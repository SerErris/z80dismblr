# Amstrad CPC RST Instruction Handling for z80map

## Table of Contents

1. [Background — Recursive-Descent / CFG Disassembly](#background)
2. [The Amstrad CPC RST Extension — Overview](#overview)
3. [RST Instruction Reference](#reference)
4. [Disassembler Output Format](#output-format)
5. [Source File: src/cpcRst.ts](#cpcrst-ts)
6. [CFG Engine Integration](#cfg-integration)
7. [Data Range Discovery and --argsout](#argsout)
8. [Source File: src/argsWriter.ts](#argswriter-ts)
9. [New CLI Arguments](#cli-arguments)
10. [Worked Example Output](#example)
11. [Summary Tables](#summary)

---

## 1. Background — Recursive-Descent / CFG Disassembly

A **recursive-descent** (or Control-Flow-Graph, CFG) disassembler follows the
actual execution paths of code rather than blindly decoding every byte
sequentially (linear sweep).

### Algorithm

1. Start at a known entry point (e.g. reset vector `0x0000`, interrupt vectors).
2. Decode the instruction at the current address.
3. Follow control flow:
   - Sequential instruction (`LD`, `ADD`, …) → continue to next byte
   - Unconditional jump (`JP nn`, `JR e`) → follow target only, no fall-through
   - Conditional jump (`JP NZ,nn`) → enqueue **both** paths
   - `CALL nn` → recurse into target, then continue after call
   - `RET` → stop this path
4. Mark visited addresses to avoid infinite loops.
5. Any address never reached is flagged as **data**, not code.

### Why This Matters for Z80

| Problem | Detail |
|---------|--------|
| Variable-length instructions | 1..4 bytes depending on prefixes |
| Prefix bytes `DD`/`FD`/`ED`/`CB` | Change the meaning of the next opcode |
| Embedded data | Jump tables, strings, constants inside code streams |
| Linear desync | A single data byte throws off all subsequent decoding |

> **Limitation:** Computed jumps (`JP (HL)`, `JP (IX)`) have runtime-determined
> targets and cannot be followed statically. They must be seeded manually
> via `--codelabel`.

### z80map

`z80map` by maziac implements a full CFG approach and is written in
TypeScript. Note: the standalone tool is no longer maintained; its engine
has been absorbed into the [DeZog VS Code debugger](https://github.com/maziac/DeZog).
The code changes described in this document apply to the `z80map` source tree (`src/`).

---

## 2. The Amstrad CPC RST Extension — Overview

On a standard Z80, `RST n` is a 1-byte instruction that pushes PC and jumps
to address `n*8`. The Amstrad CPC firmware repurposes five of the eight RST
slots as compact calling conventions that carry **2 bytes of inline operand
data** immediately after the opcode.

The CPC uses the names **RST 0..RST 7** rather than the Z80 standard
`RST #00..RST #38`.

### Naming Map

| CPC name | Z80 mnemonic | Opcode | CPC function |
|----------|-------------|--------|--------------|
| RST 0 | RST #00 | `0xC7` | RESET |
| RST 1 | RST #08 | `0xCF` | LOW JUMP |
| RST 2 | RST #10 | `0xD7` | SIDE CALL |
| RST 3 | RST #18 | `0xDF` | FAR CALL |
| RST 4 | RST #20 | `0xE7` | RAM LAM |
| RST 5 | RST #28 | `0xEF` | FIRM JUMP |
| RST 6 | RST #30 | `0xF7` | USER RESTART |
| RST 7 | RST #38 | `0xFF` | INTERRUPT |

Three-byte RSTs (LOW JUMP, SIDE CALL, FAR CALL, FIRM JUMP) carry 2 inline
data bytes immediately after the opcode. These bytes are **not** independent
instructions; they are operand data and must be consumed before the CFG
engine continues.

---

## 3. RST Instruction Reference

### RST 0 — RESET (`0xC7`)

**Size:** 1 byte. No following data.

Resets the system as if the machine has just been powered on.

**CFG:** Unconditional stop. No fall-through. No target to trace.

---

### RST 1 — LOW JUMP (`0xCF`)

**Size:** 3 bytes `[0xCF, lo, hi]`

Enables/disables the lower ROM as specified, then jumps to the target
address. ROM state is restored on return (acts like a CALL for ROM purposes,
but the Z80 itself does not push a return address — it is a **JUMP**).

**Operand** — 16-bit little-endian word:

```
Bit 15    : LR state bit  (lower ROM enable before jump)
Bit 14    : UR state bit  (upper ROM enable before jump)
Bits 13..0: Jump target address, range #0000..#3FFF
```

| Bits 15..14 | ROM state before jump |
|-------------|----------------------|
| `00` | Lower ROM enabled, upper ROM disabled |
| `01` | Lower ROM enabled, upper ROM enabled |
| `10` | Lower ROM disabled, upper ROM disabled |
| `11` | Lower ROM disabled, upper ROM enabled |

**CFG:** Unconditional jump to `(raw & 0x3FFF)`. No fall-through.

---

### RST 2 — SIDE CALL (`0xD7`)

**Size:** 3 bytes `[0xD7, lo, hi]`

Calls a routine in an adjacent ROM slot. Upper ROM is enabled, lower ROM
is disabled before the call. Both ROM state and ROM select are restored
on return.

**Operand** — 16-bit little-endian word:

```
Bits 15..14: ROM slot selector (0..3, relative to current ROM)
Bits 13..0 : Offset; actual address = #C000 + (raw & 0x3FFF)
```

**CFG:** Call to `((raw & 0x3FFF) | 0xC000)`. Fall-through to `pc+3`.

---

### RST 3 — FAR CALL (`0xDF`)

**Size:** 3 bytes `[0xDF, lo, hi]`

Calls a routine anywhere in memory (RAM or any ROM). The 2 inline bytes
are a **pointer** to a 3-byte "far address object" — not the target address
itself. This indirection allows the ROM select byte to be patched at run time.

**Operand:** 16-bit pointer (little-endian) to a far address object.

**Far address object** at `ptr` (3 bytes):

```
Byte 0: lo   — low byte of actual target address
Byte 1: hi   — high byte of actual target address
Byte 2: sel  — ROM select/state byte (see table below)
```

**ROM select/state byte (`sel`):**

| `sel` value | Effect | Comment in listing |
|-------------|--------|-------------------|
| 0..251 | Select upper ROM N; enable upper ROM, disable lower ROM | `ROM N` |
| 252 | Enable upper ROM, enable lower ROM | `UR=on, LR=on` |
| 253 | Enable upper ROM, disable lower ROM | `UR=on, LR=off` |
| 254 | Disable upper ROM, enable lower ROM | `UR=off, LR=on` |
| 255 | Disable upper ROM, disable lower ROM | `UR=off, LR=off` |

**CFG:** Call to `farLo | (farHi << 8)`. Fall-through to `pc+3`.
The 3-byte far address object at `ptr` is marked as **DATA**.
A label `FAR_XXXX` is generated for `ptr` and injected into the symbol table.

---

### RST 4 — RAM LAM (`0xE7`)

**Size:** 1 byte. No following data.

Reads the byte from RAM at the address in **HL**, with both ROMs temporarily
disabled. Needed only for reads (writes always go to RAM regardless of ROM state).

**CFG:** Fall-through to `pc+1`. No static target (operand is HL at runtime).

---

### RST 5 — FIRM JUMP (`0xEF`)

**Size:** 3 bytes `[0xEF, lo, hi]`

Enables lower ROM and jumps to the specified address. Lower ROM is disabled
when the routine returns. Upper ROM state is unchanged throughout.

**Operand:** Plain 16-bit jump target (little-endian).

**CFG:** Unconditional jump to `(lo | hi << 8)`. No fall-through.

---

### RST 6 — USER RESTART (`0xF7`)

**Size:** 1 byte minimum (user-defined; may consume more bytes).

Available for user programs. RAM locations `#0030..#0037` may be patched
to gain control.

**CFG:** Treated conservatively as 1-byte fall-through.

---

### RST 7 — INTERRUPT (`0xFF`)

**Size:** 1 byte. No following data.

Reserved for the interrupt handler. Must not be executed by programs.

**CFG:** Fall-through to `pc+1`.

---

## 4. Disassembler Output Format

All RST variants emit a **two-line format**:

- **Line 1** at address `pc` — the `rst` opcode line
- **Line 2** at address `pc+1` — the `defw` operand line *(3-byte RSTs only)*

The CFG resumes from `pc+3` for 3-byte RSTs, `pc+1` for 1-byte RSTs.

> **Key point:** The `defw` line has its **own independent address** (`pc+1`).
> It is not a continuation annotation — it is a proper addressable line.

### Single-byte RSTs (0, 4, 6, 7) — no following data

```asm
rst #00         ; RESET
rst #20         ; RAM LAM
rst #30         ; USER RESTART
rst #38         ; INTERRUPT
```

### RST 1 — LOW JUMP

```asm
rst #08         ; LOW JUMP
defw 0XXXXh     ;   to #XXXX [LR=X, UR=X]
```

Where `0XXXXh` is the raw 16-bit operand with encoding bits intact,
`#XXXX` is bits 13..0 (jump target), `LR` = bit 15, `UR` = bit 14.

Example — operand `0x41A0`, target `#01A0`, LR=1, UR=0:

```asm
1A00:  rst #08         ; LOW JUMP
1A01:  defw 041A0h     ;   to #01A0 [LR=1, UR=0]
```

### RST 2 — SIDE CALL

```asm
rst #10         ; SIDE CALL
defw 0XXXXh     ;   to #XXXX [slot X]
```

Where `slot` = bits 15..14 (0..3) and `#XXXX` = `#C000 + bits 13..0`.

Example — operand `0x8400`, slot 2, target `#C400`:

```asm
1B00:  rst #10         ; SIDE CALL
1B01:  defw 08400h     ;   to #C400 [slot 2]
```

### RST 3 — FAR CALL

```asm
rst #18         ; FAR CALL
defw label      ;   to TARGET [ROM state]
```

Where `label` is the generated `FAR_XXXX` label (or a user-supplied symbol),
`TARGET` is resolved from the far address object, and `ROM state` is decoded
from the `sel` byte. If the pointer is outside the loaded image:

```asm
defw FAR_XXXX   ;   (out of range)
```

Example — ptr `#4000`, far target `#BD3F`, ROM 7:

```asm
1C00:  rst #18         ; FAR CALL
1C01:  defw FAR_4000   ;   to #BD3F [ROM 7]

  ...

4000 FAR_4000:
4000:  defb #3F        ; target lo
4001:  defb #BD        ; target hi
4002:  defb #07        ; ROM select
```

### RST 5 — FIRM JUMP

```asm
rst #28         ; FIRM JUMP
defw label      ;   to #XXXX
```

Where `label` is from the symbol table if available, else raw hex.

Example — target `#0100` labelled `MAIN_LOOP`:

```asm
1D00:  rst #28         ; FIRM JUMP
1D01:  defw MAIN_LOOP  ;   to #0100
```

---

## 5. Source File: `src/cpcRst.ts`

```typescript
// ============================================================================
// src/cpcRst.ts
// Amstrad CPC extended RST instruction support for z80map.
// ============================================================================

export const enum CpcRstKind {
    RESET,      // RST 0  0xC7  1 byte
    LOW_JUMP,   // RST 1  0xCF  3 bytes  unconditional jump
    SIDE_CALL,  // RST 2  0xD7  3 bytes  call
    FAR_CALL,   // RST 3  0xDF  3 bytes  indirect call via pointer
    RAM_LAM,    // RST 4  0xE7  1 byte
    FIRM_JUMP,  // RST 5  0xEF  3 bytes  unconditional jump
    USER,       // RST 6  0xF7  1 byte   user-defined
    INTERRUPT,  // RST 7  0xFF  1 byte
}

export interface CpcRstInfo {
    kind:       CpcRstKind;
    z80opcode:  number;     // e.g. 0xCF
    z80hex:     string;     // e.g. "#08"  (Z80 RST address as CPC prints it)
    funcName:   string;     // e.g. "LOW JUMP"
    size:       number;     // total bytes including inline data
    isJump:     boolean;    // unconditional — no fall-through
    isCall:     boolean;    // call — fall-through + target
    hasInline:  boolean;    // has 2 inline data bytes
}

// ---------------------------------------------------------------------------
// Master table keyed by opcode byte
// ---------------------------------------------------------------------------

export const CPC_RST: ReadonlyMap<number, CpcRstInfo> = new Map([
    [0xC7, { kind: CpcRstKind.RESET,     z80opcode: 0xC7, z80hex: '#00',
             funcName: 'RESET',        size: 1, isJump: true,  isCall: false, hasInline: false }],
    [0xCF, { kind: CpcRstKind.LOW_JUMP,  z80opcode: 0xCF, z80hex: '#08',
             funcName: 'LOW JUMP',     size: 3, isJump: true,  isCall: false, hasInline: true  }],
    [0xD7, { kind: CpcRstKind.SIDE_CALL, z80opcode: 0xD7, z80hex: '#10',
             funcName: 'SIDE CALL',    size: 3, isJump: false, isCall: true,  hasInline: true  }],
    [0xDF, { kind: CpcRstKind.FAR_CALL,  z80opcode: 0xDF, z80hex: '#18',
             funcName: 'FAR CALL',     size: 3, isJump: false, isCall: true,  hasInline: true  }],
    [0xE7, { kind: CpcRstKind.RAM_LAM,   z80opcode: 0xE7, z80hex: '#20',
             funcName: 'RAM LAM',      size: 1, isJump: false, isCall: false, hasInline: false }],
    [0xEF, { kind: CpcRstKind.FIRM_JUMP, z80opcode: 0xEF, z80hex: '#28',
             funcName: 'FIRM JUMP',    size: 3, isJump: true,  isCall: false, hasInline: true  }],
    [0xF7, { kind: CpcRstKind.USER,      z80opcode: 0xF7, z80hex: '#30',
             funcName: 'USER RESTART', size: 1, isJump: false, isCall: false, hasInline: false }],
    [0xFF, { kind: CpcRstKind.INTERRUPT, z80opcode: 0xFF, z80hex: '#38',
             funcName: 'INTERRUPT',    size: 1, isJump: false, isCall: false, hasInline: false }],
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format as "0XXXXh" (raw hex with leading zero, uppercase) */
function hex16(n: number): string {
    return '0' + (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0') + 'h';
}

/** Format as "#XXXX" CPC-style address */
function cpcAddr(n: number): string {
    return '#' + (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

/** Decode RST 3 ROM select byte into a comment string */
function decodeRomSel(sel: number): string {
    if (sel <= 251) return `ROM ${sel}`;
    if (sel === 252) return 'UR=on, LR=on';
    if (sel === 253) return 'UR=on, LR=off';
    if (sel === 254) return 'UR=off, LR=on';
    return 'UR=off, LR=off';  // 255
}

/** Read a 16-bit little-endian word from a memory buffer */
function readWord(mem: Uint8Array, addr: number): number | undefined {
    if (addr < 0 || addr + 1 >= mem.length) return undefined;
    return mem[addr] | (mem[addr + 1] << 8);
}

function readByte(mem: Uint8Array, addr: number): number | undefined {
    if (addr < 0 || addr >= mem.length) return undefined;
    return mem[addr];
}

// ---------------------------------------------------------------------------
// CFG analysis result
// ---------------------------------------------------------------------------

export interface CpcRstCfg {
    /** Addresses to enqueue on the CFG worklist as code entry points */
    codeTargets:  number[];
    /** Address ranges to mark as raw data, as { addr, len } pairs */
    dataRanges:   Array<{ addr: number; len: number }>;
    /** Labels to inject into the symbol table as { addr, name } */
    newLabels:    Array<{ addr: number; name: string }>;
    /** Whether execution continues after this instruction */
    fallThrough:  boolean;
    /** Address of the first byte after this instruction (pc + size) */
    resumeAddr:   number;
    /** Address of the defw operand line (pc+1), undefined for 1-byte RSTs */
    defwAddr:     number | undefined;
}

/**
 * Analyse a CPC RST instruction at `pc` and return the CFG consequences.
 */
export function analyzeCpcRst(
    info: CpcRstInfo,
    pc:   number,
    mem:  Uint8Array,
): CpcRstCfg {

    const result: CpcRstCfg = {
        codeTargets:  [],
        dataRanges:   [],
        newLabels:    [],
        fallThrough:  !info.isJump,
        resumeAddr:   pc + info.size,
        defwAddr:     info.hasInline ? pc + 1 : undefined,
    };

    if (!info.hasInline) return result;

    const lo  = mem[pc + 1] ?? 0;
    const hi  = mem[pc + 2] ?? 0;
    const raw = lo | (hi << 8);

    switch (info.kind) {

        case CpcRstKind.LOW_JUMP: {
            result.codeTargets.push(raw & 0x3FFF);
            break;
        }

        case CpcRstKind.SIDE_CALL: {
            result.codeTargets.push((raw & 0x3FFF) | 0xC000);
            break;
        }

        case CpcRstKind.FAR_CALL: {
            const ptrAddr  = raw;
            const farLabel = `FAR_${ptrAddr.toString(16).toUpperCase().padStart(4, '0')}`;
            result.newLabels.push({ addr: ptrAddr, name: farLabel });
            result.dataRanges.push({ addr: ptrAddr, len: 3 });
            const farLo = readWord(mem, ptrAddr);
            if (farLo !== undefined) {
                result.codeTargets.push(farLo);
            }
            break;
        }

        case CpcRstKind.FIRM_JUMP: {
            result.codeTargets.push(raw & 0xFFFF);
            break;
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Formatter — produces the two-line output demanded by the spec
// ---------------------------------------------------------------------------

export interface CpcRstLines {
    rst:      string;           // "rst #08\t\t\t; LOW JUMP"
    rstAddr:  number;           // = pc
    defw:     string | undefined;
    defwAddr: number | undefined;  // = pc+1, or undefined for 1-byte RSTs
}

/**
 * Format a CPC RST instruction for listing output.
 *
 * @param info         CpcRstInfo for this opcode
 * @param pc           Address of the RST opcode byte
 * @param mem          Full memory image
 * @param lookupLabel  Returns a label string for an address, or undefined
 */
export function formatCpcRst(
    info:        CpcRstInfo,
    pc:          number,
    mem:         Uint8Array,
    lookupLabel: (addr: number) => string | undefined = () => undefined,
): CpcRstLines {

    const rstLine = `rst ${info.z80hex}\t\t\t; ${info.funcName}`;

    if (!info.hasInline) {
        return { rst: rstLine, rstAddr: pc, defw: undefined, defwAddr: undefined };
    }

    const lo  = mem[pc + 1] ?? 0;
    const hi  = mem[pc + 2] ?? 0;
    const raw = lo | (hi << 8);

    let defwLine: string;

    switch (info.kind) {

        // RST 1 — LOW JUMP: defw 0XXXXh  ;   to #XXXX [LR=X, UR=X]
        case CpcRstKind.LOW_JUMP: {
            const target = raw & 0x3FFF;
            const lr     = (raw >> 15) & 1;
            const ur     = (raw >> 14) & 1;
            defwLine = `defw ${hex16(raw)}\t\t;   to ${cpcAddr(target)} [LR=${lr}, UR=${ur}]`;
            break;
        }

        // RST 2 — SIDE CALL: defw 0XXXXh  ;   to #XXXX [slot X]
        case CpcRstKind.SIDE_CALL: {
            const slot   = (raw >> 14) & 0x3;
            const target = (raw & 0x3FFF) | 0xC000;
            defwLine = `defw ${hex16(raw)}\t\t;   to ${cpcAddr(target)} [slot ${slot}]`;
            break;
        }

        // RST 3 — FAR CALL: defw FAR_XXXX  ;   to TARGET [ROM state]
        case CpcRstKind.FAR_CALL: {
            const ptrAddr = raw;
            const operand = lookupLabel(ptrAddr)
                         ?? `FAR_${ptrAddr.toString(16).toUpperCase().padStart(4, '0')}`;
            const farLo   = readWord(mem, ptrAddr);
            const romSel  = readByte(mem, ptrAddr + 2);
            let comment: string;
            if (farLo === undefined || romSel === undefined) {
                comment = '(out of range)';
            } else {
                const farTarget = lookupLabel(farLo) ?? cpcAddr(farLo);
                comment = `to ${farTarget} [${decodeRomSel(romSel)}]`;
            }
            defwLine = `defw ${operand}\t\t;   ${comment}`;
            break;
        }

        // RST 5 — FIRM JUMP: defw label  ;   to #XXXX
        case CpcRstKind.FIRM_JUMP: {
            const target  = raw & 0xFFFF;
            const operand = lookupLabel(target) ?? hex16(raw);
            defwLine = `defw ${operand}\t\t;   to ${cpcAddr(target)}`;
            break;
        }

        default:
            defwLine = `defw ${hex16(raw)}`;
    }

    return {
        rst:      rstLine,
        rstAddr:  pc,
        defw:     defwLine,
        defwAddr: pc + 1,
    };
}
```

---

## 6. CFG Engine Integration

Add the following block to the main CFG decode loop in `disassembler.ts`,
**before** the standard opcode handler so CPC RST opcodes are never
mis-decoded as plain RSTs.

```typescript
import { CPC_RST, analyzeCpcRst, formatCpcRst } from './cpcRst';

// Inside CFG decode loop, after reading `opcode` at `pc`:

if (this.cpcMode) {
    const rstInfo = CPC_RST.get(opcode);
    if (rstInfo) {

        // Step 1: Analyse CFG consequences
        const cfg = analyzeCpcRst(rstInfo, pc, this.memory);

        // Inject generated labels FIRST so lookupLabel() finds FAR_XXXX
        for (const { addr, name } of cfg.newLabels) {
            this.symbolTable.set(addr, name);
            if (this.isInRange(addr, 1)) {
                this.discovered.push({ kind: 'datalabel', addr, name });
            }
        }

        // Enqueue code entry points
        for (const target of cfg.codeTargets) {
            this.addLabel(target);
            this.pushToWorklist(target);
        }

        // Mark far address objects as data; record for --argsout
        for (const { addr, len } of cfg.dataRanges) {
            this.markAsData(addr, len);
            if (this.isInRange(addr, len)) {
                this.discovered.push({ kind: 'datarange', addr, length: len });
            }
        }

        // Step 2: Format and emit
        const lines = formatCpcRst(
            rstInfo, pc, this.memory,
            (addr) => this.symbolTable.get(addr),
        );

        this.emitLine(lines.rstAddr, lines.rst);          // RST opcode at pc
        if (lines.defw !== undefined && lines.defwAddr !== undefined) {
            this.emitLine(lines.defwAddr, lines.defw);    // defw at pc+1
        }

        // Step 3: Advance CFG state
        if (cfg.fallThrough) {
            nextPc   = cfg.resumeAddr;   // pc+3 or pc+1
        } else {
            stopPath = true;
        }

        continue;
    }
}
```

### The `isInRange` Helper

```typescript
/**
 * Returns true if the address range [addr, addr+len-1] falls entirely
 * within one of the binary segments loaded via --bin.
 */
private isInRange(addr: number, len: number): boolean {
    return this.memoryMap.some(([start, end]) =>
        addr >= start && (addr + len - 1) <= end
    );
}
```

### Address Model for 3-Byte RSTs

| Offset | Role |
|--------|------|
| `pc+0` | RST opcode byte — emitted as `rst #XX ; FUNCNAME` |
| `pc+1` | `defw` line — **has its own address**, emitted as `defw ...` |
| `pc+2` | High byte of operand — part of `defw`, no separate address |
| `pc+3` | `resumeAddr` — CFG continues here |

---

## 7. Data Range Discovery and `--argsout`

### Background

`z80map` has **no built-in data-range or block-definition file**.
The only input mechanisms the original tool provides are:

| Mechanism | Description |
|-----------|-------------|
| `--codelabel address [name]` | Seed a code entry point |
| `--tr file` | MAME trace file |
| `--args file` | Plain text file of CLI arguments (newlines allowed) |

The author never implemented a ranges file, and no automatic update
mechanism exists in the original tool.

### New Mechanism

We add three new CLI arguments and one output file:

| Argument | Description |
|----------|-------------|
| `--datalabel address [name]` | Add to symbol table as data; do NOT enqueue for CFG traversal |
| `--datarange address length` | Mark byte range as raw data; CFG engine skips these bytes |
| `--argsout file` | After disassembly, write all discovered labels and ranges here |

### Round-Trip Workflow

```bash
# Pass 1 — discover what we can
z80map \
    --cpc \
    --bin 0 firmware.bin \
    --codelabel 0x0000 \
    --argsout discovered.args \
    --out pass1.list

# Edit discovered.args: rename labels, add missed entry points, etc.

# Pass 2 — feed accumulated knowledge back in
z80map \
    --cpc \
    --bin 0 firmware.bin \
    --args discovered.args \
    --out pass2.list
```

### Format of the `--args` / `--argsout` File

Plain text. One argument token per line. Blank lines and `;` comments are
ignored. The output file uses exactly the same syntax as the input file.

```
; Auto-generated by z80map --cpc
; Review and edit before re-using as --args input

--bin
0
firmware.bin

--codelabel
0x0000
RESET

--codelabel
0x0038
INT_HANDLER

; --- data ranges discovered from RST 3 FAR CALL operands ---

--datalabel
0x4000
FAR_4000

--datarange
0x4000
3

--datalabel
0x4003
FAR_4003

--datarange
0x4003
3
```

---

## 8. Source File: `src/argsWriter.ts`

```typescript
// ============================================================================
// src/argsWriter.ts
// Writes discovered labels and data ranges to a file in --args format
// so they can be fed back in on a subsequent disassembly pass.
// ============================================================================

import * as fs from 'fs';

export interface DiscoveredEntry {
    kind:    'codelabel' | 'datalabel' | 'datarange';
    addr:    number;
    name?:   string;
    length?: number;   // only for datarange
}

export function writeArgsOut(path: string, entries: DiscoveredEntry[]): void {
    const lines: string[] = [
        '; Auto-generated by z80map --cpc',
        '; Review before re-using as --args input',
        '',
    ];

    for (const kind of ['codelabel', 'datalabel', 'datarange'] as const) {
        const group = entries.filter(e => e.kind === kind);
        if (group.length === 0) continue;

        lines.push(`; --- ${kind} entries ---`);
        for (const e of group) {
            lines.push('');
            lines.push(`--${e.kind}`);
            lines.push(`0x${e.addr.toString(16).toUpperCase().padStart(4, '0')}`);
            if (e.name   !== undefined) lines.push(e.name);
            if (e.length !== undefined) lines.push(String(e.length));
        }
        lines.push('');
    }

    fs.writeFileSync(path, lines.join('\n'), 'utf8');
}
```

---

## 9. New CLI Arguments

Add the following cases to the argument parsing loop in `z80map.ts`:

```typescript
case '--datalabel': {
    const addr = parseAddress(args[++i]);
    const name = !args[i+1]?.startsWith('--') && !isAddress(args[i+1])
                 ? args[++i]
                 : undefined;
    disassembler.addDataLabel(addr, name);
    break;
}

case '--datarange': {
    const addr = parseAddress(args[++i]);
    const len  = parseInt(args[++i], 10);
    disassembler.addDataRange(addr, len);
    break;
}

case '--argsout': {
    argsOutFile = args[++i];
    break;
}

case '--cpc': {
    disassembler.cpcMode = true;
    break;
}
```

After disassembly completes, before the process exits:

```typescript
if (argsOutFile) {
    writeArgsOut(argsOutFile, disassembler.discovered);
}
```

---

## 10. Worked Example Output

Given a CPC firmware ROM with the following bytes at `0x1A00`:

```
0x1A00: CF 34 41   ; RST 1  operand=0x4134  (LR=1, UR=0, target=#0134)
0x1A03: D7 00 84   ; RST 2  operand=0x8400  (slot=2, target=#C400)
0x1A06: DF 00 40   ; RST 3  operand=0x4000  (ptr to far address object)
0x1A09: EF 00 01   ; RST 5  operand=0x0100  (target=#0100)
```

Far address object at `0x4000`:

```
0x4000: 3F BD 07   ; target=#BD3F, ROM select=7
```

Expected disassembly listing:

```asm
1A00:  rst #08         ; LOW JUMP
1A01:  defw 041A0h     ;   to #0134 [LR=1, UR=0]
1A03:  rst #10         ; SIDE CALL
1A04:  defw 08400h     ;   to #C400 [slot 2]
1A06:  rst #18         ; FAR CALL
1A07:  defw FAR_4000   ;   to #BD3F [ROM 7]
1A09:  rst #28         ; FIRM JUMP
1A0A:  defw MAIN_LOOP  ;   to #0100

  ... (disassembly of #0134, #C400, #BD3F, #0100 follows from CFG worklist)

4000 FAR_4000:
4000:  defb #3F        ; target lo
4001:  defb #BD        ; target hi
4002:  defb #07        ; ROM select
```

---

## 11. Summary Tables

### CFG Behaviour per RST

| RST | Opcode | Size | Follow target? | Fall-through? | Notes |
|-----|--------|------|----------------|---------------|-------|
| RST 0 RESET | `0xC7` | 1 | no | no | Hard stop |
| RST 1 LOW JUMP | `0xCF` | 3 | `raw & 0x3FFF` | no | Unconditional |
| RST 2 SIDE CALL | `0xD7` | 3 | `(raw & 0x3FFF) \| 0xC000` | yes | Both paths |
| RST 3 FAR CALL | `0xDF` | 3 | via ptr dereference | yes | Marks 3-byte object as data; generates `FAR_XXXX` label |
| RST 4 RAM LAM | `0xE7` | 1 | no (HL is runtime) | yes | Like `CALL (HL)` |
| RST 5 FIRM JUMP | `0xEF` | 3 | `raw & 0xFFFF` | no | Unconditional |
| RST 6 USER | `0xF7` | 1 | no | yes | Size unknown; treated as 1 |
| RST 7 INTERRUPT | `0xFF` | 1 | no | yes | Returns normally |

### ROM Select/State Byte (RST 3 `sel` byte)

| `sel` value | Comment in listing |
|-------------|-------------------|
| 0..251 | `ROM N` |
| 252 | `UR=on, LR=on` |
| 253 | `UR=on, LR=off` |
| 254 | `UR=off, LR=on` |
| 255 | `UR=off, LR=off` |

### Data Range Mechanism Comparison

| Feature | Original z80map | Our CPC Extension |
|---------|--------------------|--------------------|
| Code entry seed | `--codelabel` | unchanged |
| Data label | not present | `--datalabel` (new) |
| Data range | not present | `--datarange` (new) |
| Write discoveries to file | not present | `--argsout` (new) |
| Read back on next pass | `--args` | `--args` (now also reads `datalabel`/`datarange`) |
| Auto-detect from RST 3 | not present | yes — `FAR_XXXX` + 3-byte range written automatically |
