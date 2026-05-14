import assert = require('assert');
import { ByteDecoder } from './decoders/types';



export const MAX_MEM_SIZE = 0x10000;


export class BaseMemory {
	/// The resulting memory area.
	protected memory: Uint8Array;

	/// The start address.
	protected startAddress: number;

	// The size of the area.
	protected size: number;

	/// Optional per-byte decoder applied to non-M1 reads (operands and data).
	/// When unset, memory reads return raw bytes as stored. When set (via
	/// setDecoder()), getValueAt() passes each byte through the decoder.
	/// M1 fetches use getRawAt() and always bypass the decoder.
	protected decoder?: ByteDecoder;

	/**
	 * Constructor: Initializes memory.
	 * @param startAddress The start address of the memory area.
	 * @param sizeOrArr The size of the memory area or an Uint8Array.
	 * If array the array is used as is. i.e. it is not copied.
	 */
	constructor(startAddress: number, sizeOrArr: number | Uint8Array) {
		if (typeof sizeOrArr == 'number') {
			const size = sizeOrArr as number;
			this.memory = new Uint8Array(size);
		}
		else {
			this.memory = sizeOrArr as Uint8Array;
		}
		this.startAddress = startAddress;
		this.size = this.memory.length;;
	}


	/**
	 * Sets a value at an index.
	 * @param index The index into the memory buffer.
	 * @param value The value for the index.
	 */
	public setValueAtIndex(index: number, value: number) {
		this.memory[index] = value;
	}


	/**
	 * Installs or clears the non-M1 byte decoder.  When a decoder is set,
	 * getValueAt() passes each byte through it before returning. getRawAt()
	 * is unaffected and always returns the raw stored byte.
	 */
	public setDecoder(decoder: ByteDecoder | undefined): void {
		this.decoder = decoder;
	}


	/**
	 * Returns the memory value at address.  When a decoder has been installed
	 * via setDecoder(), the byte is passed through the decoder first — suitable
	 * for operand and data-byte reads.  For M1 (opcode) fetches use getRawAt().
	 * @param address The address to retrieve.
	 * @returns It's value, decoded if a decoder is installed.
	 */
	public getValueAt(address: number) {
		const raw = this.getRawAt(address);
		return this.decoder ? this.decoder(address, raw) : raw;
	}


	/**
	 * Returns the raw stored byte at address, bypassing any installed decoder.
	 * Use for M1 (opcode-fetch) reads — the byte the CPU would see on its
	 * opcode-fetch cycle, which on decrypting-hardware ROMs is the plaintext
	 * opcode that is already stored clear in the ROM.
	 */
	public getRawAt(address: number) {
		address &= (MAX_MEM_SIZE - 1);
		let index = address - this.startAddress;
		if (index < 0) {
			// wrap around
			//index=MAX_MEM_SIZE+address-this.startAddress;
			index += MAX_MEM_SIZE;
		}
		assert(index >= 0, 'getRawAt 1');
		assert(index < this.size, 'getRawAt 2');
		return this.memory[index];
	}


	/**
 * Returns the word memory value at address.
 * @param address The address to retrieve.
 * @returns It's value.
 */
	public getWordValueAt(address: number) {
		const word = this.getValueAt(address) + 256 * this.getValueAt(address + 1);
		return word;
	}


	/**
	 * Returns the word memory value at address in big endian.
	 * @param address The address to retrieve.
	 * @returns It's value.
	 */
	public getBigEndianWordValueAt(address: number) {
		const word = 256 * this.getValueAt(address) + this.getValueAt(address + 1);
		return word;
	}
}