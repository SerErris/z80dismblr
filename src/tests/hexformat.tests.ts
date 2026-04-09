import * as assert from 'assert';
import { Disassembler } from '../disassembler/disasm';
import { Format, HexFormat } from '../disassembler/format';
import { Memory } from '../disassembler/memory';
import { CPC_RST, formatCpcRst } from '../disassembler/cpcRst';


// ── Helpers ────────────────────────────────────────────────────────────────

function makeDasm(): Disassembler {
	const dasm = new Disassembler() as any;
	dasm.clmnsAddress = 0;		// suppress address column
	dasm.addOpcodeBytes = false;
	dasm.opcodesLowerCase = false;
	dasm.labelSubPrefix = 'SUB';
	dasm.labelLblPrefix = 'LBL';
	dasm.labelDataLblPrefix = 'DATA';
	dasm.labelLocalLabelPrefix = '_lbl';
	dasm.labelLoopPrefix = '_loop';
	dasm.initLabels();
	return dasm as Disassembler;
}

/** Returns disassembled lines with address column and empty lines stripped. */
function disasmLines(dasm: Disassembler): string[] {
	dasm.disassemble();
	return (dasm as any).disassembledLines
		.map((l: string) => l.trim())
		.filter((l: string) => l.length > 0);
}

/**
 * Returns true if any line in the output contains the given substring.
 * Whitespace runs are collapsed to a single space before comparison so
 * column-alignment padding does not affect results.
 */
function hasLine(lines: string[], fragment: string): boolean {
	const normFrag = fragment.replace(/\s+/g, ' ');
	return lines.some(l => l.replace(/\s+/g, ' ').includes(normFrag));
}

function makeMemory(origin: number, bytes: number[]): Memory {
	const mem = new Memory();
	mem.setMemory(origin, new Uint8Array(bytes));
	return mem;
}


// ── Test suite ─────────────────────────────────────────────────────────────

suite('Hex format', () => {

	// Always restore INTEL after each test.
	teardown(() => { Format.hexFormat = HexFormat.INTEL; });


	// ── ORG directive ────────────────────────────────────────────────────────

	suite('ORG directive', () => {

		// Memory at 0x2000 with a single NOP + RET so it disassembles cleanly.
		const org = 0x2000;
		const mem = [0x00, 0xC9];	// NOP, RET

		function makeOrgDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org, new Uint8Array(mem));
			(dasm as any).setLabel(org);
			return dasm;
		}

		test('ORG — intel  → 2000h',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeOrgDasm()), 'ORG 2000h'));  });
		test('ORG — intel0 → 02000h', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeOrgDasm()), 'ORG 02000h')); });
		test('ORG — cpc    → #2000',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeOrgDasm()), 'ORG #2000'));  });
		test('ORG — z80    → $2000',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeOrgDasm()), 'ORG $2000'));  });
		test('ORG — c      → 0x2000', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeOrgDasm()), 'ORG 0x2000')); });

	});


	// ── EQU directive ────────────────────────────────────────────────────────
	// LD A,(0x9ABC) makes a data reference to an unassigned address.
	// The disassembler creates an EQU for it since 0x9ABC is outside the loaded binary.

	suite('EQU directive', () => {

		const org = 0x1000;
		//  LD A,(9ABCh)  (0x3A lo hi) + RET — data reference to unassigned 0x9ABC
		const mem = [0x3A, 0xBC, 0x9A, 0xC9];

		function makeEquDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org, new Uint8Array(mem));
			(dasm as any).setLabel(org);
			return dasm;
		}

		test('EQU — intel  → EQU 9ABCh',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeEquDasm()), 'EQU 9ABCh'));  });
		test('EQU — intel0 → EQU 09ABCh', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeEquDasm()), 'EQU 09ABCh')); });
		test('EQU — cpc    → EQU #9ABC',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeEquDasm()), 'EQU #9ABC'));  });
		test('EQU — z80    → EQU $9ABC',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeEquDasm()), 'EQU $9ABC'));  });
		test('EQU — c      → EQU 0x9ABC', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeEquDasm()), 'EQU 0x9ABC')); });

	});


	// ── DEFB byte values ─────────────────────────────────────────────────────
	// Mark an area as data so the disassembler emits DEFB lines.

	suite('DEFB byte values', () => {

		const org   = 0x1000;
		const dOrg  = 0x1010;	// data area: one byte 0x3F

		function makeDefbDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org,  new Uint8Array([0xC9]));		// RET
			(dasm as any).memory.setMemory(dOrg, new Uint8Array([0x3F]));		// data byte
			(dasm as any).setLabel(org);
			(dasm as any).addDataLabel(dOrg, 'DATA1');
			return dasm;
		}

		test('DEFB — intel  → 3Fh',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeDefbDasm()), 'DEFB 3Fh'));  });
		test('DEFB — intel0 → 03Fh', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeDefbDasm()), 'DEFB 03Fh')); });
		test('DEFB — cpc    → #3F',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeDefbDasm()), 'DEFB #3F'));  });
		test('DEFB — z80    → $3F',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeDefbDasm()), 'DEFB $3F'));  });
		test('DEFB — c      → 0x3F', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeDefbDasm()), 'DEFB 0x3F')); });

	});


	// ── Byte opcode operands ──────────────────────────────────────────────────
	// LD B,0x3F  →  0x06, 0x3F

	suite('Byte opcode operands', () => {

		const org = 0x1000;
		const mem = [0x06, 0x3F, 0xC9];	// LD B,3Fh; RET

		function makeByteOpDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org, new Uint8Array(mem));
			(dasm as any).setLabel(org);
			return dasm;
		}

		test('byte operand — intel  → LD B,3Fh',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeByteOpDasm()), 'LD B,3Fh'));  });
		test('byte operand — intel0 → LD B,03Fh', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeByteOpDasm()), 'LD B,03Fh')); });
		test('byte operand — cpc    → LD B,#3F',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeByteOpDasm()), 'LD B,#3F'));  });
		test('byte operand — z80    → LD B,$3F',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeByteOpDasm()), 'LD B,$3F'));  });
		test('byte operand — c      → LD B,0x3F', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeByteOpDasm()), 'LD B,0x3F')); });

	});


	// ── Word opcode operands ──────────────────────────────────────────────────
	// LD HL,0x3412  →  0x21, 0x12, 0x34

	suite('Word opcode operands', () => {

		const org = 0x1000;
		const mem = [0x21, 0x12, 0x34, 0xC9];	// LD HL,3412h; RET

		function makeWordOpDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org, new Uint8Array(mem));
			(dasm as any).setLabel(org);
			return dasm;
		}

		test('word operand — intel  → LD HL,3412h',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeWordOpDasm()), 'LD HL,3412h'));  });
		test('word operand — intel0 → LD HL,03412h', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeWordOpDasm()), 'LD HL,03412h')); });
		test('word operand — cpc    → LD HL,#3412',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeWordOpDasm()), 'LD HL,#3412'));  });
		test('word operand — z80    → LD HL,$3412',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeWordOpDasm()), 'LD HL,$3412'));  });
		test('word operand — c      → LD HL,0x3412', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeWordOpDasm()), 'LD HL,0x3412')); });

	});


	// ── RST opcode values ─────────────────────────────────────────────────────
	// RST 8  (0xCF) — in non-CPC mode, rendered as  RST 8h / RST #08 etc.

	suite('RST opcode values', () => {

		const org = 0x1000;
		const mem = [0xCF, 0xC9];	// RST 8; RET  (non-CPC mode)

		function makeRstDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org, new Uint8Array(mem));
			// also load target RST08 vector area so disassembler doesn't warn
			(dasm as any).memory.setMemory(0x0008, new Uint8Array([0xC9]));
			(dasm as any).setLabel(org);
			return dasm;
		}

		// formatHex(8, 2) pads to 2 digits, so INTEL gives '08h', INTEL0 gives '008h'
		test('RST — intel  → RST 08h',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeRstDasm()), 'RST 08h'));  });
		test('RST — intel0 → RST 008h', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeRstDasm()), 'RST 008h')); });
		test('RST — cpc    → RST #08',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeRstDasm()), 'RST #08')); });
		test('RST — z80    → RST $08',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeRstDasm()), 'RST $08')); });
		test('RST — c      → RST 0x08', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeRstDasm()), 'RST 0x08'));});

	});


	// ── Reference comments ────────────────────────────────────────────────────
	// CALL to a subroutine → label comment shows "Called by: SUB1[xxxxh]"
	// where xxxx is the address of the CALL instruction.

	suite('Reference comments', () => {

		//  org 0x1000:  CALL 0x1010  (0xCD 0x10 0x10)
		//  org 0x1003:  RET
		//  org 0x1010:  RET   ← SUB target, called from 0x1000
		const org = 0x1000;
		const mem = [
			0xCD, 0x10, 0x10,	// CALL 1010h  ← at address 0x1000
			0xC9,				// RET
			// gap filled by separate setMemory
		];
		const subMem = [0xC9];	// RET at 0x1010

		function makeRefDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org,    new Uint8Array(mem));
			(dasm as any).memory.setMemory(0x1010, new Uint8Array(subMem));
			(dasm as any).setLabel(org);
			return dasm;
		}

		// The comment contains the address of the CALL instruction (0x1000).
		test('ref comment — intel  → [1000h]',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeRefDasm()), '[1000h]'));  });
		test('ref comment — intel0 → [01000h]', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeRefDasm()), '[01000h]')); });
		test('ref comment — cpc    → [#1000]',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeRefDasm()), '[#1000]'));  });
		test('ref comment — z80    → [$1000]',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeRefDasm()), '[$1000]'));  });
		test('ref comment — c      → [0x1000]', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeRefDasm()), '[0x1000]')); });

	});


	// ── Data access comments ──────────────────────────────────────────────────
	// LD HL,(nn) generates a DATA label; the label comment shows the accessor address.

	suite('Data access comments', () => {

		//  org 0x1000:  LD HL,(0x2000)  (0x2A 0x00 0x20)
		//               RET
		//  0x2000 is unassigned → DATA EQU; the comment shows "accessed by: 1000h"
		const org = 0x1000;
		const mem = [
			0x2A, 0x00, 0x20,	// LD HL,(2000h)  — data reference to 0x2000
			0xC9,				// RET
		];

		function makeDataDasm(): Disassembler {
			const dasm = makeDasm();
			(dasm as any).memory.setMemory(org, new Uint8Array(mem));
			(dasm as any).setLabel(org);
			return dasm;
		}

		// The data-access comment contains the address of the LD HL,(nn) instruction (0x1000).
		test('data comment — intel  → 1000h',  () => { Format.hexFormat = HexFormat.INTEL;  assert(hasLine(disasmLines(makeDataDasm()), '1000h'));  });
		test('data comment — intel0 → 01000h', () => { Format.hexFormat = HexFormat.INTEL0; assert(hasLine(disasmLines(makeDataDasm()), '01000h')); });
		test('data comment — cpc    → #1000',  () => { Format.hexFormat = HexFormat.CPC;    assert(hasLine(disasmLines(makeDataDasm()), '#1000'));  });
		test('data comment — z80    → $1000',  () => { Format.hexFormat = HexFormat.Z80;    assert(hasLine(disasmLines(makeDataDasm()), '$1000'));  });
		test('data comment — c      → 0x1000', () => { Format.hexFormat = HexFormat.C;      assert(hasLine(disasmLines(makeDataDasm()), '0x1000')); });

	});


	// ── CPC RST combined with hex formats ─────────────────────────────────────
	// Proves that --cpc and --hexformat are completely independent axes.
	// Tests use formatCpcRst() directly with each hex format.

	suite('CPC RST combined with hex formats', () => {

		// LOW_JUMP (RST 1) with operand 0x0134 — target 0x0134, LR=0, UR=0
		const lowJumpMem = makeMemory(0x1000, [0xCF, 0x34, 0x01]);
		const lowJumpInfo = CPC_RST.get(0xCF)!;

		test('LOW_JUMP + intel  → defw 0134h  ;   to 0134h', () => {
			Format.hexFormat = HexFormat.INTEL;
			const l = formatCpcRst(lowJumpInfo, 0x1000, lowJumpMem);
			assert.equal(l.defw, 'defw 0134h\t\t;   to 0134h [LR=0, UR=0]');
		});

		test('LOW_JUMP + intel0 → defw 00134h ;   to 00134h', () => {
			Format.hexFormat = HexFormat.INTEL0;
			const l = formatCpcRst(lowJumpInfo, 0x1000, lowJumpMem);
			assert.equal(l.defw, 'defw 00134h\t\t;   to 00134h [LR=0, UR=0]');
		});

		test('LOW_JUMP + cpc   → defw #0134   ;   to #0134', () => {
			Format.hexFormat = HexFormat.CPC;
			const l = formatCpcRst(lowJumpInfo, 0x1000, lowJumpMem);
			assert.equal(l.defw, 'defw #0134\t\t;   to #0134 [LR=0, UR=0]');
		});

		test('LOW_JUMP + z80   → defw $0134   ;   to $0134', () => {
			Format.hexFormat = HexFormat.Z80;
			const l = formatCpcRst(lowJumpInfo, 0x1000, lowJumpMem);
			assert.equal(l.defw, 'defw $0134\t\t;   to $0134 [LR=0, UR=0]');
		});

		test('LOW_JUMP + c     → defw 0x0134  ;   to 0x0134', () => {
			Format.hexFormat = HexFormat.C;
			const l = formatCpcRst(lowJumpInfo, 0x1000, lowJumpMem);
			assert.equal(l.defw, 'defw 0x0134\t\t;   to 0x0134 [LR=0, UR=0]');
		});

		// FAR_CALL (RST 3) — ptr=0x4000, target=0xBD3F, sel=7
		// FAR_XXXX label is always uppercase hex (not affected by format)
		function makeFarMem(): Memory {
			const m = makeMemory(0x1000, [0xDF, 0x00, 0x40]);
			m.setMemory(0x4000, new Uint8Array([0x3F, 0xBD, 0x07]));
			return m;
		}
		const farInfo = CPC_RST.get(0xDF)!;

		test('FAR_CALL + intel  → to BD3Fh', () => {
			Format.hexFormat = HexFormat.INTEL;
			const l = formatCpcRst(farInfo, 0x1000, makeFarMem());
			assert.equal(l.defw, 'defw FAR_4000\t\t;   to BD3Fh [ROM 7]');
		});

		test('FAR_CALL + intel0 → to 0BD3Fh', () => {
			Format.hexFormat = HexFormat.INTEL0;
			const l = formatCpcRst(farInfo, 0x1000, makeFarMem());
			assert.equal(l.defw, 'defw FAR_4000\t\t;   to 0BD3Fh [ROM 7]');
		});

		test('FAR_CALL + cpc   → to #BD3F', () => {
			Format.hexFormat = HexFormat.CPC;
			const l = formatCpcRst(farInfo, 0x1000, makeFarMem());
			assert.equal(l.defw, 'defw FAR_4000\t\t;   to #BD3F [ROM 7]');
		});

		test('FAR_CALL + z80   → to $BD3F', () => {
			Format.hexFormat = HexFormat.Z80;
			const l = formatCpcRst(farInfo, 0x1000, makeFarMem());
			assert.equal(l.defw, 'defw FAR_4000\t\t;   to $BD3F [ROM 7]');
		});

		test('FAR_CALL + c     → to 0xBD3F', () => {
			Format.hexFormat = HexFormat.C;
			const l = formatCpcRst(farInfo, 0x1000, makeFarMem());
			assert.equal(l.defw, 'defw FAR_4000\t\t;   to 0xBD3F [ROM 7]');
		});

		// FIRM_JUMP (RST 5) with label — operand uses label, comment uses formatHex
		const firmMem = makeMemory(0x1000, [0xEF, 0x00, 0x01]);
		const firmInfo = CPC_RST.get(0xEF)!;
		const firmLookup = (addr: number) => addr === 0x0100 ? 'MAIN' : undefined;

		test('FIRM_JUMP + label + intel  → to 0100h', () => {
			Format.hexFormat = HexFormat.INTEL;
			const l = formatCpcRst(firmInfo, 0x1000, firmMem, firmLookup);
			assert.equal(l.defw, 'defw MAIN\t\t;   to 0100h');
		});

		test('FIRM_JUMP + label + cpc   → to #0100', () => {
			Format.hexFormat = HexFormat.CPC;
			const l = formatCpcRst(firmInfo, 0x1000, firmMem, firmLookup);
			assert.equal(l.defw, 'defw MAIN\t\t;   to #0100');
		});

		test('FIRM_JUMP + label + c     → to 0x0100', () => {
			Format.hexFormat = HexFormat.C;
			const l = formatCpcRst(firmInfo, 0x1000, firmMem, firmLookup);
			assert.equal(l.defw, 'defw MAIN\t\t;   to 0x0100');
		});

	});

});
