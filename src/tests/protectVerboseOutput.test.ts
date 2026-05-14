/**
 * P3 tests — manual line-protection verbose output intercept.
 *
 * Verifies that when a protected block is present in protectedBlocks,
 * disassembleMemory() emits the ;;{ marker, verbatim content, and ;;}
 * in place of auto-generated lines for the protected address range.
 *
 * Also verifies the round-trip property: emit → re-import → emit produces
 * identical output (the protect markers survive a full cycle).
 */

import * as assert from 'assert';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join }   from 'path';
import { Disassembler } from '../disassembler/disasm';


// ── helpers ──────────────────────────────────────────────────────────────────

function makeDasm(org: number, bytes: number[]): any {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	return dasm;
}

/** Runs disassemble() and returns the final disassembled lines. */
function disasmLines(dasm: any): string[] {
	dasm.disassemble();
	return dasm.disassembledLines as string[];
}

function hasLine(lines: string[], substr: string): boolean {
	return lines.some(l => l.includes(substr));
}

function lineIndex(lines: string[], substr: string): number {
	return lines.findIndex(l => l.includes(substr));
}


// ── basic output shape ────────────────────────────────────────────────────────

suite('P3 — verbose output: protect block emitted verbatim', () => {


	test('protect-start marker appears in output', () => {
		// $8000: C3 05 80  JP $8005    (jump over data)
		// $8003: 34 12     [protected data]
		// $8005: C9        RET
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 34 12        DEFW $1234      ; manual content'],
		});
		const out = disasmLines(dasm);
		assert.ok(hasLine(out, ';;{'), 'protect-start marker present');
		assert.ok(hasLine(out, '8003'), 'start address in marker');
		assert.ok(hasLine(out, '8004'), 'end address in marker');
	});

	test('protect-end marker appears in output', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8004, lines: ['8003 manual'] });
		const out = disasmLines(dasm);
		assert.ok(hasLine(out, ';;}'), 'protect-end marker present');
	});

	test('manual content lines appear verbatim between markers', () => {
		const manualLine = '8003 34 12        DEFW $1234      ;; my comment';
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8004, lines: [manualLine] });
		const out = disasmLines(dasm);
		assert.ok(hasLine(out, manualLine), 'verbatim content preserved');
	});

	test('marker order: ;;{ before content, content before ;;}', () => {
		const manualLine = '8003 34 12        LD A,1';
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8004, lines: [manualLine] });
		const out = disasmLines(dasm);
		const startIdx   = lineIndex(out, ';;{');
		const contentIdx = lineIndex(out, manualLine);
		const endIdx     = lineIndex(out, ';;}');
		assert.ok(startIdx   < contentIdx, ';;{ before content');
		assert.ok(contentIdx < endIdx,     'content before ;;}');
	});

	test('no DEFB generated for the protected address range', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   ['8003 manual'],
		});
		const out = disasmLines(dasm);
		// The disassembler would normally emit "DEFB 34h, 12h" for the data bytes
		assert.ok(!out.some(l => l.includes('DEFB') && l.includes('34')),
			'no auto-DEFB for protected data bytes');
	});

	test('auto-generated label at the protected start address appears above ;;{', () => {
		// The DATA_LBL for $8003 is auto-generated because $8005 references it
		// as a JP target; we add an explicit data label to force a label at $8003.
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		(dasm as any).setFixedCodeLabel(0x8003, 'DATA_BLOCK');
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8004, lines: [] });
		const out = disasmLines(dasm);
		const labelIdx  = lineIndex(out, 'DATA_BLOCK');
		const markerIdx = lineIndex(out, ';;{');
		assert.ok(labelIdx  >= 0, 'label present');
		assert.ok(markerIdx >= 0, ';;{ present');
		assert.ok(labelIdx < markerIdx, 'label appears before ;;{');
	});

	test('code after the protected block is disassembled normally', () => {
		// $8000: C3 05 80  JP $8005
		// $8003: 34 12     [protected]
		// $8005: C9        RET   ← should appear as normal ret
		const dasm = makeDasm(0x8000, [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9]);
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8004, lines: [] });
		const out = disasmLines(dasm);
		assert.ok(hasLine(out, 'ret') || hasLine(out, 'RET'), 'RET after block emitted');
	});

	test('multiple protect blocks both emitted correctly', () => {
		// $8000: C3 08 80  JP $8008
		// $8003: AA        [protected 1]
		// $8004: BB CC     [protected 2]
		// $8007: 00        (data gap)
		// $8008: C9        RET
		const dasm = makeDasm(0x8000,
			[0xC3, 0x08, 0x80, 0xAA, 0xBB, 0xCC, 0x00, 0x00, 0xC9]);
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8003, lines: ['manual1'] });
		dasm.protectedBlocks.set(0x8004, { endAddr: 0x8005, lines: ['manual2'] });
		const out = disasmLines(dasm);
		assert.ok(hasLine(out, 'manual1'), 'first block content');
		assert.ok(hasLine(out, 'manual2'), 'second block content');
		assert.strictEqual(out.filter(l => l.includes(';;{')).length, 2, 'two ;;{ markers');
		assert.strictEqual(out.filter(l => l.includes(';;}')  ).length, 2, 'two ;;} markers');
	});

	test('empty protected block: ;;{ and ;;} with nothing in between', () => {
		const dasm = makeDasm(0x8000, [0xC3, 0x04, 0x80, 0x00, 0xC9]);
		dasm.protectedBlocks.set(0x8003, { endAddr: 0x8003, lines: [] });
		const out = disasmLines(dasm);
		const startIdx = lineIndex(out, ';;{');
		const endIdx   = lineIndex(out, ';;}');
		assert.ok(endIdx === startIdx + 1, ';;} immediately follows ;;{');
	});

});


// ── round-trip ────────────────────────────────────────────────────────────────

suite('P3 — round-trip: emit → re-import → emit produces identical output', () => {

	let tmpDir: string;
	setup(() => { tmpDir = mkdtempSync(join(tmpdir(), 'protect-rt-')); });


	test('protect block survives one full round-trip', () => {
		// Build a disassembly with a manual block.
		const bytes = [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9];
		const manualContent = '8003 34 12        DEFW $1234     ;; from hand analysis';

		const dasm1 = makeDasm(0x8000, bytes);
		dasm1.protectedBlocks.set(0x8003, {
			endAddr: 0x8004,
			lines:   [manualContent, '; note: these bytes are a data word'],
		});
		dasm1.disassemble();
		const output1 = (dasm1.disassembledLines as string[]).join('\n');

		// Write the output to a file and re-import it.
		const asmPath = join(tmpDir, 'rt.asm');
		writeFileSync(asmPath, output1 + '\n');

		const dasm2 = makeDasm(0x8000, bytes);
		dasm2.setAddressCommentsFromAsm(asmPath);
		dasm2.disassemble();
		const output2 = (dasm2.disassembledLines as string[]).join('\n');

		assert.strictEqual(output2, output1, 'round-trip output is byte-identical');
	});

	test('protect block survives two round-trips (idempotent)', () => {
		const bytes = [0xC3, 0x04, 0x80, 0x00, 0xC9];

		const dasm1 = makeDasm(0x8000, bytes);
		dasm1.protectedBlocks.set(0x8003, {
			endAddr: 0x8003,
			lines:   ['8003 00           NOP   ; manual override'],
		});
		dasm1.disassemble();
		const out1 = (dasm1.disassembledLines as string[]).join('\n');

		// First round-trip
		const p1 = join(tmpDir, 'rt1.asm');
		writeFileSync(p1, out1 + '\n');
		const dasm2 = makeDasm(0x8000, bytes);
		dasm2.setAddressCommentsFromAsm(p1);
		dasm2.disassemble();
		const out2 = (dasm2.disassembledLines as string[]).join('\n');

		// Second round-trip
		const p2 = join(tmpDir, 'rt2.asm');
		writeFileSync(p2, out2 + '\n');
		const dasm3 = makeDasm(0x8000, bytes);
		dasm3.setAddressCommentsFromAsm(p2);
		dasm3.disassemble();
		const out3 = (dasm3.disassembledLines as string[]).join('\n');

		assert.strictEqual(out2, out1, 'first round-trip identical');
		assert.strictEqual(out3, out2, 'second round-trip identical (idempotent)');
	});

	test(';;-inline-comment outside the protect block survives the round-trip', () => {
		// $8000: C3 05 80  JP $8005
		// $8003: 34 12     [protected]
		// $8005: C9        RET
		const bytes = [0xC3, 0x05, 0x80, 0x34, 0x12, 0xC9];
		const asmPath = join(tmpDir, 'rt_ctx.asm');

		// Pass 1: initial output with a protect block AND a user inline comment
		// on the JP instruction at $8000 (injected directly to avoid regex fragility).
		const dasm1 = makeDasm(0x8000, bytes);
		dasm1.protectedBlocks.set(0x8003, { endAddr: 0x8004, lines: ['8003 manual'] });
		dasm1.addressInlineComments.set(0x8000, { text: 'jump over manual block', suppressAuto: false });
		dasm1.disassemble();
		const out1 = (dasm1.disassembledLines as string[]).join('\n');
		writeFileSync(asmPath, out1 + '\n');

		// Pass 2: re-import.
		const dasm2 = makeDasm(0x8000, bytes);
		dasm2.setAddressCommentsFromAsm(asmPath);
		dasm2.disassemble();
		const out2 = (dasm2.disassembledLines as string[]).join('\n');

		assert.ok(out2.includes('jump over manual block'), 'user ;; note preserved');
		assert.ok(out2.includes(';;{'),    'protect block still present');
		assert.ok(out2.includes('manual'), 'protect content still present');
	});

});
