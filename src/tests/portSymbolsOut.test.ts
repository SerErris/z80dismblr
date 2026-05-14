/**
 * P7 tests — the `; --- discovered I/O ports ---` section in --symbolsout.
 *
 * Covers:
 * - Named matched ports appear as `port:XXXX NAME` lines.
 * - Wildcard specs (`?`) round-trip correctly.
 * - Unnamed accessed ports appear as commented stubs.
 * - Unmatched declared ports do NOT appear (only accessed ones).
 * - Round-trip: the written file can be re-read by setAddressComments().
 */

import assert = require('assert');
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join }   from 'path';
import { Disassembler } from '../disassembler/disasm';
import { writeSymbolsOut } from '../disassembler/argsWriter';
import { parsePortAddress } from '../disassembler/portLabel';


function makeDasm(org: number, bytes: number[], ports: Array<[string, string]> = []): any {
	const dasm = new Disassembler() as any;
	dasm.memory.setMemory(org, new Uint8Array(bytes));
	dasm.setFixedCodeLabel(org, 'START');
	for (const [spec, name] of ports) {
		const {address, mask} = parsePortAddress(spec);
		dasm.portLabels.push({address, mask, name});
	}
	dasm.disassemble();
	return dasm;
}

function tmpPath(dir: string, name: string): string {
	return join(dir, name);
}


suite('P7 — getPortSymbolsData()', () => {

	// ── getPortSymbolsData returns correct data ───────────────────────────

	test('matched exact-match port appears in named list', () => {
		// LD BC,$FFFD; OUT (C),A — port:FFFD AY_REGISTER is accessed.
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		const {named, unnamed} = dasm.getPortSymbolsData();
		assert.strictEqual(named.length, 1);
		assert.deepStrictEqual(named[0], {spec: 'FFFD', name: 'AY_REGISTER'});
		assert.strictEqual(unnamed.length, 0);
	});

	test('wildcard port spec reconstructed correctly', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		const {named} = dasm.getPortSymbolsData();
		assert.strictEqual(named[0].spec, '7F??');
		assert.strictEqual(named[0].name, 'GATE_ARRAY');
	});

	test('mixed-nibble wildcard spec reconstructed correctly', () => {
		// port:7?40 → address 0x7040, mask 0xF0FF
		const dasm = makeDasm(0x8000, [0x01, 0x40, 0x70, 0xED, 0x79],
			[['7?40', 'WEIRD_PORT']]);
		const {named} = dasm.getPortSymbolsData();
		assert.strictEqual(named[0].spec, '7?40');
	});

	test('declared but unaccessed port does NOT appear', () => {
		// Only GATE_ARRAY ($7F??) is declared; code only accesses $FFFD.
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		const {named, unnamed} = dasm.getPortSymbolsData();
		// BC = $FFFD → doesn't match 7F??; no port label matched.
		assert.strictEqual(named.length, 0);
		assert.strictEqual(unnamed.length, 1);
		assert.strictEqual(unnamed[0], 0xFFFD);
	});

	test('unnamed accessed port appears in unnamed list', () => {
		// BC fully known ($1234) but no matching label declared.
		const dasm = makeDasm(0x8000, [0x01, 0x34, 0x12, 0xED, 0x79], []);
		const {named, unnamed} = dasm.getPortSymbolsData();
		assert.strictEqual(named.length, 0);
		assert.strictEqual(unnamed.length, 1);
		assert.strictEqual(unnamed[0], 0x1234);
	});

	test('multiple distinct unnamed ports deduplicated and sorted', () => {
		// Two OUT (C),C to ports $7F10 and $BC01.
		const dasm = makeDasm(0x8000, [
			0x01, 0x10, 0x7F, 0xED, 0x49,   // LD BC,$7F10; OUT (C),C
			0x01, 0x01, 0xBC, 0xED, 0x49,   // LD BC,$BC01; OUT (C),C
		], []);
		const {unnamed} = dasm.getPortSymbolsData();
		assert.deepStrictEqual(unnamed, [0x7F10, 0xBC01]);
	});

	test('BC unknown: no unnamed entry added', () => {
		// No BC setup before OUT — BC unknown, no annotation, no unnamed entry.
		const dasm = makeDasm(0x8000, [0xED, 0x79], []);
		const {named, unnamed} = dasm.getPortSymbolsData();
		assert.strictEqual(named.length, 0);
		assert.strictEqual(unnamed.length, 0);
	});

	test('FDC pattern: both FB7E and FB7F appear as named', () => {
		const dasm = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x49, 0x03, 0xED, 0x49],
			[['FB7E', 'FDC_STATUS'], ['FB7F', 'FDC_DATA']]);
		const {named} = dasm.getPortSymbolsData();
		assert.strictEqual(named.length, 2);
		const names = named.map(e => e.name);
		assert.ok(names.includes('FDC_STATUS'));
		assert.ok(names.includes('FDC_DATA'));
	});

});


suite('P7 — writeSymbolsOut port section', () => {

	let tmpDir: string;
	setup(() => { tmpDir = mkdtempSync(join(tmpdir(), 'port-sym-out-')); });


	test('port section appears after memory labels', () => {
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		const path = tmpPath(tmpDir, 'out.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());
		const content = readFileSync(path, 'utf8');
		assert.ok(content.includes('; --- discovered I/O ports ---'));
		assert.ok(content.includes('port:FFFD   AY_REGISTER'));
	});

	test('wildcard port spec written correctly', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		const path = tmpPath(tmpDir, 'out2.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());
		const content = readFileSync(path, 'utf8');
		assert.ok(content.includes('port:7F??   GATE_ARRAY'));
	});

	test('unnamed port appears as commented stub', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x34, 0x12, 0xED, 0x79], []);
		const path = tmpPath(tmpDir, 'out3.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());
		const content = readFileSync(path, 'utf8');
		assert.ok(content.includes('; port:1234'));
		assert.ok(content.includes('PORT_1234'));
	});

	test('no port section when no ports accessed', () => {
		// Memory with no I/O instructions.
		const dasm = makeDasm(0x8000, [0x3E, 0x42, 0xC9], []);  // LD A,42; RET
		const path = tmpPath(tmpDir, 'out4.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());
		const content = readFileSync(path, 'utf8');
		assert.ok(!content.includes('discovered I/O ports'));
	});

	test('no port section when ports= parameter is absent (backward compat)', () => {
		const path = tmpPath(tmpDir, 'out5.sym');
		writeSymbolsOut(path, []);
		const content = readFileSync(path, 'utf8');
		assert.ok(!content.includes('port:'));
	});

	test('port section appears before trailing newline (valid symbols syntax)', () => {
		const dasm = makeDasm(0x8000, [0x01, 0xFD, 0xFF, 0xED, 0x79],
			[['FFFD', 'AY_REGISTER']]);
		const path = tmpPath(tmpDir, 'out6.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());
		const content = readFileSync(path, 'utf8');
		assert.ok(content.endsWith('\n'), 'file ends with newline');
	});


	// ── Round-trip: written file can be re-parsed ─────────────────────────

	test('round-trip: written port: lines are re-read by setAddressComments()', () => {
		const dasm = makeDasm(0x8000,
			[0x01, 0x7E, 0xFB, 0xED, 0x49, 0x03, 0xED, 0x49],
			[['FB7E', 'FDC_STATUS'], ['FB7F', 'FDC_DATA']]);
		const path = tmpPath(tmpDir, 'roundtrip.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());

		// Parse the written file in a fresh Disassembler
		const dasm2 = new Disassembler() as any;
		dasm2.initLabels();
		dasm2.setAddressComments(path);

		assert.strictEqual(dasm2.portLabels.length, 2);
		const names = dasm2.portLabels.map((pl: any) => pl.name);
		assert.ok(names.includes('FDC_STATUS'));
		assert.ok(names.includes('FDC_DATA'));
	});

	test('round-trip: wildcard spec survives write → re-read', () => {
		const dasm = makeDasm(0x8000, [0x01, 0x10, 0x7F, 0xED, 0x79],
			[['7F??', 'GATE_ARRAY']]);
		const path = tmpPath(tmpDir, 'rt2.sym');
		writeSymbolsOut(path, dasm.getSymbolsData(), dasm.getPortSymbolsData());

		const dasm2 = new Disassembler() as any;
		dasm2.initLabels();
		dasm2.setAddressComments(path);

		const pl = dasm2.portLabels[0];
		assert.strictEqual(pl.name,    'GATE_ARRAY');
		assert.strictEqual(pl.address, 0x7F00);
		assert.strictEqual(pl.mask,    0xFF00);
	});

});
