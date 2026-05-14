/**
 * Tests for analyseIoPorts() — the P4 glue pass that combines the BC
 * tracker (P3) with the port-label lookup (P2) to build the
 * `ioAnnotations` and `ldBcPortSubstitutions` maps consumed by the
 * emitter in P5/P6.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { parsePortAddress } from '../disassembler/portLabel';


/** Convenience helper: declares port labels directly on the Disassembler. */
function declarePort(dasm: any, spec: string, name: string): void {
	const {address, mask} = parsePortAddress(spec);
	dasm.portLabels.push({address, mask, name});
}


/** Builds a Disassembler with bytes loaded at `org` and the given port labels. */
function makeDasm(
	org:    number,
	bytes:  number[],
	ports:  Array<[string, string]> = [],
): any {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	for (const [spec, name] of ports)
		declarePort(dasm, spec, name);
	dasm.disassemble();
	return dasm;
}


// ---------------------------------------------------------------------------
// Detection: which instructions get annotated
// ---------------------------------------------------------------------------

suite('analyseIoPorts — instruction detection', () => {

	test('OUT (C),A (ED 79) is detected', () => {
		// $8000: 01 FD FF  LD BC,$FFFD
		// $8003: ED 79     OUT (C),A
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		assert.ok(dasm.ioAnnotations.has(0x8003));
	});

	test('IN A,(C) (ED 78) is detected', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x40, 0xF6, 0xED, 0x78],
			[['F6??', 'PPI_PORT_C_KEY']]);
		assert.ok(dasm.ioAnnotations.has(0x8003));
	});

	test('OUT (C),C (ED 49) is detected', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xED, 0x49],
			[['FB7E', 'FDC_STATUS']]);
		assert.ok(dasm.ioAnnotations.has(0x8003));
	});

	test('All eight IN r,(C) variants are detected', () => {
		// ED 40, 48, 50, 58, 60, 68, 70, 78  — IN B/C/D/E/H/L/(F)/A,(C)
		const bytes: number[] = [];
		bytes.push(0x01, 0x00, 0x7F);     // LD BC,$7F00
		for (const op2 of [0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78])
			bytes.push(0xED, op2);
		const dasm = makeDasm(0x8000, bytes, [['7F??', 'GATE_ARRAY']]);

		for (let i = 0; i < 8; i++) {
			const ioAddr = 0x8003 + i * 2;
			assert.ok(dasm.ioAnnotations.has(ioAddr),
				`expected annotation at $${ioAddr.toString(16)}`);
		}
	});

	test('ED 78 followed by ED 42 (SBC HL,BC): only ED 78 is annotated', () => {
		// ED 42 is SBC HL,BC, not an IN/OUT. Must not be detected.
		const dasm = makeDasm(0x8000,
			[0x01, 0x00, 0x7F,         // LD BC,$7F00
			 0xED, 0x78,                // IN A,(C)
			 0xED, 0x42],               // SBC HL,BC
			[['7F??', 'GATE_ARRAY']]);
		assert.ok(dasm.ioAnnotations.has(0x8003), 'IN A,(C) annotated');
		assert.ok(!dasm.ioAnnotations.has(0x8005), 'SBC HL,BC not annotated');
	});

	test('IN A,(n) / OUT (n),A (DB/D3) are annotated with the immediate form (P8)', () => {
		// $8000: DB FE     IN A,($FE)
		// $8002: D3 FE     OUT ($FE),A
		const dasm = makeDasm(0x8000, [0xDB, 0xFE, 0xD3, 0xFE],
			[['??FE', 'ULA']]);
		assert.ok(dasm.ioAnnotations.has(0x8000), 'IN A,(n) annotated');
		assert.ok(dasm.ioAnnotations.has(0x8002), 'OUT (n),A annotated');
		// Both have the immediate form flag set.
		assert.strictEqual(dasm.ioAnnotations.get(0x8000)!.isImmediateForm, true);
		assert.strictEqual(dasm.ioAnnotations.get(0x8002)!.isImmediateForm, true);
	});

});


// ---------------------------------------------------------------------------
// Annotation contents
// ---------------------------------------------------------------------------

suite('analyseIoPorts — annotation contents', () => {

	test('Full BC match: bcState + portLabel + sourceLdBcAddr present', () => {
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		const a = dasm.ioAnnotations.get(0x8003)!;
		assert.deepStrictEqual(a.bcState, {b: 0xFF, c: 0xFD});
		assert.strictEqual(a.portLabel?.name, 'AY_REGISTER');
		assert.strictEqual(a.sourceLdBcAddr, 0x8000);
	});

	test('Wildcard match: portLabel set, sourceLdBcAddr present but no substitution', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		const a = dasm.ioAnnotations.get(0x8003)!;
		assert.deepStrictEqual(a.bcState, {b: 0x7F, c: 0x10});
		assert.strictEqual(a.portLabel?.name, 'GATE_ARRAY');
		assert.strictEqual(a.sourceLdBcAddr, 0x8000);
		// Substitution map should NOT have an entry (wildcard, not exact).
		assert.strictEqual(dasm.ldBcPortSubstitutions.size, 0);
	});

	test('Fully known BC, no matching label: annotation present without portLabel', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x34, 0x12, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);   // does not match $1234
		const a = dasm.ioAnnotations.get(0x8003)!;
		assert.deepStrictEqual(a.bcState, {b: 0x12, c: 0x34});
		assert.strictEqual(a.portLabel, undefined);
	});

	test('Only B known: highByte query produces partial annotation', () => {
		// $8000: 06 7F     LD B,$7F
		// $8002: ED 78     IN A,(C)
		const dasm = makeDasm(0x8000, [0x06, 0x7F, 0xED, 0x78],
			[['7F??', 'GATE_ARRAY']]);
		const a = dasm.ioAnnotations.get(0x8002)!;
		assert.deepStrictEqual(a.bcState, {b: 0x7F, c: undefined});
		assert.strictEqual(a.portLabel?.name, 'GATE_ARRAY');
		// No source LD BC,nn (we used LD B,#n) → no substitution.
		assert.strictEqual(a.sourceLdBcAddr, undefined);
	});

	test('BC fully unknown AND no label: no annotation', () => {
		// Just an OUT (C),A with no setup → BC unknown, no label, skip.
		const dasm = makeDasm(0x8000, [0xED, 0x79], []);
		assert.ok(!dasm.ioAnnotations.has(0x8000));
	});

});


// ---------------------------------------------------------------------------
// FDC / CRTC patterns from the design doc
// ---------------------------------------------------------------------------

suite('analyseIoPorts — FDC INC BC pattern', () => {

	test('LD BC,$FB7E / OUT (C),C / INC BC / OUT (C),C — two distinct ports', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED 49     OUT (C),C       (FB7E → FDC_STATUS)
		// $8005: 03        INC BC
		// $8006: ED 49     OUT (C),C       (FB7F → FDC_DATA)
		const dasm = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x49, 0x03, 0xED, 0x49],
			[
				['FB7E', 'FDC_STATUS'],
				['FB7F', 'FDC_DATA'],
			]);
		assert.strictEqual(dasm.ioAnnotations.get(0x8003)!.portLabel?.name, 'FDC_STATUS');
		assert.strictEqual(dasm.ioAnnotations.get(0x8006)!.portLabel?.name, 'FDC_DATA');
		// First I/O has a clean source LD BC; second one's source was cleared by INC BC.
		assert.strictEqual(dasm.ioAnnotations.get(0x8003)!.sourceLdBcAddr, 0x8000);
		assert.strictEqual(dasm.ioAnnotations.get(0x8006)!.sourceLdBcAddr, undefined);
	});

});


suite('analyseIoPorts — CRTC INC B + LD C,#n pattern', () => {

	test('LD BC,$BC01 / OUT / INC B / LD C,$23 / OUT — both annotated', () => {
		// $8000: 01 01 BC  LD BC,$BC01
		// $8003: ED 49     OUT (C),C       (BC01 → CRTC_INDEX wildcard)
		// $8005: 04        INC B
		// $8006: 0E 23     LD C,$23
		// $8008: ED 49     OUT (C),C       (BD23 → CRTC_DATA_OUT wildcard)
		const dasm = makeDasm(0x8000,
			[0x01, 0x01, 0xBC, 0xED, 0x49, 0x04, 0x0E, 0x23, 0xED, 0x49],
			[
				['BC??', 'CRTC_INDEX'],
				['BD??', 'CRTC_DATA_OUT'],
			]);
		assert.strictEqual(dasm.ioAnnotations.get(0x8003)!.portLabel?.name, 'CRTC_INDEX');
		assert.strictEqual(dasm.ioAnnotations.get(0x8008)!.portLabel?.name, 'CRTC_DATA_OUT');
		// Both are wildcard matches → no substitutions.
		assert.strictEqual(dasm.ldBcPortSubstitutions.size, 0);
	});

});


// ---------------------------------------------------------------------------
// ldBcPortSubstitutions — exact-match only
// ---------------------------------------------------------------------------

suite('analyseIoPorts — ldBcPortSubstitutions (P6 prep)', () => {

	test('Exact-match label + matching LD BC,nn → substitution recorded', () => {
		// LD BC,$FFFD; OUT (C),A   with port:FFFD AY_REGISTER  → substitute LD BC
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		const sub = dasm.ldBcPortSubstitutions.get(0x8000);
		assert.strictEqual(sub?.name, 'AY_REGISTER');
	});

	test('Wildcard label → no substitution even when match', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		assert.strictEqual(dasm.ldBcPortSubstitutions.size, 0);
	});

	test('Exact-match label but LD BC immediate differs → no substitution', () => {
		// LD BC,$FFFC; INC BC; OUT (C),A   port:FFFD AY_REGISTER
		// BC at OUT = $FFFD, matches AY_REGISTER. But LD BC's immediate is $FFFC,
		// so we must NOT substitute.
		const dasm = makeDasm(0x8000,
			[0x01, 0xFC, 0xFF, 0x03, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		// The annotation still records the port label (BC value matches).
		assert.strictEqual(dasm.ioAnnotations.get(0x8004)!.portLabel?.name, 'AY_REGISTER');
		// But INC BC cleared the source, so no substitution candidate.
		assert.strictEqual(dasm.ldBcPortSubstitutions.size, 0);
	});

	test('Two distinct LD BC,nn → two substitutions, keyed by their addresses', () => {
		// $8000: 01 FD FF  LD BC,$FFFD     ; port FFFD = AY_REGISTER
		// $8003: ED 79     OUT (C),A
		// $8005: 01 FD BF  LD BC,$BFFD     ; port BFFD = AY_DATA
		// $8008: ED 79     OUT (C),A
		const dasm = makeDasm(0x8000,
			[0x01, 0xFD, 0xFF, 0xED, 0x79, 0x01, 0xFD, 0xBF, 0xED, 0x79],
			[
				['FFFD', 'AY_REGISTER'],
				['BFFD', 'AY_DATA'],
			]);
		assert.strictEqual(dasm.ldBcPortSubstitutions.size, 2);
		assert.strictEqual(dasm.ldBcPortSubstitutions.get(0x8000)?.name, 'AY_REGISTER');
		assert.strictEqual(dasm.ldBcPortSubstitutions.get(0x8005)?.name, 'AY_DATA');
	});

});


// ---------------------------------------------------------------------------
// No port labels declared — graceful degradation
// ---------------------------------------------------------------------------

suite('analyseIoPorts — no port labels declared', () => {

	test('BC fully known but no labels → annotation still recorded for "Port #xxxx" emit', () => {
		// User wants `; Port #FFFD` even without a named label so they can
		// look it up. analyseIoPorts must record the annotation.
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79], []);
		const a = dasm.ioAnnotations.get(0x8003)!;
		assert.ok(a !== undefined, 'annotation should be present');
		assert.deepStrictEqual(a.bcState, {b: 0xFF, c: 0xFD});
		assert.strictEqual(a.portLabel, undefined);
	});

	test('BC fully unknown and no labels → no annotation', () => {
		const dasm = makeDasm(0x8000, [0xED, 0x79], []);
		assert.ok(!dasm.ioAnnotations.has(0x8000));
	});

});
