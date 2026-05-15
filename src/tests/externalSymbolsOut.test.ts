/**
 * Part 2 — external-memory labels in --symbolsout.
 *
 * DATA_LBL and code labels whose address falls outside the loaded binary
 * (isEqu = true) must now appear in the --symbolsout skeleton file so the
 * user can rename them and have the name round-trip via the --symbols file.
 *
 * External labels get their own prefix (EXT / EXTSUB) to keep them visually
 * separate from in-ROM labels in the discovered .sym file.
 * Dedup is preserved: once the user feeds a renamed label back via --symbols,
 * it becomes isFixed and is excluded from the next skeleton run.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';
import { writeSymbolsOut } from '../disassembler/argsWriter';


/**
 * 0x0000: CALL 0x0010    in-ROM code call (creates SUB label, in-ROM)
 * 0x0003: LD (0xBE03),A  store to external RAM (creates EXT data label)
 * 0x0006: CALL 0xB912    call to external firmware (creates EXTSUB label)
 * 0x0009: RET
 * 0x0010: RET            callee subroutine (in-ROM SUB)
 *
 * Loaded memory: only 0x0000–0x0010. So 0xBE03 and 0xB912 are out of range.
 */
const BINARY = new Uint8Array([
    0xCD, 0x10, 0x00,   // 0000 CALL 0x0010
    0x32, 0x03, 0xBE,   // 0003 LD (0xBE03),A
    0xCD, 0x12, 0xB9,   // 0006 CALL 0xB912
    0xC9,               // 0009 RET
    0x76, 0x76, 0x76, 0x76, 0x76, 0x76,    // 000A–000F padding
    0xC9,               // 0010 RET (callee)
]);

function makeDasm(): any {
    const dasm = new Disassembler() as any;
    dasm.labelSubPrefix = 'SUB';
    dasm.labelLblPrefix = 'LBL';
    dasm.labelDataLblPrefix = 'DATA';
    dasm.labelExtDataPrefix = 'EXT';
    dasm.labelExtSubPrefix  = 'EXTSUB';
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

function disassembleAndGetSymbols(dasm: any) {
    dasm.disassemble();
    return dasm.getSymbolsData() as Array<{addr: number; name: string; isSub: boolean}>;
}


suite('Part 2 — external-memory labels in --symbolsout', () => {

    let tmpDir: string;
    setup(() => { tmpDir = mkdtempSync(join(tmpdir(), 'z80-ext-sym-')); });


    test('external DATA label (EXT) appears in getSymbolsData', () => {
        const dasm = makeDasm();
        const symbols = disassembleAndGetSymbols(dasm);

        const ext = symbols.find(s => s.addr === 0xBE03);
        assert.ok(ext, 'EXT data label at 0xBE03 must appear in symbols data');
        assert.ok(ext.name.startsWith('EXT'),
            'external data label must use EXT prefix, got ' + ext.name);
        assert.strictEqual(ext.isSub, false,
            'external data label must not be flagged isSub');
    });


    test('external CODE label (EXTSUB) appears in getSymbolsData', () => {
        const dasm = makeDasm();
        const symbols = disassembleAndGetSymbols(dasm);

        const ext = symbols.find(s => s.addr === 0xB912);
        assert.ok(ext, 'EXTSUB label at 0xB912 must appear in symbols data');
        assert.ok(ext.name.startsWith('EXTSUB'),
            'external code label must use EXTSUB prefix, got ' + ext.name);
        assert.strictEqual(ext.isSub, true,
            'external code label must be flagged isSub (gets structured placeholder)');
    });


    test('in-ROM labels keep SUB/DATA prefixes (no cross-contamination)', () => {
        const dasm = makeDasm();
        const symbols = disassembleAndGetSymbols(dasm);

        const inRom = symbols.filter(s => s.addr <= 0x0010);
        assert.ok(inRom.length > 0, 'must have in-ROM labels');
        for (const s of inRom) {
            assert.ok(!s.name.startsWith('EXT'),
                'in-ROM label ' + s.name + ' must not use EXT prefix');
        }
    });


    test('external labels appear in writeSymbolsOut output', () => {
        const dasm = makeDasm();
        const symbols = disassembleAndGetSymbols(dasm);
        const outPath = join(tmpDir, 'discovered.sym');
        writeSymbolsOut(outPath, symbols);
        const text = readFileSync(outPath, 'utf8');

        assert.ok(/BE03\s+EXT/.test(text),
            'BE03 EXTnnn line must be present in symbols file');
        assert.ok(/B912\s+EXTSUB/.test(text),
            'B912 EXTSUBnnn line must be present in symbols file');
    });


    test('dedup: external label from --symbols input is excluded next run', () => {
        // Pass 1: discover externals
        const dasm1 = makeDasm();
        const symbols1 = disassembleAndGetSymbols(dasm1);
        const extLabel = symbols1.find(s => s.addr === 0xBE03)!;
        assert.ok(extLabel);

        // Simulate user adding the discovered label to their --symbols file.
        const symPath = join(tmpDir, 'user.sym');
        writeFileSync(symPath, `BE03 ${extLabel.name}\n`);

        // Pass 2: re-run with the symbols file → label is now isFixed → not in output.
        const dasm2 = makeDasm();
        dasm2.setAddressComments(symPath);
        const symbols2 = disassembleAndGetSymbols(dasm2);

        const stillPresent = symbols2.find(s => s.addr === 0xBE03);
        assert.ok(!stillPresent,
            'label already in --symbols input must be excluded from symbolsout (dedup)');
    });


    test('rename round-trip: renamed external label persists via --symbols', () => {
        // Discover the external label (pass 1 output not examined directly).
        const dasm1 = makeDasm();
        dasm1.disassemble();

        // User renames EXT001 → vdos_drv_config in their symbols file.
        const symPath = join(tmpDir, 'user.sym');
        writeFileSync(symPath, 'BE03 vdos_drv_config\n');

        // Pass 2: re-run with renamed symbol.
        const dasm2 = makeDasm();
        dasm2.setAddressComments(symPath);
        dasm2.disassemble();
        const asm2 = (dasm2.getDisassemblyLines() as string[]).join('\n');

        assert.ok(asm2.includes('vdos_drv_config'),
            'renamed external label must appear in disassembly output');
        assert.ok(!asm2.includes('EXT001') && !asm2.includes('EXT002'),
            'old auto EXT name must not appear once renamed');

        // And it must not re-appear in the next skeleton (it is isFixed now).
        const symbols2 = dasm2.getSymbolsData() as Array<{addr: number; name: string}>;
        assert.ok(!symbols2.find(s => s.addr === 0xBE03),
            'renamed external label must not re-appear in next --symbolsout skeleton');
    });


    test('isAutoGeneratedName recognises EXT and EXTSUB prefixes', () => {
        const dasm = new Disassembler() as any;
        dasm.labelExtDataPrefix = 'EXT';
        dasm.labelExtSubPrefix  = 'EXTSUB';
        dasm.labelSubPrefix = 'SUB';
        dasm.labelLblPrefix = 'LBL';
        dasm.labelDataLblPrefix = 'DATA';
        dasm.labelSelfModifyingPrefix = 'SELF_MOD';
        dasm.labelRstPrefix = 'RST';
        dasm.labelIntrptPrefix = 'INTRPT';

        assert.ok(dasm.isAutoGeneratedName('EXT001'),
            'EXT001 must be recognised as auto-generated');
        assert.ok(dasm.isAutoGeneratedName('EXTSUB042'),
            'EXTSUB042 must be recognised as auto-generated');
        assert.ok(!dasm.isAutoGeneratedName('vdos_drv_config'),
            'vdos_drv_config must be recognised as user-authored');
        assert.ok(!dasm.isAutoGeneratedName('KL_CURR_SELECTION'),
            'KL_CURR_SELECTION must be recognised as user-authored');
    });
});
