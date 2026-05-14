/**
 * Integration tests for `port:XXXX NAME` declarations in the --symbols
 * file. Verifies that setAddressComments() recognises the prefix, parses
 * the wildcard address, and pushes a PortLabel onto `dasm.portLabels`
 * without disturbing the regular address-label state machine.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


suite('port: declarations in --symbols file', () => {

	let dasm: any;
	let tmpDir: string;

	setup(() => {
		dasm = new Disassembler() as any;
		dasm.initLabels();
		tmpDir = mkdtempSync(join(tmpdir(), 'port-sym-'));
	});


	function writeSyms(contents: string): string {
		const p = join(tmpDir, 's.sym');
		writeFileSync(p, contents);
		return p;
	}


	// ── Basic single-line declarations ─────────────────────────────────────

	test('single exact-match port: FFFD AY_REGISTER', () => {
		const p = writeSyms('port:FFFD AY_REGISTER\n\n');
		dasm.setAddressComments(p);
		assert.strictEqual(dasm.portLabels.length, 1);
		assert.deepStrictEqual(dasm.portLabels[0], {
			address: 0xFFFD,
			mask:    0xFFFF,
			name:    'AY_REGISTER',
		});
	});

	test('single high-byte-selector port: 7F?? GATE_ARRAY', () => {
		const p = writeSyms('port:7F?? GATE_ARRAY\n\n');
		dasm.setAddressComments(p);
		assert.strictEqual(dasm.portLabels.length, 1);
		assert.deepStrictEqual(dasm.portLabels[0], {
			address: 0x7F00,
			mask:    0xFF00,
			name:    'GATE_ARRAY',
		});
	});

	test('low-byte-selector port: ??FE ULA', () => {
		const p = writeSyms('port:??FE ULA\n\n');
		dasm.setAddressComments(p);
		assert.strictEqual(dasm.portLabels.length, 1);
		assert.deepStrictEqual(dasm.portLabels[0], {
			address: 0x00FE,
			mask:    0x00FF,
			name:    'ULA',
		});
	});


	// ── Multiple declarations ──────────────────────────────────────────────

	test('multiple consecutive port: declarations without blank lines', () => {
		const p = writeSyms(
			'port:7F?? GATE_ARRAY\n' +
			'port:BC?? CRTC_INDEX\n' +
			'port:BD?? CRTC_DATA\n' +
			'\n'
		);
		dasm.setAddressComments(p);
		assert.strictEqual(dasm.portLabels.length, 3);
		assert.strictEqual(dasm.portLabels[0].name, 'GATE_ARRAY');
		assert.strictEqual(dasm.portLabels[1].name, 'CRTC_INDEX');
		assert.strictEqual(dasm.portLabels[2].name, 'CRTC_DATA');
	});

	test('full CPC port set parses correctly', () => {
		const p = writeSyms([
			'port:7F?? GATE_ARRAY',
			'port:BC?? CRTC_INDEX',
			'port:BD?? CRTC_DATA_OUT',
			'port:BE?? CRTC_STATUS',
			'port:BF?? CRTC_DATA_IN',
			'port:F4?? PPI_PORT_A_PSG',
			'port:F5?? PPI_PORT_B_VSYNC',
			'port:F6?? PPI_PORT_C_KEY',
			'port:F7?? PPI_CONTROL',
			'port:FB7E FDC_STATUS',
			'port:FB7F FDC_DATA',
			'port:F8FF PERIPHERAL_RESET',
			'',
		].join('\n'));
		dasm.setAddressComments(p);
		assert.strictEqual(dasm.portLabels.length, 12);

		// Spot-check a wildcard entry
		const ga = dasm.portLabels.find((l: any) => l.name === 'GATE_ARRAY');
		assert.deepStrictEqual(ga, {address: 0x7F00, mask: 0xFF00, name: 'GATE_ARRAY'});

		// Spot-check an exact-match entry
		const reset = dasm.portLabels.find((l: any) => l.name === 'PERIPHERAL_RESET');
		assert.deepStrictEqual(reset, {address: 0xF8FF, mask: 0xFFFF, name: 'PERIPHERAL_RESET'});
	});


	// ── Mixed with regular address labels ──────────────────────────────────

	test('port: lines coexist with regular address+label lines', () => {
		const p = writeSyms(
			'port:7F?? GATE_ARRAY\n' +
			'\n' +
			'0BB00 KL_INIT\n' +
			'\n' +
			'port:BC?? CRTC_INDEX\n' +
			'\n' +
			'0BB06 KL_RESET\n' +
			'\n'
		);
		dasm.setAddressComments(p);

		// Both port labels present
		assert.strictEqual(dasm.portLabels.length, 2);
		assert.strictEqual(dasm.portLabels[0].name, 'GATE_ARRAY');
		assert.strictEqual(dasm.portLabels[1].name, 'CRTC_INDEX');

		// Both regular labels present in dasm.labels
		assert.ok(dasm.labels.get(0xBB00));
		assert.strictEqual(dasm.labels.get(0xBB00).name, 'KL_INIT');
		assert.ok(dasm.labels.get(0xBB06));
		assert.strictEqual(dasm.labels.get(0xBB06).name, 'KL_RESET');
	});

	test('preceding `; ` comment lines are discarded for port declarations', () => {
		const p = writeSyms(
			'; some explanatory note\n' +
			'; that should not get attached\n' +
			'port:7F?? GATE_ARRAY\n' +
			'\n'
		);
		dasm.setAddressComments(p);
		assert.strictEqual(dasm.portLabels.length, 1);
		assert.strictEqual(dasm.portLabels[0].name, 'GATE_ARRAY');
		// No address-comment entries should leak in from those `;` lines
		assert.strictEqual(dasm.addressComments.size, 0);
	});


	// ── Error cases ────────────────────────────────────────────────────────

	test('rejects malformed port line: only 3 hex chars', () => {
		const p = writeSyms('port:7F0 GATE_ARRAY\n\n');
		assert.throws(() => dasm.setAddressComments(p),
			/Malformed port declaration/);
	});

	test('rejects malformed port line: missing name', () => {
		const p = writeSyms('port:7F??\n\n');
		assert.throws(() => dasm.setAddressComments(p),
			/Malformed port declaration/);
	});

	test('rejects malformed port line: invalid hex character', () => {
		const p = writeSyms('port:7G00 BAD\n\n');
		assert.throws(() => dasm.setAddressComments(p),
			/Malformed port declaration/);
	});


	// ── Default state ──────────────────────────────────────────────────────

	test('portLabels is empty by default on a fresh Disassembler', () => {
		assert.ok(Array.isArray(dasm.portLabels));
		assert.strictEqual(dasm.portLabels.length, 0);
	});

});
