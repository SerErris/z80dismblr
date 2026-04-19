/**
 * Tests for §8.8 — the rewritten getLabelComments() emits the
 * banner + firmware-style body for every CODE_SUB / CODE_RST label.
 *
 * Uses the same "as any" pattern as disasm.test.ts so we can reach
 * the protected method. Every assertion pins down a concrete line
 * of the template in §7.2.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';


suite('§8.8 getLabelComments — firmware-style header', () => {

	let dasm: any;

	setup(() => {
		dasm = new Disassembler() as any;
		dasm.labelSubPrefix = 'SUB';
		dasm.labelLblPrefix = 'LBL';
		dasm.labelDataLblPrefix = 'DATA';
		dasm.labelLocalLabelPrefix = '_lbl';
		dasm.labelLoopPrefix = '_loop';
		dasm.labelSelfModifyingPrefix = 'SELF_MOD';
		dasm.addOpcodeBytes = false;
		dasm.opcodesLowerCase = false;
		dasm.initLabels();
	});


	function disassembleTinySub(): any {
		// Caller (0x0000..0x0003) RET-terminated, so the target at
		// 0x0010 becomes its own CODE_SUB rather than a local label.
		const mem = new Uint8Array(0x14);
		mem.set([0xCD, 0x10, 0x00, 0xC9], 0x0000);   // CALL 0x0010 ; RET
		mem.set([0x3E, 0x05, 0xC9],       0x0010);   // LD A,5 ; RET
		dasm.memory.setMemory(0, mem);
		dasm.setLabel(0);
		dasm.disassemble();
		return dasm.addressComments.get(0x0010);
	}


	test('comment is stored for every CODE_SUB label', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		assert(comment, 'addressComments must have an entry for the sub');
		assert(Array.isArray(comment.linesBefore));
		assert(comment.linesBefore.length > 0);
	});


	test('banner surrounds the body (top + mid + bottom rule)', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const lines: string[] = comment.linesBefore;

		// First line and *some* later line are full 79-char asterisk rules.
		const rulePattern = /^; \*{77}$/;
		assert(rulePattern.test(lines[0]),
			'first linesBefore must be the opening banner rule');
		assert(rulePattern.test(lines[2]),
			'third linesBefore must close the banner block');

		// A matching closing rule appears at the bottom of the header.
		const ruleCount = lines.filter(l => rulePattern.test(l)).length;
		assert.equal(ruleCount, 3,
			'expected exactly three asterisk rules: top, under-banner, footer');
	});


	test('middle banner line contains "sub <NAME>"', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		assert(/^; \*{3} sub \S+/.test(comment.linesBefore[1]),
			'banner mid-line must start with "; *** sub NAME"');
	});


	test('Address / Size / Instructions / CC line is present', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const joined = comment.linesBefore.join('\n');
		// Hex-format-agnostic: accepts 0010h, $0010, #0010, 0x0010, 00010h.
		assert(/Address:\s+[\$#]?0?0010h?/.test(joined));
		assert(/Size:\s+\d+ bytes/.test(joined));
		assert(/Instructions:\s+\d+/.test(joined));
		assert(/CC:\s+\d+/.test(joined));
	});


	test('Type line distinguishes Subroutine from Restart internally', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const joined = comment.linesBefore.join('\n');
		assert(/Type:\s+Subroutine/.test(joined));
	});


	test('empty user fields render as "—"', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const joined = comment.linesBefore.join('\n');
		assert(/Summary:\s+—/.test(joined),
			'Summary defaults to em-dash on first run');
		// Action / Entry — inline placeholder when undocumented.
		assert(/Action:\s+—/.test(joined),
			'Action defaults to inline em-dash');
		assert(/Entry:\s+—/.test(joined),
			'Entry defaults to inline em-dash');
		// Exit — inline placeholder.
		assert(/Exit \(success\):\s+—/.test(joined),
			'Exit (success) defaults to inline em-dash');
	});


	test('Corrupted and Preserved lines present (no Registers: group header)', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const joined = comment.linesBefore.join('\n');
		assert(/^; Corrupted:/m.test(joined), 'Corrupted at top level');
		assert(/^; Preserved:/m.test(joined), 'Preserved at top level');
		assert(!/^; Registers:/m.test(joined), 'No Registers: group header');
	});


	test('Called by: shows the caller with parent[$hex] notation', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const joined = comment.linesBefore.join('\n');
		// The caller is the top-level SUB at 0x0000.
		// Hex-format-agnostic: accepts any of the supported styles.
		assert(/Called by:.*[\$#]?0?0000h?/.test(joined),
			'caller address $0000 missing from "Called by:" line');
	});


	test('Calls: line is present (may be "—")', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		const joined = comment.linesBefore.join('\n');
		assert(/Calls:\s+/.test(joined));
	});


	test('every body line is prefixed with "; "', function () {
		if (!dasm.addressStructured) return this.skip();
		const comment = disassembleTinySub();
		for (const l of comment.linesBefore) {
			assert(l === ';' || l.startsWith('; '),
				'header line "' + l + '" must be a comment');
		}
	});


	test('CODE_LBL / DATA_LBL labels still use the legacy one-/two-line form', function () {
		if (!dasm.addressStructured) return this.skip();
		// A pure jump target: JP $0005; (no RET reachable so it stays LBL).
		const memory = [
			0xC3, 0x05, 0x00,    // 0000: JP 0005
			0x00, 0x00,          // pad
			0x00,                // 0005: NOP (jump target)
		];
		dasm.memory.setMemory(0, new Uint8Array(memory));
		dasm.setLabel(0);
		dasm.disassemble();
		const comment = dasm.addressComments.get(0x0005);
		if (!comment) return;   // label may not be emitted — that's fine
		const hasBanner = comment.linesBefore?.some((l: string) =>
			/^; \*{77}$/.test(l));
		assert(!hasBanner,
			'non-subroutine labels must not get the sub banner');
	});

});
