/**
 * Tests for lookupPort() — the port-label matching helper.
 *
 * Covers all four query kinds (full, highByte, lowByte, lowByteImmediate),
 * the "most-specific mask wins" rule, and the first-declared tie-break.
 */

import assert = require('assert');
import { PortLabel, parsePortAddress, lookupPort } from '../disassembler/portLabel';


/** Builds a PortLabel array from `port:XXXX NAME` style declarations. */
function buildLabels(...specs: Array<[string, string]>): PortLabel[] {
	return specs.map(([spec, name]) => {
		const {address, mask} = parsePortAddress(spec);
		return {address, mask, name};
	});
}


suite('lookupPort — full 16-bit query', () => {

	test('exact-match label hit: FFFD AY_REGISTER returns AY_REGISTER', () => {
		const labels = buildLabels(['FFFD', 'AY_REGISTER']);
		const r = lookupPort(labels, {kind: 'full', port: 0xFFFD});
		assert.strictEqual(r?.name, 'AY_REGISTER');
	});

	test('exact-match label miss: lookup of FFFC against FFFD returns undefined', () => {
		const labels = buildLabels(['FFFD', 'AY_REGISTER']);
		const r = lookupPort(labels, {kind: 'full', port: 0xFFFC});
		assert.strictEqual(r, undefined);
	});

	test('wildcard label hit: 7F?? GATE_ARRAY matches 7F10', () => {
		const labels = buildLabels(['7F??', 'GATE_ARRAY']);
		const r = lookupPort(labels, {kind: 'full', port: 0x7F10});
		assert.strictEqual(r?.name, 'GATE_ARRAY');
	});

	test('wildcard label miss: 7F?? does NOT match 8F10', () => {
		const labels = buildLabels(['7F??', 'GATE_ARRAY']);
		const r = lookupPort(labels, {kind: 'full', port: 0x8F10});
		assert.strictEqual(r, undefined);
	});

	test('low-byte label matches via full query: ??FE ULA matches 7FFE', () => {
		const labels = buildLabels(['??FE', 'ULA']);
		const r = lookupPort(labels, {kind: 'full', port: 0x7FFE});
		assert.strictEqual(r?.name, 'ULA');
	});

	test('all-wildcard label matches any port (lowest priority)', () => {
		const labels = buildLabels(['????', 'ANY_PORT']);
		const r = lookupPort(labels, {kind: 'full', port: 0x1234});
		assert.strictEqual(r?.name, 'ANY_PORT');
	});

	test('empty labels array returns undefined', () => {
		const r = lookupPort([], {kind: 'full', port: 0xFB7E});
		assert.strictEqual(r, undefined);
	});

});


suite('lookupPort — most-specific wins', () => {

	test('FB?? FDC_BASE + FB7E FDC_STATUS: lookup of FB7E returns FDC_STATUS', () => {
		const labels = buildLabels(
			['FB??', 'FDC_BASE'],
			['FB7E', 'FDC_STATUS'],
		);
		const r = lookupPort(labels, {kind: 'full', port: 0xFB7E});
		assert.strictEqual(r?.name, 'FDC_STATUS');
	});

	test('order-independence: more-specific wins regardless of declaration order', () => {
		const a = buildLabels(['FB7E', 'FDC_STATUS'], ['FB??', 'FDC_BASE']);
		const b = buildLabels(['FB??', 'FDC_BASE'],   ['FB7E', 'FDC_STATUS']);
		assert.strictEqual(lookupPort(a, {kind: 'full', port: 0xFB7E})?.name, 'FDC_STATUS');
		assert.strictEqual(lookupPort(b, {kind: 'full', port: 0xFB7E})?.name, 'FDC_STATUS');
	});

	test('FB?? FDC_BASE matches FB7D (no FDC_STATUS at FB7D): returns FDC_BASE', () => {
		const labels = buildLabels(
			['FB??', 'FDC_BASE'],
			['FB7E', 'FDC_STATUS'],
		);
		const r = lookupPort(labels, {kind: 'full', port: 0xFB7D});
		assert.strictEqual(r?.name, 'FDC_BASE');
	});

	test('all-wildcard loses to any narrower match', () => {
		const labels = buildLabels(
			['????', 'CATCHALL'],
			['7F??', 'GATE_ARRAY'],
		);
		const r = lookupPort(labels, {kind: 'full', port: 0x7F10});
		assert.strictEqual(r?.name, 'GATE_ARRAY');
	});

});


suite('lookupPort — first-declared tie-break', () => {

	test('two equal-specificity wildcards: first-declared wins', () => {
		// Same mask popcount (8 — high byte mask only), both match high byte 7F
		// (impossible for two CPC ports in practice, but the tie-break must be defined)
		const labels: PortLabel[] = [
			{address: 0x7F00, mask: 0xFF00, name: 'FIRST'},
			{address: 0x7F00, mask: 0xFF00, name: 'SECOND'},
		];
		const r = lookupPort(labels, {kind: 'full', port: 0x7F10});
		assert.strictEqual(r?.name, 'FIRST');
	});

	test('two equal-specificity exact-matches: first-declared wins', () => {
		const labels = buildLabels(
			['F8FF', 'PRIMARY'],
			['F8FF', 'SHADOW'],
		);
		const r = lookupPort(labels, {kind: 'full', port: 0xF8FF});
		assert.strictEqual(r?.name, 'PRIMARY');
	});

});


suite('lookupPort — highByte (B only) query', () => {

	test('high-byte-only label hit: 7F?? matches highByte b=7F', () => {
		const labels = buildLabels(['7F??', 'GATE_ARRAY']);
		const r = lookupPort(labels, {kind: 'highByte', b: 0x7F});
		assert.strictEqual(r?.name, 'GATE_ARRAY');
	});

	test('high-byte-only label miss: b=8F does not match 7F??', () => {
		const labels = buildLabels(['7F??', 'GATE_ARRAY']);
		const r = lookupPort(labels, {kind: 'highByte', b: 0x8F});
		assert.strictEqual(r, undefined);
	});

	test('exact-match label cannot match highByte query (low byte unknown)', () => {
		// FB7E requires the low byte to be known; a B-only query cannot satisfy it.
		const labels = buildLabels(['FB7E', 'FDC_STATUS']);
		const r = lookupPort(labels, {kind: 'highByte', b: 0xFB});
		assert.strictEqual(r, undefined);
	});

	test('low-byte-only label cannot match highByte query', () => {
		// ??FE requires knowing C; a B-only query has no information about C.
		const labels = buildLabels(['??FE', 'ULA']);
		const r = lookupPort(labels, {kind: 'highByte', b: 0x7F});
		assert.strictEqual(r, undefined);
	});

	test('all-wildcard label always matches highByte query', () => {
		const labels = buildLabels(['????', 'ANY']);
		const r = lookupPort(labels, {kind: 'highByte', b: 0x42});
		assert.strictEqual(r?.name, 'ANY');
	});

	test('mixed-mask: ?F?? does not constrain low byte, matches when high nibble correct', () => {
		// Mask = 0x0F00 — only the lower nibble of the high byte is constrained.
		const labels = buildLabels(['?F??', 'WEIRD']);
		// b=0x7F: high byte = 0x7F, low nibble of high byte = 0xF → matches.
		assert.strictEqual(lookupPort(labels, {kind: 'highByte', b: 0x7F})?.name, 'WEIRD');
		// b=0x70: high byte = 0x70, low nibble = 0x0 → does not match.
		assert.strictEqual(lookupPort(labels, {kind: 'highByte', b: 0x70}), undefined);
	});

});


suite('lookupPort — lowByte (C only) query', () => {

	test('low-byte-only label hit: ??FE matches lowByte c=FE', () => {
		const labels = buildLabels(['??FE', 'ULA']);
		const r = lookupPort(labels, {kind: 'lowByte', c: 0xFE});
		assert.strictEqual(r?.name, 'ULA');
	});

	test('low-byte-only label miss: c=FD does not match ??FE', () => {
		const labels = buildLabels(['??FE', 'ULA']);
		const r = lookupPort(labels, {kind: 'lowByte', c: 0xFD});
		assert.strictEqual(r, undefined);
	});

	test('high-byte-only label cannot match lowByte query', () => {
		const labels = buildLabels(['7F??', 'GATE_ARRAY']);
		const r = lookupPort(labels, {kind: 'lowByte', c: 0x00});
		assert.strictEqual(r, undefined);
	});

	test('exact-match label cannot match lowByte query (high byte unknown)', () => {
		const labels = buildLabels(['FFFD', 'AY_REGISTER']);
		const r = lookupPort(labels, {kind: 'lowByte', c: 0xFD});
		assert.strictEqual(r, undefined);
	});

});


suite('lookupPort — lowByteImmediate query (IN A,(n) / OUT (n),A)', () => {

	test('matches same labels as lowByte', () => {
		// Spectrum-flavour declarations.
		const labels = buildLabels(
			['??FE', 'ULA'],
			['??1F', 'KEMPSTON'],
		);
		assert.strictEqual(lookupPort(labels, {kind: 'lowByteImmediate', n: 0xFE})?.name, 'ULA');
		assert.strictEqual(lookupPort(labels, {kind: 'lowByteImmediate', n: 0x1F})?.name, 'KEMPSTON');
		assert.strictEqual(lookupPort(labels, {kind: 'lowByteImmediate', n: 0x42}), undefined);
	});

	test('high-byte-constraining labels cannot match', () => {
		// On CPC almost no port is declared low-byte-only, so OUT (n),A typically
		// finds no match (which the annotation pass then surfaces as "unknown").
		const labels = buildLabels(
			['7F??', 'GATE_ARRAY'],
			['FB7E', 'FDC_STATUS'],
		);
		assert.strictEqual(lookupPort(labels, {kind: 'lowByteImmediate', n: 0x00}), undefined);
		assert.strictEqual(lookupPort(labels, {kind: 'lowByteImmediate', n: 0x7E}), undefined);
	});

});


suite('lookupPort — CPC realistic mixed bag', () => {

	const cpc = buildLabels(
		['7F??', 'GATE_ARRAY'],
		['BC??', 'CRTC_INDEX'],
		['BD??', 'CRTC_DATA_OUT'],
		['BE??', 'CRTC_STATUS'],
		['BF??', 'CRTC_DATA_IN'],
		['F4??', 'PPI_PORT_A_PSG'],
		['F5??', 'PPI_PORT_B_VSYNC'],
		['F6??', 'PPI_PORT_C_KEY'],
		['F7??', 'PPI_CONTROL'],
		['FB7E', 'FDC_STATUS'],
		['FB7F', 'FDC_DATA'],
		['F8FF', 'PERIPHERAL_RESET'],
	);

	test('LD BC,#7F10 / OUT (C),A — full port 7F10 → GATE_ARRAY', () => {
		assert.strictEqual(
			lookupPort(cpc, {kind: 'full', port: 0x7F10})?.name,
			'GATE_ARRAY');
	});

	test('LD BC,#BC01 / OUT (C),C — full port BC01 → CRTC_INDEX (low byte data-piggyback)', () => {
		assert.strictEqual(
			lookupPort(cpc, {kind: 'full', port: 0xBC01})?.name,
			'CRTC_INDEX');
	});

	test('LD BC,#BD23 / OUT (C),C — full port BD23 → CRTC_DATA_OUT', () => {
		assert.strictEqual(
			lookupPort(cpc, {kind: 'full', port: 0xBD23})?.name,
			'CRTC_DATA_OUT');
	});

	test('FDC sub-addressing: FB7E → FDC_STATUS, FB7F → FDC_DATA', () => {
		assert.strictEqual(lookupPort(cpc, {kind: 'full', port: 0xFB7E})?.name, 'FDC_STATUS');
		assert.strictEqual(lookupPort(cpc, {kind: 'full', port: 0xFB7F})?.name, 'FDC_DATA');
	});

	test('Only B known (b=7F): GATE_ARRAY matches', () => {
		assert.strictEqual(
			lookupPort(cpc, {kind: 'highByte', b: 0x7F})?.name,
			'GATE_ARRAY');
	});

	test('Only B known (b=FB): no wildcard label for FB, exact FB7E/F not matchable → undefined', () => {
		// FB?? is not declared, only FB7E / FB7F. A B-only query can't hit those.
		assert.strictEqual(lookupPort(cpc, {kind: 'highByte', b: 0xFB}), undefined);
	});

	test('Unknown port falls through (no annotation produced by caller)', () => {
		assert.strictEqual(lookupPort(cpc, {kind: 'full', port: 0x1234}), undefined);
	});

});
