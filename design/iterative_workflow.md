# Iterative Workflow — Round-trip Comments and Clean Assembler Output

This document covers two related features aimed at making reverse
engineering with `z80dismblr` more convenient on long-running projects:

1. **Round-trip comments** — the main `.asm` output file doubles as the
   `--symbols` input, so a user can edit documentation directly in the
   listing and re-run the disassembler without losing any edits.
2. **Clean assembler output** — a separate emitter that produces an
   assembleable source file (for `sjasmplus` or `maxam`) stripped of all
   human-oriented commentary.

These are two emitters on top of the same internal model. Each can be
developed and shipped independently.

---

## 1. Problem statement

### 1.1 Current workflow

Today the reverse-engineering loop looks like this:

```
+-------------+           +--------------+
| foo.bin     |           | foo.cmt      |    (sidecar structured
+------+------+           +------+-------+     --symbols file)
       |                         |
       +------------+------------+
                    |
                    v
              z80dismblr
                    |
                    v
             +-------------+
             | foo.list    |            (read-only, regenerated every run)
             +-------------+
```

The user keeps manually authored metadata in `foo.cmt` and reads the
output in `foo.list`. Pain points:

- **Two files kept in sync by hand.** Addresses appear in both.
- **Context switching.** Editing `foo.cmt` while staring at `foo.list` is
  mentally expensive — addresses and labels must be transcribed.
- **Label renaming is clumsy.** Changing `SUB042` to `KM_EXP_BUFFER` means
  editing the sidecar and trusting the disassembler to pick it up next
  run.
- **`foo.list` is write-only.** Every run overwrites it; any experimental
  note a user jotted there is lost.

### 1.2 Goal

A single-file iterative loop:

```
+-------------+
| foo.bin     |
+------+------+
       |
       v
  z80dismblr  <-----+          (same file is both output
       |           |            and next-run input)
       v           |
+-------------+    |
| foo.asm     |----+
+------^------+
       |
       | (user edits in VS Code: adds summaries, renames labels,
       |  writes prose between subroutines)
       +
```

and as a second deliverable, a side-output for assembler round-tripping:

```
  z80dismblr
       |
       +-------+
       |       |
       v       v
+-----------+ +----------+
| foo.asm   | | foo.s    |  (assembleable by sjasmplus/maxam,
+-----------+ +----------+   produces the original binary back)
```

---

## 2. Design goals

1. **One user-editable file.** `foo.asm` is the canonical workspace.
   Users read it, edit it, and feed it back to the disassembler. No
   sidecar file is mandatory.
2. **Backwards compatibility.** The existing sidecar `--symbols`
   workflow keeps working. Users who like it can keep using it.
3. **Idempotence.** Running the disassembler twice on an unchanged
   binary and an unchanged `.asm` produces byte-identical output. No
   drift, no churn in version control.
4. **Transparent auto vs. manual.** The file's visual layout tells the
   reader which lines are the disassembler's and which are the user's —
   no hidden sentinels or machine-only comment markers.
5. **Non-destructive.** If the binary changes in a way that makes a
   piece of user documentation unattachable (e.g. the label address
   disappeared), the documentation is preserved as a comment at the
   top of the file rather than silently dropped.
6. **Assembleable side output.** `foo.s` is a faithful source
   representation that assembles back to the original binary (modulo
   known padding). Format-specific for the target assembler.

---

## 3. File regions in `foo.asm` — what is parseable back

The `.asm` output is divided into regions that the re-parser treats
differently. Every region is identifiable by position and textual
convention; no invisible markers are introduced.

| Region | Identified by | Round-trip role |
|--------|---------------|-----------------|
| File header (top matter) | Lines at file top before any banner/label | Preserved verbatim — free-form user notes |
| Sub banner rules (`; *{77}`) | Exact match: `'; '` + 77 asterisks | Auto-gen, discarded on re-read |
| Sub banner mid (`; *** sub NAME ***`) | Banner middle line | Auto-gen from current label name |
| `Address:` line | Fixed prefix inside a banner | Always auto-gen (from address key) |
| `Type:` line | Fixed prefix inside a banner | Always auto-gen |
| `Summary:` | Fixed prefix | **Value is user data when not `—`** |
| `Action:` (inline `—` or block) | Fixed prefix | Value is user data when not `—` |
| `Entry:` | Fixed prefix | Value is user data when not `—` |
| `Exit (success):`, `Exit (failure):` | Fixed prefix | Value is user data when not `—` |
| `Corrupted:`, `Preserved:` | Fixed prefix | Always auto-gen from analyser (§3.5) |
| `(analysis unavailable: …)` | Parenthesised note | Auto-gen |
| `Called by:`, `Calls:` | Fixed prefix | Always auto-gen |
| Closing banner rule | Exact asterisk rule | Auto-gen, discarded |
| Pre-label free-form comments | `; ...` lines between closing banner and the label line | **Preserved as `linesBefore` for that label's address** |
| Label line | `addr NAME:` or `NAME:` | **If `NAME` differs from the auto-generated name, preserved as a fixed label** |
| Instruction line | `addr bytes MNEM args ; auto ;; user` | Opcode and auto-comment part regenerated; user part after `;;` preserved (§3.4) |
| Pre-instruction comments | `; ...` lines between two instruction lines | **Preserved as `linesBefore` for the next instruction's address** |
| Data directive lines (`DEFB`, `DEFW`, `DEFS`) | `addr DEFx ...` | Regenerated |
| Blank lines | Empty lines | Regenerated based on layout rules |
| Orphaned user documentation | No longer valid in current binary | Preserved as a comment block at top of file (§5.2) |

### 3.1 The `—` sentinel

A structured field in a banner renders as `; Field: —` when the user
has not documented it. On re-read:

- Value **is** `—` → no user data, ignore.
- Value **is** anything else → user data, preserve and feed into
  `addressStructured` on the next run.

This is already how the current output works — we just need to teach the
parser to read the output format back.

### 3.2 Free-form comments between banner and label

```
; *****************************************************************************
; *** sub KM_EXP_BUFFER                                                     ***
; *****************************************************************************
; Address:   BB15h     Size: 23 bytes   Instructions: 9   CC: 2
...
; *****************************************************************************
; NOTE: This is called from IRQ context, must complete in < 1ms.   ← user note
; Never touches the paging hardware.                                ← user note
KM_EXP_BUFFER:
```

The two lines between the closing banner and the label are captured as
`linesBefore` attached to address `BB15h`. On re-emit they appear in
the same place.

### 3.3 Free-form comments between two instructions

```
BB1F              LD   A,(HL)
                  ; Now A holds the byte count; 0 means "use default". ← user
BB20              OR   A
BB21              JR   Z,.km_default
```

The commented line attaches to `BB20` (the next instruction's address)
and re-emits there on the next run.

### 3.4 Inline instruction comments (v1: `;;` user marker)

```
BB15 2A ED 8F     LD   HL,(DATA146) ; 8FEDh    ← auto-only
```

The inline `; 8FEDh` is generated by the disassembler to show the hex
value of the immediate. The disassembler also wants to let users
annotate individual instructions without moving every note to the line
above.

Rather than guess whether an inline comment is auto-generated or
user-written — they can look very similar — the grammar uses an
explicit separator `;;`. Everything before `;;` is auto-generated
(always regenerated on each run); everything after `;;` is user text
(always preserved).

**Three valid shapes per instruction line:**

```
LD HL,(DATA146)    ; 8FEDh                      ← auto-only
LD HL,(DATA146)    ; 8FEDh  ;; state pointer    ← auto + user
LD HL,(DATA146)    ;; state pointer             ← user-only (auto suppressed)
```

**Parser rules:**

- Split the inline comment on the first `;;` substring.
- Everything before `;;` (the auto region) is discarded on re-read — it
  will be re-generated from current disassembler state and settings.
- Everything after `;;` (the user region) is captured verbatim and
  attached to the instruction's address.
- A line with no `;;` has no user content; only an auto comment (if
  any) is rendered on re-emit.
- A line that starts with `;;` (no auto text in front) means the user
  has suppressed the auto comment entirely for this instruction;
  re-emit preserves the "user-only" form.

**Emitter rules:**

- Always generate the auto comment as before (governed by hex style,
  `addOpcodeBytes`, etc.).
- If the instruction's address has a captured user comment, append
  `  ;; <user text>` after the auto comment.
- If the user explicitly suppressed the auto comment (user-only form),
  emit `  ;; <user text>` without any auto content.

**Storage:**

- New field on `Disassembler`: `addressInlineComments = new Map<number, InlineComment>()`
  where `InlineComment = { text: string; suppressAuto: boolean }`.
- Populated by the round-trip parser; read by the instruction emitter
  in `disassembleMemory()`.

**Rationale:** the `;;` separator is unambiguous, requires no heuristic
pattern-matching against auto-comment formats, survives changes to
hex style or other emitter settings, and composes cleanly with the
existing line-above convention — users pick whichever fits better per
case.

Prose-heavy notes still belong on the line above (§3.3); `;;` is for
one-liners that annotate a specific instruction without breaking flow.

### 3.5 Register overrides

**Decided (§8.2): `Corrupted:` and `Preserved:` are always regenerated
from the analyser.** Any edit a user makes to those lines in the `.asm`
file is discarded on the next run; the re-parser ignores them entirely.

The rationale: the analyser result changes as the user improves their
understanding of the code (adding `--codelabel`s, trace files, etc.),
so preserving a stale manual override is worse than re-computing.

Users who genuinely need to override the analyser for a specific
subroutine use the sidecar `--symbols` file with the `corrupted:` /
`preserved:` markers. That path is unchanged and still takes precedence
over the analyser output at emit time.

### 3.6 Label renaming

```
; ...
; *****************************************************************************
BB15 KM_EXP_BUFFER:           ← user renamed from SUB042
              LD   HL,(DATA146)
```

On re-read:
- Parse each label line for `(address) (name):` (tolerating whitespace).
- If the name differs from what `assignLabelNames()` would produce,
  store it with `isFixed = true` on the `DisLabel` so the next run
  preserves it.
- Update `DisLabel.name` accordingly.

The label line must continue to carry the hex address so the re-parser
can key by address, not by name.

### 3.7 Relationship between `--symbols` and the `--out` round-trip

**`--symbols <file>`** (existing) loads a sidecar file through
`setAddressComments()`. It works on **any address** in the address space
— there is no restriction to "external only". Typical uses:

- Pre-populate labels for addresses the disassembler cannot discover
  on its own: firmware calls in another ROM bank, OS vectors, hardware
  registers, RAM variables.
- Provide structured documentation (the new `summary:`, `action:`,
  `entry:`, `exit-*:` markers from the sub-header work) for any
  subroutine.
- Force-override `Corrupted:` / `Preserved:` register lists via the
  `corrupted:` / `preserved:` markers (§3.5 — this remains the only
  supported override path; the analyser always regenerates those fields
  from the `--out` auto-import).

#### 3.7.2 Symbol types: memory, data, and I/O ports

The Z80 has three distinct address spaces that matter for labelling:

| Space | Range | Used by |
|-------|-------|---------|
| Code / memory | 0x0000–0xFFFF | `CALL`, `JP`, `LD HL,(addr)`, etc. |
| Data / memory | 0x0000–0xFFFF | `LD A,(addr)`, `LD (addr),HL`, etc. |
| I/O ports | 0x00–0xFF (8-bit) | `IN A,(n)`, `OUT (n),A` |

**Memory (code + data)** are the same address space — a label is either
a code label (`CODE_SUB`, `CODE_LBL`) or a data label (`DATA_LBL`) at
the same 0-65535 range. The disassembler assigns the type automatically
based on how the address is reached (call/jump → code; indirect load/
store → data). Both already work in `--symbols` today.

**I/O ports** are a *separate address space*. Port `#FE` and memory
address `#00FE` are completely different things. The opcode decoder
already sets `valueType = PORT_LBL` on `IN A,(n)` / `OUT (n),A`, but
the label creation step is currently unimplemented (a `TODO` in the
existing code notes this explicitly).

**Required changes to support port symbols:**

1. **Separate port label map** — add `portLabels: Map<number, DisLabel>`
   alongside the existing `labels: Map<number, DisLabel>`. Keyed by the
   8-bit port number (0–255 for direct `IN`/`OUT`).

2. **Symbol file syntax** — use a `port:` address prefix to distinguish
   port addresses from memory addresses:

   ```
   port:FE  KEYBOARD_ROW
   port:7F  GATE_ARRAY
   port:F4  PSG_READ
   port:F5  PSG_WRITE_ADDR
   port:F6  PSG_WRITE_DATA
   ```

3. **Label creation during analysis** — `setFoundLabel()` (called from
   `disassembleForLabel()` when a `PORT_LBL` opcode is decoded) must
   insert into `portLabels` rather than `labels`.

4. **Opcode formatter** — when formatting `IN A,(#FE)`, look up the
   port number in `portLabels` and substitute the name if found, e.g.
   `IN A,(KEYBOARD_ROW)`.

5. **`--symbolsout`** — the `writeSymbolsOut` emitter should include a
   section for discovered port addresses:

   ```
   ; --- discovered I/O ports ---
   port:FE  PORT_FE
   port:7F  PORT_7F
   ```

**`BC`-based port instructions** (`IN r,(C)`, `OUT (C),r`) use a 16-bit
port address whose value is only known at runtime. These cannot be
statically labelled — the disassembler emits them with no label
substitution.

**Implementation status:** data memory symbols — ✅ working today.
I/O port symbols — ⬜ requires the changes above, none yet in place.

`--symbols` is explicitly authored by the user and is **never written
or modified by the disassembler**.

#### Example `--symbols` file

```
; =============================================================================
; symbols.sym — curated symbol database for my_extension.rom
; =============================================================================


; --- CPC lower-ROM firmware entry points (BBxx range) -----------------------
; These are not part of the ROM being disassembled; the disassembler cannot
; discover them on its own. Labels here are applied whenever a CALL or JP
; in the ROM targets one of these addresses.

; summary: Initialise the key manager and expansion buffer
; entry:   HL = address of expansion buffer
;          BC = length of expansion buffer
; exit-success: Carry set
; exit-failure: Carry clear (buffer too small)
; corrupted: A, BC, DE, HL, F
; preserved: IX, IY
BB00 KL_CHOKE_OFF

; summary: Scan keyboard and return key code
; entry:   —
; exit-success: A = key code, Carry set
; exit-failure: Carry clear (no key)
; corrupted: AF, BC, DE, HL
BB03 KL_SCAN_OVER

; summary: Output a character to the lower screen
; entry:   A = ASCII character code
; corrupted: AF, BC, DE, HL, IX
BB5A TXT_OUTPUT

; summary: Print a null-terminated string to the lower screen
; entry:   HL = address of string (null-terminated)
; corrupted: AF, BC, DE, HL
BB5D TXT_STR


; --- CPC I/O ports (port address space — separate from memory) --------------
; Uses "port:XX" prefix to distinguish from memory addresses.
; Requires the port-label feature described in §3.7.2.
; IN A,(#FE) will render as  IN A,(KEYBOARD_ROW)  once implemented.

port:FE  KEYBOARD_ROW        ; read keyboard row selected by PPI port C
port:7F  GATE_ARRAY          ; write gate array (mode, colour, ROM select)
port:F4  PSG_READ            ; read AY-3-8912 PSG register data
port:F5  PSG_WRITE_ADDR      ; write AY-3-8912 PSG register address
port:F6  PSG_WRITE_DATA      ; write AY-3-8912 PSG register data
port:FB  PPI_PORT_A          ; 8255 PPI port A — keyboard row select
port:FA  PPI_PORT_C          ; 8255 PPI port C — keyboard scan / sound / ROM select
port:F8  PPI_CONTROL         ; 8255 PPI control register


; --- RAM variables used by this ROM ------------------------------------------
; Persistent state stored in RAM by the extension ROM at known offsets.

; summary: Current X cursor position (0-79)
C000 cursor_x

; summary: Current Y cursor position (0-24)
C001 cursor_y

; summary: Output mode flags (bit 0 = inverse, bit 1 = underline)
C002 output_flags

; summary: Pointer to current string being rendered (16-bit)
C003 str_ptr


; --- Subroutines within this ROM — structured documentation ------------------
; These addresses ARE in the binary being disassembled. Entries here provide
; documentation that the static analyser cannot infer, and can force-override
; the register analysis when a subroutine has been manually verified.

; summary: Print a formatted text string in HL
; action: Reads bytes from (HL). Control codes:
;         FEh followed by 2 bytes = 16-bit integer
;         FDh followed by 2 bytes = pointer to sub-string (recursive)
;         FFh = end of string
; entry:  HL = pointer to formatted string
; exit-success: HL advanced past terminator
; exit-failure: —
; corrupted: A, HL, F
; preserved: BC, DE, IX, IY
760A sub_print_hl

; summary: Compute BCD-formatted decimal from binary value in DE
; entry:   DE = binary value (0-9999)
;          HL = output buffer address (5 bytes minimum)
; exit-success: HL points past the last digit written
; corrupted: AF, BC, DE, HL
; preserved: IX, IY
7680 sub_bcd_convert
```

**`--out <file>`** (existing) is the disassembly write path.
`--out` is already defined in the codebase; the only new behaviour is
the auto-import described in §3.7.1 below.

Both are active on the same run:

```
$ z80dismblr --bin rom.bin --symbols symbols.sym --out rom.asm
```

If an address appears in both `--symbols` and the auto-imported
`--out` file, `--symbols` wins — it was explicitly authored, and its
labels carry `isFixed = true`.

### 3.7.1 Auto-import of the existing output file

**New behaviour on top of the existing `--out` option.**

**Rule:** if `--out <file>` is specified and `<file>` already exists on
disk, automatically feed it through the round-trip parser before
analysis, in addition to any `--symbols` files.

The iterative loop then collapses to a single, always-the-same command:

```
$ z80dismblr --bin rom.bin --symbols symbols.sym --out rom.asm
```

On the first run `rom.asm` does not exist; the auto-import is a no-op
and the file is created fresh. On every subsequent run it is silently
imported, user annotations extracted, and the file rewritten with a
fresh disassembly that carries all preserved content.

**Opt-out (`--fresh`):** suppresses only the `--out` auto-import.
`--symbols` files are always loaded regardless of `--fresh`.

```
$ z80dismblr --bin rom.bin --symbols symbols.sym --out rom.asm --fresh
```

**Implementation:** after CLI parsing, check `fs.existsSync(outPath)`;
if the file is present, pass it to the round-trip parser before calling
`disassemble()`. This is a pure CLI-layer addition — no change to the
core disassembler is needed.

### 3.8 `--symbolsout` output format

`--symbolsout` generates a skeleton `--symbols` file from all labels
discovered during disassembly. The current `--commentsout` code
(in `argsWriter.ts: writeCommentsOut`) emits everything — including
address-only lines with no label and auto-generated prose comments.
The new `--symbolsout` emitter is stripped to only what belongs in a
symbol definition file.

**Rules for the new emitter:**

1. **Skip address-only entries.** If a discovered label has no name
   (`entry.name === undefined`) emit nothing for that address. The
   user only needs entries they can act on.

2. **No prose comment lines.** Do not emit `entry.linesBefore`,
   `entry.inlineComment`, or `entry.linesAfter`. Those fields carry
   auto-generated statistics lines (e.g. `; Subroutine: Size=38,
   CC=4.`) or old `--comments`-style prose that no longer belongs in
   the symbol file.

3. **Emit only the address + label name line.** Format:
   `XXXX labelName` (hex address, space, name), no trailing comment.

4. **Emit empty structured-field placeholders as a template** for each
   subroutine entry so the user knows which fields are available to
   fill in. Non-subroutine labels (data, plain jump targets) do not
   get placeholders.

5. **Blank line between entries** for readability.

6. **No data-range hints.** The `; --datarange …` hint block at the
   end of the old `--commentsout` output is not emitted. Data ranges
   belong in the `--args` file, not in the symbol file.

**Resulting skeleton format (`--symbolsout rom.sym`):**

```
; Auto-generated by z80dismblr --symbolsout
; Review and complete, then use as --symbols input.

; summary: —
; action: —
; entry: —
; exit-success: —
; exit-failure: —
BB00 KL_CHOKE_OFF

; summary: —
; action: —
; entry: —
; exit-success: —
; exit-failure: —
BB15 KM_EXP_BUFFER

C000 cursor_x
```

Note: `cursor_x` is a data label — no structured-field placeholders.

**Implementation:** replace `writeCommentsOut` in `argsWriter.ts` with
a new `writeSymbolsOut` function using the rules above. The call site in
`z80dismblr.ts` (currently `writeCommentsOut(...)`) switches to the new
function. The old `writeCommentsOut` can be removed at the same time.

---

## 4. Extensions to `setAddressComments()`

The existing parser handles a minimal grammar (free-form comments +
`addr: name` lines + structured markers). To accept the full `.asm`:

| Parser extension | What it does | Complexity |
|------------------|--------------|------------|
| Skip instruction lines | Lines matching `<hex> (<hex bytes>)? <mnem> <args>(;.*)?` are not comments — ignore the assembly content, keep the line-before comments | low |
| Skip data directive lines | `DEFB`, `DEFW`, `DEFS` lines ignored the same way | low |
| Recognise banner blocks | When a line is a 79-col asterisk rule, consume the next two lines as banner mid + rule; skip them | low |
| Read structured fields inside a banner | Between open and close rule, match `^; (Summary\|Action\|Entry\|Exit \(success\)\|Exit \(failure\)): (.*)$`, and handle inline vs block forms; stop at close rule | medium |
| Capture label renaming | When a label line has a name that doesn't match the auto-generator's pattern (`SUBnnn`, `LBLnnn`, `DATAnnn`, `.subnnn_…`), treat as user-assigned fixed | medium |
| Capture `linesBefore` | Any `; …` line that is not inside a banner block and not a structured marker is attached to the next address encountered | low |

### 4.1 Suggested restructure

The parser today is a state machine (`LinesBefore` / `lineOn` /
`LinesAfter`) over a minimal line grammar. To make the extensions
manageable, refactor into two stages:

1. **Line classifier** — walks the file, emits a stream of typed events:
   `{kind: 'banner-open'}`, `{kind: 'banner-close'}`,
   `{kind: 'structured-field', name, value, address?}`,
   `{kind: 'label', address, name}`,
   `{kind: 'instruction', address, ...}`,
   `{kind: 'free-comment', text}`.
2. **Semantic consumer** — turns the event stream into updates to
   `labels`, `addressComments`, `addressStructured`.

This replaces the tangled state machine with a cleaner two-pass design
and makes the structured-field handling a drop-in extension.

---

## 5. Edge cases

### 5.1 Binary changed between runs

If the binary has changed (user loaded a different ROM version, added
`--bin` at a new offset), some addresses in the old `.asm` may no
longer correspond to the same code. The re-parser must handle this
gracefully.

**Rule:** user data is attached by address, not by content. If the
address exists in the new disassembly, the data attaches. If the
address no longer exists (e.g. ROM bank switched and the code at
`0xA123` is different opcodes now), the data is still valid in the
sense that `0xA123` still exists as an address, so the comment still
attaches — but it may be semantically wrong, and that is the user's
responsibility.

### 5.2 Orphaned user documentation

When a label address disappears entirely (e.g. memory range removed
from `--bin` args), its attached user documentation has nowhere to go.

**Rule:** preserve such content as a comment block at the very top of
the file, prefixed with `;; ORPHANED: address $XXXX — reason …`, so
the user can re-attach it manually. Never silently drop user data.

### 5.3 Idempotence across multiple runs

Round-trip: disassemble → the file → re-disassemble → the file.
The two outputs must be byte-identical. Requires:

- Stable ordering of callers in `Called by:`.
- Stable ordering of callees in `Calls:`.
- Stable register ordering in `Corrupted:` / `Preserved:`.
- Stable whitespace / padding in the banner.

Current implementation satisfies most of this; the remaining gaps
(non-deterministic `Set` iteration on some platforms) need to be fixed
with explicit sorting.

### 5.4 User adds a new address with structured markers

A user can add a new block like:

```
; summary: This is a RAM buffer I know about.
; action: —
; entry: —
C000 MY_RAM_BUFFER:
```

manually, for an address the disassembler did not discover. The parser
should accept this and create/update the label. (This is basically the
existing sidecar behaviour.)

### 5.5 User deletes the banner

If a user deletes the banner rules around a sub (just keeps the label
and structured fields), the parser should still pick up the structured
fields — don't require the banner to be present for parsing. On re-emit
the banner comes back.

---

## 6. Clean assembler output (`--cleanout`)

### 6.1 CLI surface

```
--cleanout <filename>           Emit clean assembler source to this file.
--cleanout-format <format>      One of: sjasmplus (default), maxam.
```

Both `--out` and `--cleanout` may be given in the same run; they share
the same analysis pass and just produce two different emitters.

### 6.2 Content shape

The clean file contains, in order:

- Optional file-top directive (assembler version hint comment, if any).
- For each contiguous code range: an `ORG`/`org` directive.
- Labels on their own lines, flush-left.
- Instructions indented, in the target assembler's syntax.
- Data grouped into multi-byte `DEFB`/`DEFW` directives.
- One blank line between subroutines.
- No headers, no statistics, no caller/callee lists, no inline hex
  comments.

Example (sjasmplus, default hex `$`):

```
                org     $BB15

KM_EXP_BUFFER:
                ld      hl, ($BF8D)
                push    hl
                ld      ($BF8D), de
                ld      ($BF8F), hl
                call    KL_INIT_EXP
                pop     hl
                ld      ($BF8D), hl
                ret

                defb    $00, $00, $00, $00
```

Example (maxam, default hex `#`):

```
                org     #BB15

KM_EXP_BUFFER
                ld      hl, (#BF8D)
                push    hl
                ld      (#BF8D), de
                ld      (#BF8F), hl
                call    KL_INIT_EXP
                pop     hl
                ld      (#BF8D), hl
                ret

                defb    #00, #00, #00, #00
```

Hex style follows the target assembler only. The existing `--cpc` flag
is **not** consulted by the clean-output emitter; it continues to
affect RST handling only. If a user wants `#AB` with sjasmplus they
pass `--cleanout-hex cpc` explicitly.

### 6.3 Dialect differences

sjasmplus accepts a wide range of number literal styles. Per its
documentation, all of the following are valid:

| Base | Styles accepted by sjasmplus |
|------|------------------------------|
| decimal | `12`, `12d` |
| hex | `0xC`, `$C`, `#C`, `0Ch` |
| binary | `0b1100`, `%1100`, `1100b` |
| octal | `0q14`, `14q`, `14o` |
| digit separator | `12'345` (C++ style), `1_3_7q` (underscore) |

Maxam accepts:

| Base | Styles accepted by maxam |
|------|--------------------------|
| decimal | `132` |
| hex | `&BB5A`, `#2A` (both supported for compatibility with BASIC and CPC firmware docs) |
| binary | `%1011101` |
| character | `'A'`, `"3"`, `'"'` |

Each target assembler has a conventional hex notation and we follow it:

- **sjasmplus** → `$AB` (classic Z80 convention, most common in sjasmplus
  projects).
- **maxam** → `#AB` (canonical notation in the Amstrad CPC firmware
  manual and in almost all CPC source code written against it).

`--cpc` is **not** consulted by the clean-output emitter. It remains
solely an RST-handling switch. Users who want a non-default hex style
for a given target pass `--cleanout-hex` explicitly.

Available hex styles (per `Format.formatHex` today):

| Style | Rendering | Accepted by |
|-------|-----------|-------------|
| `z80` | `$AB` | sjasmplus |
| `cpc` | `#AB` | sjasmplus, maxam |
| `intel` | `0ABh` | sjasmplus |
| `c` | `0xAB` | sjasmplus |
| `amp` | `&AB` | maxam |

**CLI surface:**

```
--cleanout <filename>            Emit clean assembler source to this file.
--cleanout-format <assembler>    sjasmplus (default) | maxam
--cleanout-hex <style>           z80 | cpc | intel | c | amp
                                 (default: z80 for sjasmplus, cpc for maxam)
```

| Aspect | sjasmplus | maxam |
|--------|-----------|-------|
| Directive case | `ORG`, `DEFB`, `DEFW`, `DEFS` (both cases accepted) | `org`, `defb`, `defw`, `defs` (lower conventional) |
| Default hex style | `$AB` (z80) | `#AB` (cpc) |
| Explicit override | `--cleanout-hex <style>` | `--cleanout-hex <style>` |
| Label line | `NAME:` (colon optional) | `NAME` (no colon) |
| Local labels | `.NAME` (dotted) | `.NAME` (dotted) |
| Comments | `;` | `;` |
| Instruction indent | conventional 4-8 spaces / tab | same |
| Case sensitivity | Case-sensitive labels by default | Case-insensitive |

The emitter is a thin formatter on top of the current `disassembleMemory()`
output — the label/opcode model does not need to change. The hex
renderer is already centralised in `Format.formatHex()` and already has
all the required style variants.

### 6.4 What is *not* emitted

- Banner blocks
- `Summary:`/`Action:`/`Entry:`/`Exit:` structured fields
- `Corrupted:`/`Preserved:` register lists
- `Called by:`/`Calls:` cross-reference lines
- Auto-generated inline hex comments (`; 8FEDh`)
- Statistics (`Size=…, CC=…`)
- Address prefixes on every line
- User-written prose comments (they belong in `.asm`, not `.s`)

The test is: pipe the output through the target assembler and compare
the resulting binary with the original. The round-trip must produce
the original bytes (modulo explicit `DEFS` fills).

### 6.5 Data grouping

Current output emits one `DEFB` per byte for readability. Clean output
groups:

- Eight bytes per line is a reasonable default: `defb 00h, 01h, 02h, …`
- Mixed byte/word ranges: honour the label type — `DATA_LBL` with a
  word-aligned access renders as `defw`.
- `DEFS` for long zero-fill runs (threshold: 16 bytes or more).

### 6.6 Label names

Clean output uses the **current label names** as they appear in the
internal model — including user-renamed labels from round-trip.
`KM_EXP_BUFFER` stays `KM_EXP_BUFFER`, not `SUB042`.

#### 6.6.1 Local labels inside subroutines

Labels that live inside a subroutine (conditional jump targets, loop
back-edges) are emitted with a leading dot:

```
KM_EXP_BUFFER:
                ld      a, (hl)
                inc     hl
                cp      $ff
                jr      z, .km_exp_buffer_l1
                djnz    .km_exp_buffer_loop    ; backward branch → loop suffix
.km_exp_buffer_loop:
                ...
                jr      .km_exp_buffer_loop
.km_exp_buffer_l1:
                ret
```

Naming convention (already in the codebase):

- `.`&nbsp; + parent-sub-name + `_l` + index → for forward branches
  (conditional and unconditional jump targets).
- `.`&nbsp; + parent-sub-name + `_loop` + index → for backward branches
  (detected as loops during label discovery).

Every local label name is **globally unique** because it embeds the
parent subroutine name. This matters because the two assemblers
interpret dotted labels differently:

| Assembler | Interpretation of `.name` |
|-----------|---------------------------|
| sjasmplus | Local label, scoped to the preceding global label. Full canonical form is `<GLOBAL>.name`. |
| maxam     | Regular label whose identifier happens to start with `.`. Name is global as-written. |

Because the dotted name already carries the parent-sub name, neither
interpretation produces a collision:

- sjasmplus scopes `.km_exp_buffer_loop` to `KM_EXP_BUFFER:`, and the
  fully qualified name `KM_EXP_BUFFER.km_exp_buffer_loop` is unique.
- maxam treats `.km_exp_buffer_loop` as a plain global label, and the
  name is unique by construction.

Consequence: the disassembler emits **exactly the same label text** for
both target assemblers. The local-label mechanism works on both, no
dialect switch needed.

Verbose output (`--out`) uses the same dotted convention today. Clean
output (`--cleanout`) inherits it.

### 6.7 Open decisions

- **Hex style defaults.** Resolved: sjasmplus → `$AB` (classic Z80
  convention), maxam → `#AB` (firmware-manual convention, already
  dominant in CPC source). `--cpc` is an RST-handling flag only and
  does not affect clean-output formatting. Users who want a non-default
  hex style pass `--cleanout-hex` explicitly.
- **Local-label flavour.** Resolved in §6.6.1: dotted labels
  (`.parent_l1`, `.parent_loop1`) work on both sjasmplus and maxam
  because the parent-sub name is embedded in the identifier — the
  same text assembles correctly under either interpretation (scoped
  local vs. plain global). No dialect switch needed.
- **ORG reset on gaps.** Confirmed: for a binary with three disjoint
  sections, emit three `org` directives — one per contiguous assigned
  range. Matches the current disassembler's memory model.
- **Digit separators.** Confirmed: the disassembler will not emit
  digit separators (`12'345`, `1_3_7q`). They are useful for humans
  writing code by hand but add no value to machine-generated output.

---

## 7. Implementation plan

Two independent streams; either can be built first.

### 7.1 Stream A — Round-trip comments

| Phase | Deliverable |
|-------|-------------|
| A1 | Line classifier (§4.1 stage 1) — extract event stream, no behaviour change yet |
| A2 | Teach classifier to skip instruction/data lines inside a `.asm` file |
| A3 | Recognise and discard banner blocks on re-read |
| A4 | Extract structured fields from within banners, feed into `addressStructured` |
| A5 | Capture label renaming into `isFixed` labels |
| A6 | Capture free-form pre-label and pre-instruction comments |
| A7 | Idempotence harness — test that `disassemble → emit → re-disassemble → emit` produces identical output |
| A8 | Orphan handling (§5.2) |
| A9 | Inline instruction comments (§3.4) — `;;` grammar, `addressInlineComments` map, emitter/parser round-trip |
| A10 | Replace `writeCommentsOut` with `writeSymbolsOut` (§3.8) — strip prose, skip nameless entries, emit structured-field placeholders for subroutines |

### 7.2 Stream B — Clean assembler output

| Phase | Deliverable |
|-------|-------------|
| B1 | `--cleanout`/`--cleanout-format`/`--cleanout-hex` CLI options |
| B2 | `CleanEmitter` class with sjasmplus dialect |
| B3 | Data grouping (§6.5) |
| B4 | **CI regression tests** — golden-file byte-diff (`cleanout.golden.test.ts`), runs as part of `npm test`. Representative fixtures covering both dialects, gap handling, local labels, `DEFS` runs |
| B5 | Maxam dialect |
| B6 | Manual smoke test — documented procedure: emit → external `sjasmplus`/`maxam` → compare bytes to original binary. Pre-release checklist item |

Stream A is more valuable for day-to-day RE work and should ship first.
Stream B is straightforward formatter work and can follow.

---

## 8. Open questions

1. **Round-trip scope for v1.** Resolved: instruction-level inline
   comment preservation IS included in v1, using the explicit `;;`
   marker (§3.4 approach B). Auto content before `;;` is regenerated;
   user content after `;;` is preserved verbatim. Line-above prose
   (§3.3) remains the recommended style for longer notes.
2. **Register override policy.** Resolved: Option A — `Corrupted:` and
   `Preserved:` are always regenerated from the analyser output. User
   edits to those lines in the `.asm` are discarded on re-read. Users
   who truly need to override the analyser use the sidecar
   `--symbols` file with `corrupted:` / `preserved:` markers, which
   continues to work unchanged.
3. **Free-form top-of-file comments.** Resolved: preserve everything
   above the first banner verbatim. Any line the disassembler writes
   before the first subroutine banner on its own runs (e.g. a future
   file-header stamp) must be clearly distinguishable from user text
   — simplest is "the disassembler writes nothing here". The whole
   pre-first-banner region belongs to the user and round-trips
   byte-for-byte.
4. **Idempotence testing.** Resolved: yes. A dedicated test harness
   is part of the v1 deliverables (phase A7 in §7.1). For each
   scenario (bare binary, user-edited labels, user-edited structured
   fields, `;;` inline comments, orphans), the harness runs
   `disassemble → emit → re-disassemble → emit` and byte-diffs the
   two outputs. Any drift fails the test.
5. **Clean output: hex style default per assembler.** Resolved in §6.3:
   `$AB` (z80) for sjasmplus, `#AB` (cpc) for maxam. `--cpc` is
   orthogonal — it controls RST handling only and does not influence
   the clean-output hex style. Users pass `--cleanout-hex` for explicit
   override.
6. **Clean output: re-assembleability test in CI.** Resolved:
   - **Manual smoke test** (local, pre-release): documented procedure
     that a developer runs before releases — disassemble a known
     binary, feed the `--cleanout` file through `sjasmplus` and
     `maxam`, diff the resulting bytes against the original.
   - **CI regression tests** (every build): golden-file comparison
     — checked-in reference outputs for representative fixtures, the
     CI job byte-diffs the emitter output against them. Any
     unexpected change fails the build; intentional changes require
     updating the golden file in the same commit. These tests join
     the existing mocha suite as a new test file (e.g.
     `src/tests/cleanout.golden.test.ts`) and run on every `npm test`.
   Promotion of the manual smoke test to automated CI can happen
   later if it proves worth the build-time cost (running an external
   assembler in CI is slow and needs its binary available).

---

## 9. Non-goals (explicit)

Confirmed: the following are explicitly out of scope for this feature
and should not be added without a separate design decision.

- **Re-parsing actual assembly code.** The `.asm` file is not a
  re-assembler input. The binary is always the source of truth for
  code. The `.asm` file contributes only documentation and labels.
- **Merging edits from concurrent disassembly runs.** Two users editing
  the same `.asm` at the same time is out of scope — that's a version
  control problem.
- **Reformatting the user's prose.** Line-above user comments are
  emitted verbatim, including whitespace. The disassembler does not
  re-wrap paragraphs or adjust indentation inside user-owned regions.
- **Binary patching.** `--cleanout` produces assembler source, not a
  patched binary or diff.
