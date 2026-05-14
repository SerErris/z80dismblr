/**
 * I/O port labels — user-curated names for I/O ports.
 *
 * Ports live in a 16-bit address space that is strictly separate from
 * the memory address space — port #F400 is NOT memory #F400.
 *
 * Wildcard support: each nibble of the 4-digit address may be a literal
 * hex digit or a `?` wildcard. The mask records which bit positions
 * participate in matching. A candidate effective port `P` matches a
 * label when `(P & mask) === (address & mask)`.
 *
 *   port:7F00  → address 0x7F00, mask 0xFFFF  (exact 16-bit match)
 *   port:7F??  → address 0x7F00, mask 0xFF00  (CPC partial decode: B = #7F)
 *   port:??FE  → address 0x00FE, mask 0x00FF  (Spectrum-style: C = #FE)
 *   port:7?40  → address 0x7040, mask 0xF0FF  (mixed)
 *
 * See `design/todo.md §3` for the design rationale (CPC partial decoding,
 * BC tracker, etc.).
 */
export interface PortLabel {
	/** 16-bit address. `?` wildcard nibbles contribute 0. */
	address: number;
	/** Bit mask: each nibble is `0xF` for a literal hex digit, `0x0` for a `?`. */
	mask: number;
	/** User-supplied name. */
	name: string;
}


/**
 * Parses the 4-character address portion of a `port:XXXX` declaration
 * (the part *after* the `port:` prefix) into an `(address, mask)` pair.
 *
 * @param spec  Exactly 4 characters. Each must be a hex digit (0-9, A-F,
 *              case-insensitive) or `?` wildcard.
 * @returns     `{ address, mask }`. `?` nibbles contribute 0 to both.
 * @throws      Error with a descriptive message on malformed input.
 */
export function parsePortAddress(spec: string): {address: number; mask: number} {
	if (spec.length !== 4) {
		throw new Error(
			`port address must be exactly 4 hex-or-'?' characters, got ${spec.length}: "${spec}"`
		);
	}
	let address = 0;
	let mask    = 0;
	for (let i = 0; i < 4; i++) {
		const c     = spec[i];
		const shift = (3 - i) * 4;
		if (c === '?') continue;                       // wildcard: leave both at 0
		const nibble = parseInt(c, 16);
		if (isNaN(nibble)) {
			throw new Error(
				`port address nibble must be a hex digit or '?', got '${c}' in "${spec}"`
			);
		}
		address |= nibble << shift;
		mask    |= 0xF    << shift;
	}
	return {address, mask};
}


// ---------------------------------------------------------------------------
// Port lookup
// ---------------------------------------------------------------------------

/**
 * What the caller knows about the effective port at an I/O site. Drives
 * which subset of port labels can possibly match — see design/todo.md §3
 * "Lookup and matching".
 */
export type PortLookupQuery =
	/** Full 16-bit BC value is known (BC tracker, both bytes resolved). */
	| {kind: 'full';             port: number}
	/** Only B (high byte) is known. Only labels with no low-byte constraint can match. */
	| {kind: 'highByte';         b:    number}
	/** Only C (low byte) is known. Only labels with no high-byte constraint can match. */
	| {kind: 'lowByte';          c:    number}
	/** `IN A,(n)` / `OUT (n),A` — only the immediate `n` (low byte) is statically known. */
	| {kind: 'lowByteImmediate'; n:    number};


/** Popcount of the low 16 bits — used to rank match specificity. */
function popcount16(n: number): number {
	n &= 0xFFFF;
	let c = 0;
	while (n) {
		n &= n - 1;   // clear lowest set bit
		c++;
	}
	return c;
}


/** Returns true if `query` is compatible with `label`'s constraints. */
function matches(label: PortLabel, query: PortLookupQuery): boolean {
	const {address, mask} = label;
	switch (query.kind) {
		case 'full':
			return (query.port & mask) === (address & mask);

		case 'highByte': {
			// Label may not constrain the low byte (we don't know C).
			if ((mask & 0x00FF) !== 0) return false;
			const hiMask = (mask    >> 8) & 0xFF;
			const hiAddr = (address >> 8) & 0xFF;
			return (query.b & hiMask) === (hiAddr & hiMask);
		}

		case 'lowByte':
		case 'lowByteImmediate': {
			// Label may not constrain the high byte (we don't know B / it is `A`).
			if ((mask & 0xFF00) !== 0) return false;
			const loMask = mask    & 0xFF;
			const loAddr = address & 0xFF;
			const value  = query.kind === 'lowByte' ? query.c : query.n;
			return (value & loMask) === (loAddr & loMask);
		}
	}
}


/**
 * Looks up the best-matching port label for a given query.
 *
 * Matching rule: `(query_value & mask) === (address & mask)` against the
 * appropriate byte(s) for the query kind. Most-specific match wins
 * (largest mask popcount). Ties resolve to the first-declared label
 * (i.e. the first matching entry in array order).
 *
 * Example — given the labels:
 *
 *   port:FB??  FDC_BASE     (mask 0xFF00, popcount 8)
 *   port:FB7E  FDC_STATUS   (mask 0xFFFF, popcount 16)
 *
 * a lookup for {kind: 'full', port: 0xFB7E} returns FDC_STATUS.
 *
 * Returns undefined if no label matches.
 */
export function lookupPort(
	labels: ReadonlyArray<PortLabel>,
	query:  PortLookupQuery,
): PortLabel | undefined {
	let best:        PortLabel | undefined;
	let bestPopcnt = -1;
	for (const label of labels) {
		if (!matches(label, query)) continue;
		const pc = popcount16(label.mask);
		if (pc > bestPopcnt) {
			best        = label;
			bestPopcnt = pc;
		}
		// Equal popcount: keep the first-declared (no update).
	}
	return best;
}
