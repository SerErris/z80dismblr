/**
 * --bytes raw|decoded|both — byte-column rendering.
 *
 * The raw column shows bytes as stored; the decoded column shows what the
 * program effectively sees: M1 (opcode/prefix) bytes raw, operand/data
 * bytes through the installed memory decoder. 'both' shows "raw | decoded".
 * The M1/operand split must match Opcode.getOpcodeAt(), including DDCB/FDCB.
 */

import assert = require('assert');
import { Format } from '../disassembler/format';
import { BaseMemory } from '../disassembler/basememory';

// Deterministic decoder: invert every byte. M1 bytes must NOT be inverted
// in the decoded column (they are raw fetches); operand bytes must be.
const invert = (_addr: number, raw: number) => raw ^ 0xFF;

function mem(bytes: number[]): BaseMemory {
    const m = new BaseMemory(0, new Uint8Array(bytes));
    m.setDecoder(invert);
    return m;
}

// formatDisassembly pads/positions other columns; we only care about the
// byte field, so disable address/opcode columns and read the trimmed head.
function bytesField(m: BaseMemory, addr: number, size: number,
                    mode: 'raw' | 'decoded' | 'both'): string {
    const line = Format.formatDisassembly(m, false, 0, 0, 1, 0, addr, size, '', mode);
    return line.trimEnd();
}


suite('--bytes raw|decoded|both', () => {

    test('unprefixed: opcode raw, operand decoded', () => {
        // 3E nn = LD A,n.  Offset 0 (3E) = M1/raw, offset 1 (nn) = operand.
        const m = mem([0x3E, 0x10]);

        assert.strictEqual(bytesField(m, 0, 2, 'raw'), '3E 10');
        // 0x3E stays raw (M1); 0x10 -> decoder -> 0xEF.
        assert.strictEqual(bytesField(m, 0, 2, 'decoded'), '3E EF');
        assert.strictEqual(bytesField(m, 0, 2, 'both'), '3E 10 | 3E EF');
    });

    test('no decoder installed: decoded == raw', () => {
        const m = new BaseMemory(0, new Uint8Array([0x3E, 0x10]));
        assert.strictEqual(bytesField(m, 0, 2, 'decoded'), '3E 10');
    });

    test('ED-prefixed: two M1 bytes raw, rest decoded', () => {
        // ED 53 nn nn = LD (nn),DE.  Offsets 0,1 raw; 2,3 operand.
        const m = mem([0xED, 0x53, 0x34, 0x12]);
        assert.strictEqual(bytesField(m, 0, 4, 'decoded'), 'ED 53 CB ED');
    });

    test('DDCB: prefix bytes raw, displacement+selector decoded', () => {
        // DD CB d op (e.g. bit b,(ix+d)).  Offsets 0,1 raw; 2,3 decoded —
        // the displacement and the post-displacement selector are non-M1
        // reads in Opcode.getOpcodeAt (OpcodeExtended2).
        const m = mem([0xDD, 0xCB, 0x05, 0x46]);
        assert.strictEqual(bytesField(m, 0, 4, 'decoded'), 'DD CB FA B9');
    });

    test('CB-prefixed: both bytes are M1 (raw), nothing decoded', () => {
        const m = mem([0xCB, 0x40]);   // bit 0,b
        assert.strictEqual(bytesField(m, 0, 2, 'decoded'), 'CB 40');
    });
});
