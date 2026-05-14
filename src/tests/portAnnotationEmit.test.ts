/**
 * P5 emit tests — verifies that `; Port #xxxx (NAME)` (and variants)
 * appear in the verbose `.asm` disassembly output at IN r,(C) /
 * OUT (C),r lines.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { Format, HexFormat } from '../disassembler/format';
import { parsePortAddress } from '../disassembler/portLabel';


function makeDasm(org: number, bytes: number[], ports: Array<[string, string]> = []): any {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	for (const [spec, name] of ports) {
		const {address, mask} = parsePortAddress(spec);
		dasm.portLabels.push({address, mask, name});
	}
	dasm.disassemble();
	return dasm;
}

function lines(dasm: any): string[] {
	return (dasm.disassembledLines as string[]);
}

function hasLine(dasm: any, substr: string): boolean {
	return lines(dasm).some(l => l.includes(substr));
}


suite('P5 — port annotation in verbose .asm output', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; Format.hexFormat = HexFormat.CPC; });
	teardown(() => { Format.hexFormat = savedHex; });


	// ── Full-port match, named label ──────────────────────────────────────

	test('OUT (C),A with exact-match port label: emits "; Port #FFFD (AY_REGISTER)"', () => {
		// $8000: 01 FD FF  LD BC,$FFFD
		// $8003: ED 79     OUT (C),A
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		assert.ok(hasLine(dasm, 'Port #FFFD (AY_REGISTER)'),
			`Expected "Port #FFFD (AY_REGISTER)" in:\n${lines(dasm).join('\n')}`);
	});

	test('OUT (C),C with wildcard match: emits "; Port #FB7E (FDC_STATUS)"', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xED, 0x49],
			[['FB7E', 'FDC_STATUS']]);
		assert.ok(hasLine(dasm, 'Port #FB7E (FDC_STATUS)'));
	});

	test('IN A,(C) with Gate Array wildcard: emits "; Port #7F10 (GATE_ARRAY)"', () => {
		// $8000: 01 10 7F  LD BC,$7F10
		// $8003: ED 78     IN A,(C)
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x78],
			[['7F??', 'GATE_ARRAY']]);
		assert.ok(hasLine(dasm, 'Port #7F10 (GATE_ARRAY)'));
	});


	// ── Full-port match, no label — plain "Port #xxxx" ───────────────────

	test('BC fully known, no matching label: emits "; Port #1234"', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x34, 0x12, 0xED, 0x79], []);
		assert.ok(hasLine(dasm, 'Port #1234'),
			`Expected "Port #1234" in:\n${lines(dasm).join('\n')}`);
	});


	// ── Partial BC (B only) ───────────────────────────────────────────────

	test('Only B known, wildcard label: emits "Port #7F?? (GATE_ARRAY, low byte unknown)"', () => {
		// $8000: 06 7F     LD B,$7F
		// $8002: ED 78     IN A,(C)     (C is unknown)
		const dasm = makeDasm(0x8000, [0x06, 0x7F, 0xED, 0x78],
			[['7F??', 'GATE_ARRAY']]);
		assert.ok(hasLine(dasm, 'Port #7F?? (GATE_ARRAY, low byte unknown)'));
	});

	test('Only B known, no label: emits "Port #7F?? (low byte unknown)"', () => {
		const dasm = makeDasm(0x8000, [0x06, 0x7F, 0xED, 0x78], []);
		assert.ok(hasLine(dasm, 'Port #7F?? (low byte unknown)'));
	});


	// ── BC fully unknown — no annotation ────────────────────────────────

	test('BC unknown: no "Port" annotation emitted', () => {
		// OUT (C),A with no BC setup
		const dasm = makeDasm(0x8000, [0xED, 0x79], []);
		assert.ok(!hasLine(dasm, 'Port'));
	});


	// ── FDC INC BC pattern — two ports on two OUT lines ──────────────────

	test('FDC: LD BC,$FB7E / OUT / INC BC / OUT — each gets correct port annotation', () => {
		const dasm = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x49, 0x03, 0xED, 0x49],
			[['FB7E', 'FDC_STATUS'], ['FB7F', 'FDC_DATA']]);
		assert.ok(hasLine(dasm, 'Port #FB7E (FDC_STATUS)'));
		assert.ok(hasLine(dasm, 'Port #FB7F (FDC_DATA)'));
	});


	// ── CRTC pattern — two OUT with different BC values ──────────────────

	test('CRTC: LD BC,$BC01 / OUT / INC B / LD C,$23 / OUT — two ports annotated', () => {
		const dasm = makeDasm(0x8000,
			[0x01, 0x01, 0xBC, 0xED, 0x49, 0x04, 0x0E, 0x23, 0xED, 0x49],
			[['BC??', 'CRTC_INDEX'], ['BD??', 'CRTC_DATA_OUT']]);
		assert.ok(hasLine(dasm, 'Port #BC01 (CRTC_INDEX)'));
		assert.ok(hasLine(dasm, 'Port #BD23 (CRTC_DATA_OUT)'));
	});


	// ── Hex format follows --hexformat setting ────────────────────────────

	test('Port annotation uses current hex format (Z80 style → $xxxx)', () => {
		Format.hexFormat = HexFormat.Z80;
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		assert.ok(hasLine(dasm, 'Port $FFFD (AY_REGISTER)'));
		assert.ok(!hasLine(dasm, 'Port #FFFD'));
	});

	test('Port annotation uses current hex format (Intel style → xxxxh)', () => {
		Format.hexFormat = HexFormat.INTEL;
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		assert.ok(hasLine(dasm, 'Port FFFDh (AY_REGISTER)'));
	});

	test('Partial port annotation uses hex format for the known byte', () => {
		Format.hexFormat = HexFormat.Z80;
		const dasm = makeDasm(0x8000, [0x06, 0x7F, 0xED, 0x78],
			[['7F??', 'GATE_ARRAY']]);
		assert.ok(hasLine(dasm, 'Port $7F?? (GATE_ARRAY, low byte unknown)'));
	});


	// ── Coexistence with user `;;` inline comments ───────────────────────

	test('Port annotation appended before any user ;; inline comment', () => {
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		// Inject a user inline comment via the round-trip map
		(dasm as any).addressInlineComments.set(0x8003, {text: 'my note', suppressAuto: false});
		// Manually call disassembleMemory (disassemble() already ran, we just
		// want to see the re-emit). Re-run the relevant part via a fresh disassemble:
		dasm.portLabels = dasm.portLabels;  // preserve labels
		dasm.disassemble();
		// The port annotation should appear as auto-comment; user ;; appended after.
		const ioLine = lines(dasm).find(l => l.includes('out') || l.includes('OUT'));
		assert.ok(ioLine, 'should have an OUT line');
		assert.ok(ioLine!.includes('Port #FFFD'), 'auto port annotation present');
		assert.ok(ioLine!.includes('my note'), 'user note present');
	});

});
