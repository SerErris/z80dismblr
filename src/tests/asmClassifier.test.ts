/**
 * Regression tests for the A1 line classifier (asmClassifier.ts).
 *
 * Every test targets classifyLine() or classifyAsmLines() in isolation —
 * no Disassembler state is touched.  Each suite covers one event kind so
 * failures point directly to the broken classification rule.
 */

import * as assert from 'assert';
import { classifyLine, classifyAsmLines, AsmEvent } from '../disassembler/asmClassifier';
import { buildBannerRule, buildBannerMid, HEADER_WIDTH } from '../disassembler/headerFormatters';


suite('asmClassifier / classifyLine', () => {

    // -----------------------------------------------------------------------
    suite('blank', () => {

        test('empty string', () => {
            assert.deepStrictEqual(classifyLine(''), { kind: 'blank' });
        });

        test('spaces only', () => {
            assert.deepStrictEqual(classifyLine('   '), { kind: 'blank' });
        });

        test('tab only', () => {
            assert.deepStrictEqual(classifyLine('\t'), { kind: 'blank' });
        });

        test('mixed whitespace', () => {
            assert.deepStrictEqual(classifyLine(' \t '), { kind: 'blank' });
        });
    });


    // -----------------------------------------------------------------------
    suite('banner-rule', () => {

        test('exact banner rule from buildBannerRule()', () => {
            assert.deepStrictEqual(classifyLine(buildBannerRule()), { kind: 'banner-rule' });
        });

        test('one asterisk too few — free-comment, not banner-rule', () => {
            const short = '; ' + '*'.repeat(HEADER_WIDTH - 3);
            assert.strictEqual(classifyLine(short).kind, 'free-comment');
        });

        test('one asterisk too many — free-comment, not banner-rule', () => {
            const long = '; ' + '*'.repeat(HEADER_WIDTH - 1);
            assert.strictEqual(classifyLine(long).kind, 'free-comment');
        });
    });


    // -----------------------------------------------------------------------
    suite('banner-mid', () => {

        test('standard auto-generated name', () => {
            const line = buildBannerMid('SUB004');
            const ev = classifyLine(line);
            assert.strictEqual(ev.kind, 'banner-mid');
            assert.strictEqual((ev as Extract<AsmEvent, { kind: 'banner-mid' }>).name, 'SUB004');
        });

        test('user-renamed label name', () => {
            const line = buildBannerMid('KM_EXP_BUFFER');
            const ev = classifyLine(line);
            assert.strictEqual(ev.kind, 'banner-mid');
            assert.strictEqual((ev as Extract<AsmEvent, { kind: 'banner-mid' }>).name, 'KM_EXP_BUFFER');
        });

        test('long name truncated with ellipsis — still banner-mid', () => {
            const longName = 'A'.repeat(80);
            const line = buildBannerMid(longName);
            const ev = classifyLine(line);
            assert.strictEqual(ev.kind, 'banner-mid');
        });

        test('local label name with dot', () => {
            const line = buildBannerMid('.sub004_loop1');
            const ev = classifyLine(line);
            assert.strictEqual(ev.kind, 'banner-mid');
            assert.strictEqual((ev as Extract<AsmEvent, { kind: 'banner-mid' }>).name, '.sub004_loop1');
        });
    });


    // -----------------------------------------------------------------------
    suite('banner-field', () => {

        const CASES: Array<[string, string]> = [
            ['Summary',        '—'],
            ['Action',         '—'],
            ['Entry',          '—'],
            ['Exit (success)', '—'],
            ['Exit (failure)', '—'],
            ['Corrupted',      'AF, BC, DE, HL, IY'],
            ['Preserved',      'IX, AF\', BC\', DE\', HL\', I, R'],
            ['Called by',      'SUB145[821Ch]'],
            ['Calls',          'SUB006[704Bh], SUB007[7096h]'],
            ['Type',           'Subroutine'],
        ];

        for (const [field, value] of CASES) {
            test(`field "${field}"`, () => {
                const line = `; ${field}: ${value}`;
                const ev = classifyLine(line) as Extract<AsmEvent, { kind: 'banner-field' }>;
                assert.strictEqual(ev.kind, 'banner-field');
                assert.strictEqual(ev.field, field);
                assert.strictEqual(ev.value, value);
            });
        }

        test('Address field with full metadata string', () => {
            const line = '; Address:   7015h          Size: 54 bytes     Instructions: 25     CC: 5';
            const ev = classifyLine(line) as Extract<AsmEvent, { kind: 'banner-field' }>;
            assert.strictEqual(ev.kind, 'banner-field');
            assert.strictEqual(ev.field, 'Address');
            // value captures the entire metadata string after the colon
            assert.ok(ev.value.startsWith('7015h'));
        });

        test('extra whitespace around value is trimmed', () => {
            const line = '; Summary:   some long summary   ';
            const ev = classifyLine(line) as Extract<AsmEvent, { kind: 'banner-field' }>;
            assert.strictEqual(ev.kind, 'banner-field');
            assert.strictEqual(ev.value, 'some long summary');
        });
    });


    // -----------------------------------------------------------------------
    suite('free-comment', () => {

        test('plain prose comment', () => {
            const line = '; This is a user note';
            assert.deepStrictEqual(classifyLine(line), { kind: 'free-comment', text: line });
        });

        test('bare semicolon', () => {
            assert.deepStrictEqual(classifyLine(';'), { kind: 'free-comment', text: ';' });
        });

        test('analysis-unavailable parenthesised note', () => {
            const line = '; (analysis unavailable: indirect JP at 7023h)';
            assert.strictEqual(classifyLine(line).kind, 'free-comment');
        });

        test('comment text is preserved verbatim', () => {
            const line = '; NOTE: Call from IRQ only. Must complete < 1 ms.';
            const ev = classifyLine(line) as Extract<AsmEvent, { kind: 'free-comment' }>;
            assert.strictEqual(ev.text, line);
        });

        test('comment that looks like a banner field but with unknown name', () => {
            const line = '; Returns: HL = pointer';
            assert.strictEqual(classifyLine(line).kind, 'free-comment');
        });
    });


    // -----------------------------------------------------------------------
    suite('label', () => {

        test('standard subroutine label', () => {
            assert.deepStrictEqual(
                classifyLine('7015 SUB004:'),
                { kind: 'label', address: 0x7015, name: 'SUB004' }
            );
        });

        test('user-renamed label', () => {
            assert.deepStrictEqual(
                classifyLine('BB15 KM_EXP_BUFFER:'),
                { kind: 'label', address: 0xBB15, name: 'KM_EXP_BUFFER' }
            );
        });

        test('local label with leading dot', () => {
            assert.deepStrictEqual(
                classifyLine('7020 .sub004_l1:'),
                { kind: 'label', address: 0x7020, name: '.sub004_l1' }
            );
        });

        test('local loop label', () => {
            assert.deepStrictEqual(
                classifyLine('7025 .sub004_loop1:'),
                { kind: 'label', address: 0x7025, name: '.sub004_loop1' }
            );
        });

        test('address 0000', () => {
            assert.deepStrictEqual(
                classifyLine('0000 RESET:'),
                { kind: 'label', address: 0x0000, name: 'RESET' }
            );
        });

        test('address FFFF', () => {
            assert.deepStrictEqual(
                classifyLine('FFFF TOP_OF_RAM:'),
                { kind: 'label', address: 0xFFFF, name: 'TOP_OF_RAM' }
            );
        });

        test('data label', () => {
            assert.deepStrictEqual(
                classifyLine('4000 BIN_START_4000:'),
                { kind: 'label', address: 0x4000, name: 'BIN_START_4000' }
            );
        });

        test('lowercase hex address', () => {
            assert.deepStrictEqual(
                classifyLine('bb15 KM_EXP_BUFFER:'),
                { kind: 'label', address: 0xBB15, name: 'KM_EXP_BUFFER' }
            );
        });
    });


    // -----------------------------------------------------------------------
    suite('instruction', () => {

        test('3-byte instruction with comment', () => {
            const ev = classifyLine('7015 2A 5D 64     LD   HL,(DATA095) \t; 645Dh');
            assert.deepStrictEqual(ev, { kind: 'instruction', address: 0x7015 });
        });

        test('1-byte instruction', () => {
            assert.deepStrictEqual(
                classifyLine('701C B7           OR   A      '),
                { kind: 'instruction', address: 0x701C }
            );
        });

        test('2-byte instruction', () => {
            assert.deepStrictEqual(
                classifyLine('7023 FE 14        CP   14h    \t; 20'),
                { kind: 'instruction', address: 0x7023 }
            );
        });

        test('4-byte instruction', () => {
            assert.deepStrictEqual(
                classifyLine('7018 ED 5B 25 60  LD   DE,(DATA039) \t; 6025h'),
                { kind: 'instruction', address: 0x7018 }
            );
        });

        test('DEFB line — not classified as instruction', () => {
            const ev = classifyLine('4000 00           DEFB 00h    \t; 0');
            assert.notStrictEqual(ev.kind, 'instruction',
                'DEFB lines must not be classified as instruction');
        });

        test('address FF00', () => {
            assert.deepStrictEqual(
                classifyLine('FF00 76           HALT'),
                { kind: 'instruction', address: 0xFF00 }
            );
        });

        test('address with lowercase hex bytes', () => {
            assert.deepStrictEqual(
                classifyLine('7015 2a 5d 64     LD   HL,(X)'),
                { kind: 'instruction', address: 0x7015 }
            );
        });

        // A9 — inline ;; comment parsing
        test(';; user text with preceding auto-comment (suppressAuto=false)', () => {
            const ev = classifyLine('0000 CD 10 00     CALL SUB002\t; called\t;; initialises output');
            assert.deepStrictEqual(ev, {
                kind: 'instruction',
                address: 0x0000,
                inlineComment: { text: 'initialises output', suppressAuto: false },
            });
        });

        test(';; user text with no preceding semicolon (suppressAuto=true)', () => {
            const ev = classifyLine('0003 C9           RET\t;; always returns carry set');
            assert.deepStrictEqual(ev, {
                kind: 'instruction',
                address: 0x0003,
                inlineComment: { text: 'always returns carry set', suppressAuto: true },
            });
        });

        test(';; with empty user text', () => {
            const ev = classifyLine('0003 C9           RET\t;;');
            assert.deepStrictEqual(ev, {
                kind: 'instruction',
                address: 0x0003,
                inlineComment: { text: '', suppressAuto: true },
            });
        });

        test('no ;; — no inlineComment field', () => {
            const ev = classifyLine('0003 C9           RET\t; returns');
            assert.deepStrictEqual(ev, { kind: 'instruction', address: 0x0003 });
        });
    });


    // -----------------------------------------------------------------------
    suite('other', () => {

        test('ORG directive (indented)', () => {
            assert.strictEqual(
                classifyLine('             ORG 4000h; 4000h').kind,
                'other'
            );
        });

        test('EQU prologue — subroutine', () => {
            assert.strictEqual(
                classifyLine('SUB001:      EQU 0000h\t; 0. Subroutine. Called by: ...').kind,
                'other'
            );
        });

        test('EQU prologue — data', () => {
            assert.strictEqual(
                classifyLine('DATA001:     EQU 0038h\t; 56. Data accessed by: ...').kind,
                'other'
            );
        });

        test('EQU header comment line', () => {
            assert.strictEqual(
                classifyLine('; EQU:').kind,
                'free-comment'   // starts with '; ' — it IS a comment, not 'other'
            );
        });
    });
});


// ---------------------------------------------------------------------------
suite('asmClassifier / classifyAsmLines', () => {

    test('empty input returns empty array', () => {
        assert.deepStrictEqual(classifyAsmLines([]), []);
    });

    test('all-blank input', () => {
        const events = classifyAsmLines(['', '  ', '\t', '']);
        assert.ok(events.every(e => e.kind === 'blank'),
            'every event should be blank');
    });

    test('all free-comment input', () => {
        const lines = ['; line one', '; line two'];
        const events = classifyAsmLines(lines);
        assert.ok(events.every(e => e.kind === 'free-comment'));
    });

    test('realistic banner + label + instructions snippet', () => {
        const rule = buildBannerRule();
        const mid  = buildBannerMid('SUB004');
        const lines = [
            rule,                   // → banner-open
            mid,                    // → banner-mid
            rule,                   // title divider — DROPPED
            '; Address:   7015h          Size: 54 bytes     Instructions: 25     CC: 5',
            '; Type:      Subroutine',
            '; Summary:   —',
            '; Action:    —',
            '; Entry:     —',
            '; Exit (success): —',
            '; Exit (failure): —',
            '; Corrupted: AF, BC, DE, HL, IY',
            '; Preserved: IX, AF\', BC\', DE\', HL\', I, R',
            '; Called by: SUB145[821Ch]',
            '; Calls:     —',
            rule,                   // → banner-close
            '7015 SUB004:',
            '7015 2A 5D 64     LD   HL,(DATA095) \t; 645Dh',
            '701C B7           OR   A      ',
            '701D ED 52        SBC  HL,DE  ',
        ];

        const ev = classifyAsmLines(lines);

        // Banner open/close replace the raw banner-rule events; the title
        // divider (third input line) is dropped entirely.
        assert.strictEqual(ev[0].kind,  'banner-open',  'opening rule → banner-open');
        assert.strictEqual(ev[1].kind,  'banner-mid',   'mid line');
        assert.strictEqual((ev[1] as Extract<AsmEvent, { kind: 'banner-mid' }>).name, 'SUB004');
        // ev[2] is Address field — title divider was dropped, indices shift by 1
        assert.strictEqual(ev[2].kind,  'banner-field', 'Address field');
        assert.strictEqual((ev[2] as Extract<AsmEvent, { kind: 'banner-field' }>).field, 'Address');
        assert.strictEqual(ev[3].kind,  'banner-field', 'Type field');
        assert.strictEqual(ev[4].kind,  'banner-field', 'Summary field');
        assert.strictEqual(ev[5].kind,  'banner-field', 'Action field');
        assert.strictEqual(ev[6].kind,  'banner-field', 'Entry field');
        assert.strictEqual(ev[7].kind,  'banner-field', 'Exit (success) field');
        assert.strictEqual(ev[8].kind,  'banner-field', 'Exit (failure) field');
        assert.strictEqual(ev[9].kind,  'banner-field', 'Corrupted field');
        assert.strictEqual(ev[10].kind, 'banner-field', 'Preserved field');
        assert.strictEqual(ev[11].kind, 'banner-field', 'Called by field');
        assert.strictEqual(ev[12].kind, 'banner-field', 'Calls field');
        assert.strictEqual(ev[13].kind, 'banner-close', 'closing rule → banner-close');
        assert.strictEqual(ev[14].kind, 'label',        'label line');
        assert.strictEqual((ev[14] as Extract<AsmEvent, { kind: 'label' }>).address, 0x7015);
        assert.strictEqual((ev[14] as Extract<AsmEvent, { kind: 'label' }>).name,    'SUB004');
        assert.strictEqual(ev[15].kind, 'instruction',  'first instruction');
        assert.strictEqual((ev[15] as Extract<AsmEvent, { kind: 'instruction' }>).address, 0x7015);
        assert.strictEqual(ev[16].kind, 'instruction',  'second instruction');
        assert.strictEqual(ev[17].kind, 'instruction',  'third instruction');
        assert.strictEqual(ev.length, 18, 'total event count (19 input lines − 1 dropped divider)');
    });

    test('user comments between instructions round-trip correctly', () => {
        const lines = [
            '701F D8           RET  C      ',
            '; Now A holds the byte count; 0 means "use default".',
            '7020 3C           INC  A      ',
        ];
        const ev = classifyAsmLines(lines);
        assert.strictEqual(ev[0].kind, 'instruction');
        assert.strictEqual(ev[1].kind, 'free-comment');
        assert.strictEqual(ev[2].kind, 'instruction');
    });

    test('ORG and EQU lines classified as other', () => {
        const lines = [
            'SUB001:      EQU 0000h\t; 0. Subroutine.',
            '             ORG 4000h; 4000h',
        ];
        const ev = classifyAsmLines(lines);
        assert.strictEqual(ev[0].kind, 'other');
        assert.strictEqual(ev[1].kind, 'other');
    });
});


// ---------------------------------------------------------------------------
// A2 — data-directive event kind
// ---------------------------------------------------------------------------

suite('asmClassifier / A2 — data-directive', () => {

    suite('classifyLine — data-directive', () => {

        test('single-byte DEFB', () => {
            assert.deepStrictEqual(
                classifyLine('4000 00           DEFB 00h    \t; 0'),
                { kind: 'data-directive', address: 0x4000 }
            );
        });

        test('DEFB with non-zero value', () => {
            assert.deepStrictEqual(
                classifyLine('4001 FF           DEFB FFh    \t; 255'),
                { kind: 'data-directive', address: 0x4001 }
            );
        });

        test('DEFB lowercase keyword', () => {
            assert.deepStrictEqual(
                classifyLine('4000 00           defb 00h'),
                { kind: 'data-directive', address: 0x4000 }
            );
        });

        test('two-byte DEFW — e.g. CPC RST inline target', () => {
            assert.deepStrictEqual(
                classifyLine('BB17 15 BB        DEFW BB15h'),
                { kind: 'data-directive', address: 0xBB17 }
            );
        });

        test('DEFW lowercase keyword', () => {
            assert.deepStrictEqual(
                classifyLine('BB17 15 BB        defw BB15h'),
                { kind: 'data-directive', address: 0xBB17 }
            );
        });

        test('DEFS keyword', () => {
            assert.deepStrictEqual(
                classifyLine('C000 00           DEFS 16'),
                { kind: 'data-directive', address: 0xC000 }
            );
        });

        test('DEFB with value that looks like a hex byte (DE)', () => {
            // Byte value DE must not be mistaken for a DEFW/DEFS keyword.
            assert.deepStrictEqual(
                classifyLine('4000 DE           DEFB DEh'),
                { kind: 'data-directive', address: 0x4000 }
            );
        });
    });


    suite('data-directive does NOT absorb real instructions', () => {

        test('single-byte instruction OR A', () => {
            assert.strictEqual(classifyLine('701C B7           OR   A      ').kind, 'instruction');
        });

        test('multi-byte instruction LD HL,(nn)', () => {
            assert.strictEqual(
                classifyLine('7015 2A 5D 64     LD   HL,(DATA095) \t; 645Dh').kind,
                'instruction'
            );
        });

        test('instruction whose mnemonic starts with D — DEC', () => {
            assert.strictEqual(
                classifyLine('7030 05           DEC  B').kind,
                'instruction'
            );
        });

        test('instruction whose bytes include DE value — LD D,A', () => {
            // Opcode 57h = LD D,A.  The byte value is not DEFW/DEFS.
            assert.strictEqual(
                classifyLine('7031 57           LD   D,A').kind,
                'instruction'
            );
        });

        test('DJNZ instruction — mnemonic starts with D', () => {
            assert.strictEqual(
                classifyLine('7032 10 FE        DJNZ 7032h').kind,
                'instruction'
            );
        });
    });


    suite('classifyAsmLines — mixed instruction and data-directive', () => {

        test('instruction followed by DEFB', () => {
            const lines = [
                '7015 2A 5D 64     LD   HL,(DATA095) \t; 645Dh',
                '4000 00           DEFB 00h    \t; 0',
            ];
            const ev = classifyAsmLines(lines);
            assert.strictEqual(ev[0].kind, 'instruction');
            assert.strictEqual(ev[1].kind, 'data-directive');
        });

        test('DEFB address is parsed correctly', () => {
            const ev = classifyAsmLines(['C0FA AB           DEFB ABh']);
            const e = ev[0] as Extract<AsmEvent, { kind: 'data-directive' }>;
            assert.strictEqual(e.address, 0xC0FA);
        });

        test('DEFW address is parsed correctly', () => {
            const ev = classifyAsmLines(['BB17 15 BB        DEFW BB15h']);
            const e = ev[0] as Extract<AsmEvent, { kind: 'data-directive' }>;
            assert.strictEqual(e.address, 0xBB17);
        });
    });
});


// ---------------------------------------------------------------------------
// A3 — banner-open / banner-close from stateful classifyAsmLines()
// ---------------------------------------------------------------------------

suite('asmClassifier / A3 — banner block recognition', () => {

    // classifyLine() still returns the raw banner-rule for its own tests.
    suite('classifyLine still emits banner-rule (unchanged)', () => {

        test('banner-rule from classifyLine', () => {
            assert.deepStrictEqual(
                classifyLine(buildBannerRule()),
                { kind: 'banner-rule' }
            );
        });
    });


    suite('classifyAsmLines — banner-open / banner-close', () => {

        function makeBanner(name: string, extraFields: string[] = []): string[] {
            const rule = buildBannerRule();
            return [
                rule,
                buildBannerMid(name),
                rule,
                '; Address:   BB15h          Size: 23 bytes     Instructions: 9     CC: 2',
                '; Type:      Subroutine',
                '; Summary:   —',
                '; Corrupted: AF',
                '; Called by: —',
                '; Calls:     —',
                ...extraFields,
                rule,
            ];
        }

        test('opening rule becomes banner-open', () => {
            const ev = classifyAsmLines(makeBanner('SUB001'));
            assert.strictEqual(ev[0].kind, 'banner-open');
        });

        test('closing rule becomes banner-close', () => {
            const ev = classifyAsmLines(makeBanner('SUB001'));
            assert.strictEqual(ev[ev.length - 1].kind, 'banner-close');
        });

        test('banner-rule never appears in classifyAsmLines output', () => {
            const ev = classifyAsmLines(makeBanner('SUB001'));
            assert.ok(
                ev.every(e => e.kind !== 'banner-rule'),
                'banner-rule must not appear in classifyAsmLines output'
            );
        });

        test('title divider (second rule) is dropped — event count', () => {
            const lines = makeBanner('SUB001');
            // 3 rules in input; title divider dropped → 2 are converted to open/close
            const ruleCount = lines.filter(l => l === buildBannerRule()).length;
            assert.strictEqual(ruleCount, 3, 'fixture has 3 banner rules');

            const ev = classifyAsmLines(lines);
            const openCount  = ev.filter(e => e.kind === 'banner-open').length;
            const closeCount = ev.filter(e => e.kind === 'banner-close').length;
            assert.strictEqual(openCount,  1, 'exactly one banner-open');
            assert.strictEqual(closeCount, 1, 'exactly one banner-close');
            // One rule was dropped → output has 2 fewer events than input lines
            assert.strictEqual(ev.length, lines.length - 1,
                'one event fewer than input lines (dropped title divider)');
        });

        test('banner-mid name is preserved', () => {
            const ev = classifyAsmLines(makeBanner('KM_EXP_BUFFER'));
            const mid = ev.find(e => e.kind === 'banner-mid') as
                Extract<AsmEvent, { kind: 'banner-mid' }>;
            assert.ok(mid, 'banner-mid event must be present');
            assert.strictEqual(mid.name, 'KM_EXP_BUFFER');
        });

        test('banner fields inside the body are passed through', () => {
            const ev = classifyAsmLines(makeBanner('SUB001'));
            const fields = ev.filter(e => e.kind === 'banner-field') as
                Array<Extract<AsmEvent, { kind: 'banner-field' }>>;
            const names = fields.map(f => f.field);
            assert.ok(names.includes('Summary'), 'Summary field present');
            assert.ok(names.includes('Corrupted'), 'Corrupted field present');
            assert.ok(names.includes('Called by'), 'Called by field present');
        });

        test('analysis-unavailable free-comment inside banner passes through', () => {
            const extra = ['; (analysis unavailable: indirect JP at BB20h)'];
            const ev = classifyAsmLines(makeBanner('SUB001', extra));
            const inner = ev.find(e => e.kind === 'free-comment') as
                Extract<AsmEvent, { kind: 'free-comment' }> | undefined;
            assert.ok(inner, 'free-comment inside banner body must survive');
            assert.ok(inner!.text.includes('analysis unavailable'));
        });

        test('label after banner is correctly classified', () => {
            const lines = [
                ...makeBanner('SUB001'),
                'BB15 KM_EXP_BUFFER:',
            ];
            const ev = classifyAsmLines(lines);
            const lbl = ev[ev.length - 1] as Extract<AsmEvent, { kind: 'label' }>;
            assert.strictEqual(lbl.kind, 'label');
            assert.strictEqual(lbl.address, 0xBB15);
        });

        test('two consecutive banners both get open/close pairs', () => {
            const lines = [
                ...makeBanner('SUB001'),
                'BB15 SUB001:',
                ...makeBanner('SUB002'),
                'BB30 SUB002:',
            ];
            const ev = classifyAsmLines(lines);
            const opens  = ev.filter(e => e.kind === 'banner-open').length;
            const closes = ev.filter(e => e.kind === 'banner-close').length;
            assert.strictEqual(opens,  2, 'two banner-open events');
            assert.strictEqual(closes, 2, 'two banner-close events');
        });

        test('non-banner content before a banner is unaffected', () => {
            const lines = [
                '; top-of-file user note',
                '',
                ...makeBanner('SUB001'),
            ];
            const ev = classifyAsmLines(lines);
            assert.strictEqual(ev[0].kind, 'free-comment');
            assert.strictEqual(ev[1].kind, 'blank');
            assert.strictEqual(ev[2].kind, 'banner-open');
        });
    });


    suite('classifyAsmLines — malformed banner recovery', () => {

        test('banner-rule not followed by banner-mid — treated as normal open+recover', () => {
            // A lone asterisk rule with no mid-line after it: the state machine
            // emits banner-open then recovers when a non-mid line appears.
            const lines = [
                buildBannerRule(),
                '; just a regular comment',
            ];
            const ev = classifyAsmLines(lines);
            assert.strictEqual(ev[0].kind, 'banner-open', 'first rule → banner-open');
            assert.strictEqual(ev[1].kind, 'free-comment', 'non-mid line passed through');
        });

        test('banner opened and never closed — no crash', () => {
            const lines = [
                buildBannerRule(),
                buildBannerMid('SUB001'),
                buildBannerRule(),   // title divider
                '; Summary:   —',
                // no closing rule
            ];
            assert.doesNotThrow(() => classifyAsmLines(lines));
        });
    });
});


// ===========================================================================
// §10 — manual line-protection markers
// ===========================================================================

suite('asmClassifier / classifyLine — protect markers', () => {

    // ── protect-start: short form ──────────────────────────────────────────

    test(';;{ short form: correct start and end addresses', () => {
        const ev = classifyLine(';;{ C000 C010');
        assert.deepStrictEqual(ev, { kind: 'protect-start', startAddr: 0xC000, endAddr: 0xC010 });
    });

    test(';;{ short form: lowercase hex', () => {
        const ev = classifyLine(';;{ fb7e fb7f');
        assert.deepStrictEqual(ev, { kind: 'protect-start', startAddr: 0xFB7E, endAddr: 0xFB7F });
    });

    test(';;{ short form: addresses at extremes (0000 and FFFF)', () => {
        const ev = classifyLine(';;{ 0000 FFFF');
        assert.deepStrictEqual(ev, { kind: 'protect-start', startAddr: 0x0000, endAddr: 0xFFFF });
    });

    test(';;{ short form: extra trailing whitespace accepted', () => {
        assert.strictEqual(classifyLine(';;{ C000 C010   ').kind, 'protect-start');
    });

    // ── protect-start: long form ───────────────────────────────────────────

    test(';;PROTECT-START long form: correct addresses', () => {
        const ev = classifyLine(';;PROTECT-START C000 C010');
        assert.deepStrictEqual(ev, { kind: 'protect-start', startAddr: 0xC000, endAddr: 0xC010 });
    });

    test(';;PROTECT-START long form: mixed case hex', () => {
        const ev = classifyLine(';;PROTECT-START Fb7E fB7f');
        assert.deepStrictEqual(ev, { kind: 'protect-start', startAddr: 0xFB7E, endAddr: 0xFB7F });
    });

    // ── protect-end: short form ────────────────────────────────────────────

    test(';;}  short form: protect-end', () => {
        assert.deepStrictEqual(classifyLine(';;}'), { kind: 'protect-end' });
    });

    test(';;}  with trailing whitespace: still protect-end', () => {
        assert.deepStrictEqual(classifyLine(';;}  '), { kind: 'protect-end' });
    });

    // ── protect-end: long form ─────────────────────────────────────────────

    test(';;PROTECT-END long form: protect-end', () => {
        assert.deepStrictEqual(classifyLine(';;PROTECT-END'), { kind: 'protect-end' });
    });

    // ── does NOT conflict with orphan markers ──────────────────────────────

    test('orphan-header still recognised after protect markers added', () => {
        assert.strictEqual(classifyLine(';; ORPHANED: $BB00 KL_INIT').kind, 'orphan-header');
    });

    test('orphan-close ;; alone is not confused with protect-end', () => {
        assert.strictEqual(classifyLine(';;').kind, 'orphan-close');
    });

    test(';; with trailing text (orphan-close) not confused with protect-end', () => {
        assert.strictEqual(classifyLine(';; some note').kind, 'orphan-close');
    });

    // ── incomplete / malformed protect-start → falls through ──────────────

    test(';;{ with only one address → not protect-start (orphan-close fallback)', () => {
        assert.strictEqual(classifyLine(';;{ C000').kind, 'orphan-close');
    });

    test(';;{ with no addresses → orphan-close fallback', () => {
        assert.strictEqual(classifyLine(';;{').kind, 'orphan-close');
    });
});


suite('asmClassifier / classifyAsmLines — protect blocks', () => {

    // ── basic round-trip ───────────────────────────────────────────────────

    test('protect block emits start, content lines, end in order', () => {
        const events = classifyAsmLines([
            ';;{ C000 C005',
            'C000 3E 01        LD   A,1',
            '; a comment',
            ';;}',
        ]);
        assert.strictEqual(events[0].kind, 'protect-start');
        assert.strictEqual(events[1].kind, 'protect-content');
        assert.strictEqual(events[2].kind, 'protect-content');
        assert.strictEqual(events[3].kind, 'protect-end');
        assert.strictEqual(events.length, 4);
    });

    test('protect-content carries verbatim text', () => {
        const events = classifyAsmLines([
            ';;{ C000 C005',
            'C000 3E 01        LD   A,1          ;; init',
            ';;}',
        ]);
        const content = events[1] as { kind: 'protect-content'; text: string };
        assert.strictEqual(content.text, 'C000 3E 01        LD   A,1          ;; init');
    });

    test('long form markers work identically', () => {
        const events = classifyAsmLines([
            ';;PROTECT-START C000 C005',
            'C000 C9           RET',
            ';;PROTECT-END',
        ]);
        assert.strictEqual(events[0].kind, 'protect-start');
        assert.strictEqual(events[1].kind, 'protect-content');
        assert.strictEqual(events[2].kind, 'protect-end');
    });

    // ── protect-content is never re-classified ─────────────────────────────

    test('instruction line inside block → protect-content, not instruction', () => {
        const events = classifyAsmLines([
            ';;{ C000 C005',
            'C000 3E 01        LD   A,1',
            ';;}',
        ]);
        assert.strictEqual(events[1].kind, 'protect-content');
    });

    test('label line inside block → protect-content, not label', () => {
        const events = classifyAsmLines([
            ';;{ C000 C005',
            'C000 MY_LABEL:',
            ';;}',
        ]);
        assert.strictEqual(events[1].kind, 'protect-content');
    });

    test('comment line inside block → protect-content, not free-comment', () => {
        const events = classifyAsmLines([
            ';;{ C000 C005',
            '; a standalone comment',
            ';;}',
        ]);
        assert.strictEqual(events[1].kind, 'protect-content');
    });

    test('blank line inside block → protect-content with empty text, not blank', () => {
        const events = classifyAsmLines([
            ';;{ C000 C005',
            '',
            ';;}',
        ]);
        assert.strictEqual(events[1].kind, 'protect-content');
        assert.strictEqual((events[1] as any).text, '');
    });

    // ── surrounding context unaffected ─────────────────────────────────────

    test('normal events before and after the protect block are unaffected', () => {
        const events = classifyAsmLines([
            'C000 MY_LABEL:',
            ';;{ C001 C005',
            'C001 C9           RET',
            ';;}',
            'C006 NEXT_LABEL:',
        ]);
        assert.strictEqual(events[0].kind, 'label');
        assert.strictEqual(events[1].kind, 'protect-start');
        assert.strictEqual(events[2].kind, 'protect-content');
        assert.strictEqual(events[3].kind, 'protect-end');
        assert.strictEqual(events[4].kind, 'label');
    });

    test('protect-start event carries the correct addresses', () => {
        const events = classifyAsmLines([';;{ FB7E FB7F', 'C9  RET', ';;}']);
        const ps = events[0] as { kind: 'protect-start'; startAddr: number; endAddr: number };
        assert.strictEqual(ps.startAddr, 0xFB7E);
        assert.strictEqual(ps.endAddr,   0xFB7F);
    });

    // ── empty protect block ────────────────────────────────────────────────

    test('empty protect block (no content lines) is valid', () => {
        const events = classifyAsmLines([';;{ C000 C005', ';;}']);
        assert.strictEqual(events[0].kind, 'protect-start');
        assert.strictEqual(events[1].kind, 'protect-end');
        assert.strictEqual(events.length, 2);
    });
});
