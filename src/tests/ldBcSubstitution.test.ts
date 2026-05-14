/**
 * P6 tests — operand substitution on LD BC,nn for exact-match port labels.
 *
 * When a LD BC,nn loads a value that:
 *   (a) matches an exact-match (mask 0xFFFF) port label, AND
 *   (b) that BC value reaches an IN r,(C) / OUT (C),r unmodified,
 * the hex immediate in the mnemonic is replaced with the label name.
 * The auto-generated "; #xxxx" comment is preserved.
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
	return dasm.disassembledLines as string[];
}

function hasLine(dasm: any, substr: string): boolean {
	return lines(dasm).some(l => l.includes(substr));
}


suite('P6 — LD BC,nn operand substitution', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; Format.hexFormat = HexFormat.CPC; });
	teardown(() => { Format.hexFormat = savedHex; });


	// ── Substitution fires for exact-match labels ─────────────────────────

	test('LD BC,$FFFD → LD BC,AY_REGISTER when port:FFFD declared', () => {
		// $8000: 01 FD FF  LD BC,$FFFD
		// $8003: ED 79     OUT (C),A
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		assert.ok(hasLine(dasm, 'AY_REGISTER'),
			`Expected AY_REGISTER in:\n${lines(dasm).join('\n')}`);
		// Raw hex must NOT appear in the mnemonic field — it's the comment's job
		assert.ok(!lines(dasm).some(l => l.match(/LD BC,.*#FFFD/i)),
			'raw #FFFD should not appear in the LD BC mnemonic');
	});

	test('LD BC line has the label name; hex reference appears on the subsequent OUT line', () => {
		// The LD BC comment carries decimal conversions (not hex — the hex was
		// the operand itself). The hex reference is visible on the OUT line as
		// "; Port #FFFD (AY_REGISTER)".
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		const ldBcLine = lines(dasm).find(l => l.includes('AY_REGISTER')
		                                    && (l.includes('ld') || l.includes('LD')));
		assert.ok(ldBcLine, 'LD BC,AY_REGISTER line present');
		// The OUT line below carries the hex reference.
		assert.ok(hasLine(dasm, 'Port #FFFD (AY_REGISTER)'),
			'hex reference present on the OUT annotation line');
	});

	test('Two exact-match ports substituted on their respective LD BC lines', () => {
		// $8000: 01 FD FF  LD BC,$FFFD   → AY_REGISTER
		// $8003: ED 79     OUT (C),A
		// $8005: 01 FD BF  LD BC,$BFFD   → AY_DATA
		// $8008: ED 79     OUT (C),A
		const dasm = makeDasm(0x8000,
			[0x01, 0xFD, 0xFF, 0xED, 0x79, 0x01, 0xFD, 0xBF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER'], ['BFFD', 'AY_DATA']]);
		assert.ok(hasLine(dasm, 'AY_REGISTER'));
		assert.ok(hasLine(dasm, 'AY_DATA'));
	});

	test('FDC exact-match: LD BC,$FB7E → LD BC,FDC_STATUS', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xED, 0x49],
			[['FB7E', 'FDC_STATUS']]);
		assert.ok(hasLine(dasm, 'FDC_STATUS'));
	});


	// ── Substitution does NOT fire for wildcard labels ────────────────────

	test('Wildcard port:BC?? does NOT substitute LD BC,$BC01', () => {
		// The low byte is data, not address — substituting would be wrong.
		const dasm = makeDasm(0x8000, [0x01, 0x01, 0xBC, 0xED, 0x49],
			[['BC??', 'CRTC_INDEX']]);
		// The OUT line gets a port annotation, but the LD BC mnemonic is unchanged.
		assert.ok(!lines(dasm).some(l => l.includes('CRTC_INDEX')
		                                && (l.includes('ld') || l.includes('LD'))),
			'LD BC should not be substituted for wildcard port');
		// The OUT (C),C line should still get the port annotation.
		assert.ok(hasLine(dasm, 'Port #BC01 (CRTC_INDEX)'));
	});

	test('Wildcard port:7F?? does NOT substitute LD BC,$7F10', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		assert.ok(!lines(dasm).some(l => l.includes('GATE_ARRAY')
		                                && (l.includes('ld') || l.includes('LD'))));
	});


	// ── Substitution does NOT fire when BC is modified before I/O ────────

	test('LD BC,$FFFC / INC BC / OUT: LD BC not substituted (different immediate)', () => {
		// The effective port is $FFFD, matching AY_REGISTER, but the LD BC
		// immediate is $FFFC — substituting LD BC would put the wrong value.
		const dasm = makeDasm(0x8000,
			[0x01, 0xFC, 0xFF, 0x03, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		// OUT still gets a port annotation.
		assert.ok(hasLine(dasm, 'Port #FFFD (AY_REGISTER)'));
		// But LD BC shows the raw immediate, not the label.
		assert.ok(!lines(dasm).some(l => l.includes('AY_REGISTER')
		                                && (l.includes('ld') || l.includes('LD'))));
	});

	test('LD BC,$FB7E / INC BC / OUT: second OUT annotated, but LD BC not substituted', () => {
		const dasm = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0x03, 0xED, 0x49],
			[['FB7F', 'FDC_DATA']]);
		assert.ok(hasLine(dasm, 'Port #FB7F (FDC_DATA)'));
		assert.ok(!lines(dasm).some(l => l.includes('FDC_DATA')
		                                && (l.includes('ld') || l.includes('LD'))));
	});


	// ── Hex style is respected ────────────────────────────────────────────

	test('Substitution works across all hex formats', () => {
		for (const [fmt, label] of [
			[HexFormat.Z80,    '$FFFD'],
			[HexFormat.INTEL,  'FFFDh'],
			[HexFormat.CPC,    '#FFFD'],
		] as [HexFormat, string][]) {
			Format.hexFormat = fmt;
			const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
				[['FFFD', 'AY_REGISTER']]);
			assert.ok(hasLine(dasm, 'AY_REGISTER'),
				`Expected substitution with ${fmt} format`);
			// The comment still carries the raw hex in the current format
			assert.ok(hasLine(dasm, label),
				`Expected raw hex ${label} in comment`);
		}
	});

});
