import assert = require('assert');
import { Disassembler } from '../disassembler/disasm';
import { CleanEmitter } from '../disassembler/cleanEmitter';
import { Opcodes } from '../disassembler/opcode';
import { Format, HexFormat } from '../disassembler/format';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Disassembler, load memory at org, run disassemble(), return emitter. */
function makeEmitter(
	org: number,
	bytes: number[],
	setup?: (d: Disassembler) => void,
	format: 'sjasmplus' | 'maxam' = 'sjasmplus',
	hex: 'z80' | 'cpc' | 'intel' | 'c' | 'amp' = 'z80',
): CleanEmitter {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	if (setup) setup(dasm);
	dasm.disassemble();
	return new CleanEmitter(dasm, format, hex);
}


// ---------------------------------------------------------------------------
// B2 — CleanEmitter skeleton (sjasmplus, EQU prologue, ORG, labels, WARNINGs)
// ---------------------------------------------------------------------------

suite('CleanEmitter — B2 skeleton', () => {

	// Save/restore global hex format so tests are isolated
	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 1 — EQU prologue: external symbols sorted by address
	// -----------------------------------------------------------------------
	test('EQU prologue: external symbols emitted as NAME equ $XXXX', () => {
		// Load a trivial RET at $8000; labels at $BB00 and $C000 are out-of-range → isEqu
		const e = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			dasm.setFixedCodeLabel(0xBB00, 'KL_INIT');
			dasm.setFixedCodeLabel(0xC000, 'cursor_x');
		});

		const out = e.emit();
		const lines = out.split('\n');

		// First two lines must be EQU entries in address order
		assert.ok(lines[0].startsWith('KL_INIT'),    'first EQU is KL_INIT');
		assert.ok(lines[0].includes('equ'),           'KL_INIT line contains equ');
		assert.ok(lines[0].includes('$BB00'),         'KL_INIT value is $BB00');

		assert.ok(lines[1].startsWith('cursor_x'),   'second EQU is cursor_x');
		assert.ok(lines[1].includes('equ'),           'cursor_x line contains equ');
		assert.ok(lines[1].includes('$C000'),         'cursor_x value is $C000');

		// A blank line must follow the EQU block
		assert.strictEqual(lines[2], '',              'blank line after EQU block');
	});


	// -----------------------------------------------------------------------
	// Test 2 — ORG + CALL + RET: basic instruction emission
	// -----------------------------------------------------------------------
	test('ORG + CALL + RET: correct structure for a simple subroutine', () => {
		// $8000: CD 00 BB  CALL $BB00
		// $8003: C9        RET
		const e = makeEmitter(0x8000, [0xCD, 0x00, 0xBB, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'SUB1');
			dasm.setFixedCodeLabel(0xBB00, 'KL_INIT');  // EQU — out of range
		});

		const out  = e.emit();
		const lines = out.split('\n');

		// EQU prologue
		assert.ok(lines[0].startsWith('KL_INIT'), 'EQU KL_INIT present');
		assert.ok(lines[0].includes('$BB00'),      'KL_INIT value correct');
		assert.strictEqual(lines[1], '',           'blank after EQU block');

		// ORG
		assert.ok(lines[2].trim().startsWith('org'), 'org directive present');
		assert.ok(lines[2].includes('$8000'),         'org value is $8000');

		// Label
		assert.strictEqual(lines[3], 'SUB1:',         'SUB1: label flush-left');

		// CALL instruction references label name
		assert.ok(lines[4].includes('call'),           'call mnemonic (lowercase)');
		assert.ok(lines[4].includes('KL_INIT'),        'call target is label name');

		// RET
		assert.ok(lines[5].includes('ret'),            'ret mnemonic');
	});


	// -----------------------------------------------------------------------
	// Test 3 — WARNING comment passes through
	// -----------------------------------------------------------------------
	test('WARNING comment is emitted before the offending instruction', () => {
		// JP $5001 jumps to byte 2 of LD HL,$6000 → WARNING
		// $5000: 21 00 60  ld hl,$6000   (3-byte: CODE_FIRST at $5000, CODE at $5001/$5002)
		// $5003: C3 01 50  jp $5001
		const e = makeEmitter(0x5000, [0x21, 0x00, 0x60, 0xC3, 0x01, 0x50], dasm => {
			dasm.setFixedCodeLabel(0x5000, 'START');
		});

		const out = e.emit();
		assert.ok(out.includes('WARNING'), 'output contains WARNING');

		// The WARNING comment line must appear before the jp instruction
		const lines = out.split('\n');
		const warnIdx = lines.findIndex(l => l.includes('WARNING'));
		const jpIdx   = lines.findIndex(l => l.trim().startsWith('jp'));
		assert.ok(warnIdx >= 0,      'WARNING line found');
		assert.ok(warnIdx < jpIdx,   'WARNING appears before the jp instruction');
		assert.ok(lines[warnIdx].trimStart().startsWith(';'), 'WARNING is a comment');
	});


	// -----------------------------------------------------------------------
	// Test 4 — File formatting: LF only, trailing newline, no BOM
	// -----------------------------------------------------------------------
	test('output uses LF-only line endings, ends with \\n, no BOM', () => {
		const e = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'SUB1');
		});

		const out = e.emit();

		// No CRLF
		assert.ok(!out.includes('\r\n'), 'no CRLF sequences');

		// Ends with LF
		assert.ok(out.endsWith('\n'), 'output ends with LF');

		// No BOM (UTF-8 BOM = EF BB BF; in a JS string that appears as \uFEFF)
		assert.ok(!out.startsWith('\uFEFF'), 'no BOM');
	});

});


// ---------------------------------------------------------------------------
// B2a — Invalid opcodes → raw defb bytes
// ---------------------------------------------------------------------------

suite('CleanEmitter — B2a invalid opcodes', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 5 — ED 00: each byte of an invalid ED-prefixed opcode → own defb
	// -----------------------------------------------------------------------
	test('ED 00: two defb lines, one per byte', () => {
		// $8000: ED 00 — ED-prefix + 0x00 is an invalid opcode (length=2)
		// $8002: C9    — RET (stops the walk)
		const e = makeEmitter(0x8000, [0xED, 0x00, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
		});

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		// Find the defb lines (after org and label)
		const defbLines = lines.filter(l => l.trim().startsWith('defb'));
		assert.ok(defbLines.length >= 2, 'at least two defb lines for ED 00');
		assert.ok(defbLines[0].includes('$ED'), 'first defb is $ED');
		assert.ok(defbLines[1].includes('$00'), 'second defb is $00');

		// RET should follow as a real instruction, not a defb
		const retLine = lines.find(l => l.trim() === 'ret');
		assert.ok(retLine !== undefined, 'ret instruction appears after the defb pair');
	});


	// -----------------------------------------------------------------------
	// Test 6 — FD 00 FD 00: two consecutive invalid FD-prefixed sequences
	// -----------------------------------------------------------------------
	test('FD 00 FD 00: four defb lines, each byte individual', () => {
		const e = makeEmitter(0x8000, [0xFD, 0x00, 0xFD, 0x00, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
		});

		const out       = e.emit();
		const defbLines = out.split('\n').filter(l => l.trim().startsWith('defb'));
		assert.strictEqual(defbLines.length, 4, 'four defb lines for two FD 00 sequences');

		// Byte values in order: FD 00 FD 00
		assert.ok(defbLines[0].includes('$FD'), 'byte 0 = $FD');
		assert.ok(defbLines[1].includes('$00'), 'byte 1 = $00');
		assert.ok(defbLines[2].includes('$FD'), 'byte 2 = $FD');
		assert.ok(defbLines[3].includes('$00'), 'byte 3 = $00');
	});

});


// ---------------------------------------------------------------------------
// B2b — Custom --opcode extension expansion
// ---------------------------------------------------------------------------

suite('CleanEmitter — B2b custom --opcode expansion', () => {

	let savedHex: HexFormat;
	// Save the RST $CF (0xCF) opcode state so --opcode append can be undone
	let restoreOpcode: () => void;

	setup(() => {
		savedHex = Format.hexFormat;
		// Save opcode names before any --opcode mutation
		const { Opcode } = require('../disassembler/opcode');
		restoreOpcode = Opcode.saveNames();
	});

	teardown(() => {
		Format.hexFormat = savedHex;
		restoreOpcode();
	});


	// -----------------------------------------------------------------------
	// Test 7 — RST $CF + trailing byte: base mnemonic on its own line, then defb
	// -----------------------------------------------------------------------
	test('--opcode RST extension: rst on one line, trailing byte as defb', () => {
		// Attach a 1-byte extension to opcode 0xCF (RST 08h)
		Opcodes[0xCF].appendToOpcode(', CODE=#n');

		// $8000: CF 3E  (RST 08h with trailing data byte 0x3E)
		// $8002: C9     (RET)
		const e = makeEmitter(0x8000, [0xCF, 0x3E, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
		});

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		const rstLine  = lines.find(l => l.trim().startsWith('rst'));
		const defbLine = lines.find(l => l.trim().startsWith('defb'));
		const retLine  = lines.find(l => l.trim() === 'ret');

		assert.ok(rstLine  !== undefined, 'rst line present');
		assert.ok(defbLine !== undefined, 'defb line for trailing byte present');
		assert.ok(retLine  !== undefined, 'ret present after the pair');

		// rst line must NOT contain the trailing-byte value ($3E)
		assert.ok(!rstLine!.includes('3E') && !rstLine!.includes('3e'), 'rst line does not contain trailing byte');
		assert.ok(defbLine!.includes('$3E') || defbLine!.includes('$3e'), 'defb line contains $3E');

		// rst must appear before defb
		assert.ok(lines.indexOf(rstLine!) < lines.indexOf(defbLine!), 'rst appears before defb');
	});


	// -----------------------------------------------------------------------
	// Test 8 — --cpc active: B2b split is bypassed (mutual exclusion)
	// When --cpc is active the appended-byte split must NOT happen; the opcode
	// is emitted as a single mnemonic line.  Full CPC RST expansion (defw) is
	// validated separately in B2d.
	// -----------------------------------------------------------------------
	test('--cpc active: B2b split is not applied (mutual exclusion)', () => {
		// Attach a 1-byte extension to 0xCF
		Opcodes[0xCF].appendToOpcode(', CODE=#n');

		// $8000: CF 3E  — RST $CF with trailing byte 0x3E
		// $8002: C9
		const e = makeEmitter(0x8000, [0xCF, 0x3E, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			dasm.cpcMode = true;
		});

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		// With cpcMode active, the B2b split (rst on one line + defb on next) must NOT occur.
		// Instead the full mnemonic (including the trailing byte value) stays on one line.
		const rstLines  = lines.filter(l => l.trim().startsWith('rst'));
		const defbLines = lines.filter(l => l.trim().startsWith('defb'));

		assert.ok(rstLines.length >= 1, 'rst line present');
		// B2b would have produced a separate defb $3E — that must NOT appear
		assert.ok(
			defbLines.every(l => !l.includes('3E') && !l.includes('3e')),
			'no standalone defb $3E (B2b split was bypassed)'
		);
	});

});


// ---------------------------------------------------------------------------
// B2c — Reserved-word label validation
// ---------------------------------------------------------------------------

suite('CleanEmitter — B2c reserved-word validation', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 9 — Reserved label name throws before any output is written
	// -----------------------------------------------------------------------
	test('label ADD at $8000 with sjasmplus format throws reserved-word error', () => {
		const e = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'ADD');
		});

		assert.throws(
			() => e.emit(),
			(err: unknown) => {
				const msg = String(err);
				return msg.includes('ADD')
				    && msg.includes('$8000')
				    && msg.includes('reserved word')
				    && msg.includes('sjasmplus');
			},
			'expected throw mentioning ADD, $8000, reserved word, sjasmplus'
		);
	});


	// -----------------------------------------------------------------------
	// Test 10 — Non-reserved label emits normally (no throw)
	// -----------------------------------------------------------------------
	test('label MY_ROUTINE is not reserved and emits without error', () => {
		const e = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'MY_ROUTINE');
		});

		assert.doesNotThrow(() => e.emit(), 'MY_ROUTINE should not trigger reserved-word check');

		const out = e.emit();
		assert.ok(out.includes('MY_ROUTINE'), 'label name appears in output');
	});


	// -----------------------------------------------------------------------
	// Test 11 — SLL is reserved in sjasmplus but not in maxam
	// -----------------------------------------------------------------------
	test('label SLL throws in sjasmplus format but is accepted in maxam format', () => {
		const eSjas = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'SLL');
		}, 'sjasmplus');

		assert.throws(
			() => eSjas.emit(),
			(err: unknown) => String(err).includes('reserved word'),
			'SLL should be reserved in sjasmplus'
		);

		const eMaxam = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'SLL');
		}, 'maxam');

		assert.doesNotThrow(() => eMaxam.emit(), 'SLL is not reserved in maxam');
	});

});


// ---------------------------------------------------------------------------
// B2d — CPC RST 3-byte expansion
// ---------------------------------------------------------------------------

suite('CleanEmitter — B2d CPC RST expansion', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 12 — FIRM_JUMP ($EF) with a label at the inline address
	// -----------------------------------------------------------------------
	test('FIRM_JUMP ($EF) with label: emits rst $28 + defw LABEL', () => {
		// $8000: EF 00 C0   FIRM_JUMP $C000
		// $8003: C9         RET
		const e = makeEmitter(0x8000, [0xEF, 0x00, 0xC0, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			dasm.setFixedCodeLabel(0xC000, 'MY_FUNC');  // out-of-range → EQU
			(dasm as any).cpcMode = true;
		});

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		const rstLine  = lines.find(l => l.trim().startsWith('rst'));
		const defwLine = lines.find(l => l.trim().startsWith('defw'));

		assert.ok(rstLine  !== undefined, 'rst line present');
		assert.ok(defwLine !== undefined, 'defw line present');
		assert.ok(rstLine!.includes('$28'),    'rst operand is $28 (FIRM_JUMP)');
		assert.ok(defwLine!.includes('MY_FUNC'), 'defw operand uses label name');
	});


	// -----------------------------------------------------------------------
	// Test 13 — FIRM_JUMP ($EF): a defw line always follows the rst line
	// (operand may be a label name or hex address depending on auto-labelling)
	// -----------------------------------------------------------------------
	test('FIRM_JUMP ($EF): rst line is followed by a defw line', () => {
		const e = makeEmitter(0x8000, [0xEF, 0x00, 0xC0, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			(dasm as any).cpcMode = true;
		});

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		const rstIdx  = lines.findIndex(l => l.trim().startsWith('rst'));
		const defwLine = lines.find(l => l.trim().startsWith('defw'));

		assert.ok(rstIdx  >= 0,              'rst line present');
		assert.ok(defwLine !== undefined,     'defw line present');
		assert.ok(lines.indexOf(defwLine!) === rstIdx + 1, 'defw immediately follows rst');
	});


	// -----------------------------------------------------------------------
	// Test 14 — 1-byte RESET ($C7) emits a single rst line, no defw
	// -----------------------------------------------------------------------
	test('1-byte RESET ($C7): single rst $00 line, no defw', () => {
		// $8000: C7   RESET (1-byte CPC RST)
		// $8001: C9   RET
		const e = makeEmitter(0x8000, [0xC7, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			(dasm as any).cpcMode = true;
		});

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		const rstLine  = lines.find(l => l.trim().startsWith('rst'));
		const defwLine = lines.find(l => l.trim().startsWith('defw'));

		assert.ok(rstLine  !== undefined, 'rst line present');
		assert.ok(rstLine!.includes('$00'), 'rst operand is $00 (RESET)');
		assert.strictEqual(defwLine, undefined, 'no defw line for 1-byte RST');
	});


	// -----------------------------------------------------------------------
	// Test 15 — hex style is respected (cpc hex → #XX prefix on rst operand)
	// Use a 1-byte RST so there is no defw label-lookup complication.
	// -----------------------------------------------------------------------
	test('cpc hex style: rst operand uses # prefix', () => {
		// $8000: C7  RESET (1-byte, no inline word)
		// $8001: C9  RET
		const e = makeEmitter(0x8000, [0xC7, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			(dasm as any).cpcMode = true;
		}, 'sjasmplus', 'cpc');

		const out     = e.emit();
		const rstLine = out.split('\n').find(l => l.trim().startsWith('rst'));

		assert.ok(rstLine !== undefined,    'rst line present');
		assert.ok(rstLine!.includes('#00'), 'rst operand uses # prefix for cpc hex style');
	});

});


// ---------------------------------------------------------------------------
// B3 — Data grouping
// ---------------------------------------------------------------------------

/**
 * Helper: build a Disassembler with a pure data region.
 * `bytes` are loaded at `org`; a DATA label is placed at `org` and
 * addDataRange marks them all as DATA so the emitter uses the data path.
 */
function makeDataEmitter(
	org: number,
	bytes: number[],
	labelName = 'DATA_TABLE',
	extraLabels: Array<{ addr: number; name: string }> = [],
): CleanEmitter {
	return makeEmitter(org, bytes, dasm => {
		dasm.addDataLabel(org, labelName);
		dasm.addDataRange(org, bytes.length);
		for (const { addr, name } of extraLabels)
			dasm.addDataLabel(addr, name);
	});
}


suite('CleanEmitter — B3 data grouping', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 16 — 10 bytes: first 8 on one defb line, remaining 2 on the next
	// -----------------------------------------------------------------------
	test('10 data bytes: packed into 8+2 defb lines', () => {
		const bytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A];
		const e = makeDataEmitter(0x8000, bytes);

		const out      = e.emit();
		const defbLines = out.split('\n').filter(l => l.trim().startsWith('defb'));

		assert.strictEqual(defbLines.length, 2, 'exactly two defb lines');

		const vals0 = defbLines[0].split(',').map(s => s.trim().replace(/.*\t/, '').trim());
		const vals1 = defbLines[1].split(',').map(s => s.trim().replace(/.*\t/, '').trim());

		assert.strictEqual(vals0.length, 8, 'first defb line has 8 bytes');
		assert.strictEqual(vals1.length, 2, 'second defb line has 2 bytes');
	});


	// -----------------------------------------------------------------------
	// Test 17 — DATA label mid-region: group breaks at label boundary
	// -----------------------------------------------------------------------
	test('DATA label in middle of region: defb group breaks at label', () => {
		// 6 bytes; SCORE_TABLE label at offset 3
		const bytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
		const e = makeDataEmitter(0x8000, bytes, 'DATA_TABLE', [
			{ addr: 0x8003, name: 'SCORE_TABLE' },
		]);

		const out   = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		// SCORE_TABLE label must appear in output
		const labelIdx = lines.findIndex(l => l.includes('SCORE_TABLE'));
		assert.ok(labelIdx >= 0, 'SCORE_TABLE label present');

		// There must be a defb line before SCORE_TABLE and one after
		const defbBefore = lines.slice(0, labelIdx).some(l => l.trim().startsWith('defb'));
		const defbAfter  = lines.slice(labelIdx + 1).some(l => l.trim().startsWith('defb'));
		assert.ok(defbBefore, 'defb line before SCORE_TABLE');
		assert.ok(defbAfter,  'defb line after SCORE_TABLE');
	});


	// -----------------------------------------------------------------------
	// Test 18 — 20-byte zero run → defs 20, 0
	// -----------------------------------------------------------------------
	test('20 zero bytes: emitted as defs 20, 0', () => {
		const bytes = new Array(20).fill(0);
		const e = makeDataEmitter(0x8000, bytes);

		const out      = e.emit();
		const defsLine = out.split('\n').find(l => l.trim().startsWith('defs'));
		const defbLines = out.split('\n').filter(l => l.trim().startsWith('defb'));

		assert.ok(defsLine !== undefined,   'defs line present');
		assert.ok(defsLine!.includes('20'), 'defs count is 20');
		assert.ok(defsLine!.includes('0'),  'defs fill value is 0');
		assert.strictEqual(defbLines.length, 0, 'no defb lines for a pure zero run');
	});


	// -----------------------------------------------------------------------
	// Test 19 — 15 zero bytes (< 16 threshold): emitted as defb, not defs
	// -----------------------------------------------------------------------
	test('15 zero bytes: emitted as defb lines, not defs', () => {
		const bytes = new Array(15).fill(0);
		const e = makeDataEmitter(0x8000, bytes);

		const out      = e.emit();
		const defsLines = out.split('\n').filter(l => l.trim().startsWith('defs'));
		const defbLines = out.split('\n').filter(l => l.trim().startsWith('defb'));

		assert.strictEqual(defsLines.length, 0, 'no defs for a 15-byte zero run');
		assert.ok(defbLines.length > 0, 'defb lines used instead');
	});


	// -----------------------------------------------------------------------
	// Test 20 — Mixed: non-zero bytes, then ≥16 zero run, then non-zero bytes
	// -----------------------------------------------------------------------
	test('mixed data: non-zero, 18 zeros, non-zero → defb + defs + defb', () => {
		const bytes = [
			0x01, 0x02,                    // 2 non-zero
			...new Array(18).fill(0),      // 18-byte zero run
			0x03, 0x04,                    // 2 non-zero
		];
		const e = makeDataEmitter(0x8000, bytes);

		const out = e.emit();
		const lines = out.split('\n').filter(l => l.trim().length > 0);

		const defsLines = lines.filter(l => l.trim().startsWith('defs'));
		const defbLines = lines.filter(l => l.trim().startsWith('defb'));

		assert.strictEqual(defsLines.length, 1, 'exactly one defs line');
		assert.ok(defsLines[0].includes('18'), 'defs count is 18');
		assert.ok(defbLines.length >= 2, 'defb lines present for non-zero regions');

		// Order: defb, defs, defb
		const firstDefb = lines.findIndex(l => l.trim().startsWith('defb'));
		const defsIdx   = lines.findIndex(l => l.trim().startsWith('defs'));
		const lastDefb  = lines.map(l => l.trim().startsWith('defb')).lastIndexOf(true);

		assert.ok(firstDefb < defsIdx,  'defb before defs');
		assert.ok(defsIdx   < lastDefb, 'defs before last defb');
	});

});


// ---------------------------------------------------------------------------
// B4 — Golden-file regression tests
// ---------------------------------------------------------------------------

suite('CleanEmitter — B4 golden-file regression', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 21 — Gap handling: two non-contiguous code blocks → two ORG entries
	// -----------------------------------------------------------------------
	test('two non-contiguous blocks produce two ORG entries with blank separator', () => {
		// BLOCK1 at $8000 (RET), BLOCK2 at $8010 (RET) — 15-byte gap
		const e = makeEmitter(0x8000, [0xC9], dasm => {
			(dasm as any).memory.setMemory(0x8010, new Uint8Array([0xC9]));
			dasm.setFixedCodeLabel(0x8000, 'BLOCK1');
			dasm.setFixedCodeLabel(0x8010, 'BLOCK2');
		});

		const out   = e.emit();
		const lines = out.split('\n');

		const orgLines = lines.filter(l => l.trim().startsWith('org'));
		assert.strictEqual(orgLines.length, 2, 'exactly two org directives');
		assert.ok(orgLines[0].includes('$8000'), 'first ORG is $8000');
		assert.ok(orgLines[1].includes('$8010'), 'second ORG is $8010');

		// There must be a blank line between the two blocks
		const firstOrgIdx  = lines.findIndex(l => l.trim().startsWith('org'));
		const secondOrgIdx = lines.findIndex((l, i) => i > firstOrgIdx && l.trim().startsWith('org'));
		const blankBetween = lines.slice(firstOrgIdx + 1, secondOrgIdx).some(l => l === '');
		assert.ok(blankBetween, 'blank line separates the two ORG blocks');
	});


	// -----------------------------------------------------------------------
	// Test 22 — Local labels: dot-prefixed label names pass through correctly
	// and the JR target references the label by name
	// -----------------------------------------------------------------------
	test('local label: dot-prefixed name in output, JR references it by name', () => {
		// $8000: FE 00   cp $00
		// $8002: 28 01   jr z, $8005
		// $8004: C9      ret
		// $8005: 3C      inc a
		// $8006: C9      ret
		// The disassembler names the JR Z target .sub1_l (CODE_LOCAL_LBL under SUB1)
		const e = makeEmitter(0x8000, [0xFE, 0x00, 0x28, 0x01, 0xC9, 0x3C, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'SUB1');
		});

		const out   = e.emit();
		const lines = out.split('\n');

		// A label line starting with '.' must exist
		const localLabelLine = lines.find(l => /^\.[a-z_]/.test(l.trim()));
		assert.ok(localLabelLine !== undefined, 'dot-prefixed local label present in output');

		// The JR instruction must reference the label by name (not a raw address)
		const jrLine = lines.find(l => l.trim().startsWith('jr'));
		assert.ok(jrLine !== undefined, 'jr instruction present');
		assert.ok(!jrLine!.includes('$8005') && !jrLine!.includes('8005'), 'jr operand uses label name not raw address');
		assert.ok(jrLine!.includes('.'), 'jr operand contains dot-prefixed name');
	});


	// -----------------------------------------------------------------------
	// Test 23 — Full golden output: complete small program matches expected text
	// -----------------------------------------------------------------------
	test('full golden output: EQU prologue + org + label + instructions', () => {
		// $8000: CD 00 BB   call KL_INIT    (KL_INIT is EQU $BB00)
		// $8003: C9         ret
		const e = makeEmitter(0x8000, [0xCD, 0x00, 0xBB, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			dasm.setFixedCodeLabel(0xBB00, 'KL_INIT');
		});

		const expected = [
			'KL_INIT\t\tequ\t$BB00',
			'',
			'\t\t\torg\t$8000',
			'START:',
			'\t\t\tcall KL_INIT',
			'\t\t\tret',
			'',
		].join('\n');

		assert.strictEqual(e.emit(), expected, 'full output matches golden string');
	});

});


// ---------------------------------------------------------------------------
// B5 — Maxam dialect
// ---------------------------------------------------------------------------

suite('CleanEmitter — B5 maxam dialect', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 24 — Maxam labels have no colon
	// -----------------------------------------------------------------------
	test('maxam format: label line has no trailing colon', () => {
		const e = makeEmitter(0x8000, [0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'MY_FUNC');
		}, 'maxam', 'cpc');

		const out   = e.emit();
		const lines = out.split('\n');

		const labelLine = lines.find(l => l.startsWith('MY_FUNC'));
		assert.ok(labelLine !== undefined, 'MY_FUNC label line present');
		assert.strictEqual(labelLine, 'MY_FUNC', 'maxam label has no colon');
	});


	// -----------------------------------------------------------------------
	// Test 25 — Maxam uses #XXXX hex by default
	// -----------------------------------------------------------------------
	test('maxam format with cpc hex: addresses use # prefix', () => {
		// $8000: CD 00 BB  call $BB00
		// $8003: C9        ret
		const e = makeEmitter(0x8000, [0xCD, 0x00, 0xBB, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			dasm.setFixedCodeLabel(0xBB00, 'KL_INIT');
		}, 'maxam', 'cpc');

		const out = e.emit();

		// EQU prologue uses # prefix
		const equLine = out.split('\n').find(l => l.includes('equ'));
		assert.ok(equLine !== undefined,      'equ line present');
		assert.ok(equLine!.includes('#BB00'), 'equ value uses # prefix');

		// ORG uses # prefix
		const orgLine = out.split('\n').find(l => l.trim().startsWith('org'));
		assert.ok(orgLine!.includes('#8000'), 'org address uses # prefix');
	});


	// -----------------------------------------------------------------------
	// Test 26 — Full golden output for maxam dialect
	// -----------------------------------------------------------------------
	test('full golden output: maxam dialect matches expected text', () => {
		// $8000: CD 00 BB   call KL_INIT    (KL_INIT is EQU #BB00)
		// $8003: C9         ret
		const e = makeEmitter(0x8000, [0xCD, 0x00, 0xBB, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
			dasm.setFixedCodeLabel(0xBB00, 'KL_INIT');
		}, 'maxam', 'cpc');

		const expected = [
			'KL_INIT\t\tequ\t#BB00',
			'',
			'\t\t\torg\t#8000',
			'START',
			'\t\t\tcall KL_INIT',
			'\t\t\tret',
			'',
		].join('\n');

		assert.strictEqual(e.emit(), expected, 'full maxam output matches golden string');
	});

});


// ---------------------------------------------------------------------------
// B5a — ZX Next opcode detection for maxam
// ---------------------------------------------------------------------------

suite('CleanEmitter — B5a ZX Next detection for maxam', () => {

	let savedHex: HexFormat;
	setup(() => { savedHex = Format.hexFormat; });
	teardown(() => { Format.hexFormat = savedHex; });


	// -----------------------------------------------------------------------
	// Test 27 — ZX Next opcode with maxam format throws a clear error
	// ED 30 = MUL D,E (OpcodeNext)
	// -----------------------------------------------------------------------
	test('ZX Next opcode with maxam format: throws with address and suggestion', () => {
		// $8000: ED 30  MUL D,E  (ZX Next)
		// $8002: C9     RET
		const e = makeEmitter(0x8000, [0xED, 0x30, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
		}, 'maxam', 'cpc');

		assert.throws(
			() => e.emit(),
			(err: unknown) => {
				const msg = String(err);
				return msg.includes('maxam')
				    && msg.includes('ZX Next')
				    && msg.includes('$8000')
				    && msg.includes('sjasmplus');
			},
			'expected throw mentioning maxam, ZX Next, $8000, sjasmplus'
		);
	});


	// -----------------------------------------------------------------------
	// Test 28 — Same ZX Next opcode with sjasmplus format: no error
	// -----------------------------------------------------------------------
	test('ZX Next opcode with sjasmplus format: no error thrown', () => {
		const e = makeEmitter(0x8000, [0xED, 0x30, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
		}, 'sjasmplus', 'z80');

		assert.doesNotThrow(() => e.emit(), 'sjasmplus should accept ZX Next opcodes');
	});


	// -----------------------------------------------------------------------
	// Test 29 — No ZX Next opcodes with maxam format: no error
	// -----------------------------------------------------------------------
	test('ordinary opcodes with maxam format: no error thrown', () => {
		// $8000: 3C  INC A
		// $8001: C9  RET
		const e = makeEmitter(0x8000, [0x3C, 0xC9], dasm => {
			dasm.setFixedCodeLabel(0x8000, 'START');
		}, 'maxam', 'cpc');

		assert.doesNotThrow(() => e.emit(), 'maxam should accept ordinary Z80 opcodes');
	});

});
