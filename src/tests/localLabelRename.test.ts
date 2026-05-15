/**
 * Part 1 — local-label rename round-trip.
 *
 * A subroutine with an internal forward jump produces an auto-generated
 * local label (e.g. `.sub002_l`). The user may rename it (keeping the
 * leading dot) in the .asm; the new name must survive subsequent runs,
 * stay scoped/indented as a local, and be used in the jump operand.
 * Non-renamed locals must keep re-numbering freely.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


/**
 * 0x0000: CALL 0x0010 ; CALL 0x0020 ; RET   (main entry)
 * 0x0010: OR A ; JR Z,0x0015 ; LD A,1 ; RET  (callee A, internal local)
 * 0x0020: OR A ; JR Z,0x0025 ; LD A,1 ; RET  (callee B, internal local)
 *
 * Each callee has its own internal forward jump → its own local label.
 */
const BINARY = new Uint8Array([
    0xCD, 0x10, 0x00,                   // 0000 CALL 0x0010
    0xCD, 0x20, 0x00,                   // 0003 CALL 0x0020
    0xC9,                               // 0006 RET
    0x76, 0x76, 0x76, 0x76, 0x76,       // 0007 padding → 0x000F
    0x76, 0x76, 0x76, 0x76,
    0xB7,                               // 0010 OR A
    0x28, 0x02,                         // 0011 JR Z,0x0015
    0x3E, 0x01,                         // 0013 LD A,1
    0xC9,                               // 0015 RET   (local label A)
    0x76, 0x76, 0x76, 0x76, 0x76,       // 0016 padding → 0x001F
    0x76, 0x76, 0x76, 0x76, 0x76,
    0xB7,                               // 0020 OR A
    0x28, 0x02,                         // 0021 JR Z,0x0025
    0x3E, 0x01,                         // 0023 LD A,1
    0xC9,                               // 0025 RET   (local label B)
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
    dasm.opcodesLowerCase = false;
    dasm.initLabels();
    dasm.memory.setMemory(0, BINARY);
    dasm.setLabel(0);
    return dasm;
}

function disassemble(dasm: any): string {
    dasm.disassemble();
    return (dasm.getDisassemblyLines() as string[]).join('\n');
}

/** Returns all auto-generated local label names in the listing (e.g. .sub002_l). */
function findLocalNames(asm: string): string[] {
    const names = [...asm.matchAll(/(\.\w+)\s*:/g)].map(m => m[1]);
    assert.ok(names.length > 0,
        'test setup: listing must contain at least one local label definition');
    return names;
}


suite('Part 1 — local-label rename round-trip', () => {

    let tmpDir: string;

    setup(() => { tmpDir = mkdtempSync(join(tmpdir(), 'z80-local-rename-')); });


    test('a renamed local label survives a round trip and stays local', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const autoName = findLocalNames(pass1)[0];
        assert.ok(/^\.\w+_l\d*$/.test(autoName),
            'precondition: auto local name matches the _l pattern, got ' + autoName);

        // User renames the local, keeping the leading dot.
        const edited = pass1.split(autoName).join('.skip_load');
        const asmPath = join(tmpDir, 'edited.asm');
        writeFileSync(asmPath, edited + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(pass2.includes('.skip_load:'),
            'renamed local must appear as an indented local definition');
        assert.ok(/jr\s+z,\.skip_load/i.test(pass2),
            'jump operand must reference the renamed local');
        assert.ok(!pass2.includes(autoName),
            'old auto-generated local name must be gone');
    });


    test('a renamed local is stable across a second round (idempotent)', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const autoName = findLocalNames(pass1)[0];
        const edited = pass1.split(autoName).join('.skip_load');
        const p1 = join(tmpDir, 'p1.asm');
        writeFileSync(p1, edited + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(p1);
        const pass2 = disassemble(dasm2);
        const p2 = join(tmpDir, 'p2.asm');
        writeFileSync(p2, pass2 + '\n');

        const dasm3 = makeDasm();
        dasm3.setAddressCommentsFromAsm(p2);
        const pass3 = disassemble(dasm3);

        assert.strictEqual(pass2, pass3,
            'renamed-local output must be byte-stable after the first round');
    });


    test('a non-renamed local (stale auto name) is left to re-number', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        // Pass 1 → feed unedited output back. The auto name must NOT be locked
        // as a user rename; output must be byte-identical.
        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const asmPath = join(tmpDir, 'unedited.asm');
        writeFileSync(asmPath, pass1 + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.strictEqual(pass1, pass2,
            'feeding back an unedited listing must be idempotent');
    });


    test('collision with another label name warns but is still applied', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const autoNames = findLocalNames(pass1);
        assert.ok(autoNames.length >= 2,
            'test setup: need two locals (one per callee) to force a collision');

        // User renames BOTH locals (in different subs) to the same name.
        let edited = pass1;
        for (const n of autoNames)
            edited = edited.split(n).join('.dup');
        const asmPath = join(tmpDir, 'collide.asm');
        writeFileSync(asmPath, edited + '\n');

        const errors: string[] = [];
        const origErr = console.error;
        console.error = (msg?: any) => { errors.push(String(msg)); };
        let pass2: string;
        try {
            const dasm2 = makeDasm();
            dasm2.setAddressCommentsFromAsm(asmPath);
            pass2 = disassemble(dasm2);
        } finally {
            console.error = origErr;
        }

        assert.ok(errors.some(e => /collides/.test(e)),
            'a collision warning must be emitted');
        assert.ok((pass2.match(/\.dup:/g) ?? []).length === 2,
            'both colliding locals are still applied (warn-but-accept)');
    });


    test('a stale auto name from a different parent number is re-numbered, not frozen', function () {
        if (typeof (new Disassembler() as any).setAddressCommentsFromAsm !== 'function')
            return this.skip();

        const dasm1 = makeDasm();
        const pass1 = disassemble(dasm1);
        const autoName = findLocalNames(pass1)[0];   // e.g. ".sub002_l"
        assert.ok(/^\.\w*sub\d+\w*$/i.test(autoName),
            'precondition: auto local carries an auto SUB parent prefix, got ' + autoName);

        // Simulate the .asm produced by an earlier run whose parent carried
        // a DIFFERENT auto number (numbering shifted / parent re-attributed).
        // The leading dot is kept, only the parent's number changes.
        const stale = autoName.replace(/sub0*\d+/i, 'sub999');
        assert.notStrictEqual(stale, autoName,
            'test setup: stale name must differ from the current auto name');
        const edited = pass1.split(autoName).join(stale);
        const asmPath = join(tmpDir, 'stale.asm');
        writeFileSync(asmPath, edited + '\n');

        const dasm2 = makeDasm();
        dasm2.setAddressCommentsFromAsm(asmPath);
        const pass2 = disassemble(dasm2);

        assert.ok(!pass2.includes('sub999'),
            'a stale auto name (wrong parent number) must NOT be frozen as a '
            + 'user rename:\n' + pass2);
        const reAuto = findLocalNames(pass2)[0];
        assert.ok(/^\.\w*sub\d+\w*$/i.test(reAuto) && !reAuto.includes('999'),
            'the local must re-number under its real current parent, got ' + reAuto);
    });
});
