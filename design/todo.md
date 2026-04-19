# z80dismblr — Future Work

Quick-reference list of planned features and the detailed notes below.
Each item links to the relevant design document section for full context.

---

## Summary

| # | Topic | Design ref | Priority |
|---|-------|------------|----------|
| 1 | [Round-trip comments (Stream A)](#1-round-trip-comments-stream-a) | `iterative_workflow.md §7.1` | High |
| 2 | [Clean assembler output (Stream B)](#2-clean-assembler-output-stream-b) | `iterative_workflow.md §7.2` | ~~Medium~~ **Done** |
| 3 | [I/O port label handling](#3-io-port-label-handling) | `iterative_workflow.md §3.7.2` | Low |
| 4 | [Data grouping — word detection (Level 2)](#4-data-grouping--word-detection-level-2) | `iterative_workflow.md §6.5` | Low |
| 5 | [Data grouping — string & struct detection (Level 3)](#5-data-grouping--string--struct-detection-level-3) | `iterative_workflow.md §6.5` | Low |

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
| EQU prologue | Emitted for every external (EQU) symbol, before any code |
| Invalid opcodes | Emitted as raw `defb $XX` bytes (coalesced into data groups) |
| Custom `--opcode` extensions | Split back into `instruction + defb` lines (skipped when `--cpc` is active) |
| CPC RST 3-byte opcodes | Emitted as `rst #XX` + `defw target` (active only when `--cpc` set) |
| `--cpc` and `--opcode` | Mutually exclusive — `--cpc` wins, `--opcode` extensions ignored |
| ZX Next opcodes on maxam | Hard error, no partial output written |
| Label name = reserved word | Hard error with rename hint |
| WARNING comments | Retained in clean output (greppable TODO markers) |
| File format | LF endings, UTF-8 no BOM, tab indent, lowercase instructions |
| Data grouping (v1) | Byte-only: 8-per-line `defb`, break at labels and code boundaries, `defs N` for zero runs ≥16 bytes |
| Word/string/struct detection | Deferred — see todos #4 and #5 |

### Implementation phases (from `iterative_workflow.md §7.2`)

| Phase | Deliverable | Status |
|-------|-------------|--------|
| B1 | `--cleanout` / `--cleanout-format` / `--cleanout-hex` CLI options | ✅ |
| B2 | `CleanEmitter` class — sjasmplus dialect, incl. EQU prologue + mnemonic table | ✅ |
| B2a | Invalid opcodes → raw `defb` bytes | ✅ |
| B2b | Custom `--opcode` extension expansion (instruction + trailing `defb`) — bypassed when `--cpc` is active | ✅ |
| B2c | Label name validation against per-dialect reserved words (hard error) | ✅ |
| B2d | CPC RST 3-byte expansion (rst + defw) — active only when `--cpc` set; mutually exclusive with B2b | ✅ |
| B3 | Data grouping (`defb` multi-byte, `defs` for runs) | ✅ |
| B4 | CI golden-file regression tests — includes SMC `label+offset` fixture | ✅ |
| B5 | Maxam dialect | ✅ |
| B5a | ZX Next detection for maxam → refuse emission with clear error | ✅ |
| B6 | Manual smoke test procedure (emit → assemble → byte-compare) | ✅ |

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

The Z80 I/O address space is completely separate from the memory address
space — port `#F4xx` and memory address `#F400` are different things.
The `--symbols` file needs a way to define named labels for I/O port
addresses, and the disassembler needs to substitute those names when
formatting `IN`/`OUT` instructions.

Currently: `IN A,(C)` → `IN A,(C)` (no label substitution)
After this feature: `IN A,(C)` with BC=`#F640` → `IN A,(KEYBOARD_ROW_0)`

The `PORT_LBL` type already exists in `numbertype.ts` and the opcode
decoder already sets it on `IN`/`OUT` instructions. However, the label
creation step in `disasm.ts` is unimplemented (explicit `TODO` in the
existing code, with a note "Port needs other handling. Is another space").

### CPC-specific: full 16-bit port addresses with partial decoding

The Amstrad CPC uses the **full 16-bit address bus** for I/O, unlike
many simpler Z80 systems that only use the low 8 bits. Hardware devices
respond based on **specific bits of the high byte** only — other bits
are ignored (partial address decoding). This means:

- Multiple devices can be selected **simultaneously** by setting bits
  to satisfy two devices' conditions at once.
- The canonical "official" port addresses (e.g. `#7Fxx`) specify the
  high byte; the low byte (`XX`) is typically a don't-care.
- Port addresses are **16-bit** (0–65535), not 8-bit.

### Two instruction forms: different labelling difficulty

**`IN r,(C)` / `OUT (C),r`** — port address = full BC register (16-bit).
**This is the primary CPC I/O form.** BC is placed on the full 16-bit
address bus; partial decoding on specific high-byte bits selects the
device(s). Typically a `LD BC,#xxxx` (or `LD B,#xx` + `LD C,#xx`)
immediately precedes the I/O instruction, making the 16-bit port address
statically traceable.

`OUT (C),C` is a notable variant: puts BC on the address bus for device
selection AND outputs the C register value as data. Used when the data
to write already lives in C. Addressing mechanism is identical to all
other `OUT (C),r` forms.

The language does not prevent a single instruction from satisfying
multiple devices' partial-decode conditions simultaneously — the hardware
will respond to all matching devices. This is intentional CPC design. The
disassembler should label by the single intended canonical port address.

**`IN A,(n)` / `OUT (n),A`** — Z80 puts **A** in the high byte and the
8-bit immediate **n** in the low byte. Effective port = `(A << 8) | n`.
Since A is program data at runtime, the **high byte (device selection)
is runtime-dependent**. Only `n` is known statically. Less common in
CPC code than the BC form.

`OUT (#7F),A` with A=`%01xxxxxx` is a special case: the same byte that
selects the Gate Array (b14=1, b15=0 in the high byte = A) IS the Gate
Array command. Hardware designed this way deliberately.

### CPC official port reference (from CPCWiki)

| Canonical port | Decode pattern | Device |
|---------------|----------------|--------|
| `#7FXX` | `%01xx xxxx xxxx xxxx` | Gate Array (write) |
| `#7FXX` | `%0xxx xxxx xxxx xxxx` | PAL 128K RAM banking (write) |
| `#BCXX` | `%x0xx xx00 xxxx xxxx` | CRTC index (write) |
| `#BDXX` | `%x0xx xx01 xxxx xxxx` | CRTC data out (write) |
| `#BEXX` | `%x0xx xx10 xxxx xxxx` | CRTC status (read) |
| `#BFXX` | `%x0xx xx11 xxxx xxxx` | CRTC data in (read) |
| `#DFXX` | `%xx0x xxxx xxxx xxxx` | Upper ROM bank number (write) |
| `#EFXX` | `%xxx0 xxxx xxxx xxxx` | Printer port (write) |
| `#F4XX` | `%xxxx 0x00 xxxx xxxx` | 8255 PPI Port A — PSG data |
| `#F5XX` | `%xxxx 0x01 xxxx xxxx` | 8255 PPI Port B — Vsync/Tape |
| `#F6XX` | `%xxxx 0x10 xxxx xxxx` | 8255 PPI Port C — keyboard/PSG ctrl |
| `#F7XX` | `%xxxx 0x11 xxxx xxxx` | 8255 PPI control register |
| `#F8FF` | exact | Peripheral soft reset |
| `#FA7E` | `%xxxx x0x0 0xxx xxxx` | Floppy motor control |
| `#FB7E` | `%xxxx x0x1 0xxx xxx0` | FDC status register (read) |
| `#FB7F` | `%xxxx x0x1 0xxx xxx1` | FDC data register (R/W) |

### Symbols file syntax (proposed)

Use a `port:` prefix with a **4-digit hex 16-bit address**:

```
port:7F00  GATE_ARRAY           ; canonical high byte #7F, low byte #00
port:BC00  CRTC_INDEX
port:F640  KEYBOARD_ROW_0       ; PPI Port C, reading keyboard row 0
port:F641  KEYBOARD_ROW_1
port:F4FF  PPI_PORT_A_READ
port:F7FF  PPI_CONTROL
```

For `IN r,(C)` with a constant BC, the full 16-bit address is used
directly. For `IN A,(n)`, only the low byte `n` is known statically;
the full address and device cannot be determined without runtime data.

### Required code changes

1. **Separate 16-bit port label map** — add
   `portLabels: Map<number, DisLabel>` to `Disassembler` alongside
   `labels: Map<number, DisLabel>`. Keyed by full 16-bit address.

2. **`--symbols` file parser** — recognise the `port:XXXX` (4-digit)
   address prefix in `setAddressComments()` and insert into `portLabels`
   rather than `labels`.

3. **Label creation during analysis** — for `IN r,(C)` / `OUT (C),r`
   where BC is a statically known constant, decode the full 16-bit
   address and insert into `portLabels`. For `IN A,(n)` / `OUT (n),A`,
   the 8-bit `n` is already in `opcode.value` — insert a partial entry.

4. **Opcode formatter** — look up `portLabels` when formatting an
   `IN`/`OUT` instruction. Exact 16-bit match → substitute label. Partial
   8-bit `n` match → annotate with label and "(high byte = A at runtime)".

5. **`--symbolsout`** — include a
   `; --- discovered I/O ports ---` section with `port:XXXX` entries.

### Notes for resuming

- The `TODO` in `opcode.ts` line ~347 and the note in `numbertype.ts`
  ("Port needs other handling. Is another space") are the entry points.
- The 8-bit `n` value is already decoded correctly into `opcode.value`
  for `IN A,(n)` / `OUT (n),A`. For `IN r,(C)`, the value is the BC
  register pair — this is NOT decoded by the current opcode decoder and
  would require dataflow analysis of preceding `LD BC,#xxxx` instructions.
- The `portLabels` map uses 16-bit keys. The existing `labels` map also
  uses 16-bit keys — keep them strictly separate; a collision on address
  value does not mean the same thing (port #F400 ≠ memory #F400).
- Implement `IN r,(C)` / `OUT (C),r` (constant BC) **first** — this
  covers all typical CPC I/O including `OUT (C),C` patterns. It handles
  the vast majority of CPC firmware and hardware access.
- `IN A,(n)` / `OUT (n),A` labelling is secondary; defer until the BC
  form is working and stable.
- This feature is self-contained — does not depend on Stream A or B.

---

## 4. Data grouping — word detection (Level 2)

**Design reference:** `iterative_workflow.md §6.5` (deferred section)

### What it is

When a `DATA_LBL` is accessed by a 16-bit-load instruction
(`LD HL,(nn)`, `LD DE,(nn)`, `LD (nn),HL`, `LD IX,(nn)`, etc.), emit the
two bytes at that address as a single `defw` rather than two `defb` bytes.

Before (v1 — Level 1):
```
DATA_PTR:   defb $34, $12
```

After (Level 2):
```
DATA_PTR:   defw $1234
```

### Why it's deferred

Output is semantically richer but requires design decisions that would
delay Stream B v1:

- **Access-size tracking.** The opcode that references a `DATA_LBL`
  knows whether it's a word or byte load; the label itself does not
  currently store this. Requires either a new `DisLabel.accessWidth`
  field or a lookup at emit time across all opcodes that reference the
  label.
- **Conflicting access sizes.** Same address accessed as both byte and
  word in different parts of the code — which representation wins?
  Probably "larger wins" but needs confirmation.
- **Unaligned word access.** `LD HL,(odd_address)` is legal on Z80 and
  would emit an unaligned `defw`, breaking the byte grouping of adjacent
  data in ugly ways.

### Notes for resuming

- The existing opcode decoder already flags the operand type
  (`NUMBER_WORD` vs `NUMBER_BYTE`). Harvesting that at the label
  reference point gives the access width.
- Start by adding `DisLabel.accessWidth?: 1 | 2` and populating it
  during `collectLabels()` when `DATA_LBL` targets are discovered.
- Level 2 is purely a clean-emitter change once the data model has the
  width. No round-trip implications.

---

## 5. Data grouping — string & struct detection (Level 3)

**Design reference:** `iterative_workflow.md §6.5` (deferred section)

### What it is

Higher-level recognition of data patterns for more readable clean
output:

**String detection**
```
GREETING:   defm "Hello, World!", 0
```

Runs of printable ASCII → assembler string directive.

**Struct / table detection**
```
ENEMY_TABLE:
    ; {x, y, type, hp} × 4 records
    defb 10, 20, 1, 100
    defb 30, 40, 2, 80
    ...
```

Fixed-size records emitted as logical rows.

### Why it's deferred

Every sub-feature here has open design questions:

**String detection:**
- What counts as "printable"? Just 0x20–0x7E? Include TAB/LF? Firmware-
  specific control codes (Amstrad CPC has its own)?
- Minimum run length to flag as a string (short runs look accidental)?
- Termination conventions: null, length-prefix, high-bit-set terminator
  (Amstrad convention)? User would need to declare via `--args` hint.
- Directive name: `defm` (Maxam/sjasmplus), `db "..."`, `.ascii` —
  dialect-specific.

**Struct detection:**
- Cannot be reliably inferred from raw bytes — needs explicit user hints
  via `--args` or a new `--struct` option.
- Record width, field types (byte/word/pointer), count of records —
  all user input.

### Notes for resuming

- Tackle string detection first — it's the more common pattern in ROM
  code and has fewer open decisions than struct detection.
- Start with a conservative heuristic: at least 4 consecutive bytes in
  range 0x20–0x7E, optionally followed by a terminator byte (0x00 or
  0xFF), emit as string.
- Add a `--string-min-length` and `--string-terminators` flag for user
  override.
- Struct detection should follow the `--datarange` pattern — a CLI flag
  `--struct <address> <count> <fieldspec>` that declares a region.
- Both are emitter-only changes — no round-trip or analysis implications.
- These are readability improvements; the byte-only v1 output already
  assembles correctly to the original bytes.
