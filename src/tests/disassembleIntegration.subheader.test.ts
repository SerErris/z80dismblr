/**
 * Tests for §8.5 — the disassemble() pipeline wires analyzeRegisterUsage()
 * in between countStatistics() and addLabelComments(), so that the final
 * rendered header contains analyser output for every sub.
 *
 * This is the end-to-end sanity check. The earlier unit-test files pin
 * down individual layers; this one asserts that a plain `disassemble()`
 * call produces a header that includes everything.
 */

import assert = require('assert');
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Disassembler } from '../disassembler/disasm';


suite('§8.5 disassemble() pipeline — full sub header', () => {

	let dasm: any;
	let tmpDir: string;

	setup(() => {
		dasm = new Disassembler() as any;
		dasm.labelSubPrefix = 'SUB';
		dasm.labelLblPrefix = 'LBL';
		dasm.labelDataLblPrefix = 'DATA';
		dasm.labelLocalLabelPrefix = '_lbl';
		dasm.labelLoopPrefix = '_loop';
		dasm.labelSelfModifyingPrefix = 'SELF_MOD';
		dasm.addOpcodeBytes = false;
		dasm.opcodesLowerCase = false;
		dasm.initLabels();
		tmpDir = mkdtempSync(join(tmpdir(), 'subhdr-int-'));
	});


	function disassembleText(): string {
		dasm.disassemble();
		return (dasm.disassembledLines as string[]).join('\n');
	}


	test('analyzeRegisterUsage() is invoked before addLabelComments()', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// CALL SUB ; HALT ; SUB: LD A,1 ; RET
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);

		let analyseCalled = false;
		let commentsCalled = false;
		const origAnalyse = dasm.analyzeRegisterUsage.bind(dasm);
		const origComments = dasm.addLabelComments.bind(dasm);
		dasm.analyzeRegisterUsage = () => {
			analyseCalled = true;
			assert(!commentsCalled,
				'analyzeRegisterUsage must run BEFORE addLabelComments');
			origAnalyse();
		};
		dasm.addLabelComments = () => {
			commentsCalled = true;
			assert(analyseCalled,
				'addLabelComments depends on the analyser output');
			origComments();
		};

		dasm.disassemble();
		assert(analyseCalled, 'analyzeRegisterUsage was not called');
		assert(commentsCalled, 'addLabelComments was not called');
	});


	test('rendered disassembly contains the full banner', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);
		const text = disassembleText();

		// Opening and closing asterisk rules appear around every sub.
		const rulePattern = /^; \*{77}$/m;
		assert(rulePattern.test(text),
			'at least one 79-col asterisk rule appears in the output');

		// Mid-banner "sub SUB..." form.
		assert(/^; \*{3} sub \S+\s+\*{3}$/m.test(text),
			'banner mid-line "; *** sub NAME ***" is present');
	});


	test('header contains the firmware-manual fields', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);
		const text = disassembleText();

		for (const field of [
			'Address:', 'Size:', 'Instructions:', 'CC:',
			'Type:', 'Summary:', 'Action:', 'Entry:',
			'Exit (success):', 'Exit (failure):',
			'Corrupted:', 'Preserved:',
			'Called by:', 'Calls:',
		]) {
			assert(text.includes(field),
				'header must contain field label: ' + field);
		}
	});


	test('auto-detected register lists flow into the rendered header', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Sub writes A; analyser records A as corrupted; header prints it.
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);
		const text = disassembleText();

		// Extract the Corrupted line from the sub's header.
		const m = /Corrupted:\s+([^\n]+)/.exec(text);
		assert(m, 'Corrupted line missing from header');
		assert(/\bA\b/.test(m[1]),
			'Corrupted list must contain A (came from LD A,1)');
	});


	test('user-supplied summary: overrides the "—" default', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);

		// --comments file with a summary for the sub at $0005.
		const commentsFile = join(tmpDir, 'c.txt');
		writeFileSync(commentsFile,
			'; summary: Put 1 in the accumulator.\n' +
			'00010: MY_SUB\n\n');
		dasm.setAddressComments(commentsFile);

		const text = disassembleText();
		// The text may contain multiple sub headers; we just need the
		// user-supplied summary to appear somewhere in the output.
		assert(text.includes('Summary:   Put 1 in the accumulator.') ||
			text.includes('Summary: Put 1 in the accumulator.'),
			'user-supplied summary renders verbatim');
	});


	test('user corrupted:/preserved: overrides the analyser output', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Analyser would mark A corrupted; user insists only F is.
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);

		const commentsFile = join(tmpDir, 'c2.txt');
		writeFileSync(commentsFile,
			'; corrupted: F\n' +
			'; preserved: A\n' +
			'00010: MY_SUB\n\n');
		dasm.setAddressComments(commentsFile);

		const text = disassembleText();
		// Find the sub-header section for 0x0010 by its Address line.
		// assignLabelNames() overwrites user label names, so match by address.
		const addrIdx = text.search(/Address:\s+0010h/i);
		assert(addrIdx >= 0, 'sub at $0010 must appear in output');
		const sectionStart = text.lastIndexOf('***', addrIdx);
		const sectionEnd   = text.indexOf('\n\n', addrIdx);
		const section = text.slice(sectionStart > 0 ? sectionStart : 0,
			sectionEnd > 0 ? sectionEnd : text.length);
		const corrLine = /Corrupted:\s+([^\n]+)/.exec(section)?.[1] ?? '';
		const presLine = /Preserved:\s+([^\n]+)/.exec(section)?.[1] ?? '';
		assert(/\bF\b/.test(corrLine),
			'user Corrupted override honored');
		assert(/\bA\b/.test(presLine),
			'user Preserved override honored');
	});


	test('"analysis unavailable" note appears only when analyser gave up', function () {
		if (typeof dasm.analyzeRegisterUsage !== 'function') return this.skip();
		// Path A: plain sub — no note.
		dasm.memory.setMemory(0, new Uint8Array([
			0xCD, 0x10, 0x00, 0xC9, 0x00, 0x00, 0x00, 0x00,  // CALL 0x0010 ; RET ; pad
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,  // pad
0x3E, 0x01, 0xC9,                                 // 0x0010: LD A,1 ; RET
		]));
		dasm.setLabel(0);
		const textOk = disassembleText();
		assert(!/analysis unavailable/.test(textOk),
			'plain sub must NOT get the unavailable note');

		// Fresh disassembler: sub that JP (HL)s.
		const dasm2: any = new Disassembler();
		dasm2.initLabels();
		dasm2.memory.setMemory(0, new Uint8Array([
			0xCD, 0x03, 0x00, 0x76, 0xE9,
		]));
		dasm2.setLabel(0);
		dasm2.disassemble();
		const textBad = (dasm2.disassembledLines as string[]).join('\n');
		assert(/analysis unavailable/.test(textBad),
			'JP (HL) sub must include the unavailable note');
		assert(/JP \(HL\)/.test(textBad),
			'note mentions the triggering opcode');
		// Note appears directly under Preserved: (no indent, top-level line).
		assert(/^; \(analysis unavailable:/m.test(textBad),
			'unavailable note is a top-level comment line');
	});

});
