import assert = require('assert');
import {
	parseCleanFormat,
	parseCleanHex,
	defaultHexForFormat,
} from '../disassembler/cleanEmitter';


suite('CleanEmitter — CLI option parsing', () => {

	suite('parseCleanFormat', () => {

		test('sjasmplus is accepted', () => {
			assert.strictEqual(parseCleanFormat('sjasmplus'), 'sjasmplus');
		});

		test('maxam is accepted', () => {
			assert.strictEqual(parseCleanFormat('maxam'), 'maxam');
		});

		test('invalid format throws with a clear message', () => {
			assert.throws(
				() => parseCleanFormat('invalid'),
				(e: unknown) => {
					const msg = String(e);
					return msg.includes('invalid') && msg.includes('--cleanout-format');
				},
				'expected throw to contain the bad value and the flag name'
			);
		});

	});


	suite('parseCleanHex', () => {

		test('z80 is accepted', () => {
			assert.strictEqual(parseCleanHex('z80'), 'z80');
		});

		test('cpc is accepted', () => {
			assert.strictEqual(parseCleanHex('cpc'), 'cpc');
		});

		test('intel is accepted', () => {
			assert.strictEqual(parseCleanHex('intel'), 'intel');
		});

		test('c is accepted', () => {
			assert.strictEqual(parseCleanHex('c'), 'c');
		});

		test('amp is accepted', () => {
			assert.strictEqual(parseCleanHex('amp'), 'amp');
		});

		test('invalid hex style throws with a clear message', () => {
			assert.throws(
				() => parseCleanHex('bad'),
				(e: unknown) => {
					const msg = String(e);
					return msg.includes('bad') && msg.includes('--cleanout-hex');
				}
			);
		});

	});


	suite('defaultHexForFormat', () => {

		test('sjasmplus defaults to z80 hex ($XXXX)', () => {
			assert.strictEqual(defaultHexForFormat('sjasmplus'), 'z80');
		});

		test('maxam defaults to cpc hex (#XXXX)', () => {
			assert.strictEqual(defaultHexForFormat('maxam'), 'cpc');
		});

	});

});
