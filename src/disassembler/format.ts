import assert = require('assert');
import {BaseMemory} from './basememory';


/// Output style for hexadecimal literals everywhere in the disassembly.
export const enum HexFormat {
	INTEL,   // nnnn h  — e.g. 1234h  (default, no leading zero for address column)
	INTEL0,  // 0nnnnh  — e.g. 01234h (leading zero, avoids label ambiguity)
	CPC,     // #nnnn   — e.g. #1234  (Amstrad CPC / sjasmplus native)
	Z80,     // $nnnn   — e.g. $1234  (Zilog / sjasmplus dollar prefix)
	C,       // 0xnnnn  — e.g. 0x1234 (C style, readable but not always reassemblable)
	AMP,     // &nnnn   — e.g. &1234  (WinApe / Maxam / BBC BASIC style)
}


export class Format {

	/// Choose opcodes in lower or upper case.
	public static hexNumbersLowerCase = false;

	/// Hex output style for assembler operands and comments.
	public static hexFormat: HexFormat = HexFormat.INTEL;


	/**
	 * Formats a number as a hex literal in the currently selected style.
	 * @param value The value to format.
	 * @param digits Minimum number of hex digits (zero-padded).
	 * @returns e.g. "1234h", "#1234", "$1234", "0x1234", "01234h"
	 */
	public static formatHex(value: number, digits = 4): string {
		let s = value.toString(16);
		if (!Format.hexNumbersLowerCase)
			s = s.toUpperCase();
		s = Format.fillDigits(s, '0', digits);
		switch (Format.hexFormat) {
			case HexFormat.CPC:    return '#' + s;
			case HexFormat.Z80:    return '$' + s;
			case HexFormat.C:      return '0x' + s;
			case HexFormat.INTEL0: return '0' + s + 'h';
			case HexFormat.AMP:    return '&' + s;
			default:               return s + 'h';   // INTEL
		}
	}

	/**
	 * Returns a hex string with a fixed number of digits.
	 * @param value The value to convert.
	 * @param countDigits The number of digits.
	 * @returns a string, e.g. "04fd".
	 */
	public static getHexString(value: number, countDigits = 4): string {
		let s = value.toString(16);
		if (!Format.hexNumbersLowerCase)
			s = s.toUpperCase();
		return Format.fillDigits(s, '0', countDigits);
	}


	/**
	 * If string is smaller than countDigits the string is filled with 'fillCharacter'.
	 * Used to fill a number up with '0' or spaces.
	 */
	public static fillDigits(valueString: string, fillCharacter: string, countDigits: number): string {
		const repeat = countDigits - valueString.length;
		if (repeat <= 0)
			return valueString;
		const res = fillCharacter.repeat(repeat) + valueString;
		return res;
	}


	/**
	 * Adds spaces to the end of the string until the given total length
	 * is reached.
	 * @param s The string.
	 * @param totalLength The total filled length of the resulting string
	 * @returns s + ' ' (several spaces)
	 */
	public static addSpaces(s: string, totalLength: number): string {
		const countString = s.length;
		const repeat = totalLength - countString;
		if (repeat <= 0)
			return s;
		const res = s + ' '.repeat(repeat);
		return res;
	}


	/**
	 * Puts together a few common conversions for a byte value.
	 * E.g. decimal and ASCII.
	 * Used to create the comment for an opcode or a data label.
	 * @param byteValue The value to convert. [-128;255]
	 * @returns A string with all conversions, e.g. "20h, 32, ' '"
	 */
	public static getVariousConversionsForByte(byteValue: number): string {
		// byte
		if (byteValue < 0)
			byteValue = 0x100 + byteValue;
		let result = byteValue.toString();
		// Negative?
		let convValue = byteValue;
		if (convValue >= 0x80) {
			convValue -= 0x100;
			result += ', ' + Format.fillDigits(convValue.toString(), ' ', 4);
		}
		// Check for ASCII
		if (byteValue >= 32 /*space*/ && byteValue <= 126 /*tilde*/)
			result += ", '" + String.fromCharCode(byteValue) + "'";
		// return
		return result;
	}


	/**
	 * Converts value to a hex address.
	 * @param value The value to convert.
	 * @returns A string with hex conversion, e.g. "FA20h"
	 */
	public static getConversionForAddress(value: number): string {
		return Format.formatHex(value, 4);
	}


	/**
	 * Puts together a few common conversions for a word value.
	 * E.g. decimal.
	 * Used to create the comment for an EQU label.
	 * @param wordValue The value to convert.
	 * @returns A string with all conversions, e.g. "62333, -3212"
	 */
	public static getVariousConversionsForWord(wordValue: number): string {
		// word
		let result = wordValue.toString();
		// Negative?
		let convValue = wordValue;
		if (convValue >= 0x8000) {
			convValue -= 0x10000;
			result += ', ' + this.fillDigits(convValue.toString(), ' ', 6);
		}
		// return
		return result;
	}


	/**
	 * Formats a disassembly string for output.
	 * @param memory The Memory to disassemble. For the opcodes. If undefined no opcodes will be printed.
	 * @param opcodesLowerCase true if opcodes should be printed lower case.
	 * @param clmnsAddress Number of digits used for the address. If 0 no address is printed.
	 * @param clmnsBytes Minimal number of characters used to display the opcodes.
	 * @param clmnsOpcodeFirstPart Minimal number of digits used to display the first of the opcode, e.g. "LD"
	 * @param clmsnOpcodeTotal Minimal number of digits used to display the first total opcode, e.g. "LD A,(HL)"
	 * @param address The address of the opcode. Only used if 'memory' is available (to retrieve opcodes) or if 'clmsnAddress' is not 0.
	 * @param size The size of the opcode. Only used to display the opcode byte values and only used if memory is defined.
	 * @param mainString The opcode string, e.g. "LD HL,35152"
	 */
	/**
	 * Classifies each byte of an instruction as an M1 (opcode/prefix) byte
	 * or a non-M1 (operand/data) byte, mirroring exactly what Opcode.
	 * getOpcodeAt() does: M1 bytes are read raw (getRawAt), operand bytes
	 * pass through the memory decoder (getValueAt). The split depends on the
	 * Z80 prefix structure:
	 *   - unprefixed:        [op][operands…]        → offset 0 raw
	 *   - CB:                [CB][op]               → offsets 0,1 raw
	 *   - ED:                [ED][op][operands…]    → offsets 0,1 raw
	 *   - DD/FD:             [pfx][op][operands…]   → offsets 0,1 raw
	 *   - DDCB/FDCB:         [pfx][CB][d][op]       → offsets 0,1 raw,
	 *                        offsets 2,3 decoded (displacement and the
	 *                        post-displacement selector are non-M1 reads).
	 * @returns boolean[] of length `size`; true = raw/M1, false = decoded.
	 */
	private static classifyInstrBytes(memory: BaseMemory, address: number, size: number): boolean[] {
		const isRaw = new Array<boolean>(size).fill(false);
		if (size <= 0)
			return isRaw;
		isRaw[0] = true;	// the first byte is always an M1 fetch
		const b0 = memory.getRawAt(address);
		if (b0 === 0xCB || b0 === 0xED) {
			if (size > 1) isRaw[1] = true;
		}
		else if (b0 === 0xDD || b0 === 0xFD) {
			if (size > 1) isRaw[1] = true;
			// DDCB/FDCB: [DD|FD][CB][d][op] — only the two prefix bytes are
			// M1; the displacement and selector are non-M1 (decoded).
			// (Already covered: offsets 0,1 raw, rest decoded.)
		}
		return isRaw;
	}


	public static formatDisassembly(memory: BaseMemory | undefined, opcodesLowerCase: boolean, clmnsAddress: number, clmnsBytes: number, clmnsOpcodeFirstPart: number, clmsnOpcodeTotal: number, address: number, size: number, mainString: string, bytesMode: 'raw' | 'decoded' | 'both' = 'raw'): string {
		let line = '';

		// Add address field?
		if (clmnsAddress > 0) {
			line = Format.addSpaces(Format.getHexString(address) + ' ', clmnsAddress);
		}

		// Add bytes of opcode.  'raw' shows the bytes physically stored in
		// memory (ROM image).  'decoded' shows what the program effectively
		// sees: M1 (opcode/prefix) bytes raw, operand/data bytes passed
		// through the memory decoder.  'both' shows "raw | decoded".
		let bytesString = '';
		if (memory) {
			const isRaw = (bytesMode === 'raw')
				? undefined
				: Format.classifyInstrBytes(memory, address, size);
			const rawGroup = (): string => {
				let s = '';
				for (let i = 0; i < size; i++)
					s += Format.getHexString(memory.getRawAt(address + i), 2) + ' ';
				return s;
			};
			const decodedGroup = (): string => {
				let s = '';
				for (let i = 0; i < size; i++) {
					const v = isRaw![i]
						? memory.getRawAt(address + i)
						: memory.getValueAt(address + i);
					s += Format.getHexString(v, 2) + ' ';
				}
				return s;
			};
			if (bytesMode === 'raw')
				bytesString = rawGroup();
			else if (bytesMode === 'decoded')
				bytesString = decodedGroup();
			else
				bytesString = rawGroup().trimEnd() + ' | ' + decodedGroup();
		}
		line += Format.addSpaces(bytesString, clmnsBytes);

		// Add opcode (or defb)
		const arr = mainString.split(' ');
		assert(arr.length > 0, 'formatDisassembly');
		arr[0] = Format.addSpaces(arr[0], clmnsOpcodeFirstPart - 1);	// 1 is added anyway when joining
		let resMainString = arr.join(' ');
		resMainString = Format.addSpaces(resMainString + ' ', clmsnOpcodeTotal);

		line += resMainString;

		// return
		return line;
	}

}

