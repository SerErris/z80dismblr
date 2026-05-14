/**
 * Tests for the BC linear-walk tracker (src/disassembler/bcTrack.ts).
 *
 * Each test loads a tiny memory image starting at $8000, lets the
 * Disassembler run its analysis (so CODE_FIRST markers and the labels
 * map are populated), then invokes trackBcAt() at a target I/O address
 * and asserts the resulting BC state.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { trackBcAt, BcState } from '../disassembler/bcTrack';


/**
 * Builds a Disassembler, loads bytes at `org`, runs disassemble(),
 * and returns the dasm + a tiny query helper.
 */
function makeDasm(org: number, bytes: number[]): {
	dasm:  any;
	query: (ioAddr: number) => BcState;
} {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	dasm.disassemble();
	return {
		dasm,
		query: (ioAddr: number) => trackBcAt(dasm.memory, dasm.labels, ioAddr),
	};
}


// ---------------------------------------------------------------------------
// Basic immediates
// ---------------------------------------------------------------------------

suite('trackBcAt — immediates', () => {

	test('LD BC,nn alone — both bytes known', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED 49     OUT (C),C       ← I/O
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8003), {b: 0xFB, c: 0x7E});
	});

	test('LD B,#n + LD C,#n — both bytes known', () => {
		// $8000: 06 7F     LD B,$7F
		// $8002: 0E 10     LD C,$10
		// $8004: ED 79     OUT (C),A       ← I/O
		const { query } = makeDasm(0x8000, [0x06, 0x7F, 0x0E, 0x10, 0xED, 0x79]);
		assert.deepStrictEqual(query(0x8004), {b: 0x7F, c: 0x10});
	});

	test('LD B,#n only — only b known', () => {
		// $8000: 06 7F     LD B,$7F
		// $8002: ED 78     IN A,(C)        ← I/O (C is unknown)
		const { query } = makeDasm(0x8000, [0x06, 0x7F, 0xED, 0x78]);
		assert.deepStrictEqual(query(0x8002), {b: 0x7F, c: undefined});
	});

	test('LD C,#n only — only c known', () => {
		// $8000: 0E FE     LD C,$FE
		// $8002: ED 78     IN A,(C)        ← I/O
		const { query } = makeDasm(0x8000, [0x0E, 0xFE, 0xED, 0x78]);
		assert.deepStrictEqual(query(0x8002), {b: undefined, c: 0xFE});
	});

	test('No setup at all — both unknown', () => {
		// $8000: ED 78     IN A,(C)        ← I/O at the very start
		const { query } = makeDasm(0x8000, [0xED, 0x78]);
		assert.deepStrictEqual(query(0x8000), {b: undefined, c: undefined});
	});

});


// ---------------------------------------------------------------------------
// FDC pattern: INC BC walks adjacent ports
// ---------------------------------------------------------------------------

suite('trackBcAt — FDC pattern (INC BC)', () => {

	test('LD BC,$FB7E / OUT (C),C / INC BC / OUT (C),C', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED 49     OUT (C),C       ← first I/O  (BC = $FB7E)
		// $8005: 03        INC BC
		// $8006: ED 49     OUT (C),C       ← second I/O (BC = $FB7F)
		// $8008: C9        RET
		const { query } = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x49, 0x03, 0xED, 0x49, 0xC9]);

		assert.deepStrictEqual(query(0x8003), {b: 0xFB, c: 0x7E});
		assert.deepStrictEqual(query(0x8006), {b: 0xFB, c: 0x7F});
	});

	test('INC BC with C=0xFF carries into B', () => {
		// $8000: 01 FF FB  LD BC,$FBFF
		// $8003: 03        INC BC          ; → $FC00
		// $8004: ED 49     OUT (C),C       ← I/O (BC = $FC00)
		const { query } = makeDasm(0x8000, [0x01, 0xFF, 0xFB, 0x03, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: 0xFC, c: 0x00});
	});

	test('DEC BC with C=0 borrows from B', () => {
		// $8000: 01 00 FB  LD BC,$FB00
		// $8003: 0B        DEC BC          ; → $FAFF
		// $8004: ED 49     OUT (C),C       ← I/O
		const { query } = makeDasm(0x8000, [0x01, 0x00, 0xFB, 0x0B, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: 0xFA, c: 0xFF});
	});

	test('INC BC when one byte is unknown → both become unknown', () => {
		// $8000: 06 FB     LD B,$FB
		// $8002: 03        INC BC          ; C is unknown → can't predict carry
		// $8003: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x06, 0xFB, 0x03, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8003), {b: undefined, c: undefined});
	});

});


// ---------------------------------------------------------------------------
// CRTC / PPI pattern: INC B + LD C,#n piggybacking data
// ---------------------------------------------------------------------------

suite('trackBcAt — CRTC pattern (INC B + LD C,#n)', () => {

	test('LD BC,$BC01 / OUT / INC B / LD C,$23 / OUT', () => {
		// $8000: 01 01 BC  LD BC,$BC01
		// $8003: ED 49     OUT (C),C       ← first I/O  (BC = $BC01)
		// $8005: 04        INC B
		// $8006: 0E 23     LD C,$23
		// $8008: ED 49     OUT (C),C       ← second I/O (BC = $BD23)
		const { query } = makeDasm(0x8000,
			[0x01, 0x01, 0xBC, 0xED, 0x49, 0x04, 0x0E, 0x23, 0xED, 0x49]);

		assert.deepStrictEqual(query(0x8003), {b: 0xBC, c: 0x01});
		assert.deepStrictEqual(query(0x8008), {b: 0xBD, c: 0x23});
	});

	test('INC B / DEC B affect B alone', () => {
		// $8000: 06 7E     LD B,$7E
		// $8002: 04        INC B           ; → $7F
		// $8003: 0E 10     LD C,$10
		// $8005: ED 79     OUT (C),A       ← I/O (BC = $7F10)
		const { query } = makeDasm(0x8000,
			[0x06, 0x7E, 0x04, 0x0E, 0x10, 0xED, 0x79]);
		assert.deepStrictEqual(query(0x8005), {b: 0x7F, c: 0x10});
	});

	test('INC C / DEC C affect C alone (no carry into B)', () => {
		// $8000: 06 7F     LD B,$7F
		// $8002: 0E FF     LD C,$FF
		// $8004: 0C        INC C           ; C = $00 (no carry to B)
		// $8005: ED 79     OUT (C),A       ← I/O (BC = $7F00)
		const { query } = makeDasm(0x8000,
			[0x06, 0x7F, 0x0E, 0xFF, 0x0C, 0xED, 0x79]);
		assert.deepStrictEqual(query(0x8005), {b: 0x7F, c: 0x00});
	});

});


// ---------------------------------------------------------------------------
// Register-to-register propagation
// ---------------------------------------------------------------------------

suite('trackBcAt — LD B,r / LD C,r propagation', () => {

	test('LD B,C copies C into B', () => {
		// $8000: 0E 42     LD C,$42
		// $8002: 41        LD B,C
		// $8003: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x0E, 0x42, 0x41, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8003), {b: 0x42, c: 0x42});
	});

	test('LD C,B copies B into C', () => {
		// $8000: 06 7F     LD B,$7F
		// $8002: 48        LD C,B
		// $8003: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x06, 0x7F, 0x48, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8003), {b: 0x7F, c: 0x7F});
	});

	test('LD B,A clobbers B (A is not tracked)', () => {
		// $8000: 01 01 BC  LD BC,$BC01
		// $8003: 47        LD B,A
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x01, 0xBC, 0x47, 0xED, 0x49]);
		// b is now whatever A was — we can't track it.
		assert.strictEqual(query(0x8004).b, undefined);
		assert.strictEqual(query(0x8004).c, 0x01);
	});

	test('LD B,B is a no-op', () => {
		// $8000: 01 01 BC  LD BC,$BC01
		// $8003: 40        LD B,B
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x01, 0xBC, 0x40, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: 0xBC, c: 0x01});
	});

	test('LD C,C is a no-op', () => {
		// $8000: 01 01 BC  LD BC,$BC01
		// $8003: 49        LD C,C
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x01, 0xBC, 0x49, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: 0xBC, c: 0x01});
	});

});


// ---------------------------------------------------------------------------
// Clobbers
// ---------------------------------------------------------------------------

suite('trackBcAt — clobbers', () => {

	test('CALL clobbers both bytes', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: CD 00 90  CALL $9000
		// $8006: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xCD, 0x00, 0x90, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8006), {b: undefined, c: undefined});
	});

	test('RST clobbers both bytes', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: CF        RST $08
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xCF, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: undefined, c: undefined});
	});

	test('POP BC clobbers both bytes', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: C1        POP BC
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xC1, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: undefined, c: undefined});
	});

	test('EXX clobbers both bytes', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: D9        EXX
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xD9, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: undefined, c: undefined});
	});

	test('ED 4B (LD BC,(nn)) clobbers both bytes', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED 4B 00 90  LD BC,($9000)
		// $8007: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x4B, 0x00, 0x90, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8007), {b: undefined, c: undefined});
	});

	test('LDIR clobbers both bytes', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED B0     LDIR
		// $8005: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xED, 0xB0, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8005), {b: undefined, c: undefined});
	});

	test('CB RES 0,B clobbers B only', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: CB 80     RES 0,B
		// $8005: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xCB, 0x80, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8005), {b: undefined, c: 0x7E});
	});

	test('CB BIT 0,B does NOT clobber B (read-only)', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: CB 40     BIT 0,B
		// $8005: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xCB, 0x40, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8005), {b: 0xFB, c: 0x7E});
	});

	test('CB SLA C clobbers C only', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: CB 21     SLA C
		// $8005: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xCB, 0x21, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8005), {b: 0xFB, c: undefined});
	});

	test('CB SET 7,A does NOT touch BC', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: CB FF     SET 7,A
		// $8005: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xCB, 0xFF, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8005), {b: 0xFB, c: 0x7E});
	});

});


// ---------------------------------------------------------------------------
// Operations that preserve BC
// ---------------------------------------------------------------------------

suite('trackBcAt — operations preserving BC', () => {

	test('PUSH BC preserves the BC value', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: C5        PUSH BC
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0xC5, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: 0xFB, c: 0x7E});
	});

	test('LD A,n does not touch BC', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: 3E 42     LD A,$42
		// $8005: ED 79     OUT (C),A
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0x3E, 0x42, 0xED, 0x79]);
		assert.deepStrictEqual(query(0x8005), {b: 0xFB, c: 0x7E});
	});

	test('NOP does not touch BC', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: 00        NOP
		// $8004: ED 49     OUT (C),C
		const { query } = makeDasm(0x8000, [0x01, 0x7E, 0xFB, 0x00, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8004), {b: 0xFB, c: 0x7E});
	});

	test('ED 43 (LD (nn),BC) reads BC but does not modify it', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED 43 00 90  LD ($9000),BC
		// $8007: ED 49        OUT (C),C
		const { query } = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x43, 0x00, 0x90, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8007), {b: 0xFB, c: 0x7E});
	});

});


// ---------------------------------------------------------------------------
// Label boundary stops the walk
// ---------------------------------------------------------------------------

suite('trackBcAt — label boundary', () => {

	test('LD BC before a label, label is between → BC unknown', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: C3 06 80  JP  $8006        ; unconditional — block ends
		// $8006: ED 49     OUT (C),C       ← label at $8006 (jump target)
		const dasm = new Disassembler() as any;
		dasm.memory.setMemory(0x8000,
			new Uint8Array([0x01, 0x7E, 0xFB, 0xC3, 0x06, 0x80, 0xED, 0x49]));
		dasm.setFixedCodeLabel(0x8000, 'START');
		dasm.disassemble();
		// A label is placed at $8006 by the JP target processing. The walkback
		// from $8006 stops there → BC unknown going into the OUT.
		assert.deepStrictEqual(
			trackBcAt(dasm.memory, dasm.labels, 0x8006),
			{b: undefined, c: undefined});
	});

	test('Block-start at run-start: full state known if all setup is in-block', () => {
		// $8000: 01 00 7F  LD BC,$7F00
		// $8003: ED 49     OUT (C),C        ← I/O
		// Block start = $8000 (run start)
		const { query } = makeDasm(0x8000, [0x01, 0x00, 0x7F, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8003), {b: 0x7F, c: 0x00});
	});

});


// ---------------------------------------------------------------------------
// I/O instruction itself does not perturb state (read-only for BC)
// ---------------------------------------------------------------------------

suite('trackBcAt — I/O instructions are not applied to state', () => {

	test('OUT (C),C followed by another OUT (C),C — both read the same BC', () => {
		// $8000: 01 7E FB  LD BC,$FB7E
		// $8003: ED 49     OUT (C),C       ← first I/O
		// $8005: ED 49     OUT (C),C       ← second I/O (BC still $FB7E)
		const { query } = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x49, 0xED, 0x49]);
		assert.deepStrictEqual(query(0x8003), {b: 0xFB, c: 0x7E});
		assert.deepStrictEqual(query(0x8005), {b: 0xFB, c: 0x7E});
	});

});
