/**
 * P2 tests — protectedBlocks field and applyAsmEventStream 'in-protect' state.
 *
 * Verifies that protect-start / protect-content / protect-end events coming
 * from the classifier are correctly stored in Disassembler.protectedBlocks,
 * and that the surrounding round-trip state (labels, comments, etc.) is
 * unaffected.
 */

import * as assert from 'assert';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


function makeDasm(): any {
	const dasm = new Disassembler() as any;
	dasm.initLabels();
	return dasm;
}

function writeSyms(dir: string, name: string, content: string): string {
	const p = join(dir, name);
	writeFileSync(p, content);
	return p;
}


suite('P2 — protectedBlocks: field and import consumer', () => {

	let tmpDir: string;
	setup(() => { tmpDir = mkdtempSync(join(tmpdir(), 'protect-import-')); });


	// ── Field initialisation ───────────────────────────────────────────────

	test('protectedBlocks is an empty Map on a fresh Disassembler', () => {
		const dasm = makeDasm();
		assert.ok(dasm.protectedBlocks instanceof Map);
		assert.strictEqual(dasm.protectedBlocks.size, 0);
	});

	test('initLabels() clears protectedBlocks', () => {
		const dasm = makeDasm();
		// Manually inject a block, then reset
		dasm.protectedBlocks.set(0xC000, { endAddr: 0xC005, lines: ['x'] });
		dasm.initLabels();
		assert.strictEqual(dasm.protectedBlocks.size, 0);
	});


	// ── Single protect block ───────────────────────────────────────────────

	test('single protect block: correct start/end addresses stored', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'a.asm', [
			';;{ C000 C005',
			'C000 3E 01        LD   A,1',
			'C002 CD 00 BB     CALL $BB00',
			'C005 C9           RET',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		assert.strictEqual(dasm.protectedBlocks.size, 1);
		const block = dasm.protectedBlocks.get(0xC000)!;
		assert.ok(block, 'block keyed by startAddr');
		assert.strictEqual(block.endAddr, 0xC005);
	});

	test('single protect block: content lines stored verbatim', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'b.asm', [
			';;{ C000 C005',
			'C000 3E 01        LD   A,1          ;; my note',
			'; a comment',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		const block = dasm.protectedBlocks.get(0xC000)!;
		assert.strictEqual(block.lines.length, 2);
		assert.strictEqual(block.lines[0], 'C000 3E 01        LD   A,1          ;; my note');
		assert.strictEqual(block.lines[1], '; a comment');
	});

	test('empty protect block: stored with empty lines array', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'c.asm', [
			';;{ C000 C005',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		const block = dasm.protectedBlocks.get(0xC000)!;
		assert.ok(block);
		assert.strictEqual(block.lines.length, 0);
	});


	// ── Multiple protect blocks ────────────────────────────────────────────

	test('two separate protect blocks both stored', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'd.asm', [
			';;{ C000 C003',
			'C000 3E 01        LD   A,1',
			';;}',
			'',
			';;{ D000 D005',
			'D000 C9           RET',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		assert.strictEqual(dasm.protectedBlocks.size, 2);
		assert.ok(dasm.protectedBlocks.has(0xC000));
		assert.ok(dasm.protectedBlocks.has(0xD000));
		assert.strictEqual(dasm.protectedBlocks.get(0xC000)!.endAddr, 0xC003);
		assert.strictEqual(dasm.protectedBlocks.get(0xD000)!.endAddr, 0xD005);
	});


	// ── Long form markers ──────────────────────────────────────────────────

	test('long form markers produce the same result as short form', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'e.asm', [
			';;PROTECT-START FB7E FB7F',
			'FB7E ED 78        IN   A,(C)',
			';;PROTECT-END',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		const block = dasm.protectedBlocks.get(0xFB7E)!;
		assert.ok(block);
		assert.strictEqual(block.endAddr, 0xFB7F);
		assert.strictEqual(block.lines[0], 'FB7E ED 78        IN   A,(C)');
	});


	// ── Surrounding context unaffected ────────────────────────────────────

	test('label before protect block is imported normally', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'f.asm', [
			'BB00 TXT_OUTPUT:',
			'',
			';;{ C000 C003',
			'C000 C9           RET',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		// Label imported normally
		assert.ok(dasm.labels.has(0xBB00));
		// Protect block also stored
		assert.strictEqual(dasm.protectedBlocks.size, 1);
	});

	test('label after protect block is imported normally', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'g.asm', [
			';;{ C000 C003',
			'C000 C9           RET',
			';;}',
			'',
			'C004 AFTER_BLOCK:',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		assert.ok(dasm.labels.has(0xC004));
		assert.strictEqual(dasm.protectedBlocks.size, 1);
	});

	test('inline comment on instruction before protect block is preserved', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'h.asm', [
			'BB00 3E 01        LD   A,1          ;; setup',
			'',
			';;{ C000 C003',
			'C000 C9           RET',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		const ic = dasm.addressInlineComments.get(0xBB00);
		assert.ok(ic, 'inline comment preserved');
		assert.strictEqual(ic.text, 'setup');
	});

	test('content inside protect block does NOT create addressInlineComments entries', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'i.asm', [
			';;{ C000 C005',
			'C000 3E 01        LD   A,1          ;; inside note',
			'C002 CD 00 BB     CALL $BB00',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		// The ;; note inside the block must NOT be imported as an inline comment
		assert.ok(!dasm.addressInlineComments.has(0xC000),
			'protect-content must not leak as addressInlineComment');
		assert.ok(!dasm.addressInlineComments.has(0xC002));
	});

	test('content inside protect block does NOT create labels', () => {
		const dasm = makeDasm();
		const p = writeSyms(tmpDir, 'j.asm', [
			';;{ C000 C005',
			'C002 INNER_LABEL:',
			';;}',
			'',
		].join('\n'));
		dasm.setAddressCommentsFromAsm(p);

		assert.ok(!dasm.labels.has(0xC002),
			'label inside protect block must not be registered');
	});

});
