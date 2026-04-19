/**
 * Register-usage analyser for the subroutine header (design: sub_header.md §7.3).
 *
 * Given the disassembler's already-built label graph and opcode data, this
 * module determines, for every CODE_SUB / CODE_RST label:
 *
 *   - corruptedRegisters: registers whose value may differ between the
 *     caller's entry and exit points.
 *   - preservedRegisters: registers guaranteed to be identical on exit.
 *   - registerAnalysisUnavailable: set when static analysis cannot safely
 *     classify (indirect jump, self-modifying code, unknown callee).
 *
 * Results are written directly onto the DisLabel objects; the formatter in
 * disasm.ts reads them when building the header.
 */

import {DisLabel} from './dislabel';
import {NumberType} from './numbertype';
import {OpcodeFlag} from './opcode';
import {Z80Register, ALL_TRACKED_REGISTERS, RegisterAnalysisResult} from './registerAnalysis';


// ── Public interface ─────────────────────────────────────────────────────────

/**
 * Minimal slice of Disassembler state that RegAnalyzer needs.
 * Keeps the analyser independent of the full Disassembler class.
 */
export interface AnalyserContext {
	readonly labels: Map<number, DisLabel>;
	readonly addressParents: DisLabel[];
	/** True iff the memory location at `address` was loaded with real bytes. */
	isAssigned(address: number): boolean;
	/**
	 * Returns a shallow clone of the decoded opcode at `address`.
	 * The clone is safe to hold across multiple calls.
	 */
	getOpcode(address: number): DecodedOpcode;
	readonly rstDontFollowAddresses: number[];
}

/** Fields we need from a decoded Opcode. */
export interface DecodedOpcode {
	name:   string;
	flags:  number;
	length: number;
	value:  number;
	writes?: ReadonlySet<Z80Register>;
	reads?:  ReadonlySet<Z80Register>;
}


// ── Internal constants ───────────────────────────────────────────────────────

// SP is excluded from the user-visible report: it is managed by the
// CALL/RET ABI and is always SP-neutral across a balanced call (§7.3).
const REPORT_EXCLUDED = new Set<Z80Register>(['SP']);

// Maximum fixed-point iterations for recursive SCCs.
const MAX_FIXPOINT = 32;


// ── Main class ───────────────────────────────────────────────────────────────

export class RegAnalyzer {

	/** Reverse map built once: DisLabel → its address in the labels map. */
	private readonly labelToAddr = new Map<DisLabel, number>();

	constructor(private readonly ctx: AnalyserContext) {
		for (const [addr, label] of ctx.labels)
			this.labelToAddr.set(label, addr);
	}


	/**
	 * Analyses every CODE_SUB / CODE_RST label and writes the results
	 * (corruptedRegisters, preservedRegisters, registerAnalysisUnavailable)
	 * directly onto each DisLabel.
	 */
	run(): void {
		const subs  = this.collectSubs();
		const order = this.topoSort(subs);   // callees before callers

		for (const sub of order)
			this.analyseAndStore(sub);

		this.fixpoint(order);
	}


	// ── Private helpers ───────────────────────────────────────────────────────

	private collectSubs(): DisLabel[] {
		const result: DisLabel[] = [];
		for (const [, label] of this.ctx.labels) {
			if (!label.isEqu && (
				label.type === NumberType.CODE_SUB ||
				label.type === NumberType.CODE_RST
			)) {
				result.push(label);
			}
		}
		return result;
	}


	/**
	 * DFS post-order topological sort — callees appear before callers
	 * so that callee.corruptedRegisters is already set when the caller
	 * is analysed (bottom-up propagation, §8.6 step 5).
	 * Recursion back-edges (self-calls, mutual recursion) are skipped
	 * here; the fixed-point pass handles them.
	 */
	private topoSort(subs: DisLabel[]): DisLabel[] {
		const subSet  = new Set(subs);
		const visited = new Set<DisLabel>();
		const result: DisLabel[] = [];

		const visit = (sub: DisLabel) => {
			if (visited.has(sub)) return;
			visited.add(sub);
			for (const callee of sub.calls) {
				if (subSet.has(callee) && callee !== sub)
					visit(callee);
			}
			result.push(sub);
		};

		for (const sub of subs) visit(sub);
		return result;
	}


	private analyseAndStore(sub: DisLabel): void {
		const result = this.analyseOneSub(sub);
		sub.corruptedRegisters = result.corrupted;
		sub.preservedRegisters = result.preserved;
		if (result.unavailable)
			sub.registerAnalysisUnavailable = result.unavailable;
	}


	private analyseOneSub(sub: DisLabel): RegisterAnalysisResult {
		const startAddr = this.labelToAddr.get(sub);
		if (startAddr === undefined)
			return this.emptyResult();

		// RSTs configured to not follow are left as "not analysed" (§8.6).
		if (sub.type === NumberType.CODE_RST &&
			this.ctx.rstDontFollowAddresses.indexOf(startAddr) >= 0) {
			return this.emptyResult();
		}

		const maybeWritten = new Set<Z80Register>();
		const pushedRegs   = new Set<Z80Register>();
		const poppedRegs   = new Set<Z80Register>();
		let   unavailable: RegisterAnalysisResult['unavailable'];

		this.walk(startAddr, new Set<number>(), (address, op) => {
			// ── unavailability check ─────────────────────────────────────
			const reason = this.unavailableReason(op, address);
			if (reason) {
				unavailable = {reason, address};
				return false;   // stop walk
			}

			// ── callee effects (bottom-up propagation) ───────────────────
			if (op.flags & OpcodeFlag.CALL) {
				const callee = this.ctx.labels.get(op.value);
				if (callee) {
					if (callee.registerAnalysisUnavailable) {
						unavailable = {
							reason:  `calls unknown subroutine ${callee.name} at ${fmtHex(address)}`,
							address,
						};
						return false;
					}
					callee.corruptedRegisters?.forEach(r => maybeWritten.add(r));
				}
			}

			// ── accumulate opcode writes ─────────────────────────────────
			op.writes?.forEach(r => maybeWritten.add(r));

			// ── PUSH / POP detection (§8.6 step 4) ──────────────────────
			if (/^push\s/i.test(op.name))
				op.reads?.forEach(r => { if (r !== 'SP') pushedRegs.add(r); });
			if (/^pop\s/i.test(op.name))
				op.writes?.forEach(r => { if (r !== 'SP') poppedRegs.add(r); });

			return true;    // continue walk
		});

		if (unavailable)
			return {corrupted: new Set(), preserved: new Set(), unavailable};

		// Registers in both pushed and popped sets are restored (§8.6 step 4).
		const restored = new Set<Z80Register>();
		for (const r of pushedRegs)
			if (poppedRegs.has(r)) restored.add(r);

		// Classify every tracked register (excluding SP, §7.3).
		const corrupted = new Set<Z80Register>();
		const preserved = new Set<Z80Register>();
		for (const reg of ALL_TRACKED_REGISTERS) {
			if (REPORT_EXCLUDED.has(reg)) continue;
			if (maybeWritten.has(reg) && !restored.has(reg))
				corrupted.add(reg);
			else
				preserved.add(reg);
		}

		return {corrupted, preserved};
	}


	/**
	 * Walks reachable addresses from `startAddr` within the current
	 * subroutine (does not cross into other subs).
	 *
	 * `cb` is called for each opcode in address order.
	 * Return `false` from the callback to stop the walk early.
	 */
	private walk(
		startAddr: number,
		visited:   Set<number>,
		cb: (address: number, op: DecodedOpcode) => boolean,
	): void {
		let addr = startAddr;
		while (true) {
			if (!this.ctx.isAssigned(addr)) return;
			if (visited.has(addr))          return;
			visited.add(addr);

			const op = this.ctx.getOpcode(addr);

			if (!cb(addr, op)) return;

			// Follow conditional branches (not CALLs — they are separate subs).
			if ((op.flags & OpcodeFlag.BRANCH_ADDRESS) &&
				!(op.flags & OpcodeFlag.CALL)) {
				const branchLabel = this.ctx.labels.get(op.value);
				const branchIsSub = branchLabel && (
					branchLabel.type === NumberType.CODE_SUB ||
					branchLabel.type === NumberType.CODE_RST);
				if (!branchIsSub)
					this.walk(op.value, visited, cb);
			}

			// Advance to the next instruction.
			addr += op.length;

			// Stop when flowing into a different sub.
			const nextLabel = this.ctx.labels.get(addr);
			if (nextLabel && (
				nextLabel.type === NumberType.CODE_SUB ||
				nextLabel.type === NumberType.CODE_RST
			)) return;

			// Stop at flow-terminating opcodes (RET, unconditional JP, …).
			if (op.flags & OpcodeFlag.STOP) return;
		}
	}


	/**
	 * Returns a non-empty reason string when `op` renders the sub
	 * unanalysable via static analysis (§7.3.2).
	 *
	 * Currently detects indirect jumps (JP (HL) / JP (IX) / JP (IY)).
	 * HALT and RET are also STOP-but-no-BRANCH, so we check the name.
	 */
	private unavailableReason(op: DecodedOpcode, address: number): string | undefined {
		// STOP + no BRANCH_ADDRESS + no RET flag → indirect stop (JP (rr))
		if ((op.flags & OpcodeFlag.STOP) &&
			!(op.flags & OpcodeFlag.BRANCH_ADDRESS) &&
			!(op.flags & OpcodeFlag.RET)) {
			const n = op.name.toUpperCase();
			if      (n.includes('(HL)')) return `JP (HL) at ${fmtHex(address)} prevents static classification`;
			else if (n.includes('(IX')) return `JP (IX) at ${fmtHex(address)} prevents static classification`;
			else if (n.includes('(IY')) return `JP (IY) at ${fmtHex(address)} prevents static classification`;
		}
		return undefined;
	}


	/**
	 * Iterates over recursive SCCs until the corrupted sets stabilise.
	 * On each pass we re-analyse every non-unavailable sub; if nothing
	 * changes the loop terminates (monotone increasing, bounded above).
	 */
	private fixpoint(order: DisLabel[]): void {
		for (let pass = 0; pass < MAX_FIXPOINT; pass++) {
			let changed = false;
			for (const sub of order) {
				if (sub.registerAnalysisUnavailable) continue;
				const prev   = sub.corruptedRegisters;
				const result = this.analyseOneSub(sub);
				if (!setsEqual(result.corrupted, prev)) {
					sub.corruptedRegisters = result.corrupted;
					sub.preservedRegisters = result.preserved;
					changed = true;
				}
			}
			if (!changed) break;
		}
	}


	private emptyResult(): RegisterAnalysisResult {
		return {corrupted: new Set(), preserved: new Set()};
	}
}


// ── Module-level helpers ─────────────────────────────────────────────────────

function fmtHex(n: number): string {
	return '$' + n.toString(16).toUpperCase().padStart(4, '0');
}

function setsEqual<T>(a: Set<T> | undefined, b: Set<T> | undefined): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	if (a.size !== b.size) return false;
	for (const x of a) if (!b.has(x)) return false;
	return true;
}
