# Using Claude Code with z80dismblr — Reverse-Engineering Guide

This document is a template for AI-assisted Z80 ROM reverse engineering using
z80dismblr. Drop a copy into the `research/` folder of your project, fill in
the placeholders, and use it as context for Claude Code sessions.

---

## Project Layout

```
<PROJECT_ROOT>/
├── project.args                # All CLI options — this is the one command to run
├── <ROM_NAME>.sym              # Curated labels and documentation fields
├── rom/
│   └── <ROM_FILE>.bin          # Original ROM binary (read-only)
├── output/
│   ├── <ROM_NAME>.asm          # Iterative annotation workspace (auto-updated)
│   └── <ROM_NAME>.s            # Clean re-assembleable output
├── research/                   # Reference documents, hardware specs, traces
│   └── this_guide.md
└── bin/                        # Helper scripts (optional)
```

---

## How to Run the Disassembler

**Always run via the args file:**

```bash
node /path/to/z80dismblr/out/z80dismblr.js --args project.args
```

Every option is in `project.args`. The command does not change between runs.

**What happens on each run:**
1. The binary is loaded from `rom/`.
2. If `output/<ROM_NAME>.asm` already exists, all annotations in it are extracted.
3. Fresh analysis is performed (CFG walk, register analysis, cross-references).
4. The `.asm` file is overwritten with fresh analysis + extracted annotations merged in.

---

## Template `project.args`

Copy this, uncomment the relevant machine flags, and fill in placeholders:

```
# ── Binary input ──────────────────────────────────────────────────────────
--bin <BASE_ADDRESS> rom/<ROM_FILE>.bin

# ── Entry points ──────────────────────────────────────────────────────────
--noautomaticaddr          # suppress automatic 0x0000 entry (needed for ROMs not at 0)
--codelabel <BASE_ADDRESS> # add more --codelabel lines as you discover entry points

# ── Machine profile ───────────────────────────────────────────────────────
# Uncomment for Amstrad CPC ROMs:
# --machine cpc

# Uncomment for Vortex encrypted disk-controller ROMs:
# --decoder vortex

# ── Labels and documentation ──────────────────────────────────────────────
--symbols <ROM_NAME>.sym

# ── Output ────────────────────────────────────────────────────────────────
--out output/<ROM_NAME>.asm
--addbytes                  # show raw hex bytes next to each instruction
--hexformat cpc             # use #XXXX style (matches CPC hardware documentation)

# ── Clean output for reassembly ───────────────────────────────────────────
--cleanout output/<ROM_NAME>.s
--cleanout-format sjasmplus

# ── Discovery outputs (review after each run, fold into args/sym) ─────────
--argsout <ROM_NAME>_discovered.args
--symbolsout <ROM_NAME>_discovered.sym
```

---

## Vortex VDOS ROM — Specific Settings

This section is pre-filled for the Vortex disk-controller ROM reverse-engineering
project. The project lives at `~/reverse_eng/vortex/`.

**`project.args` for this project:**
```
--bin 0x0000 rom/vortex_os.rom
--machine cpc
--decoder vortex
--noautomaticaddr
--codelabel 0x0000
--symbols vortex.sym
--out output/vortex_os.asm
--addbytes
--hexformat cpc
--cleanout output/vortex_os.s
--cleanout-format sjasmplus
--argsout vortex_discovered.args
--symbolsout vortex_discovered.sym
```

**Run from `~/reverse_eng/vortex/`:**
```bash
node ~/z80dismblr/out/z80dismblr.js --args project.args
```

---

## Understanding the Output Files

### `output/<ROM_NAME>.asm` — The annotation workspace

This is the central file. Claude Code and the user both read and edit it.

**Structure of a subroutine block:**
```
; *** sub SUB001 **************************************************************
; Address:     0C00h
; Size:        42 instructions (71 bytes)
; Cyclomatic:  3
; Registers:   Corrupted: A, F   Preserved: BC, DE, HL, IX, IY
;
; Summary:   —
; Action:    —
; Entry:     —
; Exit (success): —
; Exit (failure): —
;
; Called by:  SUB005, SUB012
; Calls:      SUB003
; *******************************************************************************
0C00 SUB001:
0C00 3E 01         LD   A,#01           ; 01h, 1
0C02 CD 1A 0C      CALL SUB003          ; 0C1Ah
```

**Reading the address column:** The leftmost field (e.g. `0C00`) is the hex address. This is how you navigate — every line maps to an exact ROM offset.

**Reading the byte column:** With `--addbytes`, the hex bytes of each instruction appear between the address and the mnemonic (e.g. `3E 01` for `LD A,#01`). Use these to:
- Verify against a hex dump of the original ROM
- Cross-reference with hardware documentation that lists opcodes in hex
- Identify padding bytes or unusual encodings

**The `—` sentinel:** Any field showing `—` (em-dash) has not been documented yet. This is the value to replace with your analysis.

### `output/<ROM_NAME>.s` — Clean re-assembleable output

This is suitable for feeding to `sjasmplus`. It contains no banners, comments, or addresses — only `ORG` directives, labels, instructions, and `defb`/`defw`/`defs` data. Useful for verifying that the disassembly is complete and consistent.

### `<ROM_NAME>_discovered.sym` — Label primer

Generated on every run. Contains all labels found during this run. Useful for:
- Copying newly discovered subroutine names into `<ROM_NAME>.sym`
- Identifying I/O port accesses via the `; --- discovered I/O ports ---` section

### `<ROM_NAME>_discovered.args` — Data range primer

Contains auto-discovered `--datarange` entries (e.g. FAR CALL pointer tables). Review and add them to `project.args` on the next run.

---

## How to Annotate

### Renaming labels (in `output/<ROM_NAME>.asm`)

Simply change the label name everywhere it appears. On the next run, the new
name is locked in:

```asm
; Before:
0C00 SUB001:

; After (rename in-place):
0C00 INIT_DRIVE:
```

### Documenting a subroutine

Fill in the `—` placeholders in the banner:

```asm
; Summary:   Reset the FDC and motor state to a known idle condition
; Action:    OUT FDC_STATUS,#00 — deasserts drive select
;              Waits for FDC status register to clear
; Entry:     BC = FDC_STATUS port address
; Exit (success): A = 0, Flags = Z
; Exit (failure): —
```

The next run regenerates the banner but keeps your text, updating only the
computed fields (Size, CC, Registers, Called-by, Calls).

### Inline instruction notes

Add `;;` after the auto-comment on any instruction:

```asm
0C02 CD 1A 0C      CALL SUB003          ; 0C1Ah  ;; wait for FDC ready
```

Or suppress the auto-comment and replace it entirely:

```asm
0C02 CD 1A 0C      CALL SUB003          ;; wait for FDC ready
```

Both forms are preserved on re-run. The `;; text` part is yours; everything
before `;;` is regenerated.

### Block comments before a label

Any `;` lines placed immediately above a label are preserved verbatim:

```asm
; Called from the main init sequence only.
; Must be run before any disk access.
0C00 INIT_DRIVE:
```

---

## Workflow for Claude Code Sessions

### Starting a session

1. Read `output/<ROM_NAME>.asm` to understand current state.
2. Read `<ROM_NAME>.sym` for known labels and documentation.
3. Read any hardware reference documents in `research/`.

### Running the disassembler

```bash
node ~/z80dismblr/out/z80dismblr.js --args project.args
```

Run this whenever you want to regenerate the listing (e.g. after adding entries
to `project.args` or `<ROM_NAME>.sym`). The output file is overwritten but all
annotations are preserved.

### Adding a new entry point

When you identify a new subroutine address (e.g. from a trace, a jump target, or
hardware documentation), add it to `project.args`:

```
--codelabel 0x0C4A SEEK_TRACK
```

Then re-run. The new label propagates through the listing and call graphs.

### Declaring known I/O ports

Add `port:XXXX NAME` entries to `<ROM_NAME>.sym`:

```
port:FB7E   FDC_STATUS
port:FB7F   FDC_DATA
port:FA7E   FDC_MOTOR
port:7F??   GATE_ARRAY
port:BC??   CRTC_INDEX
```

After the next run, every `IN`/`OUT` instruction that uses these ports will show
an inline annotation: `; Port #FB7E (FDC_STATUS)`.

### Marking data regions

When you find bytes that should not be decoded as code (lookup tables, string
data, pointer arrays), add them to `project.args`:

```
--datarange 0x0E40 32    # jump table, 16 word-sized entries
```

Or let the disassembler find them automatically via `--argsout` and merge
the generated entries into `project.args`.

### Verifying a data structure

Use `output/<ROM_NAME>.asm` to read the raw bytes at a known offset. The
address column gives you the position; the byte column gives you the values.
Cross-reference against hardware documentation in `research/`.

---

## Common Pitfalls

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Large blocks of `DEFB` when you expect code | Entry point missing | Add `--codelabel` for the missing entry address |
| Bytes decoded as wrong instructions | Encrypted ROM, decoder not active | Check `--decoder vortex` is in `project.args` |
| Labels reset to `SUB001` after a rename | Label in wrong file (edits to `.asm` must be inside a banner, not above it) | Check that the renamed label is inside the `--out` file, between the banner and the first instruction |
| `—` in all documentation fields after a re-run | Fields were edited but the sentinel value `—` was left | Replace `—` with actual text |
| `port:` lines not producing annotations | `port:` declarations in wrong file or wrong format | They must be in the `--symbols` file as `port:XXXX NAME` with exactly 4 hex-or-`?` chars |

---

## Quick Reference — Annotation Cheat Sheet

```asm
; Summary:   One-line description
; Action:    What it does step-by-step.
;              Continuation lines indented two spaces.
; Entry:     Register/memory inputs
; Exit (success): State on success
; Exit (failure): State on failure
ADDR LABEL:
ADDR xx xx xx     MNEMONIC   operand    ; auto-comment  ;; your note
```

**Sentinel:** `—` = "not yet documented" (not preserved on re-run)

**Label rename:** change in-place in the `.asm` file; locked on next run

**Block comment:** `;` lines immediately above a label, preserved verbatim

**Inline note:** `;;` on an instruction line, everything after `;;` preserved

**Port declaration** (in `.sym` file): `port:7F??  GATE_ARRAY`

**Data range** (in `project.args`): `--datarange 0x0E40 32`

**New entry point** (in `project.args`): `--codelabel 0x0C4A SEEK_TRACK`
