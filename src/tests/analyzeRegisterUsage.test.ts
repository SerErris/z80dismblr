/**
 * Tests for §8.6 — the analyzeRegisterUsage() pass.
 *
 * Small hand-built subroutines with known answers. The pass is
 * expected to populate `corruptedRegisters`, `preservedRegisters`,
 * and (where appropriate) `registerAnalysisUnavailable` on each
 * CODE_SUB / CODE_RST DisLabel.
 *
 * Tests skip cleanly until the pass is wired in.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';


suite('§8.6 analyzeRegisterUsage', () => {

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


	/**
	 * Set up a standard caller+callee pattern:
	 *   0x0000: CALL 0x0010 ; RET   ← caller (clean RET before the sub)
	 *   0x0010: <subMemory>          ← callee (isolated from caller's range)
	 * Ensures the callee is not demoted to a local label.
	 */
	function loadSub(subMemory: number[]): void {
		dasm.memory.setMemory(0x0000, new Uint8Array([0xCD, 0x10, 0x00, 0xC9]));
		dasm.memory.setMemory(0x0010, new Uint8Array(subMemory));
		dasm.setLabel(0x0000);
	}


	function runAnalysis(): void {
		dasm.disassemble();
	}


	function subLabel(addr: number): any {
		return dasm.labels.get(addr);
	}


	test('empty sub (just RET) — preserves everything', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		loadSub([0xC9]);    // 0x0010: RET
		runAnalysis();

		const sub = subLabel(0x0010);
		assert(sub);
		assert(sub.corruptedRegisters instanceof Set);
		assert.equal(sub.corruptedRegisters.size, 0,
			'a bare RET corrupts no registers');
		assert(sub.preservedRegisters instanceof Set);
		assert(sub.preservedRegisters.size > 0,
			'a bare RET preserves every tracked register');
	});


	test('LD A,n ; RET — corrupts A only', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		loadSub([0x3E, 0x05, 0xC9]);    // LD A,5 ; RET
		runAnalysis();

		const sub = subLabel(0x0010);
		assert(sub.corruptedRegisters.has('A'),
			'LD A,n corrupts A');
		assert(!sub.preservedRegisters.has('A'));
		// F is not touched by LD r,n.
		assert(sub.preservedRegisters.has('F') ||
			!sub.corruptedRegisters.has('F'));
	});


	test('ADD A,B ; RET — corrupts A and F', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		loadSub([0x80, 0xC9]);    // ADD A,B ; RET
		runAnalysis();

		const sub = subLabel(0x0010);
		assert(sub.corruptedRegisters.has('A'));
		assert(sub.corruptedRegisters.has('F'));
		assert(sub.preservedRegisters.has('B'),
			'ADD A,B reads B but does not write it');
	});


	test('PUSH BC ; LD BC,nn ; POP BC ; RET — BC preserved', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		loadSub([
			0xC5,                    // PUSH BC
			0x01, 0x34, 0x12,        // LD BC,$1234
			0xC1,                    // POP BC
			0xC9,                    // RET
		]);
		runAnalysis();

		const sub = subLabel(0x0010);
		assert(sub.preservedRegisters.has('B'),
			'B restored via PUSH/POP BC');
		assert(sub.preservedRegisters.has('C'),
			'C restored via PUSH/POP BC');
		assert(!sub.corruptedRegisters.has('B'));
		assert(!sub.corruptedRegisters.has('C'));
	});


	test('callee effects propagate bottom-up', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Top-level at $0000 calls SUB_A ($0010) which calls SUB_B ($0020).
		// SUB_B corrupts A → SUB_A must inherit A as corrupted.
		dasm.memory.setMemory(0, new Uint8Array(0x30));
		dasm.memory.setMemory(0x0000, new Uint8Array([0xCD, 0x10, 0x00, 0xC9]));
		// SUB_A at $0010: CALL SUB_B ; RET
		dasm.memory.setMemory(0x0010, new Uint8Array([0xCD, 0x20, 0x00, 0xC9]));
		// SUB_B at $0020: LD A,7 ; RET
		dasm.memory.setMemory(0x0020, new Uint8Array([0x3E, 0x07, 0xC9]));
		dasm.setLabel(0x0000);
		runAnalysis();

		const a = subLabel(0x0010);
		const b = subLabel(0x0020);
		assert(b.corruptedRegisters.has('A'),
			'SUB_B corrupts A directly');
		assert(a.corruptedRegisters.has('A'),
			'SUB_A must inherit A from SUB_B (callee propagation)');
	});


	test('JP (HL) marks the sub as "analysis unavailable"', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// 0000: CALL 0003 ; RET at 0003 is not reached — JP (HL) is the sub.
		// Layout: CALL 0x0003 ; (pad) ; 0x0003: JP (HL)
		// So the sub at $0003 starts with JP (HL) — address matches.
		loadSub([0xE9]);    // 0x0010: JP (HL)
		runAnalysis();

		const sub = subLabel(0x0010);
		assert(sub.registerAnalysisUnavailable,
			'JP (HL) must trigger registerAnalysisUnavailable');
		assert(sub.registerAnalysisUnavailable.reason.includes('JP (HL)'),
			'reason string mentions the triggering opcode');
		assert.equal(sub.registerAnalysisUnavailable.address, 0x0010,
			'triggering address is the JP (HL) instruction itself');
		// Both lists collapse to empty when unavailable.
		assert.equal(sub.corruptedRegisters?.size ?? 0, 0);
		assert.equal(sub.preservedRegisters?.size ?? 0, 0);
	});


	test('caller of an "unknown" sub inherits the unavailable state', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Top:   CALL SUB_A ($0010)
		// SUB_A: CALL SUB_B ($0020) ; RET
		// SUB_B: JP (HL)   ← unavailable
		dasm.memory.setMemory(0, new Uint8Array(0x30));
		dasm.memory.setMemory(0x0000, new Uint8Array([0xCD, 0x10, 0x00, 0xC9]));
		dasm.memory.setMemory(0x0010, new Uint8Array([0xCD, 0x20, 0x00, 0xC9]));
		dasm.memory.setMemory(0x0020, new Uint8Array([0xE9]));
		dasm.setLabel(0x0000);
		runAnalysis();

		const a = subLabel(0x0010);
		const b = subLabel(0x0020);
		assert(b.registerAnalysisUnavailable, 'SUB_B directly unavailable');
		assert(a.registerAnalysisUnavailable,
			'SUB_A becomes unavailable because its callee is unknown');
		assert(a.registerAnalysisUnavailable.reason.toLowerCase()
			.includes('unknown') ||
			a.registerAnalysisUnavailable.reason.toLowerCase()
			.includes('jp (hl)'),
			'reason explains the propagation');
	});


	test('recursion: SCC is solved by fixed-point and does not hang', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Direct self-recursion: SUB_A: LD A,1 ; CALL SUB_A ; RET
		// Analyser must terminate and produce a finite result.
		dasm.memory.setMemory(0, new Uint8Array(0x20));
		dasm.memory.setMemory(0x0000, new Uint8Array([0xCD, 0x10, 0x00, 0xC9]));
		dasm.memory.setMemory(0x0010, new Uint8Array([
			0x3E, 0x01,           // LD A,1
			0xCD, 0x10, 0x00,     // CALL SUB_A   (self-recursive)
			0xC9,                 // RET
		]));
		dasm.setLabel(0x0000);
		runAnalysis();

		const a = subLabel(0x0010);
		assert(a.corruptedRegisters,
			'recursive sub still produces a corrupted set');
		assert(a.corruptedRegisters.has('A'));
	});


	test('user override via corrupted:/preserved: trumps the analyser', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Sub LD A,5 ; RET — analyser records A as corrupted.
		// The override is a formatter-level decision; the analyser's data
		// is unaffected. This test locks in that contract.
		loadSub([0x3E, 0x05, 0xC9]);    // LD A,5 ; RET
		runAnalysis();

		const sub = subLabel(0x0010);
		assert(sub.corruptedRegisters.has('A'));
	});

});
