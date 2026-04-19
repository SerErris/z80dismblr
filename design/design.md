# Z80DISMBLR SW Design

## Overview

~~~~
┌──────────────────────────────────────────────────────────────────────┐
│                           Disassembler                               │
│                                                                      │
│  memory    labels         addressComments    addressStructured        │
│  Map<addr,DisLabel>       Map<addr,Comment>  Map<addr,StructFields>  │
└──────────────────────────────────────────────────────────────────────┘
        │           │                │
        ▼           ▼                ▼
  ┌──────────┐ ┌──────────┐  ┌────────────┐  ┌──────────────┐
  │  Memory  │ │ DisLabel │  │  Comment   │  │ CleanEmitter │
  │          │ │          │  │            │  │  (Stream B)  │
  │ data[]   │ │ name     │  │linesBefore │  └──────────────┘
  │ attrib[] │ │ type     │  │inlineComment    ┌──────────┐
  └──────────┘ │ isEqu    │  │linesAfter  │  │  CPC_RST │
               │ isFixed  │  └────────────┘  │ (--cpc)  │
  ┌──────────┐ │ refs     │                  └──────────┘
  │  Opcode  │ │ calls    │  ┌────────────┐  ┌──────────┐
  │          │ │ corrupted│  │   Format   │  │argsWriter│
  │ name     │ │ preserved│  │            │  └──────────┘
  │ length   │ └──────────┘  │ formatHex()│
  │ flags    │               └────────────┘
  │ writes   │
  │ reads    │
  └──────────┘
~~~~

**Disassembler**: Main orchestrator. Runs the 9-pass analysis pipeline and
holds all state: binary memory, label map, comment map, structured fields,
statistics, and CPC mode flag.

**Memory**: 64 KB buffer with per-byte attributes (`ASSIGNED`, `CODE`,
`CODE_FIRST`, `DATA`). One or more `--bin` or `--sna` files are loaded here.

**DisLabel**: Metadata for one discovered address: name, type
(`CODE_SUB`, `CODE_LBL`, `DATA_LBL`, …), reference set, callee list, and —
for Stream A — corrupted/preserved register sets.

**Opcode**: Static table of all Z80 instructions plus ZX Next and CPC RST
variants. Each entry carries: mnemonic, byte length, flags (`CALL`, `BRANCH`,
`STOP`, …), operand type, and (Stream A) `writes`/`reads` register masks.

**Comment**: The formatted header block attached to a label: `linesBefore`
(banner + structured fields), optional inline comment, and `linesAfter`.

**Format**: Hex/decimal formatting helper. Supports five hex styles:
`intel` (`1234h`), `intel0` (`01234h`), `cpc` (`#1234`), `z80` (`$1234`),
`c` (`0x1234`).

**CleanEmitter** *(Stream B)*: Produces re-assembleable source in `sjasmplus`
or `maxam` dialect. EQU prologue, ORG per block, grouped data, CPC RST
expansion, reserved-word validation.

**CPC_RST**: Amstrad CPC firmware RST handler. Decodes the 8 RST variants
(3-byte with inline operand or 1-byte), provides CFG analysis and clean-output
formatting.

**argsWriter**: Writes discovered data ranges and labels to `--argsout` (in
`--args` format) and skeleton symbol files to `--symbolsout`.

---

## Main Flow Diagram

~~~
  ┌─────────────────────────────┐
  │  Load binary / symbols      │  --bin / --sna / --symbols
  └──────────────┬──────────────┘
                 │
  ┌──────────────▼──────────────┐
  │  Add automatic addresses    │  seed 0x0000 or SNA entry (unless
  └──────────────┬──────────────┘  --noautomaticaddr)
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 1 — collectLabels                                              │
│  Recursive-descent CFG walk from all code entry points.             │
│  Decode opcodes, classify operands, follow branches and calls,      │
│  populate DisLabel.references, mark code/data attributes.           │
│  CPC RST variants handled here when --cpc is active.                │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 2 — adjustCodePointingLabels / addFlowThroughReferences        │
│  Fix labels that land mid-instruction (replace with label+offset).  │
│  Treat fall-through from one subroutine to another as CALL;RET.     │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 3 — turnLBLintoSUB                                             │
│  Promote CODE_LBL → CODE_SUB for jump targets that reach a RET.     │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 4 — addParentReferences                                        │
│  Map every address to its containing subroutine (addressParents).   │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 5 — addCallsListToLabels                                       │
│  Walk references; populate DisLabel.calls (callee list).            │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 6 — countStatistics                                            │
│  Per-subroutine: size in bytes, instruction count, cyclomatic       │
│  complexity (CC = branches − joins + 1).                            │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 7 — analyzeRegisterUsage   (Stream A)                          │
│  Per-opcode write/read masks (from Opcode.writes / .reads).         │
│  Walk reachable addresses; union writes, detect PUSH/POP symmetry.  │
│  Layer callee corrupted sets bottom-up over the call graph.         │
│  Output: DisLabel.corruptedRegisters / .preservedRegisters.         │
│  Marks "unavailable" on JP (HL), self-mod code, unknown callees.    │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 8 — assignLabelNames                                           │
│  Generate stable names: SUB001, RST_0038, LBL_0100, DATA_ABCD, …    │
│  Fixed labels (isFixed=true, user-supplied) are never renamed.      │
│  Out-of-range labels are marked isEqu=true.                         │
└────────────────┬────────────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────────────┐
│ Pass 9 — addLabelComments                                           │
│  Build the subroutine header banner for each CODE_SUB / CODE_RST:   │
│  address, type, size, CC, register lists, callers, callees.         │
│  Merge user-supplied structured fields (summary, action, entry,     │
│  exit-success, exit-failure) from --symbols or round-trip --out.    │
└────────────────┬────────────────────────────────────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │ Emit outputs  │
         └───────┬───────┘
~~~

---

## Output Modes

~~~
                          disassemble() complete
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
  ┌───────────────┐      ┌──────────────────┐    ┌──────────────────┐
  │  --out file   │      │ --cleanout file  │    │ --callgraphout / │
  │               │      │  (Stream B)      │    │ --flowchartout   │
  │ Annotated     │      │                  │    │                  │
  │ disassembly   │      │ CleanEmitter     │    │ Graphviz dot     │
  │               │      │ · EQU prologue   │    │ call graph or    │
  │ Banner header │      │ · ORG per block  │    │ flow chart       │
  │ Structured    │      │ · Instructions   │    └──────────────────┘
  │ fields        │      │ · DEFB/DEFS      │
  │ Register      │      │ · CPC RST→defw   │    ┌──────────────────┐
  │ analysis      │      │ · Validation     │    │  --argsout       │
  │ Caller/callee │      │   (reserved      │    │  --symbolsout    │
  │ inline ;;     │      │    words, ZX     │    │                  │
  │ comments      │      │    Next/maxam)   │    │ Discovered data  │
  └───────────────┘      └──────────────────┘    │ ranges + labels  │
                                                 │ for next pass    │
                                                 └──────────────────┘
~~~

### Output file descriptions

| Flag | Content | Use |
|------|---------|-----|
| `--out` | Annotated disassembly listing | Human reading, round-trip editing |
| `--cleanout` | Re-assembleable source (sjasmplus or maxam) | Binary round-trip verification |
| `--cleanout-format` | `sjasmplus` (default) or `maxam` | Target assembler dialect |
| `--cleanout-hex` | `z80` / `cpc` / `intel` / `c` / `amp` | Hex prefix style override |
| `--callgraphout` | Graphviz dot — function call graph | Architecture visualisation |
| `--flowchartout` | Graphviz dot — control-flow graph | Subroutine analysis |
| `--argsout` | Discovered `--datarange` and labels in `--args` format | Feed back to next run |
| `--symbolsout` | All labels with empty structured-field templates | Start a new `--symbols` file |

---

## Input Sources & Key Flags

| Flag | Purpose |
|------|---------|
| `--bin <addr> <file>` | Load binary at given origin (repeatable) |
| `--sna <file>` | Load ZX Spectrum 48K snapshot |
| `--tr <file>` | Load MAME trace file (seeds code entry points) |
| `--args <file>` | Read arguments from file |
| `--symbols <file>` | Sidecar symbol file: address↔name bindings + structured fields |
| `--codelabel <addr> [name]` | Seed a code entry point (repeatable) |
| `--datarange <addr> <len>` | Mark address range as data (repeatable) |
| `--cpc` | Enable Amstrad CPC firmware RST mode (3-byte RST handling) |
| `--opcode <byte> <text>` | Custom opcode extension (e.g. RST 8 + trailing byte) |
| `--noautomaticaddr` | Suppress automatic 0x0000 / SNA entry seeding |
| `--rstend <addr>` | Do not follow RST at this address |

---

## Stream A — Round-Trip Workflow

The `--out` file is designed for iterative editing:

1. **First run**: `z80dismblr --bin … --out rom.asm` — produces annotated listing with auto-generated headers.
2. **Edit**: User renames labels, adds `; summary:` / `; action:` / `; entry:` / `; exit-success:` / `; exit-failure:` structured fields inside the banner, and adds inline comments with `;;`.
3. **Next run**: Same command with the same `--out` file — the disassembler re-reads its own output, preserves user edits (names, structured fields, `;;` comments), and regenerates the auto parts (register analysis, call lists, statistics).

The `--argsout` / `--symbolsout` flags export discovered data for the next run.
The `--symbols` flag imports a curated symbol file with user-managed names and metadata.

---

## Stream B — Clean Assembler Output

`--cleanout` emits a stripped source file that re-assembles byte-for-byte:

- EQU prologue (external firmware symbols)
- One `org` directive per contiguous memory block
- Flush-left labels, tab-indented instructions
- Data bytes grouped as `defb` (8 per line) or `defs N, 0` for zero runs ≥ 16 bytes
- CPC RST 3-byte opcodes → `rst` + `defw` (when `--cpc`)
- Custom `--opcode` extensions → base instruction + `defb`/`defw` (when not `--cpc`)
- Hard errors: maxam + ZX Next opcode, or label colliding with assembler reserved word

---

## CPC Mode (--cpc)

Enables Amstrad CPC firmware RST handling. The eight RST opcodes (C7–FF) are
decoded as extended firmware calls rather than plain Z80 restarts:

| RST | Variant | Bytes | CFG |
|-----|---------|-------|-----|
| `$00` | RESET | 1 | Stop |
| `$08` | LOW JUMP | 3 | Jump to ROM 0/1 address |
| `$10` | SIDE CALL | 3 | Call to `#C000 + offset` in given slot |
| `$18` | FAR CALL | 3 | Call via 3-byte far address object |
| `$20` | RAM LAM | 1 | Read RAM via HL (no static target) |
| `$28` | FIRM JUMP | 3 | Unconditional jump to firmware address |
| `$30` | USER | 1 | User restart (treated as call; falls through) |
| `$38` | INTERRUPT | 1 | Interrupt handler |

FAR CALL pointer objects are automatically marked as data ranges and exported
via `--argsout`.
