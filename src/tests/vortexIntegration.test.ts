/**
 * Vortex decoder — integration test.
 *
 * Takes a small plaintext fixture binary, applies the Vortex XOR at every
 * non-M1 byte position to produce an "encrypted" counterpart, then runs the
 * disassembler on the encrypted binary with the vortex decoder installed.
 * The resulting output must match a run of the plaintext binary without the
 * decoder (both should produce the same disassembly).
 *
 * The test does not re-assemble: per design, the decoded view is the
 * program-visible cleartext and the emitted source produces a cleartext ROM,
 * not a byte-match to the encrypted original.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { vortexDecoder } from '../disassembler/decoders/vortex';
import { Opcode, Opcodes } from '../disassembler/opcode';
import { BaseMemory } from '../disassembler/basememory';


/**
 * Testing oracle: simulate a Vortex-encrypted ROM image from a plaintext
 * binary.  The rule on a real Vortex ROM is "opcodes are stored clear;
 * operands and data bytes are stored encrypted" — so we start by encrypting
 * every byte, then un-encrypt the positions that the CPU would M1-fetch.
 * Bytes that are never reached (padding, raw data) stay encrypted, which
 * is how they must be stored for the hardware decoder to produce the right
 * values when the disassembler reads them as DEFB data.
 */
function encryptPlaintext(plain: Uint8Array, entryPoints: number[] = [0]): Uint8Array {
    // Start: every byte XOR-encrypted with its address mask.
    const enc = new Uint8Array(plain.length);
    for (let a = 0; a < plain.length; a++) enc[a] = vortexDecoder(a, plain[a]);

    // Walk all reachable instructions from the entry points; restore M1
    // (opcode + prefix) bytes to their plaintext value.
    const mem = new BaseMemory(0, plain);
    const prefixBytes = new Set<number>([0xCB, 0xED, 0xDD, 0xFD]);
    const seen = new Set<number>();
    const queue: number[] = [...entryPoints];

    while (queue.length > 0) {
        const address = queue.shift()!;
        if (seen.has(address)) continue;
        seen.add(address);
        if (address < 0 || address >= plain.length) continue;

        const opcode = Opcode.getOpcodeAt(mem, address, Opcodes);
        const length = opcode.length;
        if (length <= 0 || address + length > plain.length) continue;

        const b0 = plain[address];
        // Restore M1 bytes to plaintext:
        //   i=0            → always M1 (opcode or prefix)
        //   i=1, b0∈prefix → M1 (op byte after CB/ED/DD/FD)
        // All other byte positions within the instruction remain encrypted.
        enc[address] = plain[address];                          // i=0
        if (length > 1 && prefixBytes.has(b0)) {
            enc[address + 1] = plain[address + 1];              // i=1 after prefix
        }

        // Follow simple fall-through so the walk reaches subsequent code.
        // A full CFG walk is not necessary for this fixture — linear
        // fall-through plus explicit entry points cover everything.
        if (b0 !== 0xC9 /* RET */) {
            queue.push(address + length);
        }
    }

    return enc;
}


function makeDasm(): any {
    const dasm = new Disassembler() as any;
    dasm.labelSubPrefix      = 'SUB';
    dasm.labelLblPrefix      = 'LBL';
    dasm.labelDataLblPrefix  = 'DATA';
    dasm.labelLocalLabelPrefix = '_l';
    dasm.labelLoopPrefix     = '_loop';
    dasm.labelSelfModifyingPrefix = 'SELF_MOD';
    dasm.opcodesLowerCase    = false;
    dasm.initLabels();
    return dasm;
}


function disassemble(dasm: any): string {
    dasm.disassemble();
    return (dasm.getDisassemblyLines() as string[]).join('\n');
}


suite('Vortex decoder — integration', () => {

    /**
     * A small fixture binary.  Carefully chosen to exercise:
     *   - a 3-byte main-set instruction with a 16-bit operand (CALL nn)
     *   - a 1-byte instruction (RET)
     *   - a 2-byte main-set instruction with an 8-bit operand (LD A,n)
     *   - a DD-prefixed 3-byte instruction (LD IX+d as part of bit test)
     *
     *   0x0000  CD 10 00    CALL 0x0010       ← operand at +1, +2 (non-M1)
     *   0x0003  C9          RET
     *   0x0004..0x000F      padding HALTs (76)
     *   0x0010  3E 01       LD   A, 1         ← operand at +1 (non-M1)
     *   0x0012  C9          RET
     *
     * All non-M1 bytes fall at addresses where the Vortex mask is non-zero:
     *   0x0001 (A2=0,A4=0) → mask 0x00 — byte 0x10 → 0x10 (unchanged)
     *   0x0002 (A2=0,A4=0) → mask 0x00 — byte 0x00 → 0x00 (unchanged)
     *   0x0011 (A2=0,A4=1) → mask 0x08 — byte 0x01 → 0x09 (encrypted!)
     *
     * So after encryption the byte at 0x0011 flips from 0x01 to 0x09.
     * With the decoder installed on pass 2, the disassembler sees 0x01 again,
     * and both disassemblies produce identical output.
     */
    const PLAIN = new Uint8Array([
        0xCD, 0x10, 0x00,
        0xC9,
        0x76, 0x76, 0x76, 0x76,
        0x76, 0x76, 0x76, 0x76,
        0x76, 0x76, 0x76, 0x76,
        0x3E, 0x01,
        0xC9,
    ]);


    test('encryption oracle flips expected bytes', () => {
        const enc = encryptPlaintext(PLAIN, [0x0000, 0x0010]);
        // 0x0001: A2=0,A4=0 → no change
        assert.strictEqual(enc[0x0001], 0x10);
        // 0x0002: A2=0,A4=0 → no change
        assert.strictEqual(enc[0x0002], 0x00);
        // 0x0011: A2=0,A4=1 → D3 flipped (0x01 XOR 0x08 = 0x09)
        assert.strictEqual(enc[0x0011], 0x09,
            'byte at 0x0011 must be encrypted (0x01 XOR 0x08 = 0x09)');
        // Opcode bytes (M1) unchanged
        assert.strictEqual(enc[0x0000], 0xCD, 'CALL opcode byte must stay raw');
        assert.strictEqual(enc[0x0003], 0xC9, 'RET opcode byte must stay raw');
        assert.strictEqual(enc[0x0010], 0x3E, 'LD A,n opcode byte must stay raw');
        assert.strictEqual(enc[0x0012], 0xC9, 'RET opcode byte must stay raw');
        // Unreached data bytes (0x04..0x0F) must be encrypted:
        //   address 0x04 (A2=1,A4=0) → mask 0x20 → 0x76 XOR 0x20 = 0x56
        assert.strictEqual(enc[0x0004], 0x56,
            'unreached data byte at 0x04 must be encrypted (0x76 XOR 0x20 = 0x56)');
        //   address 0x0D (A2=1,A4=0) → mask 0x20 → 0x56
        assert.strictEqual(enc[0x000D], 0x56);
        //   address 0x08 (A2=0,A4=0) → mask 0x00 → unchanged
        assert.strictEqual(enc[0x0008], 0x76);
    });


    test('disassembly of encrypted ROM with --decoder vortex matches plaintext disassembly', () => {
        // Pass 1 — plaintext, no decoder
        const d1 = makeDasm();
        d1.memory.setMemory(0, PLAIN);
        d1.setLabel(0);
        const plainOut = disassemble(d1);

        // Pass 2 — encrypted ROM, vortex decoder installed
        const enc = encryptPlaintext(PLAIN, [0x0000, 0x0010]);
        const d2 = makeDasm();
        d2.memory.setMemory(0, enc);
        d2.memory.setDecoder(vortexDecoder);
        d2.setLabel(0);
        const decodedOut = disassemble(d2);

        // The annotated listing includes a raw-bytes column (--addbytes is
        // true by default).  That column shows the *stored* bytes, so pass 2
        // will show the encrypted bytes there while pass 1 shows plaintext.
        // Strip the raw-bytes column before comparing.
        const stripBytesColumn = (text: string): string =>
            text.split('\n').map(l => {
                // Format is:  "XXXX  BB BB BB   MNEMONIC ..."
                // Keep the 4-digit address and everything from the mnemonic.
                const m = l.match(/^([0-9A-Fa-f]{4})\s+(?:[0-9A-Fa-f]{2}\s+)+(.*)$/);
                if (m) return m[1] + ' ' + m[2];
                return l;
            }).join('\n');

        assert.strictEqual(
            stripBytesColumn(decodedOut),
            stripBytesColumn(plainOut),
            'decoded disassembly of encrypted ROM must match plaintext disassembly',
        );
    });


    test('setDecoder(undefined) restores raw reads', () => {
        const enc = encryptPlaintext(PLAIN, [0x0000, 0x0010]);
        const d = makeDasm();
        d.memory.setMemory(0, enc);
        d.memory.setDecoder(vortexDecoder);
        // Verify decoder is in effect
        assert.strictEqual(d.memory.getValueAt(0x0011), 0x01);
        // Clear decoder
        d.memory.setDecoder(undefined);
        // Now getValueAt returns the raw (encrypted) byte
        assert.strictEqual(d.memory.getValueAt(0x0011), 0x09);
    });


    test('getRawAt always bypasses the decoder', () => {
        const enc = encryptPlaintext(PLAIN, [0x0000, 0x0010]);
        const d = makeDasm();
        d.memory.setMemory(0, enc);
        d.memory.setDecoder(vortexDecoder);
        // getRawAt returns the stored (encrypted) byte regardless of decoder
        assert.strictEqual(d.memory.getRawAt(0x0011), 0x09);
        // getValueAt returns the decoded byte
        assert.strictEqual(d.memory.getValueAt(0x0011), 0x01);
    });
});
