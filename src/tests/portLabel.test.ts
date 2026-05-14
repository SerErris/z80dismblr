import assert = require('assert');
import { parsePortAddress } from '../disassembler/portLabel';


// ---------------------------------------------------------------------------
// parsePortAddress — wildcard hex parser
// ---------------------------------------------------------------------------

suite('parsePortAddress', () => {

	// ── Exact 16-bit (no wildcards) ────────────────────────────────────────

	test('exact 16-bit: 7F00 → address 0x7F00, mask 0xFFFF', () => {
		const r = parsePortAddress('7F00');
		assert.strictEqual(r.address, 0x7F00);
		assert.strictEqual(r.mask,    0xFFFF);
	});

	test('exact 16-bit: FFFD → AY register, full mask', () => {
		const r = parsePortAddress('FFFD');
		assert.strictEqual(r.address, 0xFFFD);
		assert.strictEqual(r.mask,    0xFFFF);
	});

	test('exact 16-bit: 0000 → all-zero address and full mask', () => {
		const r = parsePortAddress('0000');
		assert.strictEqual(r.address, 0x0000);
		assert.strictEqual(r.mask,    0xFFFF);
	});

	test('case insensitive: lowercase hex parses identically', () => {
		const r = parsePortAddress('abcd');
		assert.strictEqual(r.address, 0xABCD);
		assert.strictEqual(r.mask,    0xFFFF);
	});

	test('case insensitive: mixed case', () => {
		const r = parsePortAddress('aB7c');
		assert.strictEqual(r.address, 0xAB7C);
		assert.strictEqual(r.mask,    0xFFFF);
	});


	// ── Wildcards ──────────────────────────────────────────────────────────

	test('high-byte selector: 7F?? → address 0x7F00, mask 0xFF00', () => {
		const r = parsePortAddress('7F??');
		assert.strictEqual(r.address, 0x7F00);
		assert.strictEqual(r.mask,    0xFF00);
	});

	test('low-byte selector: ??FE → address 0x00FE, mask 0x00FF', () => {
		const r = parsePortAddress('??FE');
		assert.strictEqual(r.address, 0x00FE);
		assert.strictEqual(r.mask,    0x00FF);
	});

	test('mixed-nibble mask: 7?40 → address 0x7040, mask 0xF0FF', () => {
		const r = parsePortAddress('7?40');
		assert.strictEqual(r.address, 0x7040);
		assert.strictEqual(r.mask,    0xF0FF);
	});

	test('all wildcards: ???? → matches every port (mask 0)', () => {
		const r = parsePortAddress('????');
		assert.strictEqual(r.address, 0x0000);
		assert.strictEqual(r.mask,    0x0000);
	});

	test('single wildcard at the high nibble: ?BCD → mask 0x0FFF', () => {
		const r = parsePortAddress('?BCD');
		assert.strictEqual(r.address, 0x0BCD);
		assert.strictEqual(r.mask,    0x0FFF);
	});

	test('single wildcard at the low nibble: ABC? → mask 0xFFF0', () => {
		const r = parsePortAddress('ABC?');
		assert.strictEqual(r.address, 0xABC0);
		assert.strictEqual(r.mask,    0xFFF0);
	});


	// ── CPC canonical-port spot checks ─────────────────────────────────────

	test('CPC Gate Array: 7F?? → mask covers only high byte', () => {
		const r = parsePortAddress('7F??');
		assert.strictEqual(r.address & r.mask, 0x7F00);
	});

	test('CPC FDC sub-addresses: FB7E vs FB7F have distinct full masks', () => {
		const status = parsePortAddress('FB7E');
		const data   = parsePortAddress('FB7F');
		assert.strictEqual(status.address, 0xFB7E);
		assert.strictEqual(data.address,   0xFB7F);
		assert.strictEqual(status.mask,    0xFFFF);
		assert.strictEqual(data.mask,      0xFFFF);
	});


	// ── Malformed input ────────────────────────────────────────────────────

	test('rejects empty string', () => {
		assert.throws(() => parsePortAddress(''), /4 hex-or-'\?' characters/);
	});

	test('rejects too short (3 chars)', () => {
		assert.throws(() => parsePortAddress('7F0'), /4 hex-or-'\?' characters/);
	});

	test('rejects too long (5 chars)', () => {
		assert.throws(() => parsePortAddress('7F000'), /4 hex-or-'\?' characters/);
	});

	test('rejects non-hex characters', () => {
		assert.throws(() => parsePortAddress('7G00'), /must be a hex digit or '\?'/);
		assert.throws(() => parsePortAddress('XYZW'), /must be a hex digit or '\?'/);
		assert.throws(() => parsePortAddress('7F*0'), /must be a hex digit or '\?'/);
	});

	test('rejects whitespace inside the spec', () => {
		assert.throws(() => parsePortAddress('7F 0'), /must be a hex digit or '\?'/);
	});

});
