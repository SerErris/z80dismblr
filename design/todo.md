# z80dismblr — Future Work

Quick-reference list of planned features and the detailed notes below.
Each item links to the relevant design document section for full context.

---

## Summary

| # | Topic | Design ref | Priority |
|---|-------|------------|----------|
| 1 | [Round-trip comments (Stream A)](#1-round-trip-comments-stream-a) | `iterative_workflow.md §7.1` | High |
| 2 | [Clean assembler output (Stream B)](#2-clean-assembler-output-stream-b) | `iterative_workflow.md §7.2` | Medium |
| 3 | [I/O port label handling](#3-io-port-label-handling) | `iterative_workflow.md §3.7.2` | Low |

---

## 1. Round-trip comments (Stream A)

**Design reference:** `iterative_workflow.md §7.1` (phases A1–A10)

### What it is

The main `.asm` output file becomes the single workspace for all user
annotations. Instead of maintaining a separate `--symbols` file for
in-ROM documentation, the user edits the disassembly listing directly
in a text editor (e.g. VS Code) and re-runs the disassembler. The
tool re-reads the existing `.asm`, extracts user content, and overwrites
the file with a freshly-analysed disassembly that carries all preserved
annotations.

The re-run command is always the same — no extra flags required:

```
$ z80dismblr --bin rom.bin --symbols cpc_bios.sym --out rom.asm
```

On the first run `rom.asm` does not exist; it is created fresh.
On every subsequent run the existing `rom.asm` is auto-imported before
overwriting.

### What the user can edit and have preserved

| Region in `.asm` | Preserved on re-run |
|-----------------|---------------------|
| Lines above the first banner | ✅ verbatim (free user notes) |
| `Summary:`, `Action:`, `Entry:`, `Exit (success/failure):` | ✅ when not `—` |
| Free-form `;` lines between closing banner and label | ✅ as `linesBefore` for that address |
| Free-form `;` lines between two instructions | ✅ as `linesBefore` for next instruction |
| Label renaming (e.g. `KM_EXP_BUFFER:` → stays) | ✅ `isFixed = true` |
| Instruction inline user note (`;;` marker) | ✅ everything after `;;` |
| `Corrupted:` / `Preserved:` auto-analysis lines | ❌ always regenerated from analyser |

### Key design decisions already made

- **`—` sentinel** — field value `—` means "not yet documented". Any other
  value is user data and is preserved.
- **`;;` marker for inline instruction comments** — text after `;;` on an
  instruction line is user-owned; text before `;;` is auto-generated.
  Example: `LD HL,(DATA146)  ; 8FEDh  ;; load state pointer`.
- **Auto-import of `--out` file** — if `--out foo.asm` exists on disk,
  it is automatically fed through the round-trip parser before analysis.
  Use `--fresh` to suppress this and start clean.
- **`--fresh` flag** — suppresses the `--out` auto-import only.
  `--symbols` files are always loaded regardless.
- **Orphaned annotations** — if a user-annotated address no longer exists
  in the disassembly (e.g. memory range removed), the annotation is
  preserved at the top of the file rather than silently dropped.
- **Idempotence** — `disassemble → emit → re-disassemble → emit` must
  produce byte-identical output. A dedicated test harness (phase A7)
  enforces this.

### Implementation phases (from `iterative_workflow.md §7.1`)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| A1 | Line classifier — event stream from `.asm` file | ⬜ |
| A2 | Classifier skips instruction/data lines | ⬜ |
| A3 | Classifier recognises and discards banner blocks on re-read | ⬜ |
| A4 | Structured fields extracted from banners → `addressStructured` | ⬜ |
| A5 | Label renaming detection → `isFixed` | ⬜ |
| A6 | Free-form pre-label and pre-instruction comments captured | ⬜ |
| A7 | Idempotence test harness | ⬜ |
| A8 | Orphaned annotation handling | ⬜ |
| A9 | `;;` inline comment: `addressInlineComments` map + emitter | ⬜ |
| A10 | `writeSymbolsOut`: strip prose, skip nameless, add placeholders | ⬜ |

### Notes for resuming

- Start with **A1** (line classifier) — it is purely additive and requires
  no behaviour change. Getting the event stream right first makes A2–A6
  straightforward.
- **A7 (idempotence harness)** should be written before A8/A9 so that
  any subtle drift in those phases is caught immediately.
- The parser refactor in `setAddressComments()` (described in
  `iterative_workflow.md §4.1`) proposes splitting the existing state
  machine into a two-stage classifier/consumer. This is the right
  approach — do not extend the existing state machine further.
- `--fresh` and the auto-import rule are pure CLI-layer additions
  (`z80dismblr.ts`); they require no change to the core disassembler.

---

## 2. Clean assembler output (Stream B)

**Design reference:** `iterative_workflow.md §7.2` (phases B1–B6)

### What it is

A separate `--cleanout` emitter that produces an assembleable source
file stripped of all commentary. The output can be fed directly into
`sjasmplus` or `maxam` and should reproduce the original binary
byte-for-byte.

```
$ z80dismblr --bin rom.bin --out rom.asm \
             --cleanout rom.s --cleanout-format sjasmplus
```

### What the clean output contains

- `org` / `ORG` directives for each contiguous memory range
- Labels on their own lines (including user-renamed labels)
- Instructions indented, one per line
- Data grouped into multi-byte `defb`/`defw` lines (not one byte per line)
- `defs` for zero-fill runs of 16+ bytes
- **No** banners, statistics, caller/callee lists, inline hex comments,
  address prefixes, or auto-generated prose

### Key design decisions already made

| Aspect | Decision |
|--------|----------|
| sjasmplus default hex | `$AB` (z80 style) |
| maxam default hex | `#AB` (CPC firmware-manual style) |
| `--cpc` flag effect | None on clean output — RST handling only |
| `--cleanout-hex` override | `z80`, `cpc`, `intel`, `c`, `amp` |
| Local labels | `.sub_loop1` style — same as verbose output; works on both assemblers |
| `ORG` on gaps | One `org` per contiguous assigned range |
| Digit separators | Not emitted |

### Implementation phases (from `iterative_workflow.md §7.2`)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| B1 | `--cleanout` / `--cleanout-format` / `--cleanout-hex` CLI options | ⬜ |
| B2 | `CleanEmitter` class — sjasmplus dialect | ⬜ |
| B3 | Data grouping (`defb` multi-byte, `defs` for runs) | ⬜ |
| B4 | CI golden-file regression tests (`cleanout.golden.test.ts`) | ⬜ |
| B5 | Maxam dialect | ⬜ |
| B6 | Manual smoke test procedure (emit → assemble → byte-compare) | ⬜ |

### Notes for resuming

- **B2 (`CleanEmitter`)** is the main chunk of work. Model it as a
  separate class that implements the same interface as the existing
  verbose emitter in `disassembleMemory()`, but with a format-selector
  injected at construction time.
- **B3 (data grouping)** requires walking consecutive `DATA` attribute
  bytes and coalescing them — similar logic to the existing `DEFB`
  per-byte emitter but grouped. The threshold for switching from
  `defb` to `defs` is 16 zero bytes.
- **B4 (CI tests)** should be done before B5 so that the sjasmplus
  golden files are locked in and the maxam dialect can be validated
  against a known-good reference.
- The `Format.formatHex()` function already handles all required hex
  styles — no new formatting code is needed, just pass the right
  `HexFormat` constant.
- Keep the `CleanEmitter` in a new file (`cleanEmitter.ts`) rather than
  extending `disasm.ts` further.

---

## 3. I/O port label handling

**Design reference:** `iterative_workflow.md §3.7.2`

### What it is

The Z80 I/O address space (`IN A,(n)` / `OUT (n),A`) is completely
separate from the memory address space — port `#FE` is not the same
thing as memory address `#00FE`. The `--symbols` file needs a way to
define named labels for port addresses, and the disassembler needs to
substitute those names when formatting `IN`/`OUT` instructions.

Currently: `IN A,(#FE)` → `IN A,(#FE)` (no label substitution)
After this feature: `IN A,(#FE)` → `IN A,(KEYBOARD_ROW)` (with symbol)

The `PORT_LBL` type already exists in `numbertype.ts` and the opcode
decoder already sets it on `IN`/`OUT` instructions. However, the label
creation step in `disasm.ts` is unimplemented (an explicit `TODO` in the
existing code).

### Symbols file syntax

Port addresses use a `port:` prefix to distinguish them from memory
addresses:

```
port:FE  KEYBOARD_ROW
port:7F  GATE_ARRAY
port:F4  PSG_READ
port:F5  PSG_WRITE_ADDR
port:F6  PSG_WRITE_DATA
```

### Required code changes

1. **Separate port label map** — add `portLabels: Map<number, DisLabel>`
   to `Disassembler` alongside `labels: Map<number, DisLabel>`. Port
   addresses are 8-bit (0–255 for direct `IN`/`OUT`).

2. **`--symbols` file parser** — recognise the `port:XX` address prefix
   in `setAddressComments()` and insert into `portLabels` rather than
   `labels`.

3. **Label creation during analysis** — in `setFoundLabel()` / the
   `disassembleForLabel()` path, when `opcode.valueType === PORT_LBL`,
   insert the decoded port number into `portLabels` rather than `labels`.

4. **Opcode formatter** — when formatting `IN A,(n)` or `OUT (n),A`,
   look up `portLabels.get(n)` and substitute the label name if found.

5. **`--symbolsout`** — include a `; --- discovered I/O ports ---`
   section in the skeleton output, with `port:XX` prefixed entries for
   any ports the disassembler encountered during analysis.

### Scope note

`IN r,(C)` and `OUT (C),r` use a 16-bit port address held in the `BC`
register — this is only known at runtime and cannot be labelled
statically. These instructions are out of scope for this feature.

### Notes for resuming

- The `TODO` in `opcode.ts` line ~347 and the comment in `numbertype.ts`
  about "Is another space" are the starting points.
- The 8-bit port value is already decoded correctly into `opcode.value`
  (the `PORT_LBL` case in `getOpcodeAt` reads one byte). The only
  missing piece is what happens with that value afterwards.
- The existing label map (`labels`) uses 16-bit addresses as keys.
  The new `portLabels` map uses 8-bit keys (0–255). Keep them strictly
  separate to avoid collisions.
- This feature is self-contained — it does not depend on Stream A or
  Stream B and can be implemented independently.
