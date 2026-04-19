# Subroutine Header Generation

This document describes how the Z80 disassembler identifies subroutines and
how it generates the commented header that precedes every subroutine in the
final disassembly output.

All code references point at [src/disassembler/](../src/disassembler/).

---

## 1. Example of a Generated Header

For every subroutine discovered in the disassembled memory, a three-line
comment block is emitted directly before the subroutine's label:

```
; Subroutine: Size=12, CC=2.
; Called by: SUB001[0123], 0456.
; Calls: SUB002, SUB003.
SUB004:
    LD   A,(HL)
    ...
    RET
```

For a `RST` target the first word becomes `Restart`; if the subroutine calls
itself the first line contains `Recursive`.

---

## 2. How Subroutines Are Discovered

A label becomes a "subroutine" in one of two ways.

### 2.1 Directly from opcode decoding

Every opcode carries a `valueType` that classifies the address the opcode
points at. The `CALL` and `RST` opcodes set that type to `CODE_SUB` /
`CODE_RST`:

- [opcode.ts:134-136](../src/disassembler/opcode.ts#L134-L136) — `CALL`
  instructions: `OpcodeFlag.CALL | OpcodeFlag.BRANCH_ADDRESS`,
  `valueType = NumberType.CODE_SUB`.
- [opcode.ts:191-194](../src/disassembler/opcode.ts#L191-L194) — `RST`
  instructions: same flags, `valueType = NumberType.CODE_RST`.

During the label collection pass, `disassembleForLabel()` at
[disasm.ts:959-1024](../src/disassembler/disasm.ts#L959-L1024) (invoked from
`collectLabels()` around
[disasm.ts:773](../src/disassembler/disasm.ts#L773)) reads that `valueType`
for every branch-like opcode and calls
`setFoundLabel(branchAddress, new Set([opcodeAddress]), valueType, attr)`.
This creates/updates the [DisLabel](../src/disassembler/dislabel.ts) for the
target address and — crucially — adds the caller address to the target
label's `references` set.

### 2.2 By promotion from `CODE_LBL` to `CODE_SUB`

Some subroutines are entered via `JP` rather than `CALL` (tail calls, jump
tables, hand-written assembly). They start life as `CODE_LBL`. The function
`turnLBLintoSUB()` at
[disasm.ts:1181-1202](../src/disassembler/disasm.ts#L1181-L1202) walks every
`CODE_LBL` and, with the helper `findRET()` at
[disasm.ts:1212-1276](../src/disassembler/disasm.ts#L1212-L1276), traces the
control flow looking for a `RET`. If a `RET` is reachable the label is
promoted to `CODE_SUB` at
[disasm.ts:1197](../src/disassembler/disasm.ts#L1197).

---

## 3. The Disassembly Pipeline

The top-level entry point `disassemble()` at
[disasm.ts:247-306](../src/disassembler/disasm.ts#L247-L306) orchestrates the
passes that provide the data the header generator later consumes:

| Pass | Function | Purpose |
|------|----------|---------|
| 1 | `collectLabels()` | Decode opcodes, create labels, fill `references`. |
| 2 | `adjustCodePointingLabels()` / `addFlowThroughReferences()` | Fix up mid-instruction labels and implicit fall-throughs. |
| 3 | `turnLBLintoSUB()` | Promote jump targets that reach `RET`. |
| 4 | `addParentReferences()` [disasm.ts:1437](../src/disassembler/disasm.ts#L1437) | Fill `addressParents[]`: maps every address to its enclosing subroutine. Strips self-references. |
| 5 | `addCallsListToLabels()` | For every label, walk `references`, look up the parent subroutine, and push it into that parent's `calls` array. |
| 6 | `countStatistics()` [disasm.ts:1615](../src/disassembler/disasm.ts#L1615) | Fill `subroutineStatistics` (size in bytes, instruction count, cyclomatic complexity). |
| 7 | `assignLabelNames()` | Produce names like `SUB001`, `RST_0038`, ... |
| 8 | `addLabelComments()` | Build the header Comment for each label. |
| 9 | `disassembleMemory()` | Emit the final text, inserting header comments before each label. |

Only after steps 4–7 does every subroutine label own the full data needed
by the header: callers (`references`), callees (`calls`), size/CC
(`subroutineStatistics`), and a stable name.

---

## 4. Data Backing the Header

The header is purely a projection of data already stored on the label and in
parallel maps.

### 4.1 `DisLabel` ([dislabel.ts](../src/disassembler/dislabel.ts))

- `type: NumberType` — `CODE_SUB`, `CODE_RST`, `CODE_LBL`, `DATA_LBL`, ...
- `name: string` — printed name of the subroutine.
- `references: Set<number>` ([dislabel.ts:26](../src/disassembler/dislabel.ts#L26)) — every address that `CALL`s or `JP`s here. Source of the "Called by:" line.
- `calls: Array<DisLabel>` ([dislabel.ts:29](../src/disassembler/dislabel.ts#L29)) — every subroutine this subroutine invokes. Source of the "Calls:" line.
- `isEqu: boolean` — suppresses the "Calls:" line for EQU-only labels.

### 4.2 `SubroutineStatistics` ([statistics.ts:3-12](../src/disassembler/statistics.ts#L3-L12))

- `sizeInBytes`
- `countOfInstructions`
- `CyclomaticComplexity`

Stored in `Disassembler.subroutineStatistics: Map<DisLabel, SubroutineStatistics>`
and populated by `countStatistics()` walking each subroutine's reachable
addresses.

### 4.3 `addressParents: DisLabel[]`

Declared at [disasm.ts:40-41](../src/disassembler/disasm.ts#L40-L41). Indexed
by address; yields the containing subroutine label. Used in the header to
turn a raw caller address into `parentName[hexAddr]` and to detect
recursion (`parent == addrLabel`).

---

## 5. Where the Header Is Composed

### 5.1 `addLabelComments()` — driver

[disasm.ts:1908-1929](../src/disassembler/disasm.ts#L1908-L1929)

Iterates every label, skips anything that isn't `CODE_SUB`, `CODE_RST`,
`CODE_LBL`, or `DATA_LBL`, and — if no user comment is already present in
`addressComments` — asks `getAddressComment()` for a generated one and stores
the result in `this.addressComments`.

### 5.2 `getAddressComment()` — dispatcher

[disasm.ts:1943-1950](../src/disassembler/disasm.ts#L1943-L1950)

Returns an existing (user-supplied) `Comment` if there is one, otherwise
delegates to `getLabelComments()`.

### 5.3 `getLabelComments()` — the actual header builder

[disasm.ts:1960-2079](../src/disassembler/disasm.ts#L1960-L2079)

This is the function that produces the three header lines.

**Line 1 — subroutine metadata**
[disasm.ts:2012-2018](../src/disassembler/disasm.ts#L2012-L2018)

```
Subroutine[: [Recursive, ]Size=<bytes>, CC=<complexity>.]
```

- Prefix is `Subroutine` for `CODE_SUB` and `Restart` for `CODE_RST`
  (chosen at [disasm.ts:1974-1979](../src/disassembler/disasm.ts#L1974-L1979)).
- `Recursive` is inserted when any caller has been found to live inside the
  same subroutine (detected while building line 2).
- `Size` and `CC` are read from `subroutineStatistics`; if no statistics
  exist the line degrades to just `Subroutine.` / `Restart.`.

**Line 2 — callers**
[disasm.ts:1987-2010](../src/disassembler/disasm.ts#L1987-L2010)

```
Called by: parent1[addr1], parent2[addr2], ... .
```

Built by iterating `addrLabel.references`. Each caller address is hex-
formatted (`Format.formatHex(ref, 4)`). Its parent subroutine is looked up
in `addressParents[ref]`; when the parent is the subroutine itself the
name is replaced by `self` and the `recursiveFunction` flag is set for
line 1. With no references the line ends in `-` instead of `.`.

**Line 3 — callees**
[disasm.ts:2026-2037](../src/disassembler/disasm.ts#L2026-L2037)

```
Calls: SUBxxx, SUByyy, ... .
```

Deduplicates `addrLabel.calls` through a `Set<DisLabel>` and joins the
names with `, `. Empty list ends in `-`. Suppressed for EQU labels.

**Packaging**
[disasm.ts:2067-2075](../src/disassembler/disasm.ts#L2067-L2075)

Each generated string is prefixed with `'; '` and pushed into
`comment.linesBefore`:

```ts
comment.linesBefore = lineArray.map(s => '; ' + s);
```

For non-subroutine label types (`CODE_LBL`, `DATA_LBL`) the `default`
branch at [disasm.ts:2042-2064](../src/disassembler/disasm.ts#L2042-L2064)
emits a simpler "Label accessed by:" or "Data accessed by:" block using
the same `references` / `addressParents` data.

### 5.4 `Comment` — storage and rendering

[comment.ts](../src/disassembler/comment.ts)

- `linesBefore: Array<string>` — the header block.
- `inlineComment: string` — the comment following the label on the same
  line (used for EQU labels at
  [disasm.ts:2069-2071](../src/disassembler/disasm.ts#L2069-L2071)).
- `linesAfter: Array<string>` — optional trailing comment.
- Static `Comment.getLines()` at
  [comment.ts:36-53](../src/disassembler/comment.ts#L36-L53) turns a
  `Comment` and a label statement (e.g. `SUB001:`) into the final array of
  output lines, honouring the global `disableComments` flag.

The disassembly emitter in `disassembleMemory()` looks up
`addressComments.get(address)` for each label address and passes the result
to `Comment.getLines()`, so the header appears immediately before the
label in the output stream.

---

## 6. Summary of Header Contents

| Line | Content | Source |
|------|---------|--------|
| 1 | `Subroutine` or `Restart`, optional `Recursive` flag, `Size=<bytes>`, `CC=<cyclomatic complexity>` | `DisLabel.type`, `subroutineStatistics` |
| 2 | `Called by:` every caller as `parentName[hexAddr]` (or `self[hexAddr]` for recursion, bare hex if no parent) | `DisLabel.references`, `addressParents[]` |
| 3 | `Calls:` deduplicated list of callee subroutine names (omitted for EQU labels) | `DisLabel.calls` |

Every piece of information in the header is derived from label state that
earlier passes of `disassemble()` build up; `getLabelComments()` itself
performs no analysis, it only formats.

---

## 7. Proposed Change: Condensed Firmware-Style Header

The current three-line header is compact but lacks the behavioural
information an assembly-level reader usually wants when studying a
subroutine. The Amstrad CPC firmware manual documents each firmware entry
with a fixed set of fields:

- Function name and entry address.
- A one-line **Summary**.
- An **Action** description.
- **Entry conditions** (which registers carry inputs).
- **Exit conditions**, typically split into success / failure / always
  cases, including which registers/flags are corrupt or preserved.

The goal of this change is to adopt that structure for every subroutine
emitted by the disassembler while keeping all information the current
header already provides.

### 7.1 Design goals

1. **Visually unmistakeable.** Every subroutine starts with a triple-row
   asterisk banner so the reader can scan the listing and find entry
   points at a glance.
2. **Single standardised template.** Every subroutine header is laid out
   identically. Fields are always present (and in the same order); empty
   fields render as an em-dash `—` so the layout does not collapse.
3. **Auto-filled where possible, user-overridable where needed.**
   Everything the disassembler can compute — size, CC, callers, callees,
   and the Corrupted / Preserved register lists — is emitted
   automatically. Prose fields the disassembler cannot derive from
   static analysis (Summary, Action, Entry, Exit conditions) are left
   blank by default. Both categories are populated / overridden through
   the existing `--comments` input file mechanism; when a user provides
   an explicit register list it supersedes the automatically computed
   one.
4. **Compatible with the existing `Comment` plumbing.** The banner and
   body are still stored in `Comment.linesBefore` and rendered by
   `Comment.getLines()` — only the content produced inside
   `getLabelComments()` changes.

### 7.2 Fixed layout

Every subroutine header is **79 columns wide** (suitable for standard
terminals and assembler listings). The layout is, in order:

**First-run (undocumented) output — 15 lines:**

```
; *****************************************************************************
; *** sub <NAME>                                                            ***
; *****************************************************************************
; Address:   $XXXX     Size: NN bytes   Instructions: NN   CC: NN
; Type:      Subroutine | Restart | Recursive subroutine
; Summary:   —
; Action:    —
; Entry:     —
; Exit (success): —
; Exit (failure): —
; Corrupted: <comma-separated list or "—">
; Preserved: <comma-separated list or "—">
; Called by: <parentName[$addr], ... or "—">
; Calls:     <SUB_A, SUB_B, ... or "—">
; *****************************************************************************
<NAME>:
```

**Fully-documented output (multi-line Action/Entry):**

```
; *****************************************************************************
; *** sub <NAME>                                                            ***
; *****************************************************************************
; Address:   $XXXX     Size: NN bytes   Instructions: NN   CC: NN
; Type:      Subroutine | Restart | Recursive subroutine
; Summary:   <one-line summary — user-supplied>
; Action:
;   <line 1 of description>
;   <line 2 of description>
; Entry:
;   <register — description>
; Exit (success): <condition — user-supplied>
; Exit (failure): <condition — user-supplied>
; Corrupted: <comma-separated list or "—">
; Preserved: <comma-separated list or "—">
; (analysis unavailable: <reason>)      ← only when analyser gave up
; Called by: <parentName[$addr], ... or "—">
; Calls:     <SUB_A, SUB_B, ... or "—">
; *****************************************************************************
<NAME>:
```

#### Banner rules

- Top and bottom rule: `; ` + 77 × `*` = 79 characters.
- Middle line: `; *** ` (6 chars) + `sub ` + label name, right-padded with
  spaces, + ` ***` (4 chars) = 79 characters total.
    - Prefix is always `sub `, regardless of whether the label was reached
      via `CALL` (`CODE_SUB`) or `RST` (`CODE_RST`). See §7.7 for the
      reasoning. The `Type:` line inside the header body still
      distinguishes them for readers who care.
    - If the label name plus `sub ` prefix exceeds the 69-char content
      area the name is truncated with a trailing `…`; truncation should
      never happen in practice because label names stay short.
- **No blank separator lines** between fields — the field labels are
  self-describing and blank lines add no information.

#### Field rules

| Field | Auto / User | Source |
|-------|-------------|--------|
| `Address` | Auto | label address, formatted as `$XXXX` |
| `Size`, `Instructions`, `CC` | Auto | `subroutineStatistics` |
| `Type` | Auto | `DisLabel.type` + recursion flag (prior logic) |
| `Summary` | User | `--comments` input, new `summary:` marker |
| `Action` | User | `--comments` input, new `action:` marker |
| `Entry` | User | `--comments` input, new `entry:` marker |
| `Exit (success)`, `Exit (failure)` | User | `--comments` input, new markers |
| `Registers: Corrupted` | Auto (new analysis) + user override | see §7.3; overridable via `corrupted:` marker |
| `Registers: Preserved` | Auto (new analysis) + user override | see §7.3; overridable via `preserved:` marker |
| `Called by` | Auto | `DisLabel.references` + `addressParents[]` (unchanged) |
| `Calls` | Auto | `DisLabel.calls` (unchanged) |

When a user-supplied field is empty the placeholder is rendered inline
(`; Action:    —`, `; Entry:     —`) so the header stays compact on a
first run. Multi-line fields (`Action:`, `Entry:`) expand to a labelled
block only when real content is present. `Exit (success):` and
`Exit (failure):` are always inline — exit conditions are normally a
single sentence. `Corrupted:` and `Preserved:` appear at top level
(no `Registers:` group label).

### 7.3 Register-usage analysis

The Corrupted and Preserved lists are produced by a new pass,
`analyzeRegisterUsage()`, that runs once per subroutine after
`countStatistics()` and before `addLabelComments()` in the pipeline at
[disasm.ts:247-306](../src/disassembler/disasm.ts#L247-L306).

The two lists collapse the Amstrad manual's "Always" section into
explicit register sets:

- **Corrupted** — a register whose value may differ between entry and
  exit on *some* path through the subroutine.
- **Preserved** — a register whose value is guaranteed to be identical
  on entry and exit across *all* paths through the subroutine.

A register that the analysis cannot classify with confidence (see
"unknown" handling below) appears in neither list.

#### 7.3.1 Algorithm

For each `CODE_SUB` / `CODE_RST` label:

1. **Enumerate reachable addresses.** Reuse the traversal logic already
   present in `countAddressStatistic()` (walks successors, stops at
   `RET`, handles branches). The walk yields the opcode sequence and
   the set of `RET`-reaching exit points.
2. **Per-opcode register effects.** Extend the opcode table with two
   masks:
     - `writes`  — registers whose value this opcode clobbers.
     - `reads`   — registers this opcode consumes (needed later if the
                   feature is ever extended; not part of the current
                   output).
   Registers are tracked at the 8-bit level (A, B, C, D, E, H, L, I,
   R, IXH, IXL, IYH, IYL, F) plus the alternate set (AF', BC', DE',
   HL') and SP. A 16-bit operation sets both halves; `EX`, `EXX`, and
   `EX AF,AF'` swap the matching pairs.
3. **Union over all reachable opcodes** → `maybeWritten`.
4. **Detect PUSH/POP restoration.**
     - Walk the prologue forward from the entry address, collecting
       any leading `PUSH rr` (paired, no intervening writes to `rr`).
     - Walk every `RET`-reaching path backward, collecting the
       trailing `POP rr` sequence.
     - A register `rr` is *restored* iff, for every exit path, the
       trailing `POP rr` sequence ends with the same register that the
       prologue pushed, in LIFO order.
   The restored set is subtracted from `maybeWritten`.
5. **Handle CALLs to other subroutines.** The analysis runs bottom-up
   on the call graph (topological order over `DisLabel.calls`, ignoring
   recursion back-edges). Each callee already has its own Corrupted
   set; the caller simply adds the callee's Corrupted registers to its
   own `maybeWritten`. Recursive SCCs are solved with a fixed-point
   iteration.
6. **Classify** per register:
     - `Corrupted`  = `maybeWritten \ restored`.
     - `Preserved`  = (all tracked registers) `\ maybeWritten`, minus
                     any register marked "unknown".
     - `Unknown`    = the complement (kept internally; not printed).

#### 7.3.2 When a register becomes "unknown"

Static analysis is unsound when control flow or register effects cannot
be decided. In any of these cases the analysis marks *every* tracked
register as unknown for that subroutine (both lists print `—`):

- An `IN` / `OUT` opcode whose operand is dynamic (rare; still tracked
  conservatively).
- A `JP (HL)` / `JP (IX)` / `JP (IY)` whose target is not resolvable
  from the existing label graph.
- An indirect `CALL` through a jump table the disassembler has not
  decoded.
- Self-modifying code in the subroutine's reachable range (detected by
  the existing flow analysis).
- A call to a subroutine that is itself "unknown".

Printing `—` for unknown is deliberately honest: better a blank
placeholder the user must fill in than confident-looking but wrong
documentation.

When the analyser gives up, it also records **why** so the header can
tell the reader that `—` means "statically undecidable" rather than
"not yet documented". The first triggering construct encountered is
saved as a short reason string plus its address and emitted as an
extra comment line directly below the two register lists:

```
; Registers:
;   Corrupted: —
;   Preserved: —
;   (analysis unavailable: JP (HL) at $A123 prevents static classification)
```

Reason strings are fixed phrases keyed to the triggering case, for
example:

| Trigger | Reason phrase |
|---------|---------------|
| Unresolved `JP (HL)` / `JP (IX)` / `JP (IY)` | `JP (HL) at $XXXX prevents static classification` |
| Indirect `CALL` via undecoded table | `indirect CALL at $XXXX prevents static classification` |
| Self-modifying code detected | `self-modifying code at $XXXX prevents static classification` |
| Dynamic `IN` / `OUT` | `dynamic I/O at $XXXX prevents static classification` |
| Callee itself unknown | `calls unknown subroutine <NAME> at $XXXX` |

Only one such line is emitted, for the first triggering address in
address order. The note is omitted entirely when the analysis
succeeds, so successful subroutines remain one line shorter than
unanalysable ones — an intentional asymmetry: the extra line only
appears when there is extra information to convey. A user override
(`corrupted:` / `preserved:` marker) suppresses the note regardless of
analyser state, because once the human has documented the registers
the reason is no longer relevant.

#### 7.3.3 Storage

A new field on `DisLabel`:

```ts
export class DisLabel {
    // ... existing fields ...

    /// Registers whose value may change across the subroutine call.
    public corruptedRegisters?: Set<string>;

    /// Registers whose value is guaranteed to be preserved.
    public preservedRegisters?: Set<string>;

    /// Populated when the analyser gave up. Rendered as the
    /// "(analysis unavailable: ...)" note under the Registers group.
    /// undefined when analysis succeeded (or has not run).
    public registerAnalysisUnavailable?: {
        reason: string;       // e.g. "JP (HL) at $A123 prevents static classification"
        address: number;      // the triggering opcode address
    };
}
```

`undefined` means "not analysed" (e.g. non-subroutine labels).
Empty `Set` means "analysed, result is empty" — distinct from unknown,
which is represented by both sets being `undefined` *after* the pass
has run (or by a sentinel flag if we prefer).

#### 7.3.4 User override

If `setAddressComments()` has parsed a `corrupted:` or `preserved:`
marker for this address, `getLabelComments()` uses the user-provided
list verbatim and ignores the auto-detected one. The two markers are
independent — a user can override just Corrupted and let the analysis
fill Preserved, or vice versa.

### 7.4 User-supplied fields via the `--comments` file

The existing `setAddressComments()` loader
([disasm.ts:2090](../src/disassembler/disasm.ts#L2090)) already attaches
free-form comment lines to an address. It is extended to recognise
structured markers on the "lines before" section, e.g.:

```
; summary: Allocate a buffer for expansion strings.
; action: Set the address and length of the expansion buffer.
;         Initialise the buffer with the default expansion strings.
; entry:  DE = address of the buffer
;         HL = length of the buffer
; exit-success: Carry set
; exit-failure: Carry clear (buffer too short)
; corrupted: A, BC, DE, HL, F
; preserved: IX, IY
0BB15: KM_EXP_BUFFER
```

When building the header, `getLabelComments()` prefers these structured
fields over the auto-generated defaults — i.e. a `corrupted:` /
`preserved:` marker overrides the result of §7.3's analysis for that
subroutine only. Markers are optional: omit them entirely and the
header falls back to the computed lists. Unstructured comment lines in
the user's file keep their current behaviour (appended verbatim as
additional `linesBefore`).

### 7.5 Concrete example

Applied to the Amstrad firmware entry given in the task description the
output would be:

```
; *****************************************************************************
; *** sub KM_EXP_BUFFER                                                     ***
; *****************************************************************************
; Address:   BB15h     Size: 23 bytes   Instructions: 9   CC: 2
; Type:      Subroutine
; Summary:   Allocate a buffer for expansion strings.
; Action:
;   Set the address and length of the expansion buffer. Initialise the
;   buffer with the default expansion strings.
; Entry:
;   DE = address of the buffer
;   HL = length of the buffer
; Exit (success): Carry set.
; Exit (failure): Carry clear (buffer too short).
; Corrupted: A, BC, DE, HL, F
; Preserved: IX, IY
; Called by: SUB001[A123h]
; Calls:     KM_INITIALISE[BB00h]
; *****************************************************************************
KM_EXP_BUFFER:
    ...
```

### 7.6 Impact on existing code

The implementation of this proposal touches the following places:

1. **New fields on `DisLabel`** — `corruptedRegisters`, `preservedRegisters`,
   and `registerAnalysisUnavailable` (§7.3.3). —
   [dislabel.ts](../src/disassembler/dislabel.ts)
2. **Opcode-table extension** to publish per-opcode `writes` / `reads`
   register masks used by the new pass. —
   [opcode.ts](../src/disassembler/opcode.ts)
3. **New pass `analyzeRegisterUsage()`** invoked from `disassemble()`
   between `countStatistics()` and `addLabelComments()`. Walks each
   subroutine's reachable addresses, detects PUSH/POP symmetry,
   propagates callee effects bottom-up over the call graph, and — when
   it cannot classify — records the first triggering construct in
   `registerAnalysisUnavailable` so the header can explain why the
   lists are blank. —
   [disasm.ts:282-289](../src/disassembler/disasm.ts#L282-L289)
4. **Rewrite of `getLabelComments()`** to emit the banner + 79-column
   template instead of the three-line form, consuming the new
   `DisLabel` fields (with user-override fallback from §7.3.4). —
   [disasm.ts:1960-2079](../src/disassembler/disasm.ts#L1960-L2079)
5. **Extension of `setAddressComments()`** to recognise the structured
   markers `summary:` / `action:` / `entry:` / `exit-success:` /
   `exit-failure:` / `corrupted:` / `preserved:`. Parsed values are
   attached to the `Comment` (or to a parallel per-address map) so the
   header formatter can read them and override auto-detection when
   present. —
   [disasm.ts:2090](../src/disassembler/disasm.ts#L2090)
6. **No changes** to `Comment` or to the disassembly emitter — the
   banner is plain text pushed into `comment.linesBefore`, so
   `Comment.getLines()` keeps working unchanged.
7. **Non-subroutine labels** (`CODE_LBL`, `DATA_LBL`) retain their
   current one-/two-line comment form. The banner is reserved for
   `CODE_SUB` and `CODE_RST` only, so subroutines stand out from
   ordinary local labels.

### 7.7 Resolved decisions and remaining open questions

#### Resolved

- **Banner width — fixed 79 columns.** No CLI flag in v1. Aligns with
  traditional assembler listings and keeps the template calculable at
  compile time.
- **Banner prefix — always `sub `, never `rst `.** On the Amstrad CPC
  (the disassembler's primary target) a ROM is not aware of its own
  ROM number — the number is a user/hardware-level assignment (jumper)
  and a given ROM can sit at any supported slot. CPC far calls through
  RST are therefore implemented by short stubs that live in RAM,
  compute the current ROM number at run time, and only then issue the
  RST. Because the ROM number is not statically encoded anywhere in
  the ROM image, a static disassembler cannot resolve which routine a
  CPC-style RST eventually reaches without actually executing the code
  on real hardware. Labelling some labels `rst ` in the banner would
  therefore be misleading: it would suggest a distinct class of entry
  point that the tool cannot reliably identify on this platform. We
  keep the distinction in the internal `DisLabel.type` (it still
  reflects whether the label was reached via a `CALL` or a direct
  `RST` opcode, which *is* static information), and it surfaces in the
  `Type:` line inside the body. The banner itself stays uniform.
  Other Z80-based machines may use RST differently; if we ever retarget
  this question can be reopened.

- **Empty structured fields — always render, value `—`.** On the first
  disassembly run no `summary:` / `action:` / `entry:` / `exit-success:`
  / `exit-failure:` / `corrupted:` / `preserved:` markers exist yet.
  Each of those lines is still emitted, with `—` as the value, so the
  template stays uniform and the reader can immediately spot which
  fields still need documenting. The user then fills them in through
  the `--comments` file on subsequent runs.
- **Register granularity — collapse matching 16-bit pairs.** When both
  halves of a register pair share the same classification, print the
  pair name (`AF`, `BC`, `DE`, `HL`, `IX`, `IY`, `AF'`, `BC'`, `DE'`,
  `HL'`). When the halves differ, print them split (`B, C`). This
  keeps typical output compact (most subroutines manipulate whole
  pairs) without losing information in the rare asymmetric case.
  Applies to both the Corrupted and Preserved lists.
- **"Analysis unavailable" note — emit when the analyser gave up.**
  When `analyzeRegisterUsage()` falls back to "unknown" (§7.3.2) an
  extra line is printed directly below the two register lists:

  ```
  ; Registers:
  ;   Corrupted: —
  ;   Preserved: —
  ;   (analysis unavailable: JP (HL) at $A123 prevents static classification)
  ```

  This disambiguates "not yet documented" (`—` from an un-run analysis
  or a first disassembly pass) from "statically undecidable" (analyser
  tried and refused to commit). The line is omitted entirely when
  analysis succeeds and when the user has overridden the register
  lists via `corrupted:` / `preserved:` markers, so it only ever
  appears when there is extra information to convey. The header's
  line count is therefore not strictly fixed — unanalysable
  subroutines gain exactly one extra line, which is the intended
  signal.

No open questions remain.

---

## 8. Implementation Draft

This chapter is an easy-reference checklist: every code change the
proposal implies, file by file, with the intended signatures and a
pseudocode sketch of each new or rewritten function. It is not a
finished patch — it's the "before you open the editor" map.

### 8.1 New shared types

Put these in a new file `src/disassembler/registerAnalysis.ts` to keep
`disasm.ts` uncluttered.

```ts
/// Every Z80 register we track. 8-bit granularity; the printer
/// collapses pairs (§7.7 resolved decision).
export type Z80Register =
    | 'A' | 'F'
    | 'B' | 'C' | 'D' | 'E' | 'H' | 'L'
    | 'I' | 'R'
    | 'IXH' | 'IXL' | 'IYH' | 'IYL'
    | 'SP'
    | "A'" | "F'" | "B'" | "C'" | "D'" | "E'" | "H'" | "L'";

/// Register-effect masks attached to each Opcode (§8.3).
export interface RegisterEffects {
    writes: ReadonlySet<Z80Register>;
    reads:  ReadonlySet<Z80Register>;
}

/// Output of analyzeRegisterUsage() (§8.6).
export interface RegisterAnalysisResult {
    corrupted: Set<Z80Register>;
    preserved: Set<Z80Register>;
    /// Present iff the analyser gave up.
    unavailable?: {
        reason:  string;   // e.g. "JP (HL) at $A123 prevents static classification"
        address: number;
    };
}

/// User-supplied structured fields (§8.9).
export interface StructuredFields {
    summary?:     string;
    action?:      string[];
    entry?:       string[];
    exitSuccess?: string[];
    exitFailure?: string[];
    /// User override for the two register lists. Suppresses the
    /// "(analysis unavailable: ...)" note when either is set.
    corrupted?:   Z80Register[];
    preserved?:   Z80Register[];
}
```

### 8.2 `DisLabel` — new fields
[dislabel.ts](../src/disassembler/dislabel.ts)

```ts
export class DisLabel {
    // ... existing fields unchanged ...

    /// §7.3 — populated by analyzeRegisterUsage().
    public corruptedRegisters?: Set<Z80Register>;
    public preservedRegisters?: Set<Z80Register>;

    /// §7.3.2 — set iff the analyser gave up. Feeds the
    /// "(analysis unavailable: ...)" note.
    public registerAnalysisUnavailable?: {
        reason:  string;
        address: number;
    };
}
```

No constructor changes required — all three fields stay `undefined`
until `analyzeRegisterUsage()` runs.

### 8.3 `Opcode` — per-opcode register masks
[opcode.ts](../src/disassembler/opcode.ts)

Every opcode entry gains two new optional fields:

```ts
export class Opcode {
    // ... existing fields unchanged ...

    /// Registers written (destination / clobbered) by this opcode.
    public writes?: ReadonlySet<Z80Register>;

    /// Registers read (source / consumed) by this opcode.
    public reads?:  ReadonlySet<Z80Register>;
}
```

The opcode tables in `opcode.ts` are extended so every row fills these
two sets. Special handling:

- `LD rr,nn`  — writes both halves of `rr`.
- `EX DE,HL`  — writes `{D,E,H,L}`, reads `{D,E,H,L}`.
- `EXX`       — swaps main/alternate; treated as writing *both*
                 main and alternate sets.
- `EX AF,AF'` — writes `{A,F,A',F'}`, reads same.
- `PUSH rr` / `POP rr` — only touch SP + the named pair; they are the
  inputs to the restoration heuristic and must be tagged accurately.
- `CALL nn`   — writes SP; the callee's effect is layered on top by
                 `analyzeRegisterUsage()` (§8.6 step 5).
- `JP (HL)`, `IN`/`OUT` with dynamic operand, and any opcode decoded
   over self-modifying data leave the masks empty *and* trigger the
   "unavailable" path (§8.6 step 2).

The tables are long but mechanical; a one-time Python/JS generator
script from the Z80 instruction reference is the cheapest path.

### 8.4 `Disassembler` — new instance fields
[disasm.ts:30-51](../src/disassembler/disasm.ts#L30-L51)

One additional map, alongside the existing `addressComments`:

```ts
/// User-supplied structured fields, keyed by address (§8.9).
protected addressStructured = new Map<number, StructuredFields>();
```

No changes to `addressComments`, `subroutineStatistics`,
`addressParents`, `labels`, or any other existing field.

### 8.5 `disassemble()` — pipeline insertion
[disasm.ts:247-306](../src/disassembler/disasm.ts#L247-L306)

Add one line, between `countStatistics()` (step 6) and
`assignLabelNames()` (step 7):

```ts
// ... existing passes ...
this.countStatistics();

// NEW: §7.3. Must run before addLabelComments() so the header
// formatter can read corruptedRegisters / preservedRegisters.
this.analyzeRegisterUsage();

this.assignLabelNames();

if (!this.disableCommentsInDisassembly)
    this.addLabelComments();
// ... rest unchanged ...
```

### 8.6 New `analyzeRegisterUsage()` — the pass itself
New method on `Disassembler`, placed near `countStatistics()`.

```ts
protected analyzeRegisterUsage(): void {
    // 1. Topological order over the call graph, ignoring recursion
    //    back-edges. SCCs are solved with a fixed-point pass.
    const order = this.topoSortSubroutines();

    for (const sub of order) {
        const result = this.analyzeOneSub(sub);
        sub.corruptedRegisters = result.corrupted;
        sub.preservedRegisters = result.preserved;
        if (result.unavailable)
            sub.registerAnalysisUnavailable = result.unavailable;
    }

    // Second pass over recursive SCCs until stable.
    this.fixpointRecursiveSubs(order);
}

protected analyzeOneSub(sub: DisLabel): RegisterAnalysisResult {
    const maybeWritten = new Set<Z80Register>();
    let unavailable: RegisterAnalysisResult['unavailable'];

    // 1. Enumerate reachable addresses (same traversal as
    //    countAddressStatistic()).
    for (const addr of this.reachableAddresses(sub)) {
        const op = this.decodeAt(addr);

        // 2. Unavailable triggers — first one wins.
        const reason = this.unavailableReason(op, addr);
        if (reason && !unavailable) {
            unavailable = { reason, address: addr };
            break;   // no point continuing; result is "unknown"
        }

        // 3. Accumulate writes.
        if (op.writes) op.writes.forEach(r => maybeWritten.add(r));

        // 5. Layer callee effects (bottom-up over the call graph).
        if (op.flags & OpcodeFlag.CALL) {
            const callee = this.labels.get(op.value);
            if (callee?.corruptedRegisters)
                callee.corruptedRegisters.forEach(r => maybeWritten.add(r));
            else if (callee?.registerAnalysisUnavailable && !unavailable)
                unavailable = {
                    reason:  `calls unknown subroutine ${callee.name} at ${Format.formatHex(addr,4)}`,
                    address: addr,
                };
        }
    }

    if (unavailable)
        return { corrupted: new Set(), preserved: new Set(), unavailable };

    // 4. Subtract registers restored by symmetric PUSH/POP.
    const restored = this.detectPushPopRestoration(sub);
    restored.forEach(r => maybeWritten.delete(r));

    // 6. Classify.
    const corrupted = maybeWritten;
    const preserved = new Set<Z80Register>(ALL_TRACKED_REGISTERS);
    corrupted.forEach(r => preserved.delete(r));

    return { corrupted, preserved };
}
```

Supporting helpers (also new, same file):

- `topoSortSubroutines(): DisLabel[]` — Kahn's algorithm over
  `label.calls`. Recursion back-edges dropped; recorded separately so
  `fixpointRecursiveSubs()` knows where to iterate.
- `fixpointRecursiveSubs(order)` — re-run `analyzeOneSub()` over each
  SCC until `corrupted` stops growing.
- `reachableAddresses(sub): Iterable<number>` — extract the walk that
  `countAddressStatistic()` already performs (refactor the shared
  traversal out into a private generator).
- `detectPushPopRestoration(sub): Set<Z80Register>` — matches leading
  `PUSH rr` in the prologue with trailing `POP rr` on *every* RET
  path in LIFO order. Returns the intersection across all exits.
- `unavailableReason(op, addr): string | undefined` — returns one of
  the fixed phrases from §7.3.2 when the opcode is a blocker.

### 8.7 Formatting helpers
Small, pure, same file as `getLabelComments()`.

```ts
/// Width constants — §7.2 resolved.
const HEADER_WIDTH  = 79;
const CONTENT_WIDTH = HEADER_WIDTH - '; *** '.length - ' ***'.length; // 69

function buildBannerRule(): string {
    return '; ' + '*'.repeat(HEADER_WIDTH - 2);
}

function buildBannerMid(name: string): string {
    const body = 'sub ' + name;
    const truncated = body.length > CONTENT_WIDTH
        ? body.substr(0, CONTENT_WIDTH - 1) + '…'
        : body.padEnd(CONTENT_WIDTH, ' ');
    return '; *** ' + truncated + ' ***';
}

/// §7.7 resolved: collapse AF/BC/DE/HL/IX/IY (and alternates) when
/// both halves share the same classification.
function collapseRegisterPairs(regs: Set<Z80Register>): string[] {
    const PAIRS: Array<[Z80Register, Z80Register, string]> = [
        ['A','F','AF'], ['B','C','BC'], ['D','E','DE'], ['H','L','HL'],
        ['IXH','IXL','IX'], ['IYH','IYL','IY'],
        ["A'","F'","AF'"], ["B'","C'","BC'"],
        ["D'","E'","DE'"], ["H'","L'","HL'"],
    ];
    const out: string[] = [];
    const remaining = new Set(regs);
    for (const [lo, hi, pair] of PAIRS) {
        if (remaining.has(lo) && remaining.has(hi)) {
            out.push(pair);
            remaining.delete(lo); remaining.delete(hi);
        }
    }
    // Leftover 8-bit and specials (I, R, SP) in canonical order.
    for (const r of CANONICAL_ORDER)
        if (remaining.has(r)) out.push(r);
    return out;
}

function renderList(items: string[] | undefined): string {
    return (items && items.length) ? items.join(', ') : '—';
}
```

### 8.8 Rewrite of `getLabelComments()`
[disasm.ts:1960-2079](../src/disassembler/disasm.ts#L1960-L2079)

The existing body is replaced wholesale for `CODE_SUB` / `CODE_RST`;
the `default` branch (for `CODE_LBL` / `DATA_LBL`) stays as today.

```ts
protected getLabelComments(address: number): Comment | undefined {
    const label = this.labels.get(address);
    if (!label) return undefined;

    if (label.type !== NumberType.CODE_SUB &&
        label.type !== NumberType.CODE_RST) {
        return this.getNonSubLabelComments(label);    // unchanged logic
    }

    const s        = this.addressStructured.get(address) ?? {};
    const stat     = this.subroutineStatistics.get(label);
    const isRst    = label.type === NumberType.CODE_RST;
    const recursive = [...label.references].some(
        ref => this.addressParents[ref] === label);

    const lines: string[] = [];

    // Banner (§7.2)
    lines.push(buildBannerRule());
    lines.push(buildBannerMid(label.name));
    lines.push(buildBannerRule());

    // Metadata line
    const type = recursive ? 'Recursive subroutine'
                : isRst    ? 'Restart'
                :            'Subroutine';
    lines.push(
        `Address:   $${Format.formatHex(address, 4)}` +
        `          Size: ${stat?.sizeInBytes ?? '?'} bytes` +
        `     Instructions: ${stat?.countOfInstructions ?? '?'}` +
        `     CC: ${stat?.CyclomaticComplexity ?? '?'}`);
    lines.push(`Type:      ${type}`);

    // User-supplied prose
    lines.push('');
    lines.push(`Summary:   ${s.summary ?? '—'}`);
    lines.push('');
    lines.push('Action:');
    (s.action ?? ['—']).forEach(l => lines.push('  ' + l));
    lines.push('');
    lines.push('Entry:');
    (s.entry ?? ['—']).forEach(l => lines.push('  ' + l));
    lines.push('');
    lines.push('Exit (success):');
    (s.exitSuccess ?? ['—']).forEach(l => lines.push('  ' + l));
    lines.push('Exit (failure):');
    (s.exitFailure ?? ['—']).forEach(l => lines.push('  ' + l));

    // Registers group (§7.3)
    lines.push('');
    lines.push('Registers:');
    const corrupted = s.corrupted
        ? renderList(collapseRegisterPairs(new Set(s.corrupted)))
        : renderList(label.corruptedRegisters
                     ? collapseRegisterPairs(label.corruptedRegisters)
                     : undefined);
    const preserved = s.preserved
        ? renderList(collapseRegisterPairs(new Set(s.preserved)))
        : renderList(label.preservedRegisters
                     ? collapseRegisterPairs(label.preservedRegisters)
                     : undefined);
    lines.push(`  Corrupted: ${corrupted}`);
    lines.push(`  Preserved: ${preserved}`);

    // "(analysis unavailable: ...)" note — only when analyser gave
    // up AND the user has not overridden either list.
    if (label.registerAnalysisUnavailable && !s.corrupted && !s.preserved) {
        lines.push(`  (analysis unavailable: ${label.registerAnalysisUnavailable.reason})`);
    }

    // Callers & callees (unchanged data sources)
    lines.push('');
    lines.push('Called by: ' + this.renderCallers(label));
    lines.push('Calls:     ' + this.renderCallees(label));

    // Closing banner
    lines.push(buildBannerRule());

    const comment = new Comment();
    comment.linesBefore = lines.map(l =>
        l.startsWith('; ') ? l : (l.length ? '; ' + l : ';'));
    return comment;
}
```

The two helpers `renderCallers()` / `renderCallees()` are a trivial
extraction of the existing logic from the old body (lines 1987–2037)
so the caller/callee construction is unchanged in behaviour.

### 8.9 Extension of `setAddressComments()`
[disasm.ts:2090-2172](../src/disassembler/disasm.ts#L2090-L2172)

The state machine gains a marker-aware branch inside the
`State.LinesBefore` case. A new helper extracts structured fields
from a `; <marker>: <text>` comment line.

```ts
const STRUCTURED_MARKERS = new Set([
    'summary', 'action', 'entry',
    'exit-success', 'exit-failure',
    'corrupted', 'preserved',
]);

function parseStructuredLine(commentText: string)
    : { marker: string; value: string } | undefined {
    // commentText still has leading ';' — strip it.
    const m = /^;\s*([a-z-]+)\s*:\s*(.*)$/.exec(commentText);
    if (!m) return undefined;
    if (!STRUCTURED_MARKERS.has(m[1])) return undefined;
    return { marker: m[1], value: m[2] };
}
```

Inside `setAddressComments()`, extend the loop so a structured
marker routes the rest of the line (and subsequent indented
continuation lines) into a `StructuredFields` object attached to the
current address, instead of appending to `comment.linesBefore`:

```ts
let structured: StructuredFields = {};
let currentMarker: string | undefined;

// in the LinesBefore branch:
case State.LinesBefore: {
    const parsed = commentPart && parseStructuredLine(commentPart);
    if (parsed) {
        currentMarker = parsed.marker;
        this.applyStructuredMarker(structured, parsed.marker, parsed.value);
    }
    else if (currentMarker && /^\s*;\s+\S/.test(commentPart ?? '')) {
        // Indented continuation of the previous marker.
        this.applyStructuredMarker(
            structured, currentMarker,
            commentPart!.replace(/^\s*;\s+/, ''));
    }
    else {
        currentMarker = undefined;
        comment.addBefore(commentPart);   // existing behaviour
    }
    break;
}
```

At the point where the finished `Comment` is currently stored
([disasm.ts:2118-2119](../src/disassembler/disasm.ts#L2118-L2119)),
also store the structured fields:

```ts
if (Object.keys(structured).length > 0)
    this.addressStructured.set(commentAddr, structured);
structured = {};
currentMarker = undefined;
```

`applyStructuredMarker()` converts strings to the right shape:

```ts
protected applyStructuredMarker(
    s: StructuredFields, marker: string, value: string): void {
    switch (marker) {
        case 'summary':      s.summary = value; break;
        case 'action':       (s.action      ??= []).push(value); break;
        case 'entry':        (s.entry       ??= []).push(value); break;
        case 'exit-success': (s.exitSuccess ??= []).push(value); break;
        case 'exit-failure': (s.exitFailure ??= []).push(value); break;
        case 'corrupted':    s.corrupted = this.parseRegList(value); break;
        case 'preserved':    s.preserved = this.parseRegList(value); break;
    }
}

protected parseRegList(text: string): Z80Register[] {
    // Accept 16-bit pair shorthand: "BC" -> ["B","C"].
    // Tokens separated by commas / whitespace.
    ...
}
```

### 8.10 Things that explicitly do **not** change

- `Comment` class ([comment.ts](../src/disassembler/comment.ts)) —
  banner is just text in `linesBefore`; `Comment.getLines()` needs no
  edits.
- `disassembleMemory()` — still looks up `addressComments.get(addr)`
  and calls `Comment.getLines()`. The banner comes out for free.
- Non-subroutine labels — the `default` branch of the old
  `getLabelComments()` is preserved verbatim (extracted into
  `getNonSubLabelComments()` for readability).
- `countStatistics()`, `addParentReferences()`, `addCallsListToLabels()`,
  `turnLBLintoSUB()` — unchanged; the new analysis reuses their data.
- Existing `--comments` files without the new markers — behave exactly
  as before; `parseStructuredLine()` returns `undefined` and control
  falls through to `comment.addBefore()`.

### 8.11 Suggested implementation order

A sequence that keeps each step independently testable:

1. **§8.1** — add the type module. Pure types; compiles instantly.
2. **§8.2** — add the three `DisLabel` fields. No behavioural change.
3. **§8.7** — add the formatting helpers. Unit-testable in isolation
   against fixed inputs.
4. **§8.8** — rewrite `getLabelComments()` to emit the new template
   but with the register lists *always* `—` (analysis not wired yet).
   Snapshot-test the header shape against a small sample binary.
5. **§8.9** — add structured-marker parsing. Round-trip test:
   `--commentsout` then `--comments` should reproduce every field.
6. **§8.3** — populate `writes` / `reads` masks on the opcode table.
   Generator-script + unit tests per opcode.
7. **§8.6** — implement `analyzeRegisterUsage()`. Test against a few
   hand-written subroutines with known Corrupted/Preserved answers.
8. **§8.5** — wire the new pass into `disassemble()`. End-to-end
   regression tests on the existing sample disassemblies.

Steps 1–5 can ship as a first usable version (banner + structured
fields, no automatic register analysis). Steps 6–8 are the heavier
lift and can follow in a second PR without changing the output
contract.
