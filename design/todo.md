# z80map — Future Work

Quick-reference list of planned features and the detailed notes below.
Each item links to the relevant design document section for full context.

---

## Summary

| # | Topic | Design ref | Priority |
|---|-------|------------|----------|
| 1 | [Data grouping — string & struct detection (Level 3)](#1-data-grouping--string--struct-detection-level-3) | `iterative_workflow.md §6.5` | Low |
| 2 | [Emit external-memory data labels to `--symbolsout`](#2-emit-external-memory-data-labels-to---symbolsout) | — | Medium |

---

## 1. Data grouping — string & struct detection (Level 3)

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

## 2. Emit external-memory data labels to `--symbolsout`

**Design reference:** — (raised 2026-05-15 during local-label round-trip work)

### What it is

`DATA_LBL` labels that point to RAM regions *outside* the loaded ROM
module's address space (e.g. `DATA003` at `#BE03`, `vdos_drv_config`
at `#BE7F` in `VDOS_INIT`) are not written to the `--symbolsout`
discovered-symbols file. As a result they are regenerated with fresh
auto-names on every run and cannot be meaningfully renamed and kept.

The goal: **all discovered labels should be written to the
`--symbolsout` file regardless of whether the address is inside or
outside the loaded code address space**, so the user can rename them
once and have the name persist across runs (same round-trip mechanism
used for in-ROM labels).

### Diagnostic to run first

`getSymbolsData()` at `disasm.ts:637-654` filters by type and
`!isFixed`/`!isEqu` — it does *not* filter by memory assignment. So the
drop happens at one of three gates. Before designing the fix, add a
one-shot log dumping every label's `{addr, name, type, isEqu, isFixed,
assigned}` and confirm which gate `BE03/DATA003` fails:

1. flagged `isFixed` (set as a known reference target), or
2. flagged `isEqu` (treated as an `EQU` constant), or
3. never created in `this.labels` because creation is gated on
   `MemAttribute.ASSIGNED`.

### Implementation options (independent of which gate)

1. **If `isFixed`/`isEqu` filter:** relax `getSymbolsData()` to include
   `DATA_LBL` even when `isFixed`, but only when the name is
   auto-generated (`DATAnnn`/`SELF_MODnnn`). Pre-known symbols from
   `--symbols` input stay deduped; discovered external addresses get
   emitted. ~2-line change — start here.
2. **If creation gated on ASSIGNED:** allow `DATA_LBL` creation for any
   address referenced by an instruction operand regardless of loaded
   memory. More invasive.
3. **Naming separation:** consider a distinct prefix for external-RAM
   labels (e.g. `EXT001`) or a tag, so the discovered `.sym` file does
   not mix in-ROM data labels with external scratch RAM. Only if the
   file becomes noisy in practice.

### Notes for resuming

- Round-trip path already works once the entry is in the symbols file:
  `applyFixedLabelIfRenamed` calls `setLabel(..., DATA_LBL)` and locks
  `isFixed`. The only missing piece is getting it into the file.
- Recommendation: diagnostic log + option 1 first; revisit options 2/3
  only if needed.
- Deferred while Part 1 (local-label rename round-trip) is in progress.
