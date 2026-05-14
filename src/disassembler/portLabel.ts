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
