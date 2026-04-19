/**
 * Shared types and constants for the subroutine-header register
 * analysis pass (design doc: sub_header.md §8.1).
 *
 * This module is pure data and pure types — no logic. The analyser
 * (disasm.ts analyzeRegisterUsage) and the header formatter both
 * import from here so the register vocabulary stays consistent.
 */


/**
 * Every Z80 register we track at 8-bit granularity.
 *
 * The printer in headerFormatters.ts collapses matching halves into
 * 16-bit pair names (BC, HL, ...) per §7.7.
 */
export type Z80Register =
    | 'A' | 'F'
    | 'B' | 'C' | 'D' | 'E' | 'H' | 'L'
    | 'I' | 'R'
    | 'IXH' | 'IXL' | 'IYH' | 'IYL'
    | 'SP'
    | "A'" | "F'" | "B'" | "C'" | "D'" | "E'" | "H'" | "L'";


/**
 * The complete set of registers the analyser reasons about.
 *
 * Kept as an Array so it can drive iteration and be compared against
 * CANONICAL_ORDER in tests; a Set<Z80Register> view is cheap to
 * construct when membership queries are needed.
 */
export const ALL_TRACKED_REGISTERS: ReadonlyArray<Z80Register> = [
    'A', 'F',
    'B', 'C', 'D', 'E', 'H', 'L',
    'IXH', 'IXL', 'IYH', 'IYL',
    'I', 'R', 'SP',
    "A'", "F'",
    "B'", "C'", "D'", "E'", "H'", "L'",
];


/**
 * The order in which leftover 8-bit registers appear when the pair
 * printer has already emitted the collapsible pairs.
 *
 * Must be a permutation of ALL_TRACKED_REGISTERS. The pair printer
 * removes paired members, then walks this order to append the rest.
 */
export const CANONICAL_ORDER: ReadonlyArray<Z80Register> = [
    'A', 'F',
    'B', 'C', 'D', 'E', 'H', 'L',
    'IXH', 'IXL', 'IYH', 'IYL',
    'I', 'R', 'SP',
    "A'", "F'",
    "B'", "C'", "D'", "E'", "H'", "L'",
];


/**
 * Register-effect masks attached to each Opcode (see §8.3).
 *
 * The analyser unions `writes` over every reachable opcode to build
 * the "maybe written" set, then subtracts registers proven to be
 * restored via PUSH/POP symmetry.
 */
export interface RegisterEffects {
    writes: ReadonlySet<Z80Register>;
    reads:  ReadonlySet<Z80Register>;
}


/**
 * Output of analyzeRegisterUsage() for a single subroutine (§8.6).
 *
 * When `unavailable` is set the two Sets are empty — the analyser
 * has refused to commit. The header renders this as "—" for both
 * lists plus an explanatory note (§7.3.2).
 */
export interface RegisterAnalysisResult {
    corrupted: Set<Z80Register>;
    preserved: Set<Z80Register>;
    unavailable?: {
        reason:  string;
        address: number;
    };
}


/**
 * User-supplied structured fields parsed from the --comments file
 * (see §8.9). Every key is optional: an empty object means "nothing
 * documented yet" and the header falls back to defaults / auto
 * analysis.
 */
export interface StructuredFields {
    summary?:     string;
    action?:      string[];
    entry?:       string[];
    exitSuccess?: string[];
    exitFailure?: string[];
    /// User override for the Corrupted list. When set, suppresses the
    /// "(analysis unavailable: ...)" note because the human has taken
    /// responsibility for the answer.
    corrupted?:   Z80Register[];
    preserved?:   Z80Register[];
}
