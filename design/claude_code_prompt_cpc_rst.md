# Claude Code Prompt — Implement Amstrad CPC RST Handling in z80dismblr

## Context

You are working in the z80dismblr repository on branch `cpc-rst`.
This is a TypeScript Z80 disassembler project running in a WSL2/Ubuntu environment.
The project uses `tsc` for compilation (output goes to `out/`) and `mocha` for tests.

Before doing anything else:
1. Confirm you are in the correct directory by running `pwd` — it must end in `z80dismblr`
2. Confirm the active branch is `cpc-rst` by running `git branch --show-current`
3. Run `npm run compile` and `npm test` once to establish a clean baseline — note any
   pre-existing errors or test failures so you do not accidentally blame them on your changes

---

## Task Overview

Implement Amstrad CPC extended RST instruction support for the z80dismblr CFG disassembler.
The implementation consists of four sequential steps, each followed by a validation phase
before proceeding to the next step.

Do not proceed to the next step if validation fails.
Commit each step individually with a descriptive commit message.

---

## Step 1 — Create `src/disassembler/cpcRst.ts`

Create the file `src/disassembler/cpcRst.ts` with the following components, in order:

### 1a. `CpcRstKind` enum
A const enum with values: RESET, LOW_JUMP, SIDE_CALL, FAR_CALL, RAM_LAM, FIRM_JUMP, USER, INTERRUPT

### 1b. `CpcRstInfo` interface
Fields:
- `kind: CpcRstKind`
- `z80opcode: number`       — the opcode byte e.g. 0xCF
- `z80hex: string`          — CPC display form e.g. "#08"
- `funcName: string`        — e.g. "LOW JUMP"
- `size: number`            — total bytes including inline data (1 or 3)
- `isJump: boolean`         — unconditional jump, no fall-through
- `isCall: boolean`         — call with fall-through
- `hasInline: boolean`      — has 2 inline data bytes after opcode

### 1c. `CPC_RST` table — `ReadonlyMap<number, CpcRstInfo>`
Populate with all 8 entries:

| opcode | kind       | z80hex | funcName       | size | isJump | isCall | hasInline |
|--------|------------|--------|----------------|------|--------|--------|-----------|
| 0xC7   | RESET      | '#00'  | 'RESET'        | 1    | true   | false  | false     |
| 0xCF   | LOW_JUMP   | '#08'  | 'LOW JUMP'     | 3    | true   | false  | true      |
| 0xD7   | SIDE_CALL  | '#10'  | 'SIDE CALL'    | 3    | false  | true   | true      |
| 0xDF   | FAR_CALL   | '#18'  | 'FAR CALL'     | 3    | false  | true   | true      |
| 0xE7   | RAM_LAM    | '#20'  | 'RAM LAM'      | 1    | false  | false  | false     |
| 0xEF   | FIRM_JUMP  | '#28'  | 'FIRM JUMP'    | 3    | true   | false  | true      |
| 0xF7   | USER       | '#30'  | 'USER RESTART' | 1    | false  | false  | false     |
| 0xFF   | INTERRUPT  | '#38'  | 'INTERRUPT'    | 1    | false  | false  | false     |

### 1d. Private helper functions
- `hex16(n)` — formats as "0XXXXh" (uppercase, leading zero, trailing h)
- `cpcAddr(n)` — formats as "#XXXX" (uppercase, 4 hex digits)
- `decodeRomSel(sel)` — decodes RST 3 ROM select byte:
  - 0..251 → `"ROM N"`
  - 252 → `"UR=on, LR=on"`
  - 253 → `"UR=on, LR=off"`
  - 254 → `"UR=off, LR=on"`
  - 255 → `"UR=off, LR=off"`
- `readWord(mem, addr)` — reads 16-bit little-endian word, returns `number | undefined`
- `readByte(mem, addr)` — reads single byte, returns `number | undefined`

### 1e. `CpcRstCfg` interface
Fields:
- `codeTargets: number[]`
- `dataRanges: Array<{ addr: number; len: number }>`
- `newLabels: Array<{ addr: number; name: string }>`
- `fallThrough: boolean`
- `resumeAddr: number`        — always pc + size
- `defwAddr: number | undefined`  — pc+1 for 3-byte RSTs, undefined for 1-byte

### 1f. `analyzeCpcRst(info, pc, mem)` function
Returns a `CpcRstCfg`. Logic per kind:
- **LOW_JUMP**: push `raw & 0x3FFF` to codeTargets
- **SIDE_CALL**: push `(raw & 0x3FFF) | 0xC000` to codeTargets
- **FAR_CALL**:
  - Generate label `FAR_XXXX` (4 uppercase hex digits) and push to newLabels
  - Push `{ addr: ptrAddr, len: 3 }` to dataRanges
  - Read farLo from mem[ptrAddr]; if defined push to codeTargets
- **FIRM_JUMP**: push `raw & 0xFFFF` to codeTargets
- All others: no targets

### 1g. `CpcRstLines` interface
Fields:
- `rst: string`
- `rstAddr: number`
- `defw: string | undefined`
- `defwAddr: number | undefined`

### 1h. `formatCpcRst(info, pc, mem, lookupLabel?)` function
Returns `CpcRstLines`. Output format:

**Line 1 (all RSTs):**
```
rst #XX\t\t\t; FUNCNAME
```

**Line 2 (3-byte RSTs only), address = pc+1:**

- LOW_JUMP:  `defw 0XXXXh\t\t;   to #XXXX [LR=X, UR=X]`
  - LR = bit 15, UR = bit 14, target = raw & 0x3FFF
- SIDE_CALL: `defw 0XXXXh\t\t;   to #XXXX [slot X]`
  - slot = bits 15..14, target = (raw & 0x3FFF) | 0xC000
- FAR_CALL:  `defw FAR_XXXX\t\t;   to TARGET [ROM state]`
  - operand = lookupLabel(ptrAddr) ?? generated FAR_XXXX
  - target = lookupLabel(farLo) ?? cpcAddr(farLo)
  - if out of range: `(out of range)`
- FIRM_JUMP: `defw label\t\t;   to #XXXX`
  - operand = lookupLabel(target) ?? hex16(raw)

### Step 1 validation

```bash
npm run compile
```

Expected: **zero TypeScript errors**. The new file must compile cleanly in isolation.
If there are errors, fix them before proceeding. Do not move to Step 2 until compile is clean.

**Git commit:**
```bash
git add src/disassembler/cpcRst.ts
git commit -m "feat: add cpcRst.ts — CPC RST types, table, analyser and formatter"
```

---

## Step 2 — Create `src/disassembler/argsWriter.ts`

Create the file `src/disassembler/argsWriter.ts`:

### 2a. `DiscoveredEntry` interface
Fields:
- `kind: 'codelabel' | 'datalabel' | 'datarange'`
- `addr: number`
- `name?: string`
- `length?: number`   — only for datarange

### 2b. `writeArgsOut(path, entries)` function
- Imports `fs` from Node
- Writes a plain text file to `path`
- Groups entries by kind in order: codelabel, datalabel, datarange
- Format per entry:
  ```
  ; --- KIND entries ---

  --KIND
  0xXXXX
  NAME        (if present)
  LENGTH      (if present, datarange only)
  ```
- File header:
  ```
  ; Auto-generated by z80dismblr --cpc
  ; Review before re-using as --args input
  ```

### Step 2 validation

```bash
npm run compile
```

Expected: **zero TypeScript errors** across all files.

**Git commit:**
```bash
git add src/disassembler/argsWriter.ts
git commit -m "feat: add argsWriter.ts — writes discovered labels and data ranges to --args file"
```

---

## Step 3 — Integrate into the CFG engine and CLI

This step modifies existing source files. Read the existing source files carefully
before editing. Understand the current opcode dispatch pattern before adding to it.

### 3a. Locate the correct files
Run:
```bash
ls src/
ls src/disassembler/
```
Identify which file contains:
- The main CFG decode loop (the worklist/opcode dispatch) — will be inside `src/disassembler/`
- The CLI argument parsing (`--codelabel`, `--bin`, etc.) — will be `src/z80dismblr.ts`

Read both files fully before making any changes.

Note on imports:
- In `src/disassembler/disasm.ts` (or wherever the CFG loop lives), import as:
  `import { CPC_RST, analyzeCpcRst, formatCpcRst } from './cpcRst';`
- In `src/z80dismblr.ts`, import as:
  `import { writeArgsOut } from './disassembler/argsWriter';`

### 3b. Add `cpcMode` flag and `discovered` array to the Disassembler class
- `cpcMode: boolean = false`
- `discovered: DiscoveredEntry[] = []`

### 3c. Add `isInRange(addr, len)` private method
```typescript
private isInRange(addr: number, len: number): boolean {
    return this.memoryMap.some(([start, end]) =>
        addr >= start && (addr + len - 1) <= end
    );
}
```
Note: examine the existing class to confirm the correct name for the memory map
field — it may not be called `memoryMap`. Use whatever the existing code uses.

### 3d. Insert the CPC RST dispatch block into the CFG decode loop

Insert **before** the standard opcode handler. The block must:

1. Check `this.cpcMode` first — if false, skip entirely (no behaviour change for
   non-CPC mode)
2. Call `CPC_RST.get(opcode)` — if undefined, fall through to standard handler
3. Call `analyzeCpcRst(rstInfo, pc, this.memory)`
4. Inject `newLabels` into symbol table; record to `this.discovered` if `isInRange`
5. Enqueue `codeTargets` via existing `addLabel` / `pushToWorklist` methods
   (use whatever the existing code calls these — match the naming exactly)
6. Call `markAsData` for `dataRanges`; record to `this.discovered` if `isInRange`
7. Call `formatCpcRst` with `lookupLabel` callback reading from symbol table
8. Emit rst line at `lines.rstAddr` and defw line at `lines.defwAddr`
   (use the existing emit method — match its signature exactly)
9. Set `nextPc = cfg.resumeAddr` or `stopPath = true` depending on `cfg.fallThrough`
10. `continue` to skip the standard handler

### 3e. Add new CLI argument cases

Add to the argument parsing switch/if chain:

- `--cpc` → set `disassembler.cpcMode = true`
- `--datalabel address [name]` → call `disassembler.addDataLabel(addr, name)`
- `--datarange address length` → call `disassembler.addDataRange(addr, len)`
- `--argsout file` → store path in local variable `argsOutFile`

After the disassembly completes (just before process exit):
```typescript
if (argsOutFile) {
    writeArgsOut(argsOutFile, disassembler.discovered);
}
```

### 3f. Add `addDataLabel` and `addDataRange` methods to the Disassembler class
- `addDataLabel(addr, name?)` — adds to symbol table but does NOT enqueue for CFG
- `addDataRange(addr, len)` — marks address range as data, does NOT enqueue

### Step 3 validation

```bash
# Must compile cleanly
npm run compile

# Must pass all existing tests (no regressions)
npm test

# Smoke test: run the disassembler WITHOUT --cpc on an existing binary
# to confirm non-CPC mode is completely unaffected
./z80dismblr --bin 0 some_test_binary --codelabel 0x0000 --out /tmp/test_nocpc.list 2>&1| head -20
```

If any existing tests fail that were passing before, stop and fix the regression
before proceeding.

**Git commit:**
```bash
git add src/disassembler/ src/z80dismblr.ts
git commit -m "feat: integrate CPC RST dispatch into CFG engine and add --cpc/--datalabel/--datarange/--argsout CLI args"
```

---

## Step 4 — Add a test for the CPC RST handler

Find the existing test files:
```bash
find src -name '*.test*' -o -name '*tests*' | head -20
```

Read one existing test file to understand the test style (mocha TDD: `suite`, `test`, `assert`).

Create `src/tests/cpcRst.tests.ts` with test cases covering:

### 4a. `analyzeCpcRst` tests

| Test name | Input | Expected codeTargets | Expected dataRanges | Expected newLabels |
|-----------|-------|---------------------|--------------------|--------------------|
| RST 0 RESET | opcode=0xC7, no inline | [] | [] | [] |
| RST 1 LOW_JUMP | operand=0x0134 | [0x0134] | [] | [] |
| RST 1 LOW_JUMP with ROM bits | operand=0x4134 (bits 14+15 set) | [0x0134] | [] | [] |
| RST 2 SIDE_CALL | operand=0x0400 | [0xC400] | [] | [] |
| RST 3 FAR_CALL | operand=0x4000, mem[0x4000]=0x3F, mem[0x4001]=0xBD | [0xBD3F] | [{addr:0x4000,len:3}] | [{addr:0x4000,name:'FAR_4000'}] |
| RST 3 FAR_CALL out of range | operand=0xFFFF, empty mem | [] | [{addr:0xFFFF,len:3}] | [{addr:0xFFFF,name:'FAR_FFFF'}] |
| RST 4 RAM_LAM | opcode=0xE7 | [] | [] | [] |
| RST 5 FIRM_JUMP | operand=0x0100 | [0x0100] | [] | [] |

Also assert `fallThrough` and `resumeAddr` values for each.

### 4b. `formatCpcRst` tests

| Test | Expected rst line | Expected defw line |
|------|------------------|--------------------|
| RST 0 | `"rst #00\t\t\t; RESET"` | undefined |
| RST 1, operand=0x0134 | `"rst #08\t\t\t; LOW JUMP"` | `"defw 00134h\t\t;   to #0134 [LR=0, UR=0]"` |
| RST 1, operand=0x4134 (LR=1,UR=0) | `"rst #08\t\t\t; LOW JUMP"` | `"defw 04134h\t\t;   to #0134 [LR=1, UR=0]"` |
| RST 2, operand=0x8400 (slot 2) | `"rst #10\t\t\t; SIDE CALL"` | `"defw 08400h\t\t;   to #C400 [slot 2]"` |
| RST 3, ptr=0x4000, target=0xBD3F, sel=7 | `"rst #18\t\t\t; FAR CALL"` | `"defw FAR_4000\t\t;   to #BD3F [ROM 7]"` |
| RST 3, ptr=0x4000, with label in table | `"rst #18\t\t\t; FAR CALL"` | `"defw FAR_4000\t\t;   to MY_LABEL [ROM 7]"` |
| RST 3, ptr out of range | `"rst #18\t\t\t; FAR CALL"` | `"defw FAR_FFFF\t\t;   (out of range)"` |
| RST 5, target=0x0100, no label | `"rst #28\t\t\t; FIRM JUMP"` | `"defw 00100h\t\t;   to #0100"` |
| RST 5, target=0x0100, label=MAIN | `"rst #28\t\t\t; FIRM JUMP"` | `"defw MAIN\t\t;   to #0100"` |

Also assert `rstAddr === pc` and `defwAddr === pc+1` for all 3-byte RSTs.

### Step 4 validation

```bash
npm run compile    # must be clean
npm test           # ALL tests must pass, including the new cpcRst tests
```

Check that the new test suite appears in the mocha output.

**Git commit:**
```bash
git add src/tests/cpcRst.tests.ts
git commit -m "test: add cpcRst test suite covering analyzeCpcRst and formatCpcRst"
```

---

## Final validation

After all four steps are complete and committed:

```bash
# 1. Full clean build
npm run compile

# 2. Full test suite
npm test

# 3. Git log to confirm all 4 commits are present
git log --oneline -6

# 4. Push the branch to your GitHub fork
git push -u origin cpc-rst
```

Expected git log (most recent first):
```
xxxx test: add cpcRst test suite covering analyzeCpcRst and formatCpcRst
xxxx feat: integrate CPC RST dispatch into CFG engine and add --cpc/--datalabel/--datarange/--argsout CLI args
xxxx feat: add argsWriter.ts — writes discovered labels and data ranges to --args file
xxxx feat: add cpcRst.ts — CPC RST types, table, analyser and formatter
```

---

## Important constraints

- **Do not modify any existing tests.** Only add new ones.
- **Do not change any behaviour when `--cpc` is not passed.** Non-CPC mode must be
  byte-for-byte identical to the original for all existing test inputs.
- **Match the existing code style** — variable naming, indentation, comment style.
  Read at least two existing source files before writing any code.
- **Use only Node built-ins and existing dependencies** — do not add any new npm packages.
- **All TypeScript must be strict-clean** — no `any`, no implicit returns, no
  unhandled `undefined` paths.
- If you are unsure about the name of an existing method or field, **read the source
  first** — do not guess.
