/**
 * Regression — inside vs. outside CALL determines local vs. global.
 *
 * findLocalLabelsInSubroutines() demotes a label to a local ONLY when every
 * reference (caller) sits inside the enclosing routine's coherent address
 * block. This applies uniformly to JP/JR and CALL:
 *
 *   - A target called only from *inside* the block is an internal call and
 *     becomes a local (`call .parent_lN` is intentional here).
 *   - A target called from *outside* the block is a genuine global
 *     subroutine and keeps its CODE_SUB name.
 *
 * This locks in the inside/outside rule so a future change can't regress it
 * back to a blanket "a CALL target is never local".
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';


/**
 * 0x0000: CALL 0x0009 ; CALL 0x0012 ; RET     (entry → SUB_A, then SUB_B)
 * 0x0009: OR A                                 SUB_A
 * 0x000A: JR Z,0x000F   jump into block → sweeps 0x000F into SUB_A
 * 0x000C: CALL 0x000F   internal call of 0x000F (caller inside SUB_A)
 * 0x000F: RET           TARGET_A — only callers are inside SUB_A → LOCAL
 * 0x0012: RET           SUB_B — called from 0x0003 (outside SUB_A) → global
 */
const BINARY = new Uint8Array([
    0xCD, 0x09, 0x00,   // 0000 CALL 0x0009 (SUB_A)
    0xCD, 0x12, 0x00,   // 0003 CALL 0x0012 (SUB_B, external caller)
    0xC9,               // 0006 RET
    0x76, 0x76,         // 0007 padding → 0x0009
    0xB7,               // 0009 OR A            (SUB_A)
    0x28, 0x03,         // 000A JR Z,0x000F
    0xCD, 0x0F, 0x00,   // 000C CALL 0x000F     (internal call)
    0xC9,               // 000F RET             (TARGET_A → local)
    0x76, 0x76,         // 0010 padding → 0x0012
    0xC9,               // 0012 RET             (SUB_B → global)
]);

function makeDasm(): any {
    const dasm = new Disassembler() as any;
    dasm.labelSubPrefix = 'SUB';
    dasm.labelLblPrefix = 'LBL';
    dasm.labelDataLblPrefix = 'DATA';
    dasm.labelLocalLabelPrefix = '_l';
    dasm.labelLoopPrefix = '_loop';
    dasm.labelSelfModifyingPrefix = 'SELF_MOD';
    dasm.addOpcodeBytes = false;
    dasm.opcodesLowerCase = true;
    dasm.initLabels();
    dasm.memory.setMemory(0, BINARY);
    dasm.setLabel(0);
    return dasm;
}

function disassemble(dasm: any): string {
    dasm.disassemble();
    return (dasm.getDisassemblyLines() as string[]).join('\n');
}


suite('Regression — inside vs. outside CALL → local vs. global', () => {

    test('internal-only-called target becomes a local', () => {
        const dasm = makeDasm();
        const asm = disassemble(dasm);

        const targetA = dasm.labels.get(0x000F);
        assert.ok(targetA, 'a label must exist at 0x000F');
        assert.ok(targetA.name.startsWith('.'),
            'target called only from inside the block must be a local, got '
            + targetA.name + '\n' + asm);
        // The internal CALL must therefore reference that local.
        assert.ok(/call\s+\./i.test(asm),
            'internal call must target the indented local label:\n' + asm);
    });

    test('externally-called target stays a global subroutine', () => {
        const dasm = makeDasm();
        const asm = disassemble(dasm);

        const subB = dasm.labels.get(0x0012);
        assert.ok(subB, 'a label must exist at 0x0012');
        assert.ok(!subB.name.startsWith('.'),
            'target called from outside its block must stay global, got '
            + subB.name + '\n' + asm);
        assert.ok(/call\s+SUB\d/i.test(asm),
            'the external caller must reference a global SUB label:\n' + asm);
    });
});
