/**
 * Tests for §8.7 — pure formatting helpers used by the subroutine header.
 *
 * Imports are dynamic so the file compiles before the helpers exist.
 * The helpers are expected to be exported from a new module —
 * src/disassembler/headerFormatters.ts — or re-exported from disasm.ts.
 * Adjust the require() path once the implementation lands.
 */

import assert = require('assert');


suite('§8.7 header formatting helpers', () => {

	let fmt: any;

	suiteSetup(() => {
		try {
			fmt = require('../disassembler/headerFormatters');
		} catch {
			try { fmt = require('../disassembler/disasm'); }
			catch { fmt = undefined; }
		}
	});


	suite('buildBannerRule()', () => {

		test('produces exactly 79 characters', function () {
			if (!fmt?.buildBannerRule) return this.skip();
			const rule = fmt.buildBannerRule();
			assert.equal(rule.length, 79,
				'banner rule must be 79 chars wide (§7.7 resolved)');
		});


		test('starts with "; " and is all asterisks after that', function () {
			if (!fmt?.buildBannerRule) return this.skip();
			const rule = fmt.buildBannerRule();
			assert(rule.startsWith('; '));
			assert(/^; \*{77}$/.test(rule));
		});
	});


	suite('buildBannerMid()', () => {

		test('produces exactly 79 characters', function () {
			if (!fmt?.buildBannerMid) return this.skip();
			assert.equal(fmt.buildBannerMid('FOO').length, 79);
			assert.equal(fmt.buildBannerMid('SUB001').length, 79);
			assert.equal(fmt.buildBannerMid('A').length, 79);
		});


		test('uses the "sub " prefix uniformly (§7.7 resolved)', function () {
			if (!fmt?.buildBannerMid) return this.skip();
			const line = fmt.buildBannerMid('KM_EXP_BUFFER');
			assert(line.includes('sub KM_EXP_BUFFER'));
			// Never "rst " — that distinction was dropped.
			assert(!/\brst /.test(line));
		});


		test('wraps name in leading "; *** " and trailing " ***"', function () {
			if (!fmt?.buildBannerMid) return this.skip();
			const line = fmt.buildBannerMid('FOO');
			assert(line.startsWith('; *** '));
			assert(line.endsWith(' ***'));
		});


		test('pads short names to 79 chars with spaces', function () {
			if (!fmt?.buildBannerMid) return this.skip();
			const line = fmt.buildBannerMid('X');
			// Between "sub X" and "***" there should be only spaces.
			const body = line.slice('; *** '.length, line.length - ' ***'.length);
			assert.equal(body.length, 69);
			assert(body.startsWith('sub X'));
			assert(/^sub X\s+$/.test(body));
		});


		test('truncates overly long names with a trailing ellipsis', function () {
			if (!fmt?.buildBannerMid) return this.skip();
			const longName = 'A'.repeat(200);
			const line = fmt.buildBannerMid(longName);
			assert.equal(line.length, 79,
				'width stays 79 even when truncated');
			assert(line.includes('…'),
				'truncation marker "…" must be present');
		});
	});


	suite('collapseRegisterPairs()', () => {

		test('collapses both halves of a pair to the pair name', function () {
			if (!fmt?.collapseRegisterPairs) return this.skip();
			assert.deepEqual(
				fmt.collapseRegisterPairs(new Set(['B', 'C'])),
				['BC']);
			assert.deepEqual(
				fmt.collapseRegisterPairs(new Set(['A', 'F'])),
				['AF']);
			assert.deepEqual(
				fmt.collapseRegisterPairs(new Set(['IXH', 'IXL'])),
				['IX']);
		});


		test('keeps singletons split (§7.7 resolved)', function () {
			if (!fmt?.collapseRegisterPairs) return this.skip();
			assert.deepEqual(
				fmt.collapseRegisterPairs(new Set(['B'])),
				['B']);
			assert.deepEqual(
				fmt.collapseRegisterPairs(new Set(['H'])),
				['H']);
		});


		test('mixed pair + singleton renders in canonical order', function () {
			if (!fmt?.collapseRegisterPairs) return this.skip();
			const out = fmt.collapseRegisterPairs(
				new Set(['A', 'F', 'B', 'H', 'L']));
			assert.deepEqual(out, ['AF', 'HL', 'B']);
		});


		test('alternate pairs use the AF\'/BC\' style', function () {
			if (!fmt?.collapseRegisterPairs) return this.skip();
			assert.deepEqual(
				fmt.collapseRegisterPairs(new Set(["B'", "C'"])),
				["BC'"]);
		});


		test('empty set yields empty array', function () {
			if (!fmt?.collapseRegisterPairs) return this.skip();
			assert.deepEqual(fmt.collapseRegisterPairs(new Set()), []);
		});
	});


	suite('renderList()', () => {

		test('undefined / empty render as "—" (em-dash)', function () {
			if (!fmt?.renderList) return this.skip();
			assert.equal(fmt.renderList(undefined), '—');
			assert.equal(fmt.renderList([]), '—');
		});


		test('non-empty renders comma-space joined', function () {
			if (!fmt?.renderList) return this.skip();
			assert.equal(fmt.renderList(['A', 'BC', 'HL']), 'A, BC, HL');
		});
	});

});
