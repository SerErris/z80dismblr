/**
 * A byte decoder transforms a raw ROM byte into its effective value based on
 * the address it was fetched from. Used by BaseMemory to support hardware
 * decryption schemes such as the Vortex disk-controller ROM (see decoders/vortex.ts).
 *
 * The function is a pure mapping of (address, rawByte) → decodedByte with no
 * internal state. M1 (opcode) fetches bypass the decoder entirely; operand
 * and data reads pass through it.
 */
export type ByteDecoder = (address: number, byte: number) => number;
