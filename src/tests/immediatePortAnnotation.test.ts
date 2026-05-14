/**
 * P8 tests — IN A,(n) / OUT (n),A annotation and the PORT_LBL cosmetic fix.
 *
 * Covers:
 * - The old 4-digit formatting bug is gone (IN A,(FEh) not IN A,(00FEh)).
 * - Every IN A,(n) / OUT (n),A gets an annotation.
 * - With a matching low-byte port label: "Port #??FE (ULA, high byte = A at runtime)".
 * - Without a label: "Port #??FE (high byte = A at runtime)".
 * - isImmediateForm flag is set on these annotations.
 * - The (n) form is distinct from the (C) form and does not use the BC tracker.
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


suite('P8 — IN A,(n) / OUT (n),A cosmetic fix', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; Format.hexFormat = HexFormat.CPC; });
	teardown(() => { Format.hexFormat = savedHex; });


	test('IN A,($FE) — immediate formatted as 2 digits, not 4', () => {
		// Was incorrectly emitting IN A,(#00FE); now IN A,(#FE).
		const dasm = makeDasm(0x8000, [0xDB, 0xFE]);
		const out = lines(dasm).join('\n');
		assert.ok(out.includes('(#FE)'),    'expects (#FE)');
		assert.ok(!out.includes('(#00FE)'), 'must not include (#00FE)');
	});

	test('OUT ($FE),A — immediate formatted as 2 digits', () => {
		const dasm = makeDasm(0x8000, [0xD3, 0xFE]);
		const out = lines(dasm).join('\n');
		assert.ok(out.includes('(#FE)'));
		assert.ok(!out.includes('(#00FE)'));
	});

	test('All hex formats produce 2-digit immediates', () => {
		for (const [fmt, expected] of [
			[HexFormat.Z80,   '($FE)'],
			[HexFormat.INTEL, '(FEh)'],    // INTEL: no leading 0 on 2-digit
			[HexFormat.CPC,   '(#FE)'],
		] as [HexFormat, string][]) {
			Format.hexFormat = fmt;
			const dasm = makeDasm(0x8000, [0xDB, 0xFE]);
			assert.ok(hasLine(dasm, expected),
				`Expected ${expected} with format ${fmt}`);
		}
	});

});


suite('P8 — IN A,(n) / OUT (n),A annotation', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; Format.hexFormat = HexFormat.CPC; });
	teardown(() => { Format.hexFormat = savedHex; });


	// ── ioAnnotations entry ───────────────────────────────────────────────

	test('IN A,(n) gets an ioAnnotation with isImmediateForm=true', () => {
		const dasm = makeDasm(0x8000, [0xDB, 0xFE], [['??FE', 'ULA']]);
		const a = dasm.ioAnnotations.get(0x8000)!;
		assert.ok(a !== undefined);
		assert.strictEqual(a.isImmediateForm, true);
		assert.strictEqual(a.bcState.b, undefined);
		assert.strictEqual(a.bcState.c, 0xFE);
	});

	test('OUT (n),A gets an ioAnnotation with isImmediateForm=true', () => {
		const dasm = makeDasm(0x8000, [0xD3, 0xFE], [['??FE', 'ULA']]);
		const a = dasm.ioAnnotations.get(0x8000)!;
		assert.strictEqual(a.isImmediateForm, true);
		assert.strictEqual(a.bcState.c, 0xFE);
	});

	test('Annotation always present regardless of label match', () => {
		// No port labels declared.
		const dasm = makeDasm(0x8000, [0xDB, 0x7F], []);
		assert.ok(dasm.ioAnnotations.has(0x8000));
	});


	// ── Inline comment in disassembly output ──────────────────────────────

	test('Matching low-byte label: "Port #??FE (ULA, high byte = A at runtime)"', () => {
		const dasm = makeDasm(0x8000, [0xDB, 0xFE], [['??FE', 'ULA']]);
		assert.ok(hasLine(dasm, 'Port #??FE (ULA, high byte = A at runtime)'),
			`Lines:\n${lines(dasm).join('\n')}`);
	});

	test('No label match: "Port #??7F (high byte = A at runtime)"', () => {
		const dasm = makeDasm(0x8000, [0xD3, 0x7F], []);
		assert.ok(hasLine(dasm, 'Port #??7F (high byte = A at runtime)'));
	});

	test('High-byte-only label does NOT match the (n),A form', () => {
		// port:7F?? only constrains the high byte; for IN A,(n) the high byte
		// is A (unknown), so port:7F?? should not match.
		const dasm = makeDasm(0x8000, [0xDB, 0x7F], [['7F??', 'GATE_ARRAY']]);
		assert.ok(!hasLine(dasm, 'GATE_ARRAY'));
		// Falls back to plain "Port #??7F (high byte = A at runtime)"
		assert.ok(hasLine(dasm, 'Port #??7F (high byte = A at runtime)'));
	});

	test('Kempston joystick: OUT ($1F),A with ??1F label', () => {
		const dasm = makeDasm(0x8000, [0xDB, 0x1F], [['??1F', 'KEMPSTON']]);
		assert.ok(hasLine(dasm, 'Port #??1F (KEMPSTON, high byte = A at runtime)'));
	});

	test('Hex format followed for the known nibbles', () => {
		Format.hexFormat = HexFormat.Z80;
		const dasm = makeDasm(0x8000, [0xDB, 0xFE], [['??FE', 'ULA']]);
		assert.ok(hasLine(dasm, 'Port $??FE (ULA, high byte = A at runtime)'));
	});


	// ── (n) form is independent of the BC tracker ─────────────────────────

	test('BC tracker state is irrelevant for IN A,(n) annotation', () => {
		// Even with no BC setup, the annotation is emitted.
		// $8000: DB FE     IN A,($FE) — no LD BC before
		const dasm = makeDasm(0x8000, [0xDB, 0xFE], [['??FE', 'ULA']]);
		assert.ok(hasLine(dasm, 'Port #??FE (ULA, high byte = A at runtime)'));
	});


	// ── Coexistence with the BC form ──────────────────────────────────────

	test('Code using both forms: each gets the right annotation', () => {
		// $8000: DB FE     IN A,($FE)                  — immediate form
		// $8002: 01 7E FB  LD BC,$FB7E
		// $8005: ED 49     OUT (C),C                   — BC form
		const dasm = makeDasm(0x8000,
			[0xDB, 0xFE, 0x01, 0x7E, 0xFB, 0xED, 0x49],
			[['??FE', 'ULA'], ['FB7E', 'FDC_STATUS']]);
		assert.ok(hasLine(dasm, 'Port #??FE (ULA, high byte = A at runtime)'));
		assert.ok(hasLine(dasm, 'Port #FB7E (FDC_STATUS)'));
	});

});
