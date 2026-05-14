# z80dismblr — User Manual

**z80dismblr** is a disassembler for Z80 binary code. It uses code-flow-graph analysis rather than a simple linear sweep: it follows every reachable branch (CALL, JP, JR, conditional jumps, RST) and marks the rest as data. The result is a structured, annotated listing that cleanly separates code from data.

This is a fork of the original [z80dismblr by maziac](https://github.com/maziac/z80dismblr), which is no longer actively maintained. Development continues here with a focus on Amstrad CPC support, subroutine header banners with register analysis, and an iterative round-trip annotation workflow.

Key capabilities:

- **Iterative reverse-engineering workflow** — the output `.asm` file doubles as an annotation workspace. Rename labels, fill in documentation fields, add comments, then re-run the same command. All your edits are preserved and merged with freshly analysed data.
- **Subroutine header banners** — each subroutine is preceded by an auto-generated structured block covering size, register usage, caller/callee cross-references, and user-editable documentation fields.
- **Clean assembler output** — a second emitter produces re-assembleable source (sjasmplus or maxam dialect) from the same model.
- **Amstrad CPC RST dispatch** — optional decoding of the CPC firmware's RST-based calling convention, including 3-byte FAR CALL operands.
- **Call graph and flow chart export** — Graphviz dot files for visualising control flow.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Installation & Build](#2-installation--build)
3. [Quick Start](#3-quick-start)
4. [The Iterative Workflow](#4-the-iterative-workflow)
   - 4.1 [First Run](#41-first-run)
   - 4.2 [Editing the Output File](#42-editing-the-output-file)
   - 4.3 [Re-running the Disassembler](#43-re-running-the-disassembler)
   - 4.4 [What Is and Is Not Preserved](#44-what-is-and-is-not-preserved)
5. [Input Files](#5-input-files)
   - 5.1 [Binary Files (`--bin`)](#51-binary-files---bin)
   - 5.2 [ZX Spectrum Snapshots (`--sna`)](#52-zx-spectrum-snapshots---sna)
   - 5.3 [MAME Trace Files (`--tr`)](#53-mame-trace-files---tr)
6. [The Symbols File (`--symbols`)](#6-the-symbols-file---symbols)
   - 6.1 [Address and Label Entries](#61-address-and-label-entries)
   - 6.2 [Structured Fields](#62-structured-fields)
   - 6.3 [Complete Example](#63-complete-example)
7. [The Args File (`--args`)](#7-the-args-file---args)
8. [Output: The Annotated Listing (`--out`)](#8-output-the-annotated-listing---out)
   - 8.1 [Subroutine Banner Format](#81-subroutine-banner-format)
   - 8.2 [Instruction Lines](#82-instruction-lines)
   - 8.3 [Data Lines](#83-data-lines)
   - 8.4 [Inline User Comments (`;;`)](#84-inline-user-comments-)
   - 8.5 [Pre-label and Pre-instruction Comments](#85-pre-label-and-pre-instruction-comments)
   - 8.6 [Orphaned Annotation Blocks](#86-orphaned-annotation-blocks)
9. [Output: Clean Assembler Source (`--cleanout`)](#9-output-clean-assembler-source---cleanout)
10. [Output: Skeleton Symbol File (`--symbolsout`)](#10-output-skeleton-symbol-file---symbolsout)
11. [Output: Args File (`--argsout`)](#11-output-args-file---argsout)
12. [Output: Call Graph (`--callgraphout`)](#12-output-call-graph---callgraphout)
13. [Output: Flow Chart (`--flowchartout`)](#13-output-flow-chart---flowchartout)
14. [Label Naming](#14-label-naming)
    - 14.1 [Auto-generated Names](#141-auto-generated-names)
    - 14.2 [Customising Prefixes](#142-customising-prefixes)
    - 14.3 [User-renamed Labels](#143-user-renamed-labels)
15. [CPC Mode (`--machine cpc`)](#15-cpc-mode---machine-cpc)
16. [Custom Opcode Extensions (`--opcode`)](#16-custom-opcode-extensions---opcode)
17. [All Command-line Options](#17-all-command-line-options)
18. [Typical Workflows by Use Case](#18-typical-workflows-by-use-case)
19. [AI-Assisted Reverse Engineering](#19-ai-assisted-reverse-engineering)

---

## 1. Overview

**z80dismblr** is a disassembler for Z80 binary code. It uses code-flow-graph analysis rather than a simple linear sweep: it follows every reachable branch (CALL, JP, JR, conditional jumps, RST) and marks the rest as data. The result is a structured, annotated listing that cleanly separates code from data.

Key capabilities:

- **Iterative reverse-engineering workflow** — the output `.asm` file doubles as an annotation workspace. Rename labels, fill in documentation fields, add comments, then re-run the same command. All your edits are preserved and merged with freshly analysed data.
- **Subroutine header banners** — each subroutine is preceded by an auto-generated structured block covering size, register usage, caller/callee cross-references, and user-editable documentation fields.
- **Clean assembler output** — a second emitter produces re-assembleable source (sjasmplus or maxam dialect) from the same model.
- **Amstrad CPC RST dispatch** — optional decoding of the CPC firmware's RST-based calling convention, including 3-byte FAR CALL operands.
- **Call graph and flow chart export** — Graphviz dot files for visualising control flow.

---

## 2. Installation & Build

```bash
# Install dependencies
npm install

# Compile TypeScript to JavaScript
npm run compile

# Run the test suite
npm test
```

The entry point after compilation is `out/z80dismblr.js`. You can invoke it with:

```bash
node out/z80dismblr.js [options]
```

---

## 3. Quick Start

Disassemble a plain binary loaded at address `0x0000`:

```bash
node out/z80dismblr.js --bin 0x0000 rom.bin --out rom.asm
```

Open `rom.asm` in your editor, rename some labels, fill in documentation, then re-run the exact same command. Your edits are automatically preserved.

To also produce a re-assembleable source file:

```bash
node out/z80dismblr.js --bin 0x0000 rom.bin --out rom.asm --cleanout rom.s
```

---

## 4. The Iterative Workflow

The core idea is that `--out rom.asm` serves two purposes simultaneously: it is the disassembly listing you read, and it is the annotation file you edit. You never need a separate side-file for notes — everything lives in one place.

### 4.0 Required and Recommended Parameters

**Mandatory minimum:**

| Parameter | Why required |
|-----------|-------------|
| `--bin <addr> <file>` | Load the binary to disassemble |
| `--out <file>` | Both the output target and the auto-import source on re-runs |
| `--codelabel <addr>` OR `--sna` | Seed at least one code entry point; without it the disassembler has nowhere to start and produces no output |
| `--noautomaticaddr` | Required when the ROM does NOT start at `0x0000`; suppresses the automatic `0x0000` entry point that would cause spurious code discovery |

**Strongly recommended for the iterative workflow:**

| Parameter | Why recommended |
|-----------|----------------|
| `--args <file>` | Keeps the command identical across every run; prevents parameter drift (see §4.8) |
| `--addbytes` | Shows hex bytes next to each instruction; not required for round-trip but essential for cross-referencing raw bytes against the listing |
| `--symbols <file>` | Pre-loads known label names and documentation fields; much better starting point than all-auto-generated names |
| `--symbolsout <file>` | Exports discovered labels on each run as a primer; review and fold into `--symbols` |
| `--argsout <file>` | Exports discovered data ranges on each run; review and fold into `--args` |

**Machine-specific flags:**

| Parameter | When to use |
|-----------|------------|
| `--machine cpc` | Any Amstrad CPC firmware ROM — enables RST dispatch decoding |
| `--decoder vortex` | Vortex encrypted disk-controller ROMs — decodes XOR-encrypted operand bytes |

**Round-trip compatibility of display options:**

The round-trip parser ignores formatting; you can freely change any display option between runs without losing your annotations:

| Option | Default | Round-trip safe? |
|--------|---------|-----------------|
| `--addbytes` | off | ✅ byte columns are skipped on re-read |
| `--clmnsAddress` | on (13) | ✅ address column is skipped on re-read |
| `--uppercase` | off | ✅ case is ignored on re-read |
| `--hexformat` | intel | ✅ any hex style is accepted on re-read |

The address column — `--clmnsAddress` — is **on by default** and should stay on. It is not required for the round-trip mechanism itself, but it is essential for human navigation: every line shows the hex address at the left margin, letting you jump directly to any address in your editor or find a line when reading a hardware register dump or trace.

### 4.1 First Run

```bash
node out/z80dismblr.js --bin 0x0000 rom.bin --out rom.asm
```

`rom.asm` does not yet exist, so the disassembler runs from scratch. It produces a fully annotated listing with auto-generated labels (`SUB001`, `SUB002`, …), register-analysis results, and `—` placeholders in all documentation fields.

### 4.2 Editing the Output File

Open `rom.asm` in VS Code or any text editor and make your changes directly in the file:

**Rename a label** — change `SUB002` to your chosen name wherever it appears:

```asm
; *** sub MY_CALLEE                                                         ***
```
```asm
0010 MY_CALLEE:
0000 CD 10 00     CALL MY_CALLEE     ; 0010h
```

**Fill documentation fields** — replace `—` with your text:

```asm
; Summary:   Loads accumulator with the value 1
; Action:    —
; Entry:     —
; Exit (success): A = 1
; Exit (failure): —
```

**Add an inline note to an instruction** — append `;;` followed by your text:

```asm
0000 CD 10 00     CALL MY_CALLEE     ; 0010h  ;; always returns A=1
```

Or suppress the auto-generated comment entirely by starting with `;;`:

```asm
0000 CD 10 00     CALL MY_CALLEE     ;; dispatch to loader
```

**Add a free-form comment above a label or instruction** — place `;` lines immediately above the line:

```asm
; This routine is called once during startup only.
; See also: INIT_DISPLAY
0010 MY_CALLEE:
```

### 4.3 Re-running the Disassembler

Run the exact same command:

```bash
node out/z80dismblr.js --bin 0x0000 rom.bin --out rom.asm
```

The disassembler detects that `rom.asm` already exists and automatically parses it before analysis. Everything you edited is extracted and merged back into the new output. The file is then overwritten with a freshly regenerated listing that contains:

- Your renamed labels (preserved and locked)
- Your documentation field values (preserved)
- Your `;;` inline comments (preserved verbatim)
- Your free-form comments above labels/instructions (preserved)
- Fresh register analysis, call cross-references, and statistics

To start completely fresh (ignoring all previous edits), simply delete or rename the file before running.

### 4.4 What Is and Is Not Preserved

| Content in `.asm` file | Preserved on re-run |
|------------------------|---------------------|
| Renamed labels | ✅ Locked in as fixed labels |
| `Summary:`, `Action:`, `Entry:`, `Exit (success/failure):` fields | ✅ When value is not `—` |
| Free-form `;` lines above a label or instruction | ✅ Re-emitted above the same address |
| Inline user notes after `;;` on instruction lines | ✅ Verbatim |
| `Corrupted:` / `Preserved:` register lists | ❌ Always regenerated from the analyser |
| Auto-generated address, size, CC statistics | ❌ Always regenerated |
| Caller / callee cross-reference lists | ❌ Always regenerated |
| Instruction mnemonics and operands | ❌ Always regenerated |

The `—` character (em-dash, U+2014) is the sentinel value meaning "not yet documented". Any field containing only `—` is treated as empty and will not be preserved. Replace it with your own text to make the field sticky.

### 4.5 Opcode Byte Display (`--addbytes`)

```
--addbytes
```

Adds a column of hex bytes between the address and the mnemonic:

```
0000 CD 10 00     CALL SUB001      ; 0010h
```

**Not required for round-trip** — the byte column is skipped transparently on re-read. However, enabling it is strongly recommended for ROM analysis because:
- You can cross-reference raw bytes against hardware documentation or traces
- You can spot multi-byte NOPs, padding, or suspicious bytes
- AI tools (like Claude Code) can use the byte column to verify their own instruction decoding

The column width is controlled by `--clmnsbytes`. Default is wide enough for up to four bytes. For ROMs with the odd very long instruction (IX/IY prefixed), increase if needed.

### 4.6 Using an Args File for Reproducibility

**The most important single practice for the iterative workflow** is to keep all options in a single `--args` file. This guarantees that every run — whether you are at the keyboard or a script/AI is running it — uses exactly the same parameters.

```
# project.args
--bin 0xC000 rom/firmware.bin
--machine cpc
--decoder vortex
--noautomaticaddr
--codelabel 0xC000
--symbols firmware.sym
--out output/firmware.asm
--addbytes
--hexformat cpc
--argsout firmware_discovered.args
--symbolsout firmware_discovered.sym
```

```bash
node /path/to/z80dismblr/out/z80dismblr.js --args project.args
```

The `--args` file can reference other `--args` files (nesting is allowed), so you can split stable configuration from run-specific overrides.

### 4.7 Starting Fresh

To discard all your previous annotations and start from scratch:

```bash
# Option 1: delete the output file
rm output/firmware.asm

# Option 2: use --fresh to suppress auto-import on this run only
node /path/to/z80dismblr/out/z80dismblr.js --args project.args --fresh
```

`--fresh` suppresses the auto-import of the `--out` file for this run only. Your symbols file (`--symbols`) is always loaded regardless.

### 4.8 Multi-pass Iterative Strategy

A practical rhythm for deep ROM analysis:

**Pass 1 — Discovery.**  Run with `--symbolsout` and `--argsout`. Review the generated symbol skeleton and args file. Identify obvious subroutines, add names, mark any additional data ranges.

**Pass 2 — Seed known labels.**  Build a `--symbols` file from what you found. Add well-known firmware entry points (e.g. CPC BIOS jumpblock addresses). Re-run.

**Pass 3–N — Annotation.**  Open the `.asm` file in your editor. Use `;;` inline comments to note intent as you understand it. Rename labels in-place. Fill in structured fields in the subroutine banners. Re-run after each session to regenerate the freshly-analysed parts.

At any time you can also run with `--cleanout` to produce a re-assembleable `.s` file, verify it assembles byte-for-byte, and use that to test your understanding of the ROM structure.

---

## 5. Input Files

### 5.1 Binary Files (`--bin`)

```
--bin <address> <file>
```

Loads a raw binary file into the 64 KB address space at the given origin address. The address can be decimal or hexadecimal (`0x0000`).

The option is repeatable, so multiple non-overlapping binary blocks can be loaded simultaneously:

```bash
--bin 0x0000 rom_low.bin
--bin 0x4000 rom_high.bin
```

At least one `--codelabel` (or `--sna` which provides an entry point automatically) is needed to seed the disassembly. Without an entry point, the disassembler has nowhere to start.

### 5.2 ZX Spectrum Snapshots (`--sna`)

```
--sna <file>
```

Loads a ZX Spectrum 48K `.sna` snapshot. The 48-byte header is parsed to extract the program counter, which is used as the initial code entry point (equivalent to `--codelabel <PC>`). Memory is loaded at `0x4000`–`0xFFFF`.

Only 48K snapshots are supported; 128K snapshots are not.

### 5.3 MAME Trace Files (`--tr`)

```
--tr <file>
```

Loads a MAME execution trace (`.tr`) to provide additional code entry points discovered during actual execution. Useful for finding code that is reached indirectly and would otherwise be missed by static analysis.

---

## 6. The Symbols File (`--symbols`)

```
--symbols <file>
```

A symbols file is a plain-text sidecar that provides the disassembler with named labels, documentation fields, and register-override information before analysis begins. It is read in addition to (and before) the auto-import of `--out`.

A symbols file is optional but highly recommended for any ROM or firmware with a known label set (e.g. a CPC BIOS symbol table).

The file uses the same round-trip format as the `.asm` output, so `--symbolsout` output can be used directly as `--symbols` input after you review and edit it.

### 6.1 Address and Label Entries

Each entry is an address line, optionally preceded by structured-field comment lines. Entries are separated by blank lines.

**Address-only** (no label, just marks the address):

```
BB5A
```

**Address with label name:**

```
BB5A TXT_OUTPUT
```

The address is a 4-digit hex number without a prefix (no `0x`, no `$`, no `#`). The label name follows on the same line.

### 6.2 Structured Fields

Place structured-field comment lines immediately before the address line. All fields are optional.

| Field | Meaning |
|-------|---------|
| `; summary: <text>` | One-line description of what the subroutine does |
| `; action: <text>` | Detailed description of how it works; can span multiple lines |
| `; entry: <text>` | Input register/parameter contracts |
| `; exit-success: <text>` | State on successful return |
| `; exit-failure: <text>` | State on failed/error return |
| `; corrupted: <list>` | Registers destroyed (overrides the auto-analyser) |
| `; preserved: <list>` | Registers intact on return (overrides the auto-analyser) |

Use `—` (em-dash, U+2014) as the value for "not yet documented". Anything else is treated as user content.

**Multi-line values** — indent continuation lines with two extra spaces:

```
; action: Parse the string at HL, handling FEh escape sequences.
;   On each byte: if FEh, read two more bytes as command+parameter.
;   On FFh, stop. Otherwise output byte via TXT_OUTPUT.
```

**Register lists** — comma-separated register names in any order:

```
; corrupted: A, BC, DE, HL, F
; preserved: IX, IY, AF', BC', DE', HL', I, R
```

### 6.3 Complete Example

```
; Auto-generated by z80dismblr --symbolsout
; Review and complete, then use as --symbols input.

; summary: Initialise the kernel
; entry: —
; exit-success: All kernel data structures ready
; corrupted: AF, BC, DE, HL
BB00 KL_INIT

; summary: Output a character to the screen at the current cursor position
; entry: A = ASCII character code
; exit-success: Character displayed; cursor advanced
; exit-failure: —
; corrupted: AF, BC, DE, HL
BB5A TXT_OUTPUT

; summary: Expand a key event string
; action: Reads bytes from HL. FEh-prefixed sequences are escape codes.
;   FFh terminates the string.
; entry: HL = pointer to key-event string
; exit-success: HL points past the terminator
; exit-failure: —
; corrupted: A, BC, DE, HL, F
BB15 KM_EXP_BUFFER

; Cursor X position in RAM (data label, no structured fields)
C000 cursor_x

; Cursor Y position
C001 cursor_y
```

---

## 7. The Args File (`--args`)

```
--args <file>
```

An args file lets you collect all command-line options into a text file rather than typing them on the command line every run. This is useful for complex projects with many options.

**Format:**

- One option and its parameters per line (or spread across lines — whitespace and newlines are treated identically to spaces on the command line)
- Lines starting with `#` are comments
- Values containing spaces must be quoted: `"quoted value"` or `'quoted value'`
- Options can reference other `--args` files (nesting is allowed)

**Example — `cpc_rom.args`:**

```
# CPC firmware ROM disassembly
--bin 0x0000 cpc464_os.bin
--machine cpc
--symbols cpc_bios.sym
--out cpc464.asm
--cleanout cpc464.s

# Prefix configuration
--subprefix SUB
--lblprefix LBL

# Known entry points
--codelabel 0xBB00 KL_INIT
--noautomaticaddr

# Data regions found in previous run
--datarange 0xBF00 256
--datarange 0xC000 512
```

Run it with:

```bash
node out/z80dismblr.js --args cpc_rom.args
```

Command-line options and `--args` options can be mixed freely; they are processed in order.

---

## 8. Output: The Annotated Listing (`--out`)

```
--out <file>
```

The primary output. A human-readable annotated disassembly listing in a round-trip-safe format.

### 8.1 Subroutine Banner Format

Every subroutine is preceded by a structured banner block. The banner is 79 characters wide and contains:

```
; *****************************************************************************
; *** sub SUB001                                                            ***
; *****************************************************************************
; Address:   0000h          Size: 4 bytes     Instructions: 2     CC: 1
; Type:      Subroutine
; Summary:   —
; Action:    —
; Entry:     —
; Exit (success): —
; Exit (failure): —
; Corrupted: A
; Preserved: BC, DE, HL, IX, IY, AF', BC', DE', HL', F, I, R
; Called by: —
; Calls:     SUB002
; *****************************************************************************
```

**Fields:**

| Field | Source | Editable via `.asm` |
|-------|--------|---------------------|
| Label name (in `*** sub NAME ***`) | Auto + user rename | ✅ |
| Address, Size, Instructions, CC | Auto-analysed | ❌ |
| Type | Auto-analysed | ❌ |
| Summary | User (placeholder `—`) | ✅ |
| Action | User (placeholder `—`) | ✅ |
| Entry | User (placeholder `—`) | ✅ |
| Exit (success) | User (placeholder `—`) | ✅ |
| Exit (failure) | User (placeholder `—`) | ✅ |
| Corrupted | Auto-analysed (overridable via `--symbols`) | ❌ from `.asm` |
| Preserved | Auto-analysed (overridable via `--symbols`) | ❌ from `.asm` |
| Called by | Auto-analysed | ❌ |
| Calls | Auto-analysed | ❌ |

**CC** stands for Cyclomatic Complexity — the number of independent paths through the subroutine. CC = 1 means no branches.

After filling in documentation fields over several sessions, a banner might look like:

```
; *****************************************************************************
; *** sub TXT_OUTPUT                                                        ***
; *****************************************************************************
; Address:   BB5Ah          Size: 23 bytes    Instructions: 9     CC: 3
; Type:      Subroutine
; Summary:   Output a character to the screen at the current cursor position
; Action:    Validates the character, advances cursor, wraps at line end
; Entry:     A = ASCII character code (32–126)
; Exit (success): Character displayed; cursor X/Y updated
; Exit (failure): A < 32 or A > 126; no output, flags unchanged
; Corrupted: A, BC, DE, HL, F
; Preserved: IX, IY, AF', BC', DE', HL', I, R
; Called by: PRINT_STRING[C050h], CMD_HELLO[C0A0h]
; Calls:     cursor_advance
; *****************************************************************************
```

### 8.2 Instruction Lines

Each instruction line contains:

```
ADDR [BYTES]   MNEMONIC   OPERANDS     [; auto-comment]  [;; user-comment]
```

Example with opcode bytes shown (when `--addbytes` is active):

```
0000 CD 10 00     CALL SUB002     ; 0010h  ;; dispatches to loader
```

Example without opcode bytes (default):

```
0000              CALL SUB002     ; 0010h
```

The auto-comment (after `;`) is the hex value of address operands or numeric conversions. It is regenerated on every run.

### 8.3 Data Lines

Bytes that are not reached as code are emitted as `DEFB` directives:

```
0004 76           DEFB 76h    ; 118, 'v'
```

The comment shows decimal and ASCII representations where applicable.

### 8.4 Inline User Comments (`;;`)

The `;;` marker splits an instruction line into an auto-generated part and a user-owned part:

**Auto only** (no user comment):
```
0010 3E 01        LD   A,01h  ; 1
```

**Auto + user** — append `;;` and your text after the auto-comment:
```
0010 3E 01        LD   A,01h  ; 1  ;; constant: firmware version number
```

**User only** — suppress the auto-comment by starting with `;;` (no `;` before it):
```
0010 3E 01        LD   A,01h  ;; load version into A
```

The text after `;;` is stored verbatim and emitted unchanged on every subsequent run. The auto-comment before `;;` is discarded on re-read and regenerated fresh. This means hex style changes (`--hexformat`) apply correctly even to lines with user notes.

### 8.5 Pre-label and Pre-instruction Comments

Any `;` comment lines placed immediately above a label or instruction line are captured and re-emitted in the same position on the next run:

```asm
; Called once at startup — do NOT call again during normal operation.
; Trashes all registers.
0010 MY_INIT:
```

```asm
; Adjust for the off-by-one in the CPC firmware table
0050 3E 01        LD   A,01h  ; 1
```

**Important:** a blank line between your comment and the label/instruction breaks the association. The comment buffer is reset on blank lines.

### 8.6 Orphaned Annotation Blocks

If the binary changes between runs (e.g. a memory range is removed) and an address that had user annotations no longer exists in the disassembly, the annotations are preserved at the top of the file rather than silently discarded:

```
;; ORPHANED: $0010 — address not in loaded memory
;; LABEL: MY_CALLEE
; Summary: Loads A with the value 1
;;
```

This block is machine-readable. The disassembler re-imports it on the next run and keeps the orphan block in the output until you manually remove it. Once the address is present in the binary again, the annotations are reattached automatically.

An orphan block is only emitted if actual user data exists for that address (a renamed label, an edited structured field, or a hand-written comment). Addresses with only auto-generated labels are silently dropped.

---

## 9. Output: Clean Assembler Source (`--cleanout`)

```
--cleanout <file>
--cleanout-format sjasmplus|maxam
--cleanout-hex z80|cpc|intel|c|amp
```

Produces a re-assembleable source file stripped of all commentary and analysis output. The result can be assembled with `sjasmplus` or `maxam` and should reproduce the original binary byte-for-byte.

**What is included:**

- `org` directives for each contiguous memory block
- EQU prologue for any external (out-of-range) symbols
- Labels on their own lines
- Instructions, one per line, tab-indented
- Data bytes grouped up to 8 per `defb` line
- Zero-fill runs of 16 or more bytes as a `defs N, 0` directive
- `WARNING` comments (mark disassembly issues, left for human review)

**What is omitted:**

- Banner blocks, structured fields, register lists
- Call cross-references and statistics
- Address prefixes and opcode bytes
- Auto-generated `;` comments
- User prose comments (including `linesBefore` and `;;` notes)

**Example output (sjasmplus dialect):**

```asm
KM_EXP_BUFFER   equ     $BB15
TXT_OUTPUT      equ     $BB5A

                org     $C000

GAME_INIT:
                ld      hl, $C100
                call    KM_EXP_BUFFER
                ret

.game_init_l1:
                djnz    .game_init_l1

DATA_TABLE:
                defb    $01, $02, $03, $04, $05, $06, $07, $08
                defb    $09, $0A, $0B, $0C, $0D, $0E, $0F, $10
                defs    32, 0
```

**Hex style defaults:**

| Format | sjasmplus default | maxam default |
|--------|-------------------|---------------|
| `z80` | `$AB` ✅ | — |
| `cpc` | — | `#AB` ✅ |
| `intel` | `ABh` | `ABh` |
| `c` | `0xAB` | `0xAB` |
| `amp` | `&AB` | `&AB` |

Override with `--cleanout-hex` when needed.

**CPC RST 3-byte handling** (active when `--machine cpc` is set):

```asm
                rst     $18
                defw    TXT_OUTPUT
```

**Custom `--opcode` expansion** (active when `--machine cpc` is NOT set):

```asm
                rst     $CF
                defb    $80
```

**Label name validation:** if a label name collides with an assembler reserved word, the disassembler exits with a hard error and a rename suggestion.

**ZX Next opcodes on maxam target:** hard error — maxam does not support ZX Next extensions.

---

## 10. Output: Skeleton Symbol File (`--symbolsout`)

```
--symbolsout <file>
```

After disassembly, writes a skeleton `--symbols` file containing all named labels discovered during analysis. This is intended as a starting point: review it, rename labels, fill in the documentation fields, and then use it as `--symbols` input on future runs.

**Format:**

```
; Auto-generated by z80dismblr --symbolsout
; Review and complete, then use as --symbols input.

; summary: —
; action: —
; entry: —
; exit-success: —
; exit-failure: —
0000 SUB001

; summary: —
; action: —
; entry: —
; exit-success: —
; exit-failure: —
0010 SUB002
```

**Properties:**

- Subroutine entries (code labels, RST targets) receive empty structured-field placeholders
- Data labels are emitted as plain address + name lines with no placeholders
- Jump-target labels (`LBL`-prefix) are included without placeholders
- Nameless addresses are omitted
- Entries are sorted by address ascending
- No prose, no statistics, no auto-generated comments

**I/O port section (appended when I/O instructions were found):**

If the disassembly contains any `IN r,(C)` / `OUT (C),r` instructions with statically-known BC values, a `; --- discovered I/O ports ---` section is appended:

```
; --- discovered I/O ports ---
port:FB7E   FDC_STATUS
port:7F??   GATE_ARRAY
; port:1234   PORT_1234   ; accessed but unnamed — add a label and uncomment
```

- **Named ports** (declared in `--symbols`, matched during the run) are emitted as active `port:XXXX NAME` lines. Wildcard specs (`?`) are preserved.
- **Unnamed ports** (BC fully known, no matching label) appear as commented-out stubs with a placeholder name. Rename the placeholder and uncomment to add the port to your `--symbols` file.
- Ports where BC was unknown at the I/O site are omitted (nothing useful to report).

See [section 15 — CPC Mode (`--machine cpc`)](#15-cpc-mode---machine-cpc) for the `port:XXXX NAME` symbols-file syntax.

---

## 11. Output: Args File (`--argsout`)

```
--argsout <file>
```

After disassembly, writes a merged args file combining all the options used in the current run with any data ranges that were auto-discovered (e.g. FAR CALL pointer tables in CPC mode). The resulting file can be fed directly back as `--args` input on the next run.

**Example output:**

```
# Auto-generated by z80dismblr --argsout
# Review before re-using as --args input

# --- input args ---
--bin 0x0000 cpc464_os.bin
--machine cpc
--symbols cpc_bios.sym
--out cpc464.asm

# --- auto-discovered dataranges ---
--datarange 0xBF9C 3
--datarange 0xBFA0 3
--datarange 0xBFA3 3
```

---

## 12. Output: Call Graph (`--callgraphout`)

```
--callgraphout <file>
--callgraphnode <address|label>
--callgraphnodeformat <formatstring>
--callgraphformat <formatstring>
--callgraphhighlight <address|label>[=color]
```

Writes a Graphviz dot file representing the call graph. Open with `dot`, `xdot`, or any Graphviz viewer.

**Basic usage:**

```bash
--callgraphout callgraph.dot
```

**Restrict to a subtree** (one file per node):

```bash
--callgraphnode GAME_INIT
--callgraphnode 0xBB5A
```

**Custom node label** — supports variables `${label}`, `${address}`, `${CC}`, `${size}`, `${instructions}` and newline escapes `\n`, `\l`, `\r`:

```bash
--callgraphnodeformat "${label}\n${address}\nCC=${CC}"
```

**Highlight nodes:**

```bash
--callgraphhighlight GAME_INIT=red
--callgraphhighlight TXT_OUTPUT          # default: yellow
```

**Additional dot directives:**

```bash
--callgraphformat "rankdir=LR;"
```

**Render to PNG:**

```bash
dot -Tpng callgraph.dot -o callgraph.png
```

---

## 13. Output: Flow Chart (`--flowchartout`)

```
--flowchartout <file>
--flowchartaddresses <addr1> [addr2] ...
```

Writes a Graphviz dot file showing the internal control flow of one or more subroutines. One file is produced per address.

```bash
--flowchartout flowchart.dot
--flowchartaddresses 0xC000 0xC050
```

Produces `flowchart_C000.dot` and `flowchart_C050.dot`.

---

## 14. Label Naming

### 14.1 Auto-generated Names

When no user-supplied name is available, the disassembler assigns names using type-based prefixes and sequential numbering:

| Label type | Default pattern | Example |
|------------|----------------|---------|
| Subroutine (CALL target) | `SUBnnn` | `SUB001`, `SUB042` |
| Jump target (JP/JR target) | `LBLnnn` | `LBL001`, `LBL007` |
| RST target | `RSTxx` | `RST38` |
| Data area | `DATAnnn` | `DATA001`, `DATA012` |
| Self-modifying code | `SELF_MODnnn` | `SELF_MOD001` |
| Local label (forward JR) | `.SUBnnn_lN` | `.SUB001_l1` |
| Local loop (backward JR) | `.SUBnnn_loopN` | `.SUB001_loop1` |

Numeric suffixes are zero-padded to a minimum of **three digits** and widen automatically when the count exceeds 999 (`SUB1000`, etc.). This keeps labels sorted lexicographically in editors such as VS Code's Go to Symbol panel.

### 14.2 Customising Prefixes

All prefixes are configurable via command-line flags (or `--args` file):

```
--subprefix   SUB        Subroutine prefix (default: SUB)
--lblprefix   LBL        Jump-target prefix (default: LBL)
--rstprefix   RST        RST-target prefix (default: RST)
--datalblprefix DATA     Data label prefix (default: DATA)
--selfmodprefix SELF_MOD Self-modifying code prefix (default: SELF_MOD)
--locallblprefix _l      Local forward-jump suffix (default: _l)
--localloopprefix _loop  Local backward-jump suffix (default: _loop)
```

Example — use CPC firmware naming conventions:

```
--subprefix BSUB
--datalblprefix BDATA
```

### 14.3 User-renamed Labels

To rename a label, simply change its name wherever it appears in the `--out` file (the label definition line and all call/reference sites). On the next run, the disassembler recognises that the name does not match any auto-generated pattern and locks it in as a *fixed* label (`isFixed = true`). Fixed labels are never overwritten by auto-numbering.

A name is treated as **auto-generated** (and therefore not preserved) if it matches any of:

- `SUBnnn`, `LBLnnn`, `DATAnnn`, `SELF_MODnnn` (prefix + digits only)
- `RSTxx` (prefix + exactly two hex digits)
- Any name starting with `.` (local label)

Any other name — including names with mixed case, underscores, or custom prefixes — is treated as user-supplied and preserved.

---

## 15. CPC Mode (`--machine cpc`)

```
--machine cpc
```

Activates Amstrad CPC firmware RST dispatch decoding. In CPC mode the eight RST opcodes are interpreted as firmware calling convention entries rather than plain `RST n` instructions.

`--machine <name>` is the general target-machine selector. The only accepted value today is `cpc`; future Z80 targets (other firmware ROMs with machine-specific RST conventions or calling patterns) will be added under the same flag.

| RST | Opcode | Name | Operand bytes | Control flow |
|-----|--------|------|---------------|-------------|
| `RST 00h` | `C7` | RESET | 0 | Terminates (no fall-through) |
| `RST 08h` | `CF` | LOW JUMP | 2 (word) | Jumps within 16 KB page |
| `RST 10h` | `D7` | SIDE CALL | 2 (word) | Calls into an alternative ROM slot |
| `RST 18h` | `DF` | FAR CALL | 2 (word = pointer to 3-byte record) | Calls firmware entry; pointer area marked as data |
| `RST 20h` | `E7` | RAM LAM | 0 | Fall-through; HL is runtime operand |
| `RST 28h` | `EF` | FIRM JUMP | 2 (word) | Jumps to firmware address |
| `RST 30h` | `F7` | USER RESTART | 0 | Call with fall-through |
| `RST 38h` | `FF` | INTERRUPT | 0 | Interrupt handler |

**FAR CALL pointer records** (3 bytes at the pointer address):

```
Byte 0:  low address byte of target
Byte 1:  high address byte of target
Byte 2:  ROM select / state byte (0–251 = ROM N, 252–255 = ROM flags)
```

These pointer records are automatically marked as data ranges and included in `--argsout` output.

In the annotated listing, CPC RST calls appear with their decoded operand:

```
0000 DF           RST  18h   ; FAR CALL → TXT_OUTPUT
0001 9C BF        DEFW BF9Ch ; pointer record
```

**`--machine cpc` and `--opcode` are mutually exclusive.** When `--machine cpc` is active, any `--opcode` extensions are ignored.

---

## 16. Custom Opcode Extensions (`--opcode`)

```
--opcode <byte> <appendtext>
```

Extends a single opcode byte with additional inline operand data. This is useful for platforms that embed a data byte or word immediately after an RST opcode as a calling convention (common on platforms other than the CPC).

| Marker in `appendtext` | Meaning |
|------------------------|---------|
| `#n` | One byte following the opcode (substituted as hex) |
| `#nn` | 16-bit word following the opcode (substituted as hex) |

**Example — RST 08h followed by one data byte:**

```
--opcode 0xCF ", FUNC=#n"
```

Decodes the sequence `CF 42` as:

```
0050 CF 42        RST  08h, FUNC=42h
```

In `--cleanout` output (when `--machine cpc` is not active), the extension is split back into the base instruction and a trailing `defb`:

```asm
                rst     $08
                defb    $42
```

**Cannot be combined with `--machine cpc`.** When `--machine cpc` is active, RST opcodes are handled by the CPC dispatch table and `--opcode` entries are ignored.

---

## 17. All Command-line Options

### Input

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--bin` | `<address> <file>` | Load binary file at given origin address (repeatable) |
| `--sna` | `<file>` | Load ZX Spectrum 48K snapshot |
| `--tr` | `<file>` | Load MAME trace file for additional entry points (repeatable) |
| `--args` | `<file>` | Read options from file (nestable, repeatable) |

### Code Entry Points

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--codelabel` | `<address> [name]` | Seed a code entry point with optional label name (repeatable) |
| `--noautomaticaddr` | — | Suppress auto-seeding of address 0x0000 or SNA entry point |
| `--rstend` | `<address>` | Stop following RST at this address (repeatable) |
| `--clrlabels` | — | Clear all collected labels (for re-seeding) |

### Data Annotation

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--datarange` | `<address> <length>` | Mark address range as data, not code (repeatable) |
| `--jmptable` | `<address> <size>` | Declare jump table; size = number of pointer entries (repeatable) |

### Symbol Files

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--symbols` | `<file>` | Load symbol definitions (labels, structured fields, register overrides) |
| `--symbolsout` | `<file>` | Write skeleton symbol file after disassembly |

### Output: Annotated Listing

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--out` | `<file>` | Write annotated listing; auto-imported on next run if it exists |

### Output: Clean Assembler Source

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--cleanout` | `<file>` | Write re-assembleable source file |
| `--cleanout-format` | `sjasmplus\|maxam` | Target assembler dialect (default: `sjasmplus`) |
| `--cleanout-hex` | `z80\|cpc\|intel\|c\|amp` | Hex literal style override |

### Output: Discovery Files

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--argsout` | `<file>` | Write merged args file with discovered data ranges |

### Output: Graphs

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--callgraphout` | `<file>` | Write Graphviz call graph dot file |
| `--callgraphnode` | `<address\|label>` | Restrict graph to this subtree; one file per node (repeatable) |
| `--callgraphnodeformat` | `<format>` | Node label template; supports `${label}`, `${address}`, `${CC}`, `${size}`, `${instructions}` |
| `--callgraphformat` | `<format>` | Additional dot directives (e.g. `rankdir=LR;`) |
| `--callgraphhighlight` | `<address\|label>[=color]` | Highlight node; default color is yellow (repeatable) |
| `--flowchartout` | `<file>` | Write Graphviz flow chart dot file |
| `--flowchartaddresses` | `<addr> ...` | Subroutine addresses to chart (repeatable) |

### Label Prefix Customisation

| Option | Default | Description |
|--------|---------|-------------|
| `--subprefix` | `SUB` | Subroutine label prefix |
| `--lblprefix` | `LBL` | Jump-target label prefix |
| `--rstprefix` | `RST` | RST-target label prefix |
| `--datalblprefix` | `DATA` | Data label prefix |
| `--selfmodprefix` | `SELF_MOD` | Self-modifying code label prefix |
| `--locallblprefix` | `_l` | Local forward-jump label suffix |
| `--localloopprefix` | `_loop` | Local backward-jump (loop) label suffix |

### Listing Format

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--clmnsaddress` | `<n>` | Address column width; `0` suppresses address output |
| `--clmnsbytes` | `<n>` | Opcode bytes column width |
| `--clmnsopcodefirst` | `<n>` | First mnemonic token column width |
| `--clmnsopcodetotal` | `<n>` | Full opcode + operand column width |
| `--uppercase` | — | Uppercase opcode mnemonics (default: lowercase) |
| `--addbytes` | — | Include opcode byte values in the listing |
| `--hexformat` | `intel\|intel0\|cpc\|z80\|c` | Hex literal style for the annotated listing (default: `intel` → `1234h`) |

### Platform / Extension

| Option | Arguments | Description |
|--------|-----------|-------------|
| `--machine` | `<name>` | Select target-machine profile. Currently supported: `cpc` (Amstrad CPC RST dispatch decoding) |
| `--opcode` | `<byte> <appendtext>` | Define custom opcode extension (repeatable; ignored when `--machine cpc` is active) |

### Information

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Print help text |
| `--version`, `-v` | Print version number |

---

## 18. Typical Workflows by Use Case

### Basic Z80 ROM Disassembly

```bash
# First pass
node out/z80dismblr.js \
  --bin 0x0000 game_rom.bin \
  --out game.asm

# Edit game.asm: rename labels, add notes

# Second pass — edits are preserved automatically
node out/z80dismblr.js \
  --bin 0x0000 game_rom.bin \
  --out game.asm
```

### Multi-segment Binary with Known Entry Points

```bash
node out/z80dismblr.js \
  --bin 0x0000 rom_bank0.bin \
  --bin 0x4000 rom_bank1.bin \
  --noautomaticaddr \
  --codelabel 0x0000 ENTRY \
  --codelabel 0x0038 INT_HANDLER \
  --codelabel 0x0066 NMI_HANDLER \
  --out disasm.asm
```

### Amstrad CPC Firmware ROM

```bash
# Put options in an args file for clarity
cat > cpc.args << 'EOF'
--bin 0x0000 cpc464_os.rom
--machine cpc
--symbols cpc_bios.sym
--noautomaticaddr
--codelabel 0xBB00 KL_INIT
--out cpc464.asm
--cleanout cpc464.s
--cleanout-format sjasmplus
--argsout cpc464.args
EOF

node out/z80dismblr.js --args cpc.args
```

### Encrypted Vortex Disk-Controller ROM (CPC)

Typical layout:
```
project/
├── project.args            # all CLI options live here
├── firmware.sym            # curated labels and documentation
├── rom/
│   └── vortex_os.rom       # original encrypted ROM
└── output/
    ├── vortex_os.asm       # iterative annotation workspace
    └── vortex_os.s         # clean re-assembleable output
```

**`project.args`:**
```
# Vortex disk-controller ROM
--bin 0x0000 rom/vortex_os.rom
--machine cpc
--decoder vortex
--noautomaticaddr
--codelabel 0x0000
--symbols firmware.sym
--out output/vortex_os.asm
--addbytes
--hexformat cpc
--cleanout output/vortex_os.s
--cleanout-format sjasmplus
--argsout firmware_discovered.args
--symbolsout firmware_discovered.sym
```

**Run command (identical on every pass):**
```bash
node /path/to/z80dismblr/out/z80dismblr.js --args project.args
```

**What `--decoder vortex` does:** operand and data bytes are passed through the Vortex XOR decoder (based on address bits A2/A4); M1 opcode-fetch bytes are read raw. The output `.asm` and `.s` are in cleartext and will NOT reproduce the original encrypted binary byte-for-byte.

**What `--machine cpc` adds:** RST opcodes are decoded as CPC firmware calls (1-byte or 3-byte variants). FAR CALL pointer records are automatically marked as data ranges and added to `--argsout`.

### Iterative Documentation with symbolsout

```bash
# Step 1: disassemble and generate a skeleton symbol file
node out/z80dismblr.js \
  --bin 0x0000 rom.bin \
  --out rom.asm \
  --symbolsout rom_skeleton.sym

# Step 2: review and edit rom_skeleton.sym — fill in names and fields

# Step 3: re-run using your edited symbols file
node out/z80dismblr.js \
  --bin 0x0000 rom.bin \
  --symbols rom_skeleton.sym \
  --out rom.asm
```

### Verify Clean Output Re-assembles to Original

```bash
# Disassemble and emit clean source
node out/z80dismblr.js \
  --bin 0x0000 rom.bin \
  --out rom.asm \
  --cleanout rom.s \
  --cleanout-format sjasmplus

# Reassemble
sjasmplus rom.s --raw rom_rebuilt.bin

# Compare
cmp rom.bin rom_rebuilt.bin && echo "Byte-identical ✓" || echo "Mismatch ✗"
```

### ZX Spectrum Snapshot

```bash
node out/z80dismblr.js \
  --sna game.sna \
  --out game.asm \
  --uppercase \
  --addbytes
```

### Call Graph for a Subsystem

```bash
node out/z80dismblr.js \
  --bin 0x0000 rom.bin \
  --symbols rom.sym \
  --out rom.asm \
  --callgraphout callgraph.dot \
  --callgraphnode GAME_INIT \
  --callgraphnodeformat "${label}\n${address}" \
  --callgraphhighlight GAME_INIT=green

# Render
dot -Tpng callgraph_GAME_INIT.dot -o callgraph.png
```

---

## 19. AI-Assisted Reverse Engineering

When working with an AI assistant (e.g. Claude Code in VS Code), the most
effective setup is:

1. **All options in `project.args`** — the AI runs the disassembler with a
   single command and the output is always consistent.

2. **`research/` folder for context** — place hardware specifications, ROM
   maps, schematic references, and any other documentation the AI needs to
   understand the target in a `research/` subdirectory of your project.

3. **A session guide** — a document (e.g. `research/ai_guide.md`) that tells
   the AI exactly where files are, how to run the disassembler, and what
   conventions to follow for annotations.

A ready-to-use template for this guide is provided at:

```
documentation/ai_reverse_engineering_guide.md
```

Copy it to your project's `research/` directory and fill in the placeholders
(`<ROM_FILE>`, `<BASE_ADDRESS>`, `<ROM_NAME>`, etc.) for your specific ROM.
The document covers:

- Project directory structure
- The single command to run the disassembler
- How to read the `.asm` output (address column, byte column, banners)
- How to annotate (label rename, `;;` comments, structured fields)
- How to declare known I/O ports and data ranges
- A workflow guide for Claude Code sessions
- Common pitfalls and their fixes
- A quick-reference annotation cheat sheet
