/**
 * Vortex disk-controller ROM decoder.
 *
 * The original Vortex controller (circa 1986) holds its Z80 firmware ROM in an
 * encrypted form. Opcode fetches (M1) read raw bytes, but every non-M1 read
 * passes through a hardware XOR stage that flips two data bits based on two
 * address bits:
 *
 *   A2 set (address & 0x04) → flip D5 (XOR 0x20)
 *   A4 set (address & 0x10) → flip D3 (XOR 0x08)
 *
 * Only the low byte of the address matters. The four possible masks are:
 *
 *   A4 A2 | mask | bits flipped
 *   ------+------+-------------
 *    0  0 | 0x00 | none
 *    0  1 | 0x20 | D5
 *    1  0 | 0x08 | D3
 *    1  1 | 0x28 | D3, D5
 *
 * The operation is its own inverse (XOR is self-reversing).
 */

import { ByteDecoder } from './types';


export const vortexDecoder: ByteDecoder = (address: number, byte: number): number => {
    let mask = 0;
    if (address & 0x04) mask  = 0x20;   // A2 set → flip D5
    if (address & 0x10) mask |= 0x08;   // A4 set → flip D3
    return byte ^ mask;
};
