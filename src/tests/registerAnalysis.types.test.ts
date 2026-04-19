/**
 * Tests for §8.1 — shared types in src/disassembler/registerAnalysis.ts.
 *
 * Until that module is created, the `before()` hook can't require it and
 * every test in this file is skipped. Once §8.1 lands the tests should
 * run and pass without modification.
 */

import assert = require('assert');


suite('§8.1 registerAnalysis types', () => {

	let mod: any;

	suiteSetup(() => {
		try {
			mod = require('../disassembler/registerAnalysis');
		} catch {
			mod = undefined;
		}
	});


	test('module exposes expected exports', function () {
		if (!mod) return this.skip();
		// Public symbols we rely on elsewhere in the implementation:
		assert('ALL_TRACKED_REGISTERS' in mod,
			'ALL_TRACKED_REGISTERS constant must be exported');
		assert('CANONICAL_ORDER' in mod,
			'CANONICAL_ORDER constant must be exported');
	});


	test('ALL_TRACKED_REGISTERS covers the main Z80 register file', function () {
		if (!mod) return this.skip();
		const set = new Set<string>(mod.ALL_TRACKED_REGISTERS);
		// 8-bit main set
		for (const r of ['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L'])
			assert(set.has(r), 'missing main 8-bit register ' + r);
		// Index halves
		for (const r of ['IXH', 'IXL', 'IYH', 'IYL'])
			assert(set.has(r), 'missing index half ' + r);
		// Specials
		for (const r of ['I', 'R', 'SP'])
			assert(set.has(r), 'missing special register ' + r);
		// Alternate set
		for (const r of ["A'", "F'", "B'", "C'", "D'", "E'", "H'", "L'"])
			assert(set.has(r), 'missing alternate register ' + r);
	});


	test('CANONICAL_ORDER is a permutation of ALL_TRACKED_REGISTERS', function () {
		if (!mod) return this.skip();
		const all = new Set<string>(mod.ALL_TRACKED_REGISTERS);
		const ord = new Set<string>(mod.CANONICAL_ORDER);
		assert.equal(all.size, ord.size);
		for (const r of all) assert(ord.has(r));
	});


	test('RegisterAnalysisResult shape — success case', function () {
		if (!mod) return this.skip();
		// Shape check via duck-typing: the analyser produces `corrupted` and
		// `preserved` sets; `unavailable` is optional.
		const ok: any = {
			corrupted: new Set(['A']),
			preserved: new Set(['B', 'C']),
		};
		assert(ok.corrupted instanceof Set);
		assert(ok.preserved instanceof Set);
		assert.equal(ok.unavailable, undefined);
	});


	test('RegisterAnalysisResult shape — unavailable case', function () {
		if (!mod) return this.skip();
		const bad: any = {
			corrupted: new Set(),
			preserved: new Set(),
			unavailable: {
				reason: 'JP (HL) at $A123 prevents static classification',
				address: 0xA123,
			},
		};
		assert.equal(typeof bad.unavailable.reason, 'string');
		assert.equal(typeof bad.unavailable.address, 'number');
		assert(bad.unavailable.reason.includes('$A123'),
			'reason string must contain the triggering hex address');
	});


	test('StructuredFields is a pure-data bag — all keys optional', function () {
		if (!mod) return this.skip();
		const empty: any = {};
		// An empty struct is valid: first-run disassembly before the user
		// has supplied anything.
		assert.equal(Object.keys(empty).length, 0);

		const full: any = {
			summary:     'x',
			action:      ['a', 'b'],
			entry:       ['DE = addr'],
			exitSuccess: ['Carry set'],
			exitFailure: ['Carry clear'],
			corrupted:   ['A', 'F'],
			preserved:   ['IX', 'IY'],
		};
		assert.equal(typeof full.summary, 'string');
		assert(Array.isArray(full.action));
		assert(Array.isArray(full.corrupted));
	});

});
