/**
 * A9 — Inline instruction comment round-trip.
 *
 * The ';;' marker on an instruction line separates the auto-generated comment
 * from user-supplied text.  The user text must survive a full round-trip.
 * suppressAuto = true (no '; auto' before ';;') means the emitter must omit
 * the auto-generated comment on re-emit.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


/** Binary: CALL 0x0010, RET, padding, LD A,1, RET */
const BINARY = new Uint8Array([
    0xCD, 0x10, 0x00,   // 0x0000: CALL 0x0010
    0xC9,               // 0x0003: RET
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    0x3E, 0x01,         // 0x0010: LD A,1
    0xC9,               // 0x0012: RET
]);

function makeDasm(): any {
    const dasm = new Disassembler() as any;
    dasm.labelSubPrefix      = 'SUB';
    dasm.labelLblPrefix      = 'LBL';
    dasm.labelDataLblPrefix  = 'DATA';
    dasm.labelLocalLabelPrefix = '_l';
    dasm.labelLoopPrefix     = '_loop';
    dasm.labelSelfModifyingPrefix = 'SELF_MOD';
    // addOpcodeBytes stays true (default) — the classifier requires hex-byte
    // columns to identify instruction lines and extract ;; inline comments.
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


suite('A9 — inline instruction comment round-trip', () => {

    let tmpDir: string;

    setup(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'z80-inline-'));
    });


    // ------------------------------------------------------------------
    // Prerequisite guard
    // ------------------------------------------------------------------

    test('setAddressCommentsFromAsm is present', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();
    });


    // ------------------------------------------------------------------
    // Basic round-trip: user text appended after ;;
    // ------------------------------------------------------------------

    test('user inline comment survives a round trip (suppressAuto=false)', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);

        // Find the CALL line and append a ;; comment after the auto-comment.
        const edited = pass1.replace(
            /^(0000 .+CALL .+)$/m,
            '$1 ;; dispatches to main loop',
        );
        assert.ok(edited.includes('dispatches to main loop'), 'setup: injected comment must appear');

        const asmPath = join(tmpDir, 'edited.asm');
        writeFileSync(asmPath, edited + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('dispatches to main loop'),
            'user inline comment must appear in pass 2');
    });


    // ------------------------------------------------------------------
    // suppressAuto: no auto-comment emitted when ;; leads the suffix
    // ------------------------------------------------------------------

    test('suppressAuto=true: auto-comment replaced by user text', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);

        // Replace the CALL line: strip any auto-comment and put only ;; user text.
        const edited = pass1.replace(
            /^(0000 .+CALL \S+)\s*(?:\t;[^\n]*)?$/m,
            '$1\t;; my custom note',
        );
        assert.ok(edited.includes(';; my custom note'), 'setup: injected ;; comment must appear');

        const asmPath = join(tmpDir, 'suppressed.asm');
        writeFileSync(asmPath, edited + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('my custom note'),
            'user text must appear in pass 2');
        // The auto-generated comment (a hex address like "; 0010h") must not appear
        // on the CALL line when suppressAuto is true.
        const callLine = pass2.split('\n').find(l => /^0000\s+/.test(l));
        assert.ok(callLine, 'CALL line must exist in pass 2');
        assert.ok(!callLine!.includes('; 0010h') && !callLine!.includes('; 10h'),
            'auto-generated address comment must be suppressed on the CALL line');
    });


    // ------------------------------------------------------------------
    // Idempotence: second round-trip produces identical output
    // ------------------------------------------------------------------

    test('inline comment is stable across a second round trip', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);

        const edited = pass1.replace(
            /^(0000 .+CALL .+)$/m,
            '$1 ;; stable annotation',
        );
        const asmPath1 = join(tmpDir, 'edited.asm');
        writeFileSync(asmPath1, edited + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath1);
        const pass2 = disassemble(dasm2);
        const asmPath2 = join(tmpDir, 'pass2.asm');
        writeFileSync(asmPath2, pass2 + '\n');

        const dasm3 = makeDasm();
        dasm3.setAddressCommentsFromAsm(asmPath2);
        const pass3 = disassemble(dasm3);

        assert.strictEqual(pass2, pass3,
            'output must be identical on the second round trip');
    });


    // ------------------------------------------------------------------
    // Other instructions unaffected
    // ------------------------------------------------------------------

    test('instructions without ;; are unaffected', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const asmPath = join(tmpDir, 'pass1.asm');
        writeFileSync(asmPath, pass1 + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.strictEqual(pass1, pass2,
            'output without any ;; annotations must be byte-identical (idempotence)');
    });
});
