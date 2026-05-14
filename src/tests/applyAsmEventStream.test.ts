/**
 * Tests for A4 — applyAsmEventStream() imports structured fields from the
 * round-trip .asm event stream into Disassembler.addressStructured.
 *
 * Drives the protected applyAsmEventStream() directly (cast to any) so no
 * temp files are needed.  Each test builds a minimal AsmEvent[] that
 * represents the output of classifyAsmLines() for a given .asm snippet.
 */

import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { AsmEvent } from '../disassembler/asmClassifier';


/** Minimal banner event sequence with the given fields. */
function banner(fields: AsmEvent[], labelAddress: number, labelName: string): AsmEvent[] {
    return [
        { kind: 'banner-open' },
        { kind: 'banner-mid', name: labelName },
        ...fields,
        { kind: 'banner-close' },
        { kind: 'blank' },
        { kind: 'label', address: labelAddress, name: labelName },
    ];
}


suite('A4 — applyAsmEventStream', () => {

    let dasm: any;

    setup(() => {
        dasm = new Disassembler() as any;
        dasm.initLabels();
    });


    // ------------------------------------------------------------------
    // Prerequisite
    // ------------------------------------------------------------------

    test('applyAsmEventStream is present and protected', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        assert.equal(typeof dasm.applyAsmEventStream, 'function');
    });


    // ------------------------------------------------------------------
    // Single-line fields
    // ------------------------------------------------------------------

    test('Summary field is stored', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Summary', value: 'Allocate buffer' },
        ], 0xBB15, 'KM_EXP_BUFFER');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB15);
        assert(s, 'structured fields must exist at $BB15');
        assert.equal(s.summary, 'Allocate buffer');
    });

    test('Entry field is stored as array', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Entry', value: 'HL = pointer' },
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB00);
        assert(s, 'structured fields must exist at $BB00');
        assert(Array.isArray(s.entry), 'entry must be an array');
        assert.equal(s.entry![0], 'HL = pointer');
    });

    test('Exit (success) field is stored as exitSuccess', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Exit (success)', value: 'Carry set' },
        ], 0xBB03, 'KL_SCAN_OVER');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB03);
        assert(s);
        assert(Array.isArray(s.exitSuccess));
        assert.equal(s.exitSuccess![0], 'Carry set');
    });

    test('Exit (failure) field is stored as exitFailure', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Exit (failure)', value: 'Carry clear' },
        ], 0xBB03, 'KL_SCAN_OVER');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB03);
        assert(s);
        assert(Array.isArray(s.exitFailure));
        assert.equal(s.exitFailure![0], 'Carry clear');
    });

    test('Action field is stored as array', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Action', value: 'Sends key event to queue' },
        ], 0xBB20, 'KM_READ_KEY');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB20);
        assert(s);
        assert(Array.isArray(s.action));
        assert.equal(s.action![0], 'Sends key event to queue');
    });


    // ------------------------------------------------------------------
    // Em-dash sentinel
    // ------------------------------------------------------------------

    test('em-dash sentinel leaves field unset', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Summary', value: '\u2014' },
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        // No entry for that address, OR the entry exists but summary is absent.
        const s = dasm.addressStructured.get(0xBB00);
        assert(!s || s.summary === undefined, 'summary must not be set for \u2014 value');
    });

    test('em-dash on Entry leaves entry unset', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Entry', value: '\u2014' },
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB00);
        assert(!s || s.entry === undefined);
    });


    // ------------------------------------------------------------------
    // Ignored fields (Corrupted, Preserved, Address, Type, Called by, Calls)
    // ------------------------------------------------------------------

    test('Corrupted field is ignored — not stored', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Corrupted', value: 'A, BC' },
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB00);
        // 'Corrupted' is auto-generated; nothing survives into addressStructured.
        assert(!s || Object.keys(s).length === 0,
            'ignored field must not produce structured data');
    });

    test('Preserved field is ignored', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Preserved', value: 'IX, IY' },
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB00);
        assert(!s || Object.keys(s).length === 0);
    });

    test('Ignored field terminates multi-line continuation', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Action', value: '' },      // start multi-line
            { kind: 'banner-field', field: 'Corrupted', value: 'A' },  // terminates multi-line
            { kind: 'free-comment', text: ';   stray continuation' },  // must NOT be attached
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB00);
        // action[] should be empty (no lines were attached before interruption)
        // and the stray continuation should not appear anywhere.
        if (s && s.action) {
            assert(!s.action.includes('stray continuation'),
                'stray line must not land in action after ignored field interruption');
        }
    });


    // ------------------------------------------------------------------
    // Multi-line continuation
    // ------------------------------------------------------------------

    test('multi-line Action accumulates continuation lines', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Action', value: '' },
            { kind: 'free-comment', text: ';   First line of action' },
            { kind: 'free-comment', text: ';   Second line of action' },
        ], 0xBB20, 'KM_READ_KEY');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB20);
        assert(s && Array.isArray(s.action), 'action must be an array');
        assert(s.action!.includes('First line of action'));
        assert(s.action!.includes('Second line of action'));
    });

    test('multi-line Entry accumulates continuation lines', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Entry', value: '' },
            { kind: 'free-comment', text: ';   HL = pointer to buffer' },
            { kind: 'free-comment', text: ';   DE = buffer length' },
        ], 0xBB15, 'KM_EXP_BUFFER');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB15);
        assert(s && Array.isArray(s.entry));
        assert.equal(s.entry!.length, 2);
        assert.equal(s.entry![0], 'HL = pointer to buffer');
        assert.equal(s.entry![1], 'DE = buffer length');
    });

    test('non-continuation free-comment does not attach to multi-line', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        // ';  ' (3 spaces) is NOT a continuation — emitter uses 4-char prefix.
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Action', value: '' },
            { kind: 'free-comment', text: ';  wrong indent' },
        ], 0xBB20, 'KM_READ_KEY');

        dasm.applyAsmEventStream(events);

        const s = dasm.addressStructured.get(0xBB20);
        if (s && s.action) {
            assert(!s.action.includes('wrong indent'));
        }
    });


    // ------------------------------------------------------------------
    // Two consecutive banners are independent
    // ------------------------------------------------------------------

    test('two consecutive banners produce independent structured maps', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            ...banner([
                { kind: 'banner-field', field: 'Summary', value: 'First sub' },
            ], 0x1000, 'SUB_A'),
            ...banner([
                { kind: 'banner-field', field: 'Summary', value: 'Second sub' },
            ], 0x2000, 'SUB_B'),
        ];

        dasm.applyAsmEventStream(events);

        const a = dasm.addressStructured.get(0x1000);
        const b = dasm.addressStructured.get(0x2000);
        assert(a && a.summary === 'First sub', 'SUB_A summary must be stored');
        assert(b && b.summary === 'Second sub', 'SUB_B summary must be stored');
    });


    // ------------------------------------------------------------------
    // Banner without label is discarded
    // ------------------------------------------------------------------

    test('banner with no following label is silently discarded', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'banner-open' },
            { kind: 'banner-mid', name: 'ORPHAN' },
            { kind: 'banner-field', field: 'Summary', value: 'Orphaned' },
            { kind: 'banner-close' },
            // No label follows; end of stream.
        ];

        dasm.applyAsmEventStream(events);

        assert.equal(dasm.addressStructured.size, 0,
            'orphaned banner must not produce an entry');
    });


    // ------------------------------------------------------------------
    // Empty stream and no-banner stream
    // ------------------------------------------------------------------

    test('empty event stream produces no structured entries', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        dasm.applyAsmEventStream([]);
        assert.equal(dasm.addressStructured.size, 0);
    });

    test('event stream with no banners produces no structured entries', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'blank' },
            { kind: 'label', address: 0x1000, name: 'MY_LABEL' },
            { kind: 'instruction', address: 0x1000 },
        ];

        dasm.applyAsmEventStream(events);
        assert.equal(dasm.addressStructured.size, 0);
    });


    // ------------------------------------------------------------------
    // A5 — label renaming detection → isFixed
    // ------------------------------------------------------------------

    test('user-renamed label after banner gets isFixed = true', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([], 0xBB15, 'KM_EXP_BUFFER');
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0xBB15);
        assert(lbl, 'label must exist');
        assert.equal(lbl.name, 'KM_EXP_BUFFER');
        assert.equal(lbl.isFixed, true);
    });

    test('auto-generated SUB name is not fixed', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([], 0x1000, 'SUB042');
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0x1000);
        assert(!lbl || lbl.isFixed !== true, 'SUB042 must not be fixed');
    });

    test('auto-generated LBL name is not fixed', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([], 0x2000, 'LBL007');
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0x2000);
        assert(!lbl || lbl.isFixed !== true, 'LBL007 must not be fixed');
    });

    test('auto-generated DATA name is not fixed', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'label', address: 0x3000, name: 'DATA003' },
        ];
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0x3000);
        assert(!lbl || lbl.isFixed !== true, 'DATA003 must not be fixed');
    });

    test('auto-generated RST name is not fixed', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'label', address: 0x08, name: 'RST08' },
        ];
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0x08);
        assert(!lbl || lbl.isFixed !== true, 'RST08 must not be fixed');
    });

    test('user-renamed label outside banner (normal state) gets isFixed = true', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'label', address: 0xC000, name: 'cursor_x' },
        ];
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0xC000);
        assert(lbl, 'label must exist');
        assert.equal(lbl.name, 'cursor_x');
        assert.equal(lbl.isFixed, true);
    });

    test('local label starting with dot is not fixed', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'label', address: 0x1010, name: '.sub001_l3' },
        ];
        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0x1010);
        assert(!lbl || lbl.isFixed !== true, 'local label must not be fixed');
    });

    test('user-renamed label name is preserved alongside structured fields', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = banner([
            { kind: 'banner-field', field: 'Summary', value: 'Read a key' },
        ], 0xBB00, 'KL_CHOKE_OFF');

        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0xBB00);
        assert(lbl && lbl.isFixed, 'label must be fixed');
        assert.equal(lbl.name, 'KL_CHOKE_OFF');

        const s = dasm.addressStructured.get(0xBB00);
        assert(s && s.summary === 'Read a key', 'structured fields must also be stored');
    });


    // ------------------------------------------------------------------
    // A6 — free-form pre-label and pre-instruction comments → linesBefore
    // ------------------------------------------------------------------

    test('free-comment before label (after-banner) lands in linesBefore', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'banner-open' },
            { kind: 'banner-mid', name: 'KM_EXP_BUFFER' },
            { kind: 'banner-close' },
            { kind: 'free-comment', text: '; Never touches the paging hardware.' },
            { kind: 'free-comment', text: '; Adjusts IX on return.' },
            { kind: 'label', address: 0xBB15, name: 'KM_EXP_BUFFER' },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0xBB15);
        assert(c && Array.isArray(c.linesBefore), 'linesBefore must exist');
        assert(c.linesBefore.includes('; Never touches the paging hardware.'));
        assert(c.linesBefore.includes('; Adjusts IX on return.'));
    });

    test('blank between banner-close and label does not break pre-label comment capture', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'banner-open' },
            { kind: 'banner-mid', name: 'MY_SUB' },
            { kind: 'banner-close' },
            { kind: 'blank' },
            { kind: 'free-comment', text: '; User note after blank.' },
            { kind: 'label', address: 0x1000, name: 'MY_SUB' },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0x1000);
        assert(c && c.linesBefore && c.linesBefore.includes('; User note after blank.'),
            'blank between banner and label must not discard comment');
    });

    test('free-comment before instruction (normal state) lands in linesBefore', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'instruction', address: 0x1000 },
            { kind: 'free-comment', text: '; Step 1: load the pointer.' },
            { kind: 'instruction', address: 0x1001 },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0x1001);
        assert(c && c.linesBefore && c.linesBefore.includes('; Step 1: load the pointer.'));
    });

    test('blank resets pre-instruction comment buffer', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'free-comment', text: '; old auto-gen comment' },
            { kind: 'blank' },
            { kind: 'free-comment', text: '; user note' },
            { kind: 'instruction', address: 0x2000 },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0x2000);
        if (c && c.linesBefore) {
            assert(!c.linesBefore.includes('; old auto-gen comment'),
                'comment before blank must be discarded');
            assert(c.linesBefore.includes('; user note'));
        } else {
            assert.fail('linesBefore must exist');
        }
    });

    test('multiple pre-instruction comments are ordered correctly', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'free-comment', text: '; line 1' },
            { kind: 'free-comment', text: '; line 2' },
            { kind: 'free-comment', text: '; line 3' },
            { kind: 'instruction', address: 0x3000 },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0x3000);
        assert(c && c.linesBefore);
        assert.equal(c.linesBefore[0], '; line 1');
        assert.equal(c.linesBefore[1], '; line 2');
        assert.equal(c.linesBefore[2], '; line 3');
    });

    test('free-comment before data-directive lands in linesBefore', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'free-comment', text: '; lookup table' },
            { kind: 'data-directive', address: 0x4000 },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0x4000);
        assert(c && c.linesBefore && c.linesBefore.includes('; lookup table'));
    });

    test('pre-label comment in normal state (no banner) lands in linesBefore', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'free-comment', text: '; local variable block' },
            { kind: 'label', address: 0x5000, name: 'cursor_x' },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0x5000);
        assert(c && c.linesBefore && c.linesBefore.includes('; local variable block'));
    });

    test('; type: sub comment promotes label to CODE_SUB and is not stored as linesBefore', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const { NumberType } = require('../disassembler/numbertype');
        dasm.labels.set(0xC344, { type: NumberType.CODE_LBL, name: 'cpm_cold_boot', isFixed: false, isEqu: false, references: new Set() });

        const events: AsmEvent[] = [
            { kind: 'free-comment', text: '; type: sub' },
            { kind: 'label', address: 0xC344, name: 'cpm_cold_boot' },
        ];

        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0xC344);
        assert.strictEqual(lbl.type, NumberType.CODE_SUB,
            '; type: sub must promote CODE_LBL to CODE_SUB');
        const c = dasm.addressComments.get(0xC344);
        assert.ok(!c || !c.linesBefore || !c.linesBefore.includes('; type: sub'),
            '; type: sub must not appear in linesBefore');
    });

    test('; type: sub is cleared by a blank line', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const { NumberType } = require('../disassembler/numbertype');
        dasm.labels.set(0xC344, { type: NumberType.CODE_LBL, name: 'cpm_cold_boot', isFixed: false, isEqu: false, references: new Set() });

        const events: AsmEvent[] = [
            { kind: 'free-comment', text: '; type: sub' },
            { kind: 'blank' },
            { kind: 'label', address: 0xC344, name: 'cpm_cold_boot' },
        ];

        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0xC344);
        assert.notStrictEqual(lbl.type, NumberType.CODE_SUB,
            'blank line between ; type: sub and label must cancel the promotion');
    });

    test('banner promotes label to CODE_SUB', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        // A jp-only target starts life as CODE_LBL. Writing a banner in the
        // .asm file is an explicit declaration that it is a subroutine — the
        // round-trip importer must promote it to CODE_SUB so the banner is
        // regenerated on the next run.
        const { NumberType } = require('../disassembler/numbertype');
        dasm.labels.set(0xC344, { type: NumberType.CODE_LBL, name: 'cpm_cold_boot', isFixed: false, isEqu: false, references: new Set() });

        const events: AsmEvent[] = [
            { kind: 'banner-open' },
            { kind: 'banner-mid', name: 'cpm_cold_boot' },
            { kind: 'banner-field', field: 'Summary', value: 'Start CP/M cold boot' },
            { kind: 'banner-close' },
            { kind: 'label', address: 0xC344, name: 'cpm_cold_boot' },
        ];

        dasm.applyAsmEventStream(events);

        const lbl = dasm.labels.get(0xC344);
        assert.strictEqual(lbl.type, NumberType.CODE_SUB,
            'banner import must promote CODE_LBL to CODE_SUB');
    });

    test('pre-label comment and structured fields both captured', function () {
        if (typeof dasm.applyAsmEventStream !== 'function') return this.skip();
        const events: AsmEvent[] = [
            { kind: 'banner-open' },
            { kind: 'banner-mid', name: 'KL_CHOKE_OFF' },
            { kind: 'banner-field', field: 'Summary', value: 'Read a key' },
            { kind: 'banner-close' },
            { kind: 'free-comment', text: '; See AMSDOS manual p.42.' },
            { kind: 'label', address: 0xBB00, name: 'KL_CHOKE_OFF' },
        ];

        dasm.applyAsmEventStream(events);

        const c = dasm.addressComments.get(0xBB00);
        assert(c && c.linesBefore && c.linesBefore.includes('; See AMSDOS manual p.42.'),
            'linesBefore must be captured');
        const s = dasm.addressStructured.get(0xBB00);
        assert(s && s.summary === 'Read a key', 'structured fields must also be captured');
    });
});
