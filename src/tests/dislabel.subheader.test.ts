/**
 * Tests for §8.2 — the three new DisLabel fields.
 *
 * Verifies (a) default state is "un-analysed", (b) the fields accept the
 * shapes declared in §7.3.3 / §8.1, (c) nothing else about DisLabel
 * changes.
 */

import assert = require('assert');
import { DisLabel } from '../disassembler/dislabel';
import { NumberType } from '../disassembler/numbertype';


suite('§8.2 DisLabel register-analysis fields', () => {

	test('defaults to undefined on a fresh label', () => {
		const lbl: any = new DisLabel(NumberType.CODE_SUB);
		assert.equal(lbl.corruptedRegisters, undefined);
		assert.equal(lbl.preservedRegisters, undefined);
		assert.equal(lbl.registerAnalysisUnavailable, undefined);
	});


	test('corruptedRegisters / preservedRegisters accept a Set<string>', () => {
		const lbl: any = new DisLabel(NumberType.CODE_SUB);
		lbl.corruptedRegisters = new Set(['A', 'F']);
		lbl.preservedRegisters = new Set(['IX', 'IY']);
		assert(lbl.corruptedRegisters instanceof Set);
		assert(lbl.preservedRegisters instanceof Set);
		assert(lbl.corruptedRegisters.has('A'));
		assert(lbl.preservedRegisters.has('IX'));
	});


	test('registerAnalysisUnavailable accepts { reason, address }', () => {
		const lbl: any = new DisLabel(NumberType.CODE_SUB);
		lbl.registerAnalysisUnavailable = {
			reason:  'JP (HL) at $A123 prevents static classification',
			address: 0xA123,
		};
		assert.equal(lbl.registerAnalysisUnavailable.address, 0xA123);
		assert(lbl.registerAnalysisUnavailable.reason.startsWith('JP (HL)'));
	});


	test('existing DisLabel contract is preserved', () => {
		// Construction and pre-existing fields continue to behave.
		const lbl = new DisLabel(NumberType.CODE_SUB);
		assert.equal(lbl.type, NumberType.CODE_SUB);
		assert(lbl.references instanceof Set,
			'references stays a Set<number>');
		assert(Array.isArray(lbl.calls),
			'calls stays an Array<DisLabel>');
		assert.equal(lbl.isEqu, false);
		assert.equal(lbl.isFixed, false);
	});


	test('un-analysed label renders as undefined, not empty Set', () => {
		// §7.3.2: empty Set means "analysed, none corrupted". undefined
		// means "never analysed". The formatter relies on this distinction.
		const lbl: any = new DisLabel(NumberType.CODE_LBL);
		assert.strictEqual(lbl.corruptedRegisters, undefined);
		assert.notStrictEqual(lbl.corruptedRegisters, new Set());
	});

});
