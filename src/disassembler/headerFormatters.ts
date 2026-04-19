/**
 * Pure formatting helpers for the subroutine header (§8.7).
 *
 * No Disassembler state touched here — these are deterministic,
 * unit-testable string/set transformations used by getLabelComments()
 * in disasm.ts.
 */

import {CANONICAL_ORDER, Z80Register} from './registerAnalysis';


/** Fixed header width — §7.7 resolved decision. */
export const HEADER_WIDTH = 79;

/** Visible content width inside the banner's middle line. */
export const CONTENT_WIDTH =
	HEADER_WIDTH - '; *** '.length - ' ***'.length;   // = 69


/**
 * The top and bottom asterisk rules of the banner.
 * Always exactly HEADER_WIDTH characters.
 */
export function buildBannerRule(): string {
	return '; ' + '*'.repeat(HEADER_WIDTH - 2);
}


/**
 * The middle line of the banner:
 * `; *** sub <NAME>                    ***`
 *
 * Always exactly HEADER_WIDTH characters. Names that overflow the
 * content area are truncated with a trailing '…'.
 */
export function buildBannerMid(name: string): string {
	const body = 'sub ' + name;
	const content = body.length > CONTENT_WIDTH
		? body.slice(0, CONTENT_WIDTH - 1) + '…'
		: body.padEnd(CONTENT_WIDTH, ' ');
	return '; *** ' + content + ' ***';
}


/**
 * Collapses matching 16-bit pair halves into pair names (§7.7).
 *
 * Input: a set of 8-bit register names.
 * Output: a canonically ordered list where both halves of a pair are
 * replaced by the pair name (BC, HL, IX, ...) and leftover singletons
 * keep their 8-bit names.
 */
export function collapseRegisterPairs(regs: Set<Z80Register>): string[] {
	const PAIRS: Array<[Z80Register, Z80Register, string]> = [
		['A', 'F', 'AF'],
		['B', 'C', 'BC'],
		['D', 'E', 'DE'],
		['H', 'L', 'HL'],
		['IXH', 'IXL', 'IX'],
		['IYH', 'IYL', 'IY'],
		["A'", "F'", "AF'"],
		["B'", "C'", "BC'"],
		["D'", "E'", "DE'"],
		["H'", "L'", "HL'"],
	];

	const out: string[] = [];
	const remaining = new Set<Z80Register>(regs);

	for (const [lo, hi, pair] of PAIRS) {
		if (remaining.has(lo) && remaining.has(hi)) {
			out.push(pair);
			remaining.delete(lo);
			remaining.delete(hi);
		}
	}

	for (const r of CANONICAL_ORDER)
		if (remaining.has(r)) out.push(r);

	return out;
}


/**
 * Renders a list of register/field names for the header.
 * Empty or undefined → em-dash placeholder (§7.7 resolved).
 */
export function renderList(items: string[] | undefined): string {
	return (items && items.length > 0) ? items.join(', ') : '—';
}
