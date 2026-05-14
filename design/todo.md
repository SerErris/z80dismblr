# z80dismblr — Future Work

Quick-reference list of planned features and the detailed notes below.
Each item links to the relevant design document section for full context.

---

## Summary

| # | Topic | Design ref | Priority |
|---|-------|------------|----------|
| 1 | [Round-trip comments (Stream A)](#1-round-trip-comments-stream-a) | `iterative_workflow.md §7.1` | ~~High~~ **Done** |
| 2 | [Clean assembler output (Stream B)](#2-clean-assembler-output-stream-b) | `iterative_workflow.md §7.2` | ~~Medium~~ **Done** |
| 3 | [I/O port label handling](#3-io-port-label-handling) | `iterative_workflow.md §3.7.2` | ~~Low~~ **Done** |
| 4 | [Data grouping — word detection (Level 2)](#4-data-grouping--word-detection-level-2) | `iterative_workflow.md §6.5` | ~~Low~~ **Done** |
| 5 | [Data grouping — string & struct detection (Level 3)](#5-data-grouping--string--struct-detection-level-3) | `iterative_workflow.md §6.5` | Low |
| 6 | [Replace `--cpc` with `--machine cpc`](#6-replace---cpc-with---machine-cpc) | — | ~~Low~~ **Done** |

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
| A1 | Line classifier — event stream from `.asm` file | ✅ |
| A2 | Classifier skips instruction/data lines | ✅ |
| A3 | Classifier recognises and discards banner blocks on re-read | ✅ |
| A4 | Structured fields extracted from banners → `addressStructured` | ✅ |
| A5 | Label renaming detection → `isFixed` | ✅ |
| A6 | Free-form pre-label and pre-instruction comments captured | ✅ |
| A7 | Idempotence test harness | ✅ |
| A8 | Orphaned annotation handling | ✅ |
| A9 | `;;` inline comment: `addressInlineComments` map + emitter | ✅ |
| A10 | `writeSymbolsOut`: strip prose, skip nameless, add placeholders | ✅ |

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

**Status:** ✅ Done (v2.3.0, branch IO_port_label_handling). Section retained for design rationale.

**Design reference:** `iterative_workflow.md §3.7.2`

### What it is

The Z80 I/O address space is completely separate from the memory address
space — port `#F4xx` and memory address `#F400` are different things.
The `--symbols` file needs a way to define named labels for I/O port
addresses, and the disassembler needs to surface those names in the
listing without breaking re-assembly.

### Key insight: don't substitute into `IN`/`OUT` operands

The earlier draft of this section proposed substituting the port name
into the `IN`/`OUT` operand. That is **wrong** for the primary CPC form:

- `IN A,(C)` / `OUT (C),r` — the `C` here is the register, not a port
  number. There is no operand slot for a label name. The port is
  whatever BC holds at runtime. `IN A,(KEYBOARD_ROW_0)` is invalid
  Z80 syntax and would not re-assemble.
- `IN A,(n)` / `OUT (n),A` — `n` IS an 8-bit immediate, so substitution
  would be syntactically legal. But the Z80 also drives A8–A15 with
  the contents of `A` during this cycle (hardware fact; see the CPC
  decoding subsection). What that means in practice depends on the
  target machine:
  - **Flat-decode hardware** (Spectrum ULA, CP/M-class systems) ignores
    A8–A15 entirely; `n` alone names the port.
  - **Partial-decode hardware** (CPC) decodes A8–A15 for device
    selection. Because `A` is *also* the data byte being written, its
    bit pattern is determined by what the program wants to send, not
    by which device it wants to address. `OUT (n),A` therefore cannot
    cleanly select one device on CPC, and the CPC idiom uses the BC
    form (`LD BC,#7Fxx / OUT (C),A`, etc.) for I/O. `OUT (n),A` is
    essentially never used for device addressing on CPC.
  In either case `A` is a runtime value the disassembler cannot know,
  so annotate via inline comment and never substitute the operand.

So labels live in **two places** in the source:

| Place | Form | Substitute label? |
|-------|------|------------------|
| `LD BC,nn` (or `LD B,#nn` + `LD C,#nn`) | 16-bit immediate | ✅ when this BC flows into an `IN r,(C)` / `OUT (C),r` |
| `IN`/`OUT` instruction itself | — | ❌ never. Use an inline comment instead |

The instruction stream itself is unchanged at the I/O site; the label
information is carried in the existing inline-comment slot (`;` slot
that today holds hex annotations like `; 8FEDh`).

### The FDC / CRTC / PPI pattern — handled by tiny linear BC tracking

Two common patterns motivate the BC tracker.

**FDC pattern — `INC BC` walks adjacent ports:**

```
LD BC,#FB7E          ; FDC_STATUS
OUT (C),C            ; → #FB7E (FDC_STATUS)
INC BC
OUT (C),C            ; → #FB7F (FDC_DATA)
```

**CRTC / PPI pattern — `INC B` jumps to the data port, `LD C,#nn`
re-uses the same `OUT (C),C` instruction to write data:**

```
LD BC,#BC01          ; CRTC_INDEX + register #01
OUT (C),C            ; → #BC01 — selects CRTC register 1 on CRTC_INDEX (#BC00)
INC B
LD C,#23
OUT (C),C            ; → #BD23 — writes #23 to CRTC_DATA (#BD00)
```

(The CRTC/PPI partial-decoding scheme uses the high byte for device
selection and piggybacks data on the low byte and C register. Same
`OUT (C),C` instruction, different effective ports across uses.)

A full dataflow analysis is not needed — a **linear walk inside one
basic block** is enough. The state tracks the **B and C bytes
independently**, each as known/unknown with a value:

| Encountered | Effect on B / C state |
|-------------|----------------------|
| `LD BC,nn` | B = high(nn), C = low(nn), both known |
| `LD B,#nn` | B = nn, known; C unchanged |
| `LD C,#nn` | C = nn, known; B unchanged |
| `LD B,r` / `LD C,r` (r currently tracked & known) | propagate known value |
| `INC B` / `DEC B` | B ± 1 if known; otherwise B stays unknown |
| `INC C` / `DEC C` | C ± 1 if known; otherwise C stays unknown |
| `INC BC` / `DEC BC` | combined ±1 (carry across the byte boundary) if both known |
| Anything else writing B, C, or BC | corresponding byte → unknown |
| Label, CALL, RET, branch target | both bytes → unknown (joins from elsewhere) |

BC is "fully known" when both B and C are known; the effective port is
`(B << 8) | C`. If at the I/O site BC is fully known, emit the inline-
comment annotation matching against `portLabels`. Otherwise emit
nothing; the user can patch via Stream A `;;` comments.

**Operand substitution on `LD BC,nn` — exact match only.**
A `LD BC,nn` is rewritten as `LD BC,PORTNAME` only when:

1. The immediate `nn` exactly matches a `portLabels` entry, AND
2. It flows linearly into an `IN r,(C)` / `OUT (C),r` in the same basic
   block (so a `LD BC,nn` setting up a memory pointer for `LDIR` etc.
   is not rewritten even if `nn` coincidentally collides with a port).

For the CRTC/PPI partial-decoding pattern, the canonical port label
typically lives at `#XX00` (`port:BC00 CRTC_INDEX`). A literal
`LD BC,#BC01` does **not** match exactly and is therefore not
substituted in the operand. The high-byte device identity still
surfaces in the inline comment on the following `OUT (C),C`. Writing
`LD BC,CRTC_INDEX + 1` would conflate address bits with data bits and
is deliberately avoided — port labels name *addresses*, not
data-piggybacked composites.

### CPC-specific: full 16-bit port addresses with partial decoding

The Amstrad CPC uses the **full 16-bit address bus** for I/O. Each
device is selected when a **specific bit of the high byte is low**
(active-low decoding); the other bits of the high byte do not
participate in *that* device's decode (though they may select other
devices in parallel):

| High-byte bit low | Selects |
|------------------|---------|
| A15 = 0 | Gate Array / PAL |
| A14 = 0 | CRTC |
| A13 = 0 | ROM select |
| A12 = 0 | Printer port |
| A11 = 0 | PPI (8255) |
| A10 = 0 | FDC |
| A9, A8   | Device-internal (e.g. CRTC register select, PPI port select) |

Consequences:

- **Multiple devices respond simultaneously** if more than one selector
  bit is low. Clean single-device addressing requires *exactly one*
  selector bit low and all the others high — for example the Gate
  Array idiom uses high byte `#7F = 0111 1111` (A15 = 0, A14..A10 all 1).
- Canonical "official" port names follow that pattern: `#7F` for Gate
  Array, `#BC..#BF` for CRTC (A14 low, A9/A8 select sub-function),
  `#F4..#F7` for PPI (A11 low, A9/A8 select port A/B/C/control), etc.
- The **low byte** is largely don't-care for device selection on most
  chips. A few devices read sub-address bits from it (e.g. the FDC uses
  A0).
- Port addresses are therefore **16-bit** (0–65535), not 8-bit.

`OUT (C),C` is a notable variant: puts BC on the address bus for
device selection AND outputs the C register value as data. Used when
the data to write already lives in C. Addressing mechanism is
identical to all other `OUT (C),r` forms.

**Why CPC code uses `LD BC,addr / OUT (C),r`, never `OUT (n),A` for I/O.**
The Z80 drives A8–A15 from A during `OUT (n),A`. On the CPC, A8–A15
carry the device selectors. Since A is simultaneously the data byte,
its bit pattern is dictated by the value being written — not by which
device the program wants to address. With `OUT (n),A` the programmer
therefore cannot guarantee clean single-device selection: e.g.
`LD A,#54 / OUT (#7F),A` would put `#547F` on the address bus, which
has A15 = 0 *and* A13 = 0 *and* A11 = 0 — Gate Array + ROM select +
PPI all respond at once. The BC form splits the two concerns: B
carries the device-select pattern, A carries the data. For this reason
`OUT (n),A` is essentially never used for I/O on CPC, and the
disassembler should annotate it as comment-only without trying to
guess a port label.

### CPC official port reference (from CPCWiki)

| Canonical port | Decode pattern | Device |
|---------------|----------------|--------|
| `#7FXX` | `%01xx xxxx xxxx xxxx` | Gate Array / PAL (write) — see note |
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

**Note on `#7Fxx` (Gate Array vs PAL):** the **address** decode is
identical for both chips — `%01xx xxxx xxxx xxxx` (A15 = 0, A14 = 1).
The distinction is made in the **data byte** by the top two bits:

| Data bits 7–6 | Meaning |
|--------------|---------|
| `00xxxxxx` | Select pen (number in bits 0–4) — Gate Array |
| `01xxxxxx` | Set colour for previously selected pen — Gate Array |
| `10xxxxxx` | ROM configuration / screen mode — Gate Array |
| `11xxxxxx` | RAM banking — PAL (128K models only); on 6128, bit 5 further splits this between GA interrupt control and PAL banking |

For our purposes the disassembler only sees the address; both chips
share one entry in `portLabels`. Source: *Das Schneider CPC Systembuch*,
[k1.spdns.de/Vintage/Schneider CPC/…/z64.htm](https://k1.spdns.de/Vintage/Schneider%20CPC/Das%20Schneider%20CPC%20Systembuch/z64.htm).

### Symbols file syntax — `port:` with wildcards

The exact-match-only syntax in the earlier draft is unusable on CPC:
real CPC code loads `LD BC,#7F10`, `LD BC,#BC01`, `LD BC,#7F54`, …
where the low byte is data, not part of the port address. A literal
`port:7F00 GATE_ARRAY` declaration would match almost no instruction
in the wild. The syntax therefore takes a **4-digit hex address with
optional `?` wildcards**. Each `?` marks one nibble as
"don't-participate-in-the-match".

| Form | Meaning |
|------|---------|
| `port:7F00` | Exact 16-bit match — both bytes must equal #7F00 |
| `port:7F??` | High byte = #7F; low byte don't-care (CPC partial decode) |
| `port:??FE` | Low byte = #FE; high byte don't-care (Spectrum / CP/M-class) |
| `port:7?40` | Mixed: high nibble 7, low byte 40, middle two nibbles don't-care |

Examples by machine:

```
# CPC — B selects the device; C carries data, sub-address, or both
port:7F??   GATE_ARRAY        ; A15 = 0 selects GA / PAL; data on low byte
port:BC??   CRTC_INDEX        ; A14 = 0, A9/A8 = 00 → index reg
port:BD??   CRTC_DATA_OUT     ; A14 = 0, A9/A8 = 01
port:BE??   CRTC_STATUS       ; A14 = 0, A9/A8 = 10
port:BF??   CRTC_DATA_IN      ; A14 = 0, A9/A8 = 11
port:F4??   PPI_PORT_A_PSG    ; A11 = 0, A9/A8 = 00 → port A (PSG data)
port:F5??   PPI_PORT_B_VSYNC  ; A11 = 0, A9/A8 = 01 → port B
port:F6??   PPI_PORT_C_KEY    ; A11 = 0, A9/A8 = 10 → port C
port:F7??   PPI_CONTROL       ; A11 = 0, A9/A8 = 11 → control reg
port:DF??   UPPER_ROM_SELECT  ; A13 = 0

# CPC — devices with sub-addressing on the low byte (FDC uses A0)
port:FA7E   FDC_MOTOR
port:FB7E   FDC_STATUS
port:FB7F   FDC_DATA
port:F8FF   PERIPHERAL_RESET  ; exact 16-bit

# Spectrum / CP/M-class — low byte selects, high byte don't-care
port:??FE   ULA
port:??1F   KEMPSTON

# Spectrum 128 — AY chip decodes the full 16 bits; exact-match needed
port:FFFD   AY_REGISTER
port:BFFD   AY_DATA
```

Port labels are user-curated — they come from the `--symbols` file.
The disassembler does not auto-discover or auto-name port addresses;
an unmatched port simply has no annotation.

### Lookup and matching

Internal representation per label is `(address, mask, name)`. Each
literal hex digit sets 4 bits in the mask; each `?` leaves them
zero. A candidate effective port `P` matches a label when
`(P & mask) === (address & mask)`.

| Form | address | mask |
|------|---------|------|
| `port:7F00` | `0x7F00` | `0xFFFF` |
| `port:7F??` | `0x7F00` | `0xFF00` |
| `port:??FE` | `0x00FE` | `0x00FF` |
| `port:7?40` | `0x7040` | `0xF0FF` |

**At an `IN r,(C)` / `OUT (C),r` site** (driven by the BC tracker):

| BC state | Lookup strategy |
|----------|-----------------|
| Both B and C known | Full lookup against every label |
| Only B known | Match only labels whose mask zeroes the low byte (`mask & 0x00FF == 0`); compare high byte |
| Only C known | Match only labels whose mask zeroes the high byte (`mask & 0xFF00 == 0`); compare low byte |
| Neither known | No annotation |

**At an `IN A,(n)` / `OUT (n),A` site** only `n` (low byte) is
statically known. Match labels with `mask & 0xFF00 == 0` whose low
byte equals `n`. Flat-decode hardware (Spectrum ULA, Kempston)
typically yields a clean match; CPC almost never does, and the
annotation falls back to "low byte = #n; high byte = A at runtime".

**Most-specific match wins.** When several labels match, pick the
label with the largest mask popcount (most bits constrained). Tie-
break: first declared. Example with both `port:FB?? FDC_BASE` and
`port:FB7E FDC_STATUS`, a lookup of #FB7E returns FDC_STATUS
(popcount 16) rather than FDC_BASE (popcount 8).

### Operand substitution on `LD BC,nn` — exact-match-only

A `LD BC,nn` is rewritten as `LD BC,PORTNAME` only when **both**:

1. There is a port label with `mask === 0xFFFF` whose address equals
   `nn`, AND
2. That `LD BC,nn` flows linearly into an `IN r,(C)` / `OUT (C),r` in
   the same basic block.

Wildcard labels (`port:7F??`, etc.) are **never** substituted into the
operand. Writing `LD BC,GATE_ARRAY + #10` would conflate the
device-select address pattern with the data piggybacked on the low
byte, which is semantically wrong even though it would assemble.

Practical consequence: on CPC, operand substitution rarely fires (most
CPC ports are wildcards). The inline comment on the `IN`/`OUT` line is
the primary surface. On Spectrum's exact-16-bit ports
(`port:FFFD AY_REGISTER`) the substitution does fire and is useful.

### Required code changes

1. **Port label storage** — on `Disassembler`:
   ```ts
   portLabels: Array<{ address: number, mask: number, name: string }>
   ```
   Stored as an array, not a `Map`, because wildcard lookups require
   a scan. (Cheap optimisation: bucket by the high-byte literal and
   by the low-byte literal so the linear scan only walks plausible
   candidates.) Strictly separate from `labels` (port `#F400` ≠
   memory `#F400`).

2. **`--symbols` file parser** — recognise the `port:` prefix in
   `setAddressComments()`. Parse exactly **4** hex-or-`?` characters
   into `(address, mask)`: each `?` clears 4 bits in the mask. Reject
   any other length or character with a clear error message.

3. **BC linear-walkback helper** — new small module
   (`src/disassembler/bcTrack.ts`). At each `IN r,(C)` / `OUT (C),r`
   site, walk backwards within the basic block per the per-byte state
   table earlier in this section and return one of:
   `{ b: number, c: number }` (both bytes known),
   `{ b: number }` (only B), `{ c: number }` (only C), or `undefined`.

4. **Port lookup helper** — small function that takes the tracker's
   state (or `n` for the `(n),A` form) and returns the best-matching
   label per the rules in the "Lookup and matching" subsection
   (most-specific mask wins; first-declared breaks ties).

5. **Listing formatter** —
   - `LD BC,nn` flagged as I/O setup AND matching an exact-match
     (`mask === 0xFFFF`) port label: substitute the operand with the
     port name; the auto-generated `; #xxxx` hex comment remains for
     clarity.
   - `IN r,(C)` / `OUT (C),r` with any port match: append
     `; → #xxxx (PORTNAME)`. If only B was known, render the low
     byte as `??` and note "(low byte data-dependent)".
   - `IN A,(n)` / `OUT (n),A`: append `; → #??n (PORTNAME)` if a
     low-byte-only label matches; otherwise
     `; low byte = #n; high byte = A at runtime`.

6. **Clean emitter (`cleanEmitter.ts`)** — only **exact-match**
   (`mask === 0xFFFF`) port labels emit an EQU prologue entry, since
   only those ever appear as a substituted `LD BC,PORT` operand.
   Wildcard labels emit no EQU (nothing to reference). Inline
   comments are dropped by clean output by design.

7. **`--symbolsout`** — include a
   `; --- discovered I/O ports ---` section listing the `port:`
   entries that the disassembler matched at least once during the
   run. Useful round-trip primer for the user's symbols file.

### Notes for resuming

- The `TODO` in [opcode.ts:396](src/disassembler/opcode.ts#L396) ("need
  to be implemented differently") and the note in
  [numbertype.ts:12](src/disassembler/numbertype.ts#L12) are the entry
  points. `PORT_LBL` for the `(n)` immediate can be folded back into
  `NUMBER_BYTE`; the port-ness becomes comment metadata, not a value
  type.
- Implement `IN r,(C)` / `OUT (C),r` (constant BC) **first** — this
  covers all typical CPC I/O including `OUT (C),C` patterns and the
  FDC `INC BC` chain. Comment-only annotation is enough for a first
  cut; operand substitution on `LD BC,nn` is a follow-up polish step.
- **Implement wildcards from day one.** Without `?`-wildcard port
  declarations the BC-form annotation barely fires on CPC (most CPC
  port loads are `LD BC,#7Fxx` style, never `LD BC,#7F00`). The
  exact-match path is essentially the Spectrum-128 AY case; the
  wildcard path is everything else.
- `IN A,(n)` / `OUT (n),A` labelling is comment-only; defer until the
  BC form is working and stable.
- The BC walkback is intentionally not interprocedural and not a
  full dataflow. If it gives up, the user can patch via Stream A
  `;;` comments — that is the safety net.
- This feature is self-contained — does not depend on Stream A or B,
  but benefits from both (Stream A for user-added port comments,
  Stream B's EQU prologue for the `LD BC,PORT` substitution).

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

---

## 6. Replace `--cpc` with `--machine cpc`

**Status:** ✅ Done (v2.2.0). Section retained for design rationale.

### What it is

Rename the existing `--cpc` flag to a general-purpose `--machine <name>`
option. The mechanics (CPC RST dispatch decoding, FAR CALL pointer records,
etc.) stay exactly the same — only the CLI surface changes.

### Why

Future targets (other Z80 machines with machine-specific RST conventions,
calling patterns, or memory maps) can be added without further flag
proliferation. Instead of `--cpc`, `--msx`, `--zxnext-rom`, … as separate
booleans, a single `--machine <name>` slot keeps the CLI focused.

### Scope

- Add `--machine <name>` option. Accepted values for now: `cpc`.
- Remove the `--cpc` flag outright. No deprecation alias, no back-compat
  shim — a clean rename. Any existing `--args` file or user script that
  still passes `--cpc` will fail with "unknown option".
- Internally, replace `Disassembler.cpcMode: boolean` with
  `Disassembler.machine: 'none' | 'cpc'` (or a string discriminated union).
- All current `if (this.cpcMode)` sites become `if (this.machine === 'cpc')`.
- Update help text, README, and the user manual.
- Update `--argsout` round-trip behaviour so any written args file emits
  `--machine cpc` rather than `--cpc`.
- **All tests that currently pass `--cpc` must be updated to
  `--machine cpc`.** This includes the smoke-test pipeline and all
  `.args` fixture files under `src/tests/data/`.

### Notes for resuming

- The flag is consumed in exactly one place (`z80dismblr.ts` case handler).
  Call sites of `dasm.cpcMode` are in `disasm.ts`, `cleanEmitter.ts`, and
  `cpcRst.ts` — grep covers them.
- Before implementing, grep the whole repository (not just `src/`) for
  `--cpc` to catch all test fixtures, docs, and CHANGELOG references that
  need updating in the same commit.
- Document the breaking change prominently in CHANGELOG.md.
- Orthogonal to the Vortex decoder (`--decoder vortex`) — both stay.
