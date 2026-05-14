/**
 * Level-2 word detection tests — DATA_LBL accessed by 16-bit load instructions
 * emits `defw` instead of two `defb` bytes in clean assembler output.
 *
 * Layout convention: a JP at $8000 jumps over the data block, so the data
 * bytes are never reached as fall-through code. The data label is created by
 * the LD HL/(LD (nn),HL/etc. instruction that follows.
 *
 * Design reference: design/todo.md §4.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { CleanEmitter }  from '../disassembler/cleanEmitter';


// ── helpers ─────────────────────────────────────────────────────────────────

function makeDasm(org: number, bytes: number[]): any {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	dasm.disassemble();
	return dasm;
}

function emit(dasm: any, fmt: 'sjasmplus' | 'maxam' = 'sjasmplus', hex: string = 'z80'): string {
	return new CleanEmitter(dasm, fmt, hex as any).emit();
}

/**
 * Builds a compact layout:
 *   $8000: C3 hi lo   JP $CODE
 *   $8003: ...data...
 *   $CODE: ...instructions... C9
 *
 * codeOffset = byte offset from $8003 where the code block starts.
 */
function makeLayout(dataBytes: number[], codeBytes: number[]): any {
	const dataOffset = 3;                         // after the JP
	const codeOffset = dataOffset + dataBytes.length;
	const codeAddr   = 0x8000 + codeOffset;
	const bytes: number[] = [
		0xC3, codeAddr & 0xFF, (codeAddr >> 8) & 0xFF,   // JP code
		...dataBytes,
		...codeBytes,
	];
	return makeDasm(0x8000, bytes);
}


// ── accessWidth tracking ─────────────────────────────────────────────────────

suite('Word detection — DisLabel.accessWidth set correctly', () => {

	test('LD HL,(nn) sets accessWidth=2 on the data label', () => {
		// data at $8003; code: LD HL,($8003); RET
		const dasm = makeLayout([0x34, 0x12], [0x2A, 0x03, 0x80, 0xC9]);
		const lbl = dasm.labels.get(0x8003);
		assert.ok(lbl, 'label created at $8003');
		assert.strictEqual(lbl.accessWidth, 2);
	});

	test('LD (nn),HL sets accessWidth=2', () => {
		const dasm = makeLayout([0x34, 0x12], [0x22, 0x03, 0x80, 0xC9]);
		assert.strictEqual(dasm.labels.get(0x8003)?.accessWidth, 2);
	});

	test('LD DE,(nn) (ED 5B) sets accessWidth=2', () => {
		const dasm = makeLayout([0x78, 0x56], [0xED, 0x5B, 0x03, 0x80, 0xC9]);
		assert.strictEqual(dasm.labels.get(0x8003)?.accessWidth, 2);
	});

	test('LD BC,(nn) (ED 4B) sets accessWidth=2', () => {
		const dasm = makeLayout([0x78, 0x56], [0xED, 0x4B, 0x03, 0x80, 0xC9]);
		assert.strictEqual(dasm.labels.get(0x8003)?.accessWidth, 2);
	});

	test('LD IX,(nn) (DD 2A) sets accessWidth=2', () => {
		const dasm = makeLayout([0xAB, 0xCD], [0xDD, 0x2A, 0x03, 0x80, 0xC9]);
		assert.strictEqual(dasm.labels.get(0x8003)?.accessWidth, 2);
	});

	test('LD IY,(nn) (FD 2A) sets accessWidth=2', () => {
		const dasm = makeLayout([0xAB, 0xCD], [0xFD, 0x2A, 0x03, 0x80, 0xC9]);
		assert.strictEqual(dasm.labels.get(0x8003)?.accessWidth, 2);
	});

	test('LD A,(nn) leaves accessWidth undefined (byte access)', () => {
		const dasm = makeLayout([0x42], [0x3A, 0x03, 0x80, 0xC9]);
		const lbl = dasm.labels.get(0x8003);
		assert.ok(lbl, 'label created');
		assert.strictEqual(lbl.accessWidth, undefined);
	});

	test('"Larger wins": byte + word access on same address → accessWidth=2', () => {
		// code: LD A,($8003); LD HL,($8003); RET
		const dasm = makeLayout([0x34, 0x12],
			[0x3A, 0x03, 0x80, 0x2A, 0x03, 0x80, 0xC9]);
		assert.strictEqual(dasm.labels.get(0x8003)?.accessWidth, 2);
	});

});


// ── clean emitter output ─────────────────────────────────────────────────────

suite('Word detection — clean emitter output', () => {

	test('LD HL,(addr): emits defw $1234 instead of defb $34, $12', () => {
		const dasm = makeLayout([0x34, 0x12], [0x2A, 0x03, 0x80, 0xC9]);
		const out = emit(dasm);
		assert.ok(out.includes('defw'),    'defw present');
		assert.ok(out.includes('$1234'),   'word value $1234 present');
		// The two separate defb bytes must not appear
		const badLine = out.split('\n').find(
			l => l.includes('defb') && l.includes('$34') && l.includes('$12'));
		assert.strictEqual(badLine, undefined, 'separate defb $34,$12 must not appear');
	});

	test('LD (nn),HL: also emits defw', () => {
		const dasm = makeLayout([0xCD, 0xAB], [0x22, 0x03, 0x80, 0xC9]);
		assert.ok(emit(dasm).includes('defw'));
	});

	test('LD A,(addr): byte-only access still emits defb', () => {
		const dasm = makeLayout([0x42], [0x3A, 0x03, 0x80, 0xC9]);
		const out = emit(dasm);
		assert.ok(!out.includes('defw'), 'defw must not appear for byte access');
		assert.ok(out.includes('defb'),  'defb should appear');
	});

	test('Conflicting access (byte + word) → defw wins', () => {
		const dasm = makeLayout([0x34, 0x12],
			[0x3A, 0x03, 0x80, 0x2A, 0x03, 0x80, 0xC9]);
		assert.ok(emit(dasm).includes('defw'));
	});

	test('Two consecutive word-accessed labels → two defw lines', () => {
		// data: [34 12 78 56];  code: LD HL,($8003); LD HL,($8005); RET
		const dasm = makeLayout([0x34, 0x12, 0x78, 0x56],
			[0x2A, 0x03, 0x80, 0x2A, 0x05, 0x80, 0xC9]);
		const out = emit(dasm);
		const defwLines = out.split('\n').filter(l => l.includes('defw'));
		assert.strictEqual(defwLines.length, 2, 'exactly two defw lines');
		assert.ok(out.includes('$1234'));
		assert.ok(out.includes('$5678'));
	});

	test('defw followed by extra data bytes → defw + defb for remainder', () => {
		// data: [34 12 AB];  code: LD HL,($8003); RET
		const dasm = makeLayout([0x34, 0x12, 0xAB], [0x2A, 0x03, 0x80, 0xC9]);
		const out = emit(dasm);
		assert.ok(out.includes('defw'));
		assert.ok(out.includes('defb'));
		assert.ok(out.includes('$1234'));
		assert.ok(out.includes('$AB'));
	});

	test('defw $0000 for a zero word (not defs 2)', () => {
		// data: [00 00];  code: LD HL,($8003); RET
		const dasm = makeLayout([0x00, 0x00], [0x2A, 0x03, 0x80, 0xC9]);
		const out = emit(dasm);
		assert.ok(out.includes('defw'),   'defw $0000 should appear');
		assert.ok(out.includes('$0000'),  'zero word value');
		const hasDefs2 = out.split('\n').some(l => l.includes('defs') && /\b2\b/.test(l));
		assert.ok(!hasDefs2, 'defs 2 must not be emitted for a 2-zero-byte word');
	});

	test('defw + large zero run → defw first, then defs for rest', () => {
		// data: [00 00 + 16 zeros = 18 bytes];  LD HL access
		const dataBytes = new Array(18).fill(0);
		const dasm = makeLayout(dataBytes, [0x2A, 0x03, 0x80, 0xC9]);
		const out = emit(dasm);
		assert.ok(out.includes('defw'),  'defw for the word');
		assert.ok(out.includes('defs'),  'defs for the remainder');
	});

	test('Word access at odd address emits defw (no alignment restriction)', () => {
		// data: [00 34 12];  code: LD HL,($8004); RET  (odd address $8004)
		const bytes = [
			0xC3, 0x06, 0x80,                                // JP $8006
			0x00, 0x34, 0x12,                                // $8003-$8005: pad + word
			0x2A, 0x04, 0x80,                                // $8006: LD HL,($8004) [odd]
			0xC9,
		];
		const dasm = makeDasm(0x8000, bytes);
		assert.ok(emit(dasm).includes('defw'));
	});

	test('sjasmplus format: defw $1234 (Z80 hex)', () => {
		const dasm = makeLayout([0x34, 0x12], [0x2A, 0x03, 0x80, 0xC9]);
		assert.ok(emit(dasm, 'sjasmplus', 'z80').includes('defw\t$1234'));
	});

	test('maxam format: defw #1234 (CPC hex)', () => {
		const dasm = makeLayout([0x34, 0x12], [0x2A, 0x03, 0x80, 0xC9]);
		assert.ok(emit(dasm, 'maxam', 'cpc').includes('defw\t#1234'));
	});

});
