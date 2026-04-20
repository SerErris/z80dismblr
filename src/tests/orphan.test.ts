/**
 * A8 — Orphaned annotation handling.
 *
 * When an address that had user annotations in the .asm file is no longer
 * present in the current binary, its data must be preserved as a comment
 * block at the very top of the output rather than silently dropped.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


/** A tiny binary: one subroutine at 0x0000 (CALL 0x0010 + RET). */
const BINARY_FULL = new Uint8Array([
    0xCD, 0x10, 0x00,   // 0x0000: CALL 0x0010
    0xC9,               // 0x0003: RET
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    0x3E, 0x01,         // 0x0010: LD A,1
    0xC9,               // 0x0012: RET
]);

/** Same binary but without the 0x0010 block — so 0x0010 is orphaned. */
const BINARY_REDUCED = new Uint8Array([
    0xCD, 0x10, 0x00,   // 0x0000: CALL 0x0010 (now unresolved)
    0xC9,               // 0x0003: RET
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    0x76, 0x76, 0x76, 0x76,
    // 0x0010 block absent
]);

function makeDasm(binary: Uint8Array): any {
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
    dasm.memory.setMemory(0, binary);
    dasm.setLabel(0);
    return dasm;
}

function disassemble(dasm: any): string {
    dasm.disassemble();
    return (dasm.getDisassemblyLines() as string[]).join('\n');
}


suite('A8 — orphaned annotation handling', () => {

    let tmpDir: string;

    setup(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'z80-orphan-'));
    });


    // ------------------------------------------------------------------
    // Prerequisite
    // ------------------------------------------------------------------

    test('buildOrphanBlock is present', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();
    });


    // ------------------------------------------------------------------
    // No orphans — output unchanged
    // ------------------------------------------------------------------

    test('no orphan block when all imported addresses still exist', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();

        const dasm1 = makeDasm(BINARY_FULL);
        const pass1 = disassemble(dasm1);
        const asmPath = join(tmpDir, 'pass1.asm');
        writeFileSync(asmPath, pass1 + '\n');

        const dasm2 = makeDasm(BINARY_FULL);
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(!pass2.includes('ORPHANED'),
            'no orphan block expected when binary is unchanged');
    });


    // ------------------------------------------------------------------
    // User-renamed label becomes orphaned
    // ------------------------------------------------------------------

    test('orphan block appears when renamed label address is removed from binary', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();

        // Pass 1: full binary, rename SUB002 → MY_CALLEE
        const dasm1 = makeDasm(BINARY_FULL);
        const pass1 = disassemble(dasm1);
        const edited = pass1.replace(/\bSUB002\b/g, 'MY_CALLEE');
        const asmPath = join(tmpDir, 'edited.asm');
        writeFileSync(asmPath, edited + '\n');

        // Pass 2: reduced binary — 0x0010 is no longer loaded
        const dasm2 = makeDasm(BINARY_REDUCED);
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('ORPHANED'),
            'orphan block must appear when annotated address is missing');
        assert.ok(pass2.includes('0010') || pass2.includes('$0010'),
            'orphan block must reference the missing address');
        assert.ok(pass2.includes('MY_CALLEE'),
            'orphan block must preserve the user-renamed label name');
    });


    // ------------------------------------------------------------------
    // Structured fields preserved in orphan block
    // ------------------------------------------------------------------

    test('structured fields appear in orphan block', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();

        const dasm1 = makeDasm(BINARY_FULL);
        const pass1 = disassemble(dasm1);

        // Simulate user editing the Summary field for SUB002 (at 0x0010).
        // Replace only the LAST occurrence of '— Summary: —' so we target
        // SUB002's banner, not SUB001's.
        let count = 0;
        const edited = pass1.replace(/^; Summary:\s*—$/mg, (m) => {
            count++;
            return count === 2 ? '; Summary: Loads A with the value 1.' : m;
        });
        const asmPath = join(tmpDir, 'with_summary.asm');
        writeFileSync(asmPath, edited + '\n');

        // Reduced binary — 0x0010 now missing
        const dasm2 = makeDasm(BINARY_REDUCED);
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('ORPHANED'), 'orphan block must appear');
        assert.ok(pass2.includes('Loads A with the value 1.'),
            'Summary field must be preserved in orphan block');
    });


    // ------------------------------------------------------------------
    // Pre-label comment preserved in orphan block
    // ------------------------------------------------------------------

    test('pre-label comments appear in orphan block', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();

        const dasm1 = makeDasm(BINARY_FULL);
        const pass1 = disassemble(dasm1);

        const userNote = '; Hand-written note about SUB002.';
        const edited = pass1.replace(/^(0010\s+SUB002:)/m, userNote + '\n$1');
        const asmPath = join(tmpDir, 'with_note.asm');
        writeFileSync(asmPath, edited + '\n');

        const dasm2 = makeDasm(BINARY_REDUCED);
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('ORPHANED'), 'orphan block must appear');
        assert.ok(pass2.includes(userNote),
            'pre-label comment must be preserved in orphan block');
    });


    // ------------------------------------------------------------------
    // Orphan block is idempotent (re-read doesn't re-orphan or corrupt)
    // ------------------------------------------------------------------

    test('orphan block is stable across a second round trip', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();

        // Build an orphan situation
        const dasm1 = makeDasm(BINARY_FULL);
        const pass1 = disassemble(dasm1);
        const edited = pass1.replace(/\bSUB002\b/g, 'MY_CALLEE');
        const asmPath1 = join(tmpDir, 'edited.asm');
        writeFileSync(asmPath1, edited + '\n');

        const dasm2 = makeDasm(BINARY_REDUCED);
        dasm2.setAddressCommentsFromAsm(asmPath1);
        const pass2 = disassemble(dasm2);
        const asmPath2 = join(tmpDir, 'pass2.asm');
        writeFileSync(asmPath2, pass2 + '\n');

        // Third pass: re-read the file that already has the orphan block
        const dasm3 = makeDasm(BINARY_REDUCED);
        dasm3.setAddressCommentsFromAsm(asmPath2);
        const pass3 = disassemble(dasm3);

        assert.strictEqual(pass2, pass3,
            'output must be identical on the second round trip (orphan block stable)');
    });


    // ------------------------------------------------------------------
    // Auto-generated label only — no orphan block emitted
    // ------------------------------------------------------------------

    test('no orphan block for address with only auto-generated label', function () {
        if (typeof (new Disassembler() as any).buildOrphanBlock !== 'function')
            return this.skip();

        // Pass 1: full binary, no user edits (all labels auto-generated)
        const dasm1 = makeDasm(BINARY_FULL);
        const pass1 = disassemble(dasm1);
        const asmPath = join(tmpDir, 'pass1.asm');
        writeFileSync(asmPath, pass1 + '\n');

        // Pass 2: reduced binary — 0x0010 missing, but label was never renamed
        const dasm2 = makeDasm(BINARY_REDUCED);
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(!pass2.includes('ORPHANED'),
            'auto-generated-only label must not produce an orphan block');
    });
});
