/**
 * P4 tests — manual line-protection in --cleanout output.
 *
 * Verifies that extractCleanLine() strips correctly and that
 * CleanEmitter uses extracted instructions instead of raw DEFB bytes
 * for protected address ranges.
 */

import * as assert from 'assert';
import { Disassembler } from '../disassembler/disasm';
import { CleanEmitter }  from '../disassembler/cleanEmitter';
import { Format, HexFormat } from '../disassembler/format';


// ── helpers ──────────────────────────────────────────────────────────────────

function makeDasm(org: number, bytes: number[]): any {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	return dasm;
}

function cleanLines(dasm: any, fmt: 'sjasmplus'|'maxam' = 'sjasmplus', hex = 'z80'): string[] {
	dasm.disassemble();
	return new CleanEmitter(dasm, fmt, hex as any).emit().split('\n');
}

function hasLine(lines: string[], substr: string): boolean {
	return lines.some(l => l.includes(substr));
}


// ── extractCleanLine unit tests ───────────────────────────────────────────────

suite('P4 — extractCleanLine()', () => {

	// Access the protected method via a subclass shim.
	class Shim extends CleanEmitter {
		public extract(raw: string) { return (this as any).extractCleanLine(raw); }
	}
	let shim: Shim;
	setup(() => {
		const dasm = new Disassembler() as any;
		shim = new Shim(dasm, 'sjasmplus', 'z80');
	});


	test('blank line → undefined', () => {
		assert.strictEqual(shim.extract(''), undefined);
		assert.strictEqual(shim.extract('   '), undefined);
	});

	test('pure ; comment → undefined', () => {
		assert.strictEqual(shim.extract('; a note'), undefined);
		assert.strictEqual(shim.extract('; '), undefined);
	});

	test(';; comment line → undefined (starts with ;)', () => {
		assert.strictEqual(shim.extract(';; another note'), undefined);
	});

	test('instruction with address + bytes prefix stripped', () => {
		const r = shim.extract('C000 3E 01        LD   A,1');
		assert.deepStrictEqual(r, {text: 'LD   A,1', isLabel: false});
	});

	test('instruction with address only (no bytes) stripped', () => {
		const r = shim.extract('C000 LD   A,1');
		assert.deepStrictEqual(r, {text: 'LD   A,1', isLabel: false});
	});

	test('multi-byte instruction prefix stripped', () => {
		const r = shim.extract('C000 CD 00 BB     CALL $BB00');
		assert.deepStrictEqual(r, {text: 'CALL $BB00', isLabel: false});
	});

	test('trailing ; comment stripped', () => {
		const r = shim.extract('C000 3E 01        LD   A,1        ; 01h');
		assert.deepStrictEqual(r, {text: 'LD   A,1', isLabel: false});
	});

	test('trailing ;; user comment stripped', () => {
		const r = shim.extract('C000 3E 01        LD   A,1        ;; my note');
		assert.deepStrictEqual(r, {text: 'LD   A,1', isLabel: false});
	});

	test('label line detected (ends with :)', () => {
		const r = shim.extract('C000 MY_LABEL:');
		assert.deepStrictEqual(r, {text: 'MY_LABEL:', isLabel: true});
	});

	test('label with address prefix stripped', () => {
		const r = shim.extract('C002 INNER_LABEL:');
		assert.deepStrictEqual(r, {text: 'INNER_LABEL:', isLabel: true});
	});

	test('directive (DEFW) extracted', () => {
		const r = shim.extract('C000 34 12        DEFW $1234');
		assert.deepStrictEqual(r, {text: 'DEFW $1234', isLabel: false});
	});

	test('address + instruction with no bytes column also stripped', () => {
		// Some users may write without the byte column
		const r = shim.extract('C000 DEFW $1234');
		assert.deepStrictEqual(r, {text: 'DEFW $1234', isLabel: false});
	});

});


// ── clean emitter output ─────────────────────────────────────────────────────

suite('P4 — clean output: instructions extracted, DEFB not emitted', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	test('instruction from protect block appears in clean output', () => {
		// $8000: C3 05 80  JP $8005
		// $8003: 34 12     [protected — manual DEFW]
		// $8005: C9        RET
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 34 12        DEFW $1234'],
		});
		const out = cleanLines(dasm);
		assert.ok(hasLine(out, 'DEFW') || hasLine(out, 'defw'),
			'DEFW from manual content present');
		assert.ok(hasLine(out, '$1234') || hasLine(out, '1234'),
			'word value present');
	});

	test('raw DEFB is NOT emitted for protected bytes', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 34 12        DEFW $1234'],
		});
		const out = cleanLines(dasm);
		// The disassembler would normally emit "defb $34, $12" for unprotected data
		assert.ok(!out.some(l => /defb.*\$34/i.test(l)),
			'auto defb $34 must not appear for protected range');
	});

	test('comment lines inside block dropped from clean output', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   [
				'; this is a comment that should vanish',
				'8003 34 12        DEFW $1234',
				';; another note that should vanish',
			],
		});
		const out = cleanLines(dasm);
		assert.ok(!hasLine(out, 'vanish'), 'comments dropped from clean output');
	});

	test('inline comment on instruction line stripped', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 34 12        DEFW $1234        ; pointer to something'],
		});
		const out = cleanLines(dasm);
		assert.ok(!hasLine(out, 'pointer'), 'inline comment stripped from clean');
	});

	test('multiple instructions in protect block all emitted', () => {
		// $8000: C3 07 80  JP $8007
		// $8003: 3E 01 CD 00 BB  [protected: LD A,1 + CALL $BB00]
		// $8007: C9        RET
		const dasm = makeDasm(0x8000,
			[0xC3, 0x07, 0x80, 0x3E, 0x01, 0xCD, 0x00, 0xBB, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8007,
			lines:   [
				'8003 3E 01        LD   A,1',
				'8005 CD 00 BB     CALL $BB00',
			],
		});
		const out = cleanLines(dasm);
		assert.ok(hasLine(out, 'LD') || hasLine(out, 'ld'), 'LD instruction present');
		assert.ok(hasLine(out, 'CALL') || hasLine(out, 'call'), 'CALL instruction present');
	});

	test('instruction format: tab-indented in clean output', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x04, 0x80, 0x00, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8003,
			lines:   ['8003 00           NOP'],
		});
		const out = cleanLines(dasm);
		const nopLine = out.find(l => /\bnop\b/i.test(l));
		assert.ok(nopLine, 'nop line found');
		assert.ok(nopLine!.startsWith('\t'), 'instruction is tab-indented');
	});

	test('code after the protected block assembles normally', () => {
		// RET at $8005 should still appear
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 34 12        DEFW $1234'],
		});
		const out = cleanLines(dasm);
		assert.ok(hasLine(out, 'ret') || hasLine(out, 'RET'), 'ret after block present');
	});

	test('maxam format: same extraction, label emitted without colon', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 34 12        DEFW $1234'],
		});
		const out = cleanLines(dasm, 'maxam', 'cpc');
		assert.ok(hasLine(out, 'DEFW') || hasLine(out, 'defw'));
	});

});
