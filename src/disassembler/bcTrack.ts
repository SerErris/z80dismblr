/**
 * BC linear-walk tracker.
 *
 * Walks forward through one basic block, simulating B/C register state,
 * to determine the effective BC value at a given I/O instruction
 * (`IN r,(C)` / `OUT (C),r`). See design/todo.md §3 — the per-byte state
 * table.
 *
 * The tracker is intentionally NOT a full dataflow analysis. It is:
 *   - linear (forward within one basic block, no joins),
 *   - non-interprocedural (CALL / RST always clobber BC),
 *   - conservative on doubt (anything not precisely modelled clobbers
 *     the affected byte).
 *
 * When it cannot determine BC, the caller falls back to "no annotation"
 * and the user can patch via Stream A `;;` comments.
 */

import {MemAttribute, Memory} from './memory';
import {Opcode, OpcodeFlag} from './opcode';


/** B and C register values at a program point. `undefined` = unknown. */
export interface BcState {
	b?: number;   // high byte: 0..0xFF or undefined
	c?: number;   // low byte:  0..0xFF or undefined
}


/** Bounds the backward walk that locates the basic-block start. */
const MAX_WALKBACK_INSTRUCTIONS = 128;


/**
 * Returns the effective BC state immediately before the instruction at
 * `ioAddress`. Both `state.b` and `state.c` are `undefined` if either
 * cannot be statically resolved.
 *
 * @param memory      Disassembler memory (`disasm.memory`).
 * @param labels      Address → label map (`disasm.labels`). Only `.has()`
 *                    is consulted.
 * @param ioAddress   Address of the I/O instruction whose preceding BC
 *                    state we want.
 */
export function trackBcAt(
	memory:    Memory,
	labels:    {has(addr: number): boolean},
	ioAddress: number,
): BcState {
	// ── Step 1: Find the basic-block start by walking backwards through
	// CODE_FIRST instruction boundaries. Stop at the first label
	// encountered — the block starts at that label (BC unknown going in).
	let blockStart = ioAddress;
	{
		let addr = ioAddress;
		for (let i = 0; i < MAX_WALKBACK_INSTRUCTIONS; i++) {
			const prev = findPrevInstruction(memory, addr);
			if (prev === undefined) break;
			if (labels.has(prev)) {
				blockStart = prev;     // include the label in the forward walk
				break;
			}
			blockStart = prev;
			addr = prev;
		}
	}

	// ── Step 2: Forward-walk from blockStart, applying per-opcode effects.
	// Initialise both keys explicitly so they are present-with-undefined in
	// the returned object (TS strips `{b: undefined, c: undefined}` literals
	// for optional fields, so we assign each separately).
	const state: BcState = {};
	state.b = undefined;
	state.c = undefined;
	let cursor = blockStart;
	while (cursor < ioAddress) {
		applyOpcodeEffect(state, memory, cursor);

		// If this instruction is an unconditional stop (JP, JR, RET without
		// condition), control would not fall through to `ioAddress`.
		// Anomalous — bail with unknown state.
		const op = Opcode.getOpcodeAt(memory, cursor);
		if ((op.flags & OpcodeFlag.STOP) && !(op.flags & OpcodeFlag.CONDITIONAL)) {
			const unknown: BcState = {};
			unknown.b = undefined;
			unknown.c = undefined;
			return unknown;
		}
		cursor += op.length;
	}
	return state;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the address of the previous instruction, or undefined. */
function findPrevInstruction(memory: Memory, addr: number): number | undefined {
	for (let a = addr - 1; a >= 0; a--) {
		const attr = memory.getAttributeAt(a);
		if (!(attr & MemAttribute.ASSIGNED))  return undefined;
		if (attr & MemAttribute.CODE_FIRST)   return a;
	}
	return undefined;
}


/**
 * Applies the effect of the instruction at `addr` to `state` in place.
 *
 * Handles the precise cases listed in design/todo.md §3 (LD BC,nn / LD B,
 * #n / LD C,#n / LD B,r / LD C,r / INC|DEC B/C/BC). Anything that
 * conservatively might clobber B and/or C does so. Instructions known
 * to leave BC untouched are no-ops.
 */
function applyOpcodeEffect(state: BcState, memory: Memory, addr: number): void {
	const m1 = memory.getRawAt(addr);
	switch (m1) {

		// LD BC,nn
		case 0x01:
			state.c = memory.getValueAt(addr + 1);
			state.b = memory.getValueAt(addr + 2);
			return;

		// LD B,#n
		case 0x06:
			state.b = memory.getValueAt(addr + 1);
			return;

		// LD C,#n
		case 0x0E:
			state.c = memory.getValueAt(addr + 1);
			return;

		// INC B / DEC B
		case 0x04:
			if (state.b !== undefined) state.b = (state.b + 1) & 0xFF;
			return;
		case 0x05:
			if (state.b !== undefined) state.b = (state.b - 1) & 0xFF;
			return;

		// INC C / DEC C
		case 0x0C:
			if (state.c !== undefined) state.c = (state.c + 1) & 0xFF;
			return;
		case 0x0D:
			if (state.c !== undefined) state.c = (state.c - 1) & 0xFF;
			return;

		// INC BC / DEC BC — full 16-bit ±1; both bytes must be known
		// because a carry/borrow can cross the byte boundary.
		case 0x03:
			if (state.b !== undefined && state.c !== undefined) {
				const bc = (((state.b << 8) | state.c) + 1) & 0xFFFF;
				state.b = (bc >> 8) & 0xFF;
				state.c =  bc       & 0xFF;
			}
			else {
				state.b = undefined;
				state.c = undefined;
			}
			return;
		case 0x0B:
			if (state.b !== undefined && state.c !== undefined) {
				const bc = (((state.b << 8) | state.c) - 1) & 0xFFFF;
				state.b = (bc >> 8) & 0xFF;
				state.c =  bc       & 0xFF;
			}
			else {
				state.b = undefined;
				state.c = undefined;
			}
			return;

		// LD B,r  (40..47)
		case 0x40: return;                      // LD B,B — no-op
		case 0x41: state.b = state.c; return;   // LD B,C — propagate (may set undefined)
		case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
			state.b = undefined;                // LD B,{D,E,H,L,(HL),A} — clobber
			return;

		// LD C,r  (48..4F)
		case 0x48: state.c = state.b; return;   // LD C,B — propagate
		case 0x49: return;                      // LD C,C — no-op
		case 0x4A: case 0x4B: case 0x4C: case 0x4D: case 0x4E: case 0x4F:
			state.c = undefined;
			return;

		// POP BC
		case 0xC1:
			state.b = undefined;
			state.c = undefined;
			return;

		// EXX — swaps with B'C' (and DE'/HL'); both bytes become unknown
		case 0xD9:
			state.b = undefined;
			state.c = undefined;
			return;

		// EX (SP),HL — no effect on BC
		case 0xE3:
			return;

		// CALL / CALL cc — callee may clobber BC
		case 0xCD:
		case 0xC4: case 0xCC: case 0xD4: case 0xDC:
		case 0xE4: case 0xEC: case 0xF4: case 0xFC:
			state.b = undefined;
			state.c = undefined;
			return;

		// RST n — same as call
		case 0xC7: case 0xCF: case 0xD7: case 0xDF:
		case 0xE7: case 0xEF: case 0xF7: case 0xFF:
			state.b = undefined;
			state.c = undefined;
			return;

		// CB prefix — bit ops. Look at the destination register (low 3 bits).
		case 0xCB: {
			const op2  = memory.getRawAt(addr + 1);
			const dst  = op2 & 0x07;
			const isBit = (op2 & 0xC0) === 0x40;
			if (isBit) return;                    // BIT n,r — read-only
			// RLC/RRC/RL/RR/SLA/SRA/SLL/SRL/RES/SET write to dst register
			if      (dst === 0) state.b = undefined;   // B
			else if (dst === 1) state.c = undefined;   // C
			return;
		}

		// ED prefix
		case 0xED: {
			const op2 = memory.getRawAt(addr + 1);
			switch (op2) {
				case 0x4B:                           // LD BC,(nn)
				case 0xA0: case 0xA8: case 0xB0: case 0xB8:  // LDI / LDD / LDIR / LDDR
				case 0xA1: case 0xA9: case 0xB1: case 0xB9:  // CPI / CPD / CPIR / CPDR
					state.b = undefined;
					state.c = undefined;
					return;
				case 0xA2: case 0xAA: case 0xB2: case 0xBA:  // INI / IND / INIR / INDR
				case 0xA3: case 0xAB: case 0xB3: case 0xBB:  // OUTI / OUTD / OTIR / OTDR
					state.b = undefined;               // each decrements B
					return;
				// IN r,(C) / OUT (C),r and other ED-prefix ops not in the above
				// set do not write to B or C. Includes ED 43 (LD (nn),BC).
				default:
					return;
			}
		}

		// DD / FD prefix — IX/IY ops. Only the LD B,r / LD C,r sub-opcodes
		// with prefix touch B or C (via IXH/IXL or (IX+d)).
		case 0xDD:
		case 0xFD: {
			const op2 = memory.getRawAt(addr + 1);
			if (op2 >= 0x40 && op2 <= 0x47)       { state.b = undefined; return; }
			if (op2 >= 0x48 && op2 <= 0x4F)       { state.c = undefined; return; }
			return;
		}

		default:
			// All other unprefixed opcodes preserve B and C. Examples: NOP,
			// LD A,*, arithmetic on A, JP/JR (handled by the STOP check
			// in the main walk), HALT, DI/EI, IN A,(n) / OUT (n),A.
			return;
	}
}
