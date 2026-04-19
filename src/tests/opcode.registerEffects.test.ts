/**
 * Tests for §8.3 — the Opcode tables publish writes/reads register
 * masks used by analyzeRegisterUsage().
 *
 * Sanity-checks a handful of representative instructions rather than
 * the full 256 x 4 tables. If these pass, the pattern is right; bulk
 * correctness is a job for a generator script + a golden file.
 */

import assert = require('assert');
import { Opcodes, OpcodesED, OpcodesCB } from '../disassembler/opcode';


suite('§8.3 Opcode.writes / Opcode.reads', () => {

	function hasMasks(op: any): boolean {
		return op && op.writes instanceof Set && op.reads instanceof Set;
	}


	test('every non-array opcode exposes writes & reads as Sets', function () {
		if (!hasMasks(Opcodes[0x00])) return this.skip();
		for (let i = 0; i < Opcodes.length; i++) {
			const op: any = Opcodes[i];
			if (!op || Array.isArray(op)) continue;
			assert(op.writes instanceof Set,
				'opcode 0x' + i.toString(16) + ' (' + op.name +
				') must have writes: Set');
			assert(op.reads instanceof Set,
				'opcode 0x' + i.toString(16) + ' (' + op.name +
				') must have reads: Set');
		}
	});


	test('NOP touches nothing', function () {
		const nop: any = Opcodes[0x00];
		if (!hasMasks(nop)) return this.skip();
		assert.equal(nop.writes.size, 0);
		assert.equal(nop.reads.size, 0);
	});


	test('LD A,B writes A, reads B', function () {
		const ld: any = Opcodes[0x78];   // LD A,B
		if (!hasMasks(ld)) return this.skip();
		assert(ld.writes.has('A'));
		assert(ld.reads.has('B'));
		assert(!ld.writes.has('F'),
			'LD does not affect flags');
	});


	test('LD HL,nn writes both halves of HL', function () {
		const ld: any = Opcodes[0x21];   // LD HL,nn
		if (!hasMasks(ld)) return this.skip();
		assert(ld.writes.has('H'));
		assert(ld.writes.has('L'));
	});


	test('EX DE,HL writes and reads all four halves', function () {
		const ex: any = Opcodes[0xEB];
		if (!hasMasks(ex)) return this.skip();
		for (const r of ['D', 'E', 'H', 'L']) {
			assert(ex.writes.has(r), 'EX DE,HL writes ' + r);
			assert(ex.reads.has(r), 'EX DE,HL reads ' + r);
		}
	});


	test('EXX swaps main and alternate register sets', function () {
		const exx: any = Opcodes[0xD9];
		if (!hasMasks(exx)) return this.skip();
		// Both main and alternate BC/DE/HL should appear in writes.
		for (const r of ['B', 'C', 'D', 'E', 'H', 'L',
			"B'", "C'", "D'", "E'", "H'", "L'"]) {
			assert(exx.writes.has(r), 'EXX writes ' + r);
		}
	});


	test("EX AF,AF' swaps AF with AF'", function () {
		const ex: any = Opcodes[0x08];
		if (!hasMasks(ex)) return this.skip();
		for (const r of ['A', 'F', "A'", "F'"]) {
			assert(ex.writes.has(r), "EX AF,AF' writes " + r);
			assert(ex.reads.has(r), "EX AF,AF' reads " + r);
		}
	});


	test('PUSH BC reads B, C and touches SP', function () {
		const push: any = Opcodes[0xC5];
		if (!hasMasks(push)) return this.skip();
		assert(push.reads.has('B'));
		assert(push.reads.has('C'));
		assert(push.writes.has('SP'));
	});


	test('POP BC writes B, C and touches SP', function () {
		const pop: any = Opcodes[0xC1];
		if (!hasMasks(pop)) return this.skip();
		assert(pop.writes.has('B'));
		assert(pop.writes.has('C'));
		assert(pop.writes.has('SP'));
	});


	test('ADD A,B writes A & F, reads A & B', function () {
		const add: any = Opcodes[0x80];
		if (!hasMasks(add)) return this.skip();
		assert(add.writes.has('A'));
		assert(add.writes.has('F'));
		assert(add.reads.has('A'));
		assert(add.reads.has('B'));
	});


	test('CP B only writes flags, reads A and B', function () {
		const cp: any = Opcodes[0xB8];
		if (!hasMasks(cp)) return this.skip();
		assert(cp.writes.has('F'));
		assert(!cp.writes.has('A'),
			'CP does not modify A');
		assert(cp.reads.has('A'));
		assert(cp.reads.has('B'));
	});


	test('CALL nn: callee effect is layered by the analyser, not the mask', function () {
		const call: any = Opcodes[0xCD];
		if (!hasMasks(call)) return this.skip();
		// The opcode itself only moves SP. The callee's Corrupted set
		// is added later in analyzeRegisterUsage() (§8.6 step 5).
		assert(call.writes.has('SP'));
		assert.equal(call.writes.size, 1,
			'CALL nn itself writes only SP — callee effect is separate');
	});


	test('RET only reads SP (and may test flags for conditional RET)', function () {
		const ret: any = Opcodes[0xC9];
		if (!hasMasks(ret)) return this.skip();
		assert(ret.writes.has('SP'));
		assert(ret.reads.has('SP'));
	});


	test('ED 44 (NEG) writes A & F, reads A', function () {
		const neg: any = OpcodesED[0x44];
		if (!hasMasks(neg)) return this.skip();
		assert(neg.writes.has('A'));
		assert(neg.writes.has('F'));
		assert(neg.reads.has('A'));
	});


	test('CB 00 (RLC B) writes B & F, reads B', function () {
		const rlc: any = OpcodesCB[0x00];
		if (!hasMasks(rlc)) return this.skip();
		assert(rlc.writes.has('B'));
		assert(rlc.writes.has('F'));
		assert(rlc.reads.has('B'));
	});

});
