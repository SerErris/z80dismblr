/**
 * Vortex ROM decoder — unit tests.
 *
 * Validates the four-state XOR table from design/vortex_decrypt.md §Decoding Routine
 * and the self-inverse property.
 */

import * as assert from 'assert';
import { vortexDecoder } from '../../disassembler/decoders/vortex';


suite('vortex decoder', () => {

    // ------------------------------------------------------------------
    // Four-state table (A4, A2) → mask
    // ------------------------------------------------------------------

    suite('XOR mask by address', () => {

        test('A4=0 A2=0 → no bits flipped (mask 0x00)', () => {
            // addresses 0x0000, 0x0001, 0x0002, 0x0003 — neither A2 nor A4 set
            for (const addr of [0x0000, 0x0001, 0x0002, 0x0003]) {
                for (let b = 0; b < 256; b++) {
                    assert.strictEqual(vortexDecoder(addr, b), b,
                        `address ${addr.toString(16)} must pass byte ${b} through unchanged`);
                }
            }
        });

        test('A4=0 A2=1 → D5 flipped (mask 0x20)', () => {
            // 0x0004–0x0007 and 0x000C–0x000F: A2 set, A4 clear
            for (const addr of [0x0004, 0x0005, 0x000C, 0x000F]) {
                assert.strictEqual(vortexDecoder(addr, 0x00), 0x20);
                assert.strictEqual(vortexDecoder(addr, 0xFF), 0xDF);
                assert.strictEqual(vortexDecoder(addr, 0x20), 0x00);
            }
        });

        test('A4=1 A2=0 → D3 flipped (mask 0x08)', () => {
            // 0x0010–0x0013 and 0x0018–0x001B: A4 set, A2 clear
            for (const addr of [0x0010, 0x0011, 0x0018, 0x001B]) {
                assert.strictEqual(vortexDecoder(addr, 0x00), 0x08);
                assert.strictEqual(vortexDecoder(addr, 0xFF), 0xF7);
                assert.strictEqual(vortexDecoder(addr, 0x08), 0x00);
            }
        });

        test('A4=1 A2=1 → both D3 and D5 flipped (mask 0x28)', () => {
            // 0x0014–0x0017 and 0x001C–0x001F: both A2 and A4 set
            for (const addr of [0x0014, 0x0017, 0x001C, 0x001F]) {
                assert.strictEqual(vortexDecoder(addr, 0x00), 0x28);
                assert.strictEqual(vortexDecoder(addr, 0xFF), 0xD7);
                assert.strictEqual(vortexDecoder(addr, 0x28), 0x00);
            }
        });
    });


    // ------------------------------------------------------------------
    // Self-inverse (applying the XOR twice returns the original)
    // ------------------------------------------------------------------

    test('self-inverse: decode(decode(byte)) === byte for every address in 0..0x1F', () => {
        for (let addr = 0; addr < 0x20; addr++) {
            for (let b = 0; b < 256; b++) {
                const once  = vortexDecoder(addr, b);
                const twice = vortexDecoder(addr, once);
                assert.strictEqual(twice, b,
                    `addr=${addr.toString(16)} byte=${b} must round-trip`);
            }
        }
    });


    // ------------------------------------------------------------------
    // Only low 5 bits of address matter (A0, A1, A3 ignored; high bits ignored)
    // ------------------------------------------------------------------

    test('only address bits A2 and A4 are consulted', () => {
        // 0x0014 and 0x3F34 and 0xFF14 all have A2=1, A4=1 → same mask 0x28
        assert.strictEqual(vortexDecoder(0x0014, 0x00),
                           vortexDecoder(0x3F34, 0x00));
        assert.strictEqual(vortexDecoder(0x0014, 0x00),
                           vortexDecoder(0xFF14, 0x00));
    });


    // ------------------------------------------------------------------
    // Bit isolation: only D3 and D5 can ever change
    // ------------------------------------------------------------------

    test('bits other than D3 and D5 are never altered', () => {
        const preservedMask = ~0x28 & 0xFF;   // everything except D3, D5
        for (let addr = 0; addr < 0x20; addr++) {
            for (let b = 0; b < 256; b++) {
                const decoded = vortexDecoder(addr, b);
                assert.strictEqual((decoded & preservedMask),
                                   (b & preservedMask),
                    `addr=${addr.toString(16)} byte=${b}: bits outside D3/D5 must be unchanged`);
            }
        }
    });
});
