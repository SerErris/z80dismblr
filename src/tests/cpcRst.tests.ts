import * as assert from 'assert';
import { Memory } from '../disassembler/memory';
import { CPC_RST, analyzeCpcRst, formatCpcRst } from '../disassembler/cpcRst';


/**
 * Builds a Memory object with the given bytes starting at origin.
 */
function makeMemory(origin: number, bytes: number[]): Memory {
	const mem = new Memory();
	mem.setMemory(origin, new Uint8Array(bytes));
	return mem;
}


suite('CPC RST', () => {

	// ── analyzeCpcRst ──────────────────────────────────────────────────────────

	suite('analyzeCpcRst', () => {

		test('RST 0 RESET — no targets', () => {
			const info = CPC_RST.get(0xC7)!;
			const mem = makeMemory(0x1000, [0xC7]);
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, []);
			assert.deepEqual(cfg.dataRanges, []);
			assert.deepEqual(cfg.newLabels, []);
			assert.equal(cfg.fallThrough, false);
			assert.equal(cfg.resumeAddr, 0x1001);
		});

		test('RST 1 LOW_JUMP — target = raw & 0x3FFF', () => {
			const info = CPC_RST.get(0xCF)!;
			// opcode at 0x1000, operand word 0x0134 at 0x1001
			const mem = makeMemory(0x1000, [0xCF, 0x34, 0x01]);
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, [0x0134]);
			assert.deepEqual(cfg.dataRanges, []);
			assert.deepEqual(cfg.newLabels, []);
			assert.equal(cfg.fallThrough, false);
			assert.equal(cfg.resumeAddr, 0x1003);
		});

		test('RST 1 LOW_JUMP with ROM bits — ROM bits stripped from target', () => {
			const info = CPC_RST.get(0xCF)!;
			// operand 0x4134: bits 14+15 set, target = 0x4134 & 0x3FFF = 0x0134
			const mem = makeMemory(0x1000, [0xCF, 0x34, 0x41]);
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, [0x0134]);
			assert.deepEqual(cfg.dataRanges, []);
			assert.deepEqual(cfg.newLabels, []);
			assert.equal(cfg.fallThrough, false);
			assert.equal(cfg.resumeAddr, 0x1003);
		});

		test('RST 2 SIDE_CALL — target = (raw & 0x3FFF) | 0xC000', () => {
			const info = CPC_RST.get(0xD7)!;
			// operand 0x0400, target = 0x0400 | 0xC000 = 0xC400
			const mem = makeMemory(0x1000, [0xD7, 0x00, 0x04]);
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, [0xC400]);
			assert.deepEqual(cfg.dataRanges, []);
			assert.deepEqual(cfg.newLabels, []);
			assert.equal(cfg.fallThrough, true);
			assert.equal(cfg.resumeAddr, 0x1003);
		});

		test('RST 3 FAR_CALL — resolves pointer table', () => {
			const info = CPC_RST.get(0xDF)!;
			// operand word = 0x4000 (ptr table address)
			// mem[0x4000]=0x3F, mem[0x4001]=0xBD → target = 0xBD3F
			// mem[0x4002]=0x07 → ROM select
			const mem = makeMemory(0x1000, [0xDF, 0x00, 0x40]);
			mem.setMemory(0x4000, new Uint8Array([0x3F, 0xBD, 0x07]));
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, [0xBD3F]);
			assert.deepEqual(cfg.dataRanges, [{ addr: 0x4000, len: 3 }]);
			assert.deepEqual(cfg.newLabels, [{ addr: 0x4000, name: 'FAR_4000' }]);
			assert.equal(cfg.fallThrough, true);
			assert.equal(cfg.resumeAddr, 0x1003);
		});

		test('RST 3 FAR_CALL out of range — no code target, data range still added', () => {
			const info = CPC_RST.get(0xDF)!;
			// operand = 0xFFFF pointing to unassigned memory
			const mem = makeMemory(0x1000, [0xDF, 0xFF, 0xFF]);
			// 0xFFFF is not assigned → farLo undefined → no code target
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, []);
			assert.deepEqual(cfg.dataRanges, [{ addr: 0xFFFF, len: 3 }]);
			assert.deepEqual(cfg.newLabels, [{ addr: 0xFFFF, name: 'FAR_FFFF' }]);
			assert.equal(cfg.fallThrough, true);
			assert.equal(cfg.resumeAddr, 0x1003);
		});

		test('RST 4 RAM_LAM — no targets', () => {
			const info = CPC_RST.get(0xE7)!;
			const mem = makeMemory(0x1000, [0xE7]);
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, []);
			assert.deepEqual(cfg.dataRanges, []);
			assert.deepEqual(cfg.newLabels, []);
			assert.equal(cfg.fallThrough, false);
			assert.equal(cfg.resumeAddr, 0x1001);
		});

		test('RST 5 FIRM_JUMP — target = raw & 0xFFFF', () => {
			const info = CPC_RST.get(0xEF)!;
			// operand 0x0100
			const mem = makeMemory(0x1000, [0xEF, 0x00, 0x01]);
			const cfg = analyzeCpcRst(info, 0x1000, mem);
			assert.deepEqual(cfg.codeTargets, [0x0100]);
			assert.deepEqual(cfg.dataRanges, []);
			assert.deepEqual(cfg.newLabels, []);
			assert.equal(cfg.fallThrough, false);
			assert.equal(cfg.resumeAddr, 0x1003);
		});

	});


	// ── formatCpcRst ──────────────────────────────────────────────────────────

	suite('formatCpcRst', () => {

		test('RST 0 RESET — rst line only, no defw', () => {
			const info = CPC_RST.get(0xC7)!;
			const mem = makeMemory(0x1000, [0xC7]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #00\t\t\t; RESET');
			assert.equal(lines.defw, undefined);
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, undefined);
		});

		test('RST 1 LOW_JUMP — operand=0x0134, LR=0 UR=0', () => {
			const info = CPC_RST.get(0xCF)!;
			const mem = makeMemory(0x1000, [0xCF, 0x34, 0x01]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #08\t\t\t; LOW JUMP');
			assert.equal(lines.defw, 'defw 00134h\t\t;   to #0134 [LR=0, UR=0]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 1 LOW_JUMP — operand=0x4134, LR=0 UR=1', () => {
			const info = CPC_RST.get(0xCF)!;
			// 0x4134 = 0100 0001 0011 0100 → bit15=0(LR=0), bit14=1(UR=1)
			// target = 0x4134 & 0x3FFF = 0x0134
			const mem = makeMemory(0x1000, [0xCF, 0x34, 0x41]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #08\t\t\t; LOW JUMP');
			assert.equal(lines.defw, 'defw 04134h\t\t;   to #0134 [LR=0, UR=1]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 1 LOW_JUMP — operand=0x8134, LR=1 UR=0', () => {
			const info = CPC_RST.get(0xCF)!;
			// 0x8134 = 1000 0001 0011 0100 → bit15=1(LR=1), bit14=0(UR=0)
			// target = 0x8134 & 0x3FFF = 0x0134
			const mem = makeMemory(0x1000, [0xCF, 0x34, 0x81]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #08\t\t\t; LOW JUMP');
			assert.equal(lines.defw, 'defw 08134h\t\t;   to #0134 [LR=1, UR=0]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 1 LOW_JUMP — operand=0xC134, LR=1 UR=1', () => {
			const info = CPC_RST.get(0xCF)!;
			// 0xC134 = 1100 0001 0011 0100 → bit15=1(LR=1), bit14=1(UR=1)
			// target = 0xC134 & 0x3FFF = 0x0134
			const mem = makeMemory(0x1000, [0xCF, 0x34, 0xC1]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #08\t\t\t; LOW JUMP');
			assert.equal(lines.defw, 'defw 0C134h\t\t;   to #0134 [LR=1, UR=1]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 2 SIDE_CALL — operand=0x0400 (slot 0)', () => {
			const info = CPC_RST.get(0xD7)!;
			// 0x0400 = 0000 0100 0000 0000 → bits 15..14 = 00 = slot 0
			// target = (0x0400 & 0x3FFF) | 0xC000 = 0xC400
			const mem = makeMemory(0x1000, [0xD7, 0x00, 0x04]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #10\t\t\t; SIDE CALL');
			assert.equal(lines.defw, 'defw 00400h\t\t;   to #C400 [slot 0]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 2 SIDE_CALL — operand=0x4400 (slot 1)', () => {
			const info = CPC_RST.get(0xD7)!;
			// 0x4400 = 0100 0100 0000 0000 → bits 15..14 = 01 = slot 1
			// target = (0x4400 & 0x3FFF) | 0xC000 = 0xC400
			const mem = makeMemory(0x1000, [0xD7, 0x00, 0x44]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #10\t\t\t; SIDE CALL');
			assert.equal(lines.defw, 'defw 04400h\t\t;   to #C400 [slot 1]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 2 SIDE_CALL — operand=0x8400 (slot 2)', () => {
			const info = CPC_RST.get(0xD7)!;
			// 0x8400 = 1000 0100 0000 0000 → bits 15..14 = 10 = slot 2
			// target = (0x8400 & 0x3FFF) | 0xC000 = 0xC400
			const mem = makeMemory(0x1000, [0xD7, 0x00, 0x84]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #10\t\t\t; SIDE CALL');
			assert.equal(lines.defw, 'defw 08400h\t\t;   to #C400 [slot 2]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 2 SIDE_CALL — operand=0xC400 (slot 3)', () => {
			const info = CPC_RST.get(0xD7)!;
			// 0xC400 = 1100 0100 0000 0000 → bits 15..14 = 11 = slot 3
			// target = (0xC400 & 0x3FFF) | 0xC000 = 0xC400
			const mem = makeMemory(0x1000, [0xD7, 0x00, 0xC4]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #10\t\t\t; SIDE CALL');
			assert.equal(lines.defw, 'defw 0C400h\t\t;   to #C400 [slot 3]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 3 FAR_CALL — ptr=0x4000, target=0xBD3F, sel=7', () => {
			const info = CPC_RST.get(0xDF)!;
			const mem = makeMemory(0x1000, [0xDF, 0x00, 0x40]);
			mem.setMemory(0x4000, new Uint8Array([0x3F, 0xBD, 0x07]));
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #18\t\t\t; FAR CALL');
			assert.equal(lines.defw, 'defw FAR_4000\t\t;   to #BD3F [ROM 7]');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 3 FAR_CALL — target address resolved via lookupLabel', () => {
			const info = CPC_RST.get(0xDF)!;
			const mem = makeMemory(0x1000, [0xDF, 0x00, 0x40]);
			mem.setMemory(0x4000, new Uint8Array([0x3F, 0xBD, 0x07]));
			const lines = formatCpcRst(info, 0x1000, mem, (addr) => {
				if (addr === 0xBD3F) return 'MY_LABEL';
				return undefined;
			});
			assert.equal(lines.rst, 'rst #18\t\t\t; FAR CALL');
			assert.equal(lines.defw, 'defw FAR_4000\t\t;   to MY_LABEL [ROM 7]');
		});

		test('RST 3 FAR_CALL — ptr out of range', () => {
			const info = CPC_RST.get(0xDF)!;
			// operand = 0xFFFF, pointing to unassigned memory
			const mem = makeMemory(0x1000, [0xDF, 0xFF, 0xFF]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #18\t\t\t; FAR CALL');
			assert.equal(lines.defw, 'defw FAR_FFFF\t\t;   (out of range)');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 5 FIRM_JUMP — target=0x0100, no label', () => {
			const info = CPC_RST.get(0xEF)!;
			const mem = makeMemory(0x1000, [0xEF, 0x00, 0x01]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #28\t\t\t; FIRM JUMP');
			assert.equal(lines.defw, 'defw 00100h\t\t;   to #0100');
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, 0x1001);
		});

		test('RST 5 FIRM_JUMP — target=0x0100, label=MAIN', () => {
			const info = CPC_RST.get(0xEF)!;
			const mem = makeMemory(0x1000, [0xEF, 0x00, 0x01]);
			const lines = formatCpcRst(info, 0x1000, mem, (addr) => {
				if (addr === 0x0100) return 'MAIN';
				return undefined;
			});
			assert.equal(lines.rst, 'rst #28\t\t\t; FIRM JUMP');
			assert.equal(lines.defw, 'defw MAIN\t\t;   to #0100');
		});

		// ── rst comment line coverage for all 8 variants ──────────────────────

		test('RST 4 RAM_LAM — rst comment line', () => {
			const info = CPC_RST.get(0xE7)!;
			const mem = makeMemory(0x1000, [0xE7]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #20\t\t\t; RAM LAM');
			assert.equal(lines.defw, undefined);
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, undefined);
		});

		test('RST 6 USER RESTART — rst comment line', () => {
			const info = CPC_RST.get(0xF7)!;
			const mem = makeMemory(0x1000, [0xF7]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #30\t\t\t; USER RESTART');
			assert.equal(lines.defw, undefined);
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, undefined);
		});

		test('RST 7 INTERRUPT — rst comment line', () => {
			const info = CPC_RST.get(0xFF)!;
			const mem = makeMemory(0x1000, [0xFF]);
			const lines = formatCpcRst(info, 0x1000, mem);
			assert.equal(lines.rst, 'rst #38\t\t\t; INTERRUPT');
			assert.equal(lines.defw, undefined);
			assert.equal(lines.rstAddr, 0x1000);
			assert.equal(lines.defwAddr, undefined);
		});

	});

});
