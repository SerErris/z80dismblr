import {Memory, MemAttribute} from './memory';


// ── Enums & interfaces ──────────────────────────────────────────────────────

/** Identifies which CPC firmware RST variant an opcode represents. */
export const enum CpcRstKind {
    RESET,
    LOW_JUMP,
    SIDE_CALL,
    FAR_CALL,
    RAM_LAM,
    FIRM_JUMP,
    USER,
    INTERRUPT,
}


/** Static descriptor for one CPC RST opcode. */
export interface CpcRstInfo {
    kind: CpcRstKind;
    z80opcode: number;      // e.g. 0xCF
    z80hex: string;         // CPC display form e.g. "#08"
    funcName: string;       // e.g. "LOW JUMP"
    size: number;           // total bytes including inline data (1 or 3)
    isJump: boolean;        // unconditional jump, no fall-through
    isCall: boolean;        // call with fall-through
    hasInline: boolean;     // has 2 inline data bytes after opcode
}


/** Results of CFG analysis for one CPC RST instruction. */
export interface CpcRstCfg {
    codeTargets: number[];
    dataRanges: Array<{ addr: number; len: number }>;
    newLabels: Array<{ addr: number; name: string }>;
    fallThrough: boolean;
    resumeAddr: number;             // always pc + size
    defwAddr: number | undefined;   // pc+1 for 3-byte RSTs, undefined for 1-byte
}


/** Formatted disassembly lines for one CPC RST instruction. */
export interface CpcRstLines {
    rst: string;
    rstAddr: number;
    defw: string | undefined;
    defwAddr: number | undefined;
}


// ── CPC_RST lookup table ────────────────────────────────────────────────────

/** Lookup table: opcode byte → CpcRstInfo. */
export const CPC_RST: ReadonlyMap<number, CpcRstInfo> = new Map<number, CpcRstInfo>([
    [0xC7, { kind: CpcRstKind.RESET,     z80opcode: 0xC7, z80hex: '#00', funcName: 'RESET',        size: 1, isJump: true,  isCall: false, hasInline: false }],
    [0xCF, { kind: CpcRstKind.LOW_JUMP,  z80opcode: 0xCF, z80hex: '#08', funcName: 'LOW JUMP',     size: 3, isJump: true,  isCall: false, hasInline: true  }],
    [0xD7, { kind: CpcRstKind.SIDE_CALL, z80opcode: 0xD7, z80hex: '#10', funcName: 'SIDE CALL',    size: 3, isJump: false, isCall: true,  hasInline: true  }],
    [0xDF, { kind: CpcRstKind.FAR_CALL,  z80opcode: 0xDF, z80hex: '#18', funcName: 'FAR CALL',     size: 3, isJump: false, isCall: true,  hasInline: true  }],
    [0xE7, { kind: CpcRstKind.RAM_LAM,   z80opcode: 0xE7, z80hex: '#20', funcName: 'RAM LAM',      size: 1, isJump: false, isCall: false, hasInline: false }],
    [0xEF, { kind: CpcRstKind.FIRM_JUMP, z80opcode: 0xEF, z80hex: '#28', funcName: 'FIRM JUMP',    size: 3, isJump: true,  isCall: false, hasInline: true  }],
    [0xF7, { kind: CpcRstKind.USER,      z80opcode: 0xF7, z80hex: '#30', funcName: 'USER RESTART', size: 1, isJump: false, isCall: false, hasInline: false }],
    [0xFF, { kind: CpcRstKind.INTERRUPT, z80opcode: 0xFF, z80hex: '#38', funcName: 'INTERRUPT',    size: 1, isJump: false, isCall: false, hasInline: false }],
]);


// ── Private helpers ─────────────────────────────────────────────────────────

/** Formats a 16-bit value as "0XXXXh" (uppercase, leading zero, trailing h). */
function hex16(n: number): string {
    const s = n.toString(16).toUpperCase().padStart(4, '0');
    return '0' + s + 'h';
}

/** Formats a 16-bit address as "#XXXX" (uppercase, 4 hex digits). */
function cpcAddr(n: number): string {
    return '#' + n.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Decodes the RST 3 (FAR CALL) ROM select byte.
 * 0–251  → "ROM N"
 * 252    → "UR=on, LR=on"
 * 253    → "UR=on, LR=off"
 * 254    → "UR=off, LR=on"
 * 255    → "UR=off, LR=off"
 */
function decodeRomSel(sel: number): string {
    if (sel <= 251) return 'ROM ' + sel;
    if (sel === 252) return 'UR=on, LR=on';
    if (sel === 253) return 'UR=on, LR=off';
    if (sel === 254) return 'UR=off, LR=on';
    return 'UR=off, LR=off';
}

/** Reads a 16-bit little-endian word from memory. Returns undefined if either byte is unassigned. */
function readWord(mem: Memory, addr: number): number | undefined {
    if ((mem.getAttributeAt(addr) & MemAttribute.ASSIGNED) === 0) return undefined;
    if ((mem.getAttributeAt(addr + 1) & MemAttribute.ASSIGNED) === 0) return undefined;
    return mem.getValueAt(addr) + 256 * mem.getValueAt(addr + 1);
}

/** Reads a single byte from memory. Returns undefined if the byte is unassigned. */
function readByte(mem: Memory, addr: number): number | undefined {
    if ((mem.getAttributeAt(addr) & MemAttribute.ASSIGNED) === 0) return undefined;
    return mem.getValueAt(addr);
}


// ── CFG analyser ────────────────────────────────────────────────────────────

/**
 * Analyses a CPC RST instruction for CFG purposes.
 * @param info   The CpcRstInfo descriptor for this opcode.
 * @param pc     Address of the RST opcode byte.
 * @param mem    Memory image.
 * @returns      CpcRstCfg with targets, data ranges, labels, and control-flow info.
 */
export function analyzeCpcRst(info: CpcRstInfo, pc: number, mem: Memory): CpcRstCfg {
    const cfg: CpcRstCfg = {
        codeTargets: [],
        dataRanges: [],
        newLabels: [],
        fallThrough: info.isCall,
        resumeAddr: pc + info.size,
        defwAddr: info.hasInline ? pc + 1 : undefined,
    };

    if (!info.hasInline) {
        return cfg;
    }

    // Read the 16-bit inline operand at pc+1
    const raw = readWord(mem, pc + 1);
    if (raw === undefined) {
        return cfg;
    }

    switch (info.kind) {
        case CpcRstKind.LOW_JUMP:
            cfg.codeTargets.push(raw & 0x3FFF);
            break;

        case CpcRstKind.SIDE_CALL:
            cfg.codeTargets.push((raw & 0x3FFF) | 0xC000);
            break;

        case CpcRstKind.FAR_CALL: {
            // The inline word is the address of a 3-byte pointer record:
            //   [ptrAddr+0..1] = target address (little-endian)
            //   [ptrAddr+2]    = ROM select byte
            const ptrAddr = raw;
            const labelName = 'FAR_' + ptrAddr.toString(16).toUpperCase().padStart(4, '0');
            cfg.newLabels.push({ addr: ptrAddr, name: labelName });
            cfg.dataRanges.push({ addr: ptrAddr, len: 3 });
            const farLo = readWord(mem, ptrAddr);
            if (farLo !== undefined) {
                cfg.codeTargets.push(farLo);
            }
            break;
        }

        case CpcRstKind.FIRM_JUMP:
            cfg.codeTargets.push(raw & 0xFFFF);
            break;

        default:
            break;
    }

    return cfg;
}


// ── Formatter ───────────────────────────────────────────────────────────────

/**
 * Formats a CPC RST instruction as disassembly lines.
 * @param info         The CpcRstInfo descriptor for this opcode.
 * @param pc           Address of the RST opcode byte.
 * @param mem          Memory image.
 * @param lookupLabel  Optional: resolves an address to a label string.
 * @returns            CpcRstLines with rst and optional defw strings.
 */
export function formatCpcRst(
    info: CpcRstInfo,
    pc: number,
    mem: Memory,
    lookupLabel?: (addr: number) => string | undefined,
): CpcRstLines {
    const lines: CpcRstLines = {
        rst: 'rst ' + info.z80hex + '\t\t\t; ' + info.funcName,
        rstAddr: pc,
        defw: undefined,
        defwAddr: undefined,
    };

    if (!info.hasInline) {
        return lines;
    }

    const defwAddr = pc + 1;
    lines.defwAddr = defwAddr;

    const raw = readWord(mem, defwAddr);
    if (raw === undefined) {
        lines.defw = 'defw ???\t\t;   (unreadable)';
        return lines;
    }

    switch (info.kind) {
        case CpcRstKind.LOW_JUMP: {
            const target = raw & 0x3FFF;
            const lr = (raw >> 15) & 1;
            const ur = (raw >> 14) & 1;
            lines.defw = 'defw ' + hex16(raw) + '\t\t;   to ' + cpcAddr(target) + ' [LR=' + lr + ', UR=' + ur + ']';
            break;
        }

        case CpcRstKind.SIDE_CALL: {
            const target = (raw & 0x3FFF) | 0xC000;
            const slot = (raw >> 14) & 3;
            lines.defw = 'defw ' + hex16(raw) + '\t\t;   to ' + cpcAddr(target) + ' [slot ' + slot + ']';
            break;
        }

        case CpcRstKind.FAR_CALL: {
            const ptrAddr = raw;
            const genLabel = 'FAR_' + ptrAddr.toString(16).toUpperCase().padStart(4, '0');
            const operand = (lookupLabel && lookupLabel(ptrAddr)) ?? genLabel;

            const farTarget = readWord(mem, ptrAddr);
            const romSel    = readByte(mem, ptrAddr + 2);

            if (farTarget === undefined) {
                lines.defw = 'defw ' + operand + '\t\t;   (out of range)';
            }
            else {
                const targetStr = (lookupLabel && lookupLabel(farTarget)) ?? cpcAddr(farTarget);
                const romStr    = romSel !== undefined ? decodeRomSel(romSel) : '?';
                lines.defw = 'defw ' + operand + '\t\t;   to ' + targetStr + ' [' + romStr + ']';
            }
            break;
        }

        case CpcRstKind.FIRM_JUMP: {
            const target = raw & 0xFFFF;
            const operand = (lookupLabel && lookupLabel(target)) ?? hex16(raw);
            lines.defw = 'defw ' + operand + '\t\t;   to ' + cpcAddr(target);
            break;
        }

        default:
            break;
    }

    return lines;
}
