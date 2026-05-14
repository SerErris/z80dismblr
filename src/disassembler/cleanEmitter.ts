import { writeFileSync } from 'fs';
import * as util from 'util';
import { Disassembler } from './disasm';
import { Opcode } from './opcode';
import { Memory, MemAttribute } from './memory';
import { NumberType } from './numbertype';
import { Format, HexFormat } from './format';
import { CPC_RST } from './cpcRst';


export type CleanFormat = 'sjasmplus' | 'maxam';
export type CleanHex    = 'z80' | 'cpc' | 'intel' | 'c' | 'amp';


/** Return the default hex style for a given assembler format. */
export function defaultHexForFormat(fmt: CleanFormat): CleanHex {
	return fmt === 'maxam' ? 'cpc' : 'z80';
}


/**
 * Parse and validate a --cleanout-format value.
 * Throws a descriptive string (compatible with the CLI throw pattern) on bad input.
 */
export function parseCleanFormat(s: string): CleanFormat {
	if (s === 'sjasmplus' || s === 'maxam')
		return s;
	throw `--cleanout-format: Unknown format '${s}'. Use sjasmplus or maxam.`;
}


/**
 * Parse and validate a --cleanout-hex value.
 * Throws a descriptive string on bad input.
 */
export function parseCleanHex(s: string): CleanHex {
	if (s === 'z80' || s === 'cpc' || s === 'intel' || s === 'c' || s === 'amp')
		return s;
	throw `--cleanout-hex: Unknown hex style '${s}'. Use z80, cpc, intel, c or amp.`;
}


/** Map CleanHex to the HexFormat enum used by Format.formatHex(). */
function toHexFormat(hex: CleanHex): HexFormat {
	switch (hex) {
		case 'z80':   return HexFormat.Z80;
		case 'cpc':   return HexFormat.CPC;
		case 'c':     return HexFormat.C;
		case 'amp':   return HexFormat.AMP;
		default:      return HexFormat.INTEL;
	}
}


// ---------------------------------------------------------------------------
// Reserved-word sets (case-insensitive matching is done in checkReservedWords)
// ---------------------------------------------------------------------------

/** sjasmplus reserved identifiers (registers, mnemonics, directives). */
const RESERVED_SJASMPLUS = new Set([
	// Z80 registers
	'a', 'b', 'c', 'd', 'e', 'f', 'h', 'l',
	'af', 'bc', 'de', 'hl', 'ix', 'iy', 'sp', 'pc',
	'ixh', 'ixl', 'iyh', 'iyl', 'i', 'r',
	// Condition codes used as standalone identifiers in some contexts
	'nc', 'nz', 'z', 'po', 'pe', 'p', 'm',
	// Core Z80 mnemonics
	'adc', 'add', 'and', 'bit', 'call', 'ccf', 'cp', 'cpd', 'cpdr',
	'cpi', 'cpir', 'cpl', 'daa', 'dec', 'di', 'djnz', 'ei', 'ex',
	'exx', 'halt', 'im', 'in', 'inc', 'ind', 'indr', 'ini', 'inir',
	'jp', 'jr', 'ld', 'ldd', 'lddr', 'ldi', 'ldir', 'neg', 'nop',
	'or', 'otdr', 'otir', 'out', 'outd', 'outi', 'pop', 'push',
	'res', 'ret', 'reti', 'retn', 'rl', 'rla', 'rlc', 'rlca', 'rld',
	'rr', 'rra', 'rrc', 'rrca', 'rrd', 'rst', 'sbc', 'scf', 'set',
	'sla', 'sll', 'sra', 'srl', 'sub', 'xor',
	// sjasmplus assembler directives
	'org', 'defb', 'defw', 'defm', 'defs', 'equ', 'db', 'dw', 'ds',
	'include', 'incbin', 'module', 'endmodule', 'struct', 'ends',
	'macro', 'endm', 'rept', 'endr', 'if', 'ifdef', 'ifndef',
	'else', 'endif', 'end',
]);

/**
 * Maxam / WinApe reserved identifiers.
 * Maxam does not support SLL (treats it as undefined), and uses slightly
 * different directive names.
 */
const RESERVED_MAXAM = new Set([
	// Z80 registers (same as sjasmplus)
	'a', 'b', 'c', 'd', 'e', 'f', 'h', 'l',
	'af', 'bc', 'de', 'hl', 'ix', 'iy', 'sp', 'pc',
	'ixh', 'ixl', 'iyh', 'iyl', 'i', 'r',
	'nc', 'nz', 'z', 'po', 'pe', 'p', 'm',
	// Core Z80 mnemonics (SLL not listed — Maxam doesn't recognise it)
	'adc', 'add', 'and', 'bit', 'call', 'ccf', 'cp', 'cpd', 'cpdr',
	'cpi', 'cpir', 'cpl', 'daa', 'dec', 'di', 'djnz', 'ei', 'ex',
	'exx', 'halt', 'im', 'in', 'inc', 'ind', 'indr', 'ini', 'inir',
	'jp', 'jr', 'ld', 'ldd', 'lddr', 'ldi', 'ldir', 'neg', 'nop',
	'or', 'otdr', 'otir', 'out', 'outd', 'outi', 'pop', 'push',
	'res', 'ret', 'reti', 'retn', 'rl', 'rla', 'rlc', 'rlca', 'rld',
	'rr', 'rra', 'rrc', 'rrca', 'rrd', 'rst', 'sbc', 'scf', 'set',
	'sla', 'sra', 'srl', 'sub', 'xor',
	// Maxam directives
	'org', 'defb', 'defw', 'defm', 'defs', 'equ', 'db', 'dw', 'ds',
	'if', 'else', 'endif', 'end',
]);


/**
 * Emits clean, re-assembleable source from a completed Disassembler run.
 * Instantiate after disassemble() has been called; call emit() to get the
 * full source text, then write it to a file with writeToFile().
 */
export class CleanEmitter {

	protected dasm:   Disassembler;
	protected format: CleanFormat;
	protected hex:    CleanHex;

	constructor(dasm: Disassembler, format: CleanFormat, hex: CleanHex) {
		this.dasm   = dasm;
		this.format = format;
		this.hex    = hex;
	}


	/** Emit `NAME:` (sjasmplus) or `NAME` (maxam) flush-left. */
	protected labelLine(name: string): string {
		return this.format === 'maxam' ? name : name + ':';
	}


	/** Tab-indented comment line. */
	protected commentLine(text: string): string {
		return '\t\t\t; ' + text;
	}


	/**
	 * Given a full mnemonic produced by opcode.disassemble() for an opcode that has
	 * appendValueTypes set, returns just the base portion (without the appended text).
	 *
	 * Strategy: format the appended template suffix with the actual append values,
	 * then strip that formatted suffix from the end of the full mnemonic.
	 */
	protected stripAppendSuffix(opcode: Opcode, fullMnemonic: string): string {
		const appendTpl = opcode.name.slice(opcode.baseName!.length); // e.g. ", code=%s"
		const appendFormatted = util.format(
			appendTpl,
			...opcode.appendValueTypes.map((vt, k) =>
				vt === NumberType.NUMBER_WORD
					? Format.formatHex(opcode.appendValues[k], 4)
					: Format.formatHex(opcode.appendValues[k], 2)
			)
		);
		if (fullMnemonic.endsWith(appendFormatted))
			return fullMnemonic.slice(0, fullMnemonic.length - appendFormatted.length);
		return fullMnemonic;  // fallback — return full mnemonic unchanged
	}


	/**
	 * Emit `len` data bytes starting at `addr` as grouped `defb` / `defs` lines.
	 *
	 * Rules:
	 *   - If the label at `addr` has `accessWidth === 2` and at least 2 bytes
	 *     remain: emit a `defw <word>` for the first two bytes, then continue
	 *     with the remaining bytes using the rules below.
	 *   - Runs of ≥ 16 consecutive zero bytes → `defs N, 0`
	 *   - Everything else → `defb $XX, $XX, ...` with up to 8 bytes per line,
	 *     but the group is broken before any ≥ 16-byte zero run.
	 */
	protected emitDataRegion(lines: string[], memory: Memory, addr: number, len: number): void {
		let pos = 0;
		// Level-2 word detection: emit defw when the data label was accessed
		// by a 16-bit load instruction (LD HL,(nn) etc.).
		const startLabel = this.dasm.labels.get(addr);
		if (startLabel?.accessWidth === 2 && len >= 2) {
			const lo   = memory.getValueAt(addr);
			const hi   = memory.getValueAt(addr + 1);
			const word = lo | (hi << 8);
			lines.push('\t\t\tdefw\t' + Format.formatHex(word, 4));
			pos = 2;
		}
		while (pos < len) {
			// Count consecutive zeros at current position
			let zeros = 0;
			while (pos + zeros < len && memory.getValueAt(addr + pos + zeros) === 0) zeros++;

			if (zeros >= 16) {
				lines.push('\t\t\tdefs\t' + zeros + ', 0');
				pos += zeros;
				continue;
			}

			// Collect up to 8 bytes as a defb line, stopping before a ≥ 16-byte zero run
			const bytes: string[] = [];
			while (bytes.length < 8 && pos < len) {
				let z = 0;
				while (pos + z < len && memory.getValueAt(addr + pos + z) === 0) z++;
				if (z >= 16) break;
				bytes.push(Format.formatHex(memory.getValueAt(addr + pos), 2));
				pos++;
			}
			if (bytes.length > 0)
				lines.push('\t\t\tdefb\t' + bytes.join(', '));
		}
	}


	/**
	 * Throws if the format is maxam and the disassembled binary contains any
	 * ZX Next opcode (OpcodeNext / OpcodeNextPush), which maxam does not support.
	 * Must be called before any output is written.
	 */
	protected checkZxNextForMaxam(): void {
		if (this.format !== 'maxam') return;
		const memory = this.dasm.memory;
		for (let addr = 0; addr <= 0xFFFF; addr++) {
			const attr = memory.getAttributeAt(addr);
			if (!(attr & MemAttribute.ASSIGNED))   continue;
			if (!(attr & MemAttribute.CODE))       continue;
			if (!(attr & MemAttribute.CODE_FIRST)) continue;
			const opcode = Opcode.getOpcodeAt(memory, addr);
			if (opcode.isNextOpcode) {
				const hex = '$' + addr.toString(16).toUpperCase().padStart(4, '0');
				throw `z80map: --cleanout-format maxam: this binary contains ZX Next opcodes\nwhich maxam does not support. Use --cleanout-format sjasmplus instead.\nFirst ZX Next opcode found at address ${hex}.`;
			}
		}
	}


	/**
	 * Throws if any non-EQU label name collides with a reserved word for the
	 * current assembler format.  Call before writing any output.
	 */
	protected checkReservedWords(): void {
		const reserved = this.format === 'maxam' ? RESERVED_MAXAM : RESERVED_SJASMPLUS;
		for (const [addr, label] of this.dasm.labels) {
			if (label.isEqu || !label.name) continue;
			if (reserved.has(label.name.toLowerCase())) {
				const hex = '$' + addr.toString(16).toUpperCase().padStart(4, '0');
				throw `z80map: label '${label.name}' at ${hex} is a reserved word in ${this.format}.\nRename the label and try again.`;
			}
		}
	}


	/**
	 * Produce the complete clean source text.
	 *
	 * Structure:
	 *   1. EQU prologue — all isEqu labels sorted by address
	 *   2. For each contiguous assigned block:
	 *      org $XXXX
	 *      [label:]              (flush-left, blank line before SUB/RST)
	 *      \t\t\tinstruction   (tab-indented, lowercase)
	 *      \t\t\tdefb $XX      (one per data byte — grouping added in B3)
	 *
	 * WARNING comments from opcode.disassemble() are emitted as a comment
	 * line immediately before the offending instruction.
	 *
	 * LF-only line endings, UTF-8, trailing newline, no BOM.
	 */
	public emit(): string {
		this.checkZxNextForMaxam();
		this.checkReservedWords();

		const lines  = new Array<string>();
		const memory = this.dasm.memory;
		const labels = this.dasm.labels;

		// Temporarily override global hex format and opcode name case so that
		// opcode.disassemble() produces the desired style without permanently
		// affecting the global opcode tables.
		const savedHex    = Format.hexFormat;
		const restoreOps  = Opcode.saveNames();
		Format.hexFormat  = toHexFormat(this.hex);
		Opcode.makeLowerCase();

		try {
			// 1. EQU prologue
			let hasEqu = false;
			for (const [addr, label] of labels) {
				if (!label.isEqu || !label.name) continue;
				lines.push(label.name + '\t\tequ\t' + Format.formatHex(addr, 4));
				hasEqu = true;
			}
			if (hasEqu) lines.push('');

			// 2. Main body — mirrors disassembleMemory() outer loop logic
			let walkAddress = -1;

			for (const [addr, label] of labels) {
				if (label.isEqu) continue;

				if (walkAddress !== -1) {
					if (addr < walkAddress) continue; // already covered by prior inner walk
					// gap detected — start a new ORG block
					lines.push('');
					lines.push('\t\t\torg\t' + Format.formatHex(addr, 4));
				} else {
					// very first non-EQU label
					lines.push('\t\t\torg\t' + Format.formatHex(addr, 4));
				}

				walkAddress = addr;
				let firstLabelInBlock = true;

				// Inner walk: emit all code/data from walkAddress until unassigned
				while (true) {
					const attr = memory.getAttributeAt(walkAddress);
					if (!(attr & MemAttribute.ASSIGNED)) break;

					// Emit label if one exists at this address
					const addrLabel = labels.get(walkAddress);
					if (addrLabel) {
						const type = addrLabel.type;
						const isSub = type === NumberType.CODE_SUB
						           || type === NumberType.CODE_RST;
						// Blank line before subroutine labels, but not immediately after ORG
						if (isSub && !firstLabelInBlock && lines[lines.length - 1] !== '') {
							lines.push('');
						}
						firstLabelInBlock = false;
						lines.push(this.labelLine(addrLabel.name));
					}

					if (attr & MemAttribute.CODE) {
						// B2d — CPC RST 3-byte expansion (active only when --machine cpc is set)
						if (this.dasm.machine === 'cpc') {
							const opByte  = memory.getRawAt(walkAddress);   // M1 opcode fetch
							const cpcInfo = CPC_RST.get(opByte);
							if (cpcInfo) {
								lines.push('\t\t\trst\t' + Format.formatHex(opByte & 0x38, 2));
								if (cpcInfo.hasInline) {
									const lo   = memory.getValueAt(walkAddress + 1);
									const hi   = memory.getValueAt(walkAddress + 2);
									const word = lo + 256 * hi;
									const lbl  = labels.get(word);
									lines.push('\t\t\tdefw\t' + (lbl?.name ?? Format.formatHex(word, 4)));
								}
								walkAddress += cpcInfo.size;
								continue;
							}
						}

						// CODE: decode opcode and emit mnemonic
						const opcode = Opcode.getOpcodeAt(memory, walkAddress);

						// Invalid opcodes → emit each raw byte as defb
						if (opcode.name.startsWith('invalid instruction')) {
							for (let i = 0; i < opcode.length; i++)
								lines.push('\t\t\tdefb\t' + Format.formatHex(memory.getRawAt(walkAddress + i), 2));  // invalid opcode: M1 bytes, keep raw
							walkAddress += opcode.length;
						} else if (opcode.appendValueTypes && this.dasm.machine !== 'cpc') {
							// B2b — custom --opcode extension (active only when --machine cpc is NOT set):
							// emit base mnemonic on its own line, then one defb/defw per appended byte.
							const desc        = opcode.disassemble(memory);
							const baseMnemonic = this.stripAppendSuffix(opcode, desc.mnemonic);
							lines.push('\t\t\t' + baseMnemonic);

							for (let k = 0; k < opcode.appendValueTypes.length; k++) {
								const vType = opcode.appendValueTypes[k];
								const val   = opcode.appendValues[k];
								if (vType === NumberType.NUMBER_WORD)
									lines.push('\t\t\tdefw\t' + Format.formatHex(val, 4));
								else
									lines.push('\t\t\tdefb\t' + Format.formatHex(val, 2));
							}
							walkAddress += opcode.length;
						} else {
							const desc    = opcode.disassemble(memory);
							const mnemonic = desc.mnemonic;   // already lowercase via makeLowerCase()
							const comment  = desc.comment;

							// WARNING passthrough: emit as a greppable comment before the instruction
							if (comment && comment.includes('WARNING:')) {
								const wIdx = comment.indexOf('WARNING:');
								lines.push(this.commentLine(comment.substring(wIdx)));
							}

							lines.push('\t\t\t' + mnemonic);
							walkAddress += opcode.length;
						}
					} else {
						// DATA: collect consecutive bytes until next label/code/unassigned, then group
						const runStart = walkAddress;
						let runLen = 0;
						while (true) {
							const a  = runStart + runLen;
							const at = memory.getAttributeAt(a);
							if (!(at & MemAttribute.ASSIGNED)) break;
							if (at & MemAttribute.CODE)        break;
							if (runLen > 0 && labels.has(a))   break;
							runLen++;
						}
						this.emitDataRegion(lines, memory, runStart, runLen);
						walkAddress = runStart + runLen;
					}
				}
			}
		} finally {
			Format.hexFormat = savedHex;
			restoreOps();
		}

		return lines.join('\n') + '\n';
	}


	/** Write the clean source to a file (LF line endings, UTF-8). */
	public writeToFile(path: string): void {
		writeFileSync(path, this.emit());
	}
}
