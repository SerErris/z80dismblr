/**
 * A7 — Idempotence harness.
 *
 * Verifies that `disassemble → emit → auto-import → disassemble → emit`
 * produces byte-identical output.  Any drift means the round-trip parser
 * is either changing data on re-read (false positive) or failing to
 * preserve user data (false negative).
 *
 * The test runs two passes over the same binary.  Pass 1 has no prior
 * annotations; its output is written to a temp file and fed back as auto-
 * import for Pass 2.  The two output strings must be identical.
 */

import assert = require('assert');
import { createPatch } from 'diff';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


/** Binary that generates two subroutines with banners and a data label. */
const BINARY = new Uint8Array([
    // 0x0000: CALL 0x0010 ; RET (main entry)
    0xCD, 0x10, 0x00,
    0xC9,
    // 0x0004–0x000F: padding (HALTs)
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    // 0x0010: LD A,1 ; RET (callee subroutine)
    0x3E, 0x01,
    0xC9,
]);

function makeDasm(): any {
    const dasm = new Disassembler() as any;
    dasm.labelSubPrefix      = 'SUB';
    dasm.labelLblPrefix      = 'LBL';
    dasm.labelDataLblPrefix  = 'DATA';
    dasm.labelLocalLabelPrefix = '_l';
    dasm.labelLoopPrefix     = '_loop';
    dasm.labelSelfModifyingPrefix = 'SELF_MOD';
    dasm.addOpcodeBytes      = false;
    dasm.opcodesLowerCase    = false;
    dasm.initLabels();
    dasm.memory.setMemory(0, BINARY);
    dasm.setLabel(0);
    return dasm;
}

function disassemble(dasm: any): string {
    dasm.disassemble();
    return (dasm.getDisassemblyLines() as string[]).join('\n');
}


suite('A7 — idempotence harness', () => {

    let tmpDir: string;

    setup(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'z80-idempotence-'));
    });


    test('pass 1 and pass 2 output are byte-identical', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        // ── Pass 1: disassemble with no prior annotations ──────────────────
        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);

        // Write pass 1 output to a temp file to simulate the --out file.
        const asmPath = join(tmpDir, 'round_trip.asm');
        writeFileSync(asmPath, pass1 + '\n');

        // ── Pass 2: auto-import pass 1 output, then disassemble again ──────
        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        if (pass1 !== pass2) {
            const patch = createPatch('round_trip.asm', pass1, pass2,
                'pass 1', 'pass 2');
            assert.fail('Idempotence violation — output changed on second pass:\n\n' + patch);
        }
    });


    test('pass 2 and pass 3 output are byte-identical (stable point reached in one round)', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        // ── Pass 1 ─────────────────────────────────────────────────────────
        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const asmPath1 = join(tmpDir, 'pass1.asm');
        writeFileSync(asmPath1, pass1 + '\n');

        // ── Pass 2 ─────────────────────────────────────────────────────────
        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath1);
        const pass2 = disassemble(dasm2);
        const asmPath2 = join(tmpDir, 'pass2.asm');
        writeFileSync(asmPath2, pass2 + '\n');

        // ── Pass 3 ─────────────────────────────────────────────────────────
        const dasm3 = makeDasm();
        dasm3.setAddressCommentsFromAsm(asmPath2);
        const pass3 = disassemble(dasm3);

        if (pass2 !== pass3) {
            const patch = createPatch('round_trip.asm', pass2, pass3,
                'pass 2', 'pass 3');
            assert.fail('Not stable after two rounds — still drifting at pass 3:\n\n' + patch);
        }
    });


    test('user-renamed label survives a round trip', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        // ── Pass 1: get auto-generated output ──────────────────────────────
        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);

        // Simulate the user renaming SUB002 → MY_CALLEE in the .asm file.
        const edited = pass1.replace(/\bSUB002\b/g, 'MY_CALLEE');
        const asmPath = join(tmpDir, 'edited.asm');
        writeFileSync(asmPath, edited + '\n');

        // ── Pass 2: re-disassemble with the renamed label ──────────────────
        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('MY_CALLEE'),
            'renamed label MY_CALLEE must appear in pass 2 output');
        assert.ok(!pass2.includes('SUB002'),
            'old auto-generated name SUB002 must not appear once user renamed it');
    });


    test('user-added pre-label comment survives a round trip', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        // ── Pass 1 ─────────────────────────────────────────────────────────
        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);

        // Find the label line for SUB002 (the callee) and insert a comment above it.
        const userNote = '; User note: this routine loads A with 1.';
        const edited = pass1.replace(/^(0010\s+SUB002:)/m, userNote + '\n$1');
        assert.ok(edited.includes(userNote), 'test setup: injected comment must appear');

        const asmPath = join(tmpDir, 'with_note.asm');
        writeFileSync(asmPath, edited + '\n');

        // ── Pass 2 ─────────────────────────────────────────────────────────
        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes(userNote),
            'pre-label comment must be preserved in the next disassembly');
    });
});
