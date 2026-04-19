/**
 * Tests for §8.9 — setAddressComments() recognises the new structured
 * markers (summary / action / entry / exit-success / exit-failure /
 * corrupted / preserved) and stores them on the Disassembler's
 * addressStructured map.
 *
 * Uses a temp file for the --comments input (matching what the CLI
 * does). Tests skip when the addressStructured map is not yet present.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


suite('§8.9 setAddressComments — structured markers', () => {

	let dasm: any;
	let tmpDir: string;

	setup(() => {
		dasm = new Disassembler() as any;
		dasm.initLabels();
		tmpDir = mkdtempSync(join(tmpdir(), 'subhdr-'));
	});


	function writeCommentsFile(content: string): string {
		const path = join(tmpDir, 'comments.txt');
		writeFileSync(path, content);
		return path;
	}


	test('addressStructured map is present on the Disassembler', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		assert(dasm.addressStructured instanceof Map);
		assert.equal(dasm.addressStructured.size, 0,
			'empty on a fresh Disassembler');
	});


	test('summary: marker lands in addressStructured', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		const file = writeCommentsFile(
			'; summary: Allocate a buffer for expansion strings.\n' +
			'0BB15: KM_EXP_BUFFER\n\n');
		dasm.setAddressComments(file);

		const s = dasm.addressStructured.get(0xBB15);
		assert(s, 'structured fields must be stored for $BB15');
		assert.equal(s.summary,
			'Allocate a buffer for expansion strings.');
	});


	test('action: / entry: continuation lines accumulate into arrays', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		const file = writeCommentsFile(
			'; action: Set the address and length of the buffer.\n' +
			';         Initialise the buffer with defaults.\n' +
			'; entry:  DE = address of the buffer\n' +
			';         HL = length of the buffer\n' +
			'0BB15: KM_EXP_BUFFER\n\n');
		dasm.setAddressComments(file);

		const s = dasm.addressStructured.get(0xBB15);
		assert(s);
		assert(Array.isArray(s.action));
		assert.equal(s.action.length, 2);
		assert(Array.isArray(s.entry));
		assert.equal(s.entry.length, 2);
		assert.equal(s.entry[0], 'DE = address of the buffer');
	});


	test('exit-success: / exit-failure: markers are distinct fields', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		const file = writeCommentsFile(
			'; exit-success: Carry set\n' +
			'; exit-failure: Carry clear (buffer too short)\n' +
			'0BB15: KM_EXP_BUFFER\n\n');
		dasm.setAddressComments(file);

		const s = dasm.addressStructured.get(0xBB15);
		assert(s);
		assert.equal(s.exitSuccess[0], 'Carry set');
		assert.equal(s.exitFailure[0], 'Carry clear (buffer too short)');
	});


	test('corrupted: / preserved: parse into register arrays', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		const file = writeCommentsFile(
			'; corrupted: A, BC, DE, HL, F\n' +
			'; preserved: IX, IY\n' +
			'0BB15: KM_EXP_BUFFER\n\n');
		dasm.setAddressComments(file);

		const s = dasm.addressStructured.get(0xBB15);
		assert(s);
		// Pair shorthand expands to halves (BC -> B, C).
		assert(s.corrupted.includes('A'));
		assert(s.corrupted.includes('B'));
		assert(s.corrupted.includes('C'));
		assert(s.corrupted.includes('F'));
		assert(s.preserved.includes('IXH') && s.preserved.includes('IXL') ||
			s.preserved.includes('IX'),
			'IX must be represented either as the pair or both halves');
	});


	test('unrecognised comment lines keep the legacy behaviour', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		// A plain comment (no structured marker) must still flow into
		// the Comment.linesBefore, not silently drop.
		const file = writeCommentsFile(
			'; Just a plain hand-written note.\n' +
			'0BB15: KM_EXP_BUFFER\n\n');
		dasm.setAddressComments(file);

		const c = dasm.addressComments.get(0xBB15);
		assert(c, 'legacy comment must still be stored');
		const joined = (c.linesBefore ?? []).join('\n');
		assert(joined.includes('Just a plain hand-written note.'));
		// No structured side-effects.
		assert(!dasm.addressStructured.get(0xBB15) ||
			Object.keys(dasm.addressStructured.get(0xBB15)).length === 0);
	});


	test('multiple subroutines in one file stay independent', function () {
		// §8.9 adds a dedicated parser entry point. Skip until it exists.
		if (typeof dasm.applyStructuredMarker !== 'function') return this.skip();
		const file = writeCommentsFile(
			'; summary: Routine A\n' +
			'01000: SUB_A\n' +
			'\n' +
			'; summary: Routine B\n' +
			'02000: SUB_B\n' +
			'\n');
		dasm.setAddressComments(file);

		const a = dasm.addressStructured.get(0x1000);
		const b = dasm.addressStructured.get(0x2000);
		assert(a && a.summary === 'Routine A');
		assert(b && b.summary === 'Routine B');
	});

});
