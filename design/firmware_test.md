# firmware_test — Round-trip Smoke-Test Fixture

A small Amstrad CPC-style ROM located at `#C000` that serves as the input
for the `cleanout_smoke_test.md` procedure.  Its only purpose is to
exercise every clean-emitter code path so that:

- `firmware_test.s` → `sjasmplus` → `firmware_test.bin` →
  `z80dismblr --machine cpc --cleanout smoke_test_out.s` → `sjasmplus` →
  `smoke_test_out.bin` must equal `firmware_test.bin` **byte for byte**.
- Any emitter path not exercised here is a coverage gap that will
  silently escape the smoke test — so we list every feature up front
  and keep this doc as the authoritative inventory.

The fixture is **ROM-style**: position-dependent, no self-modifying code,
no runtime relocation, no RAM variables.  Everything is deterministic.

---

## 1. Target layout

```
#C000 ──────────────────────────────────────────────
        ROM header (6 bytes)
        Command JP table
        Command handlers
        Internal utility subroutines
        String data
        Byte / word tables
        Long zero-fill region
        RSX command name table
#C???  ──────────────────────────────────────────────
```

Total size target: ≈ 256 bytes, small enough to read end-to-end during
triage but large enough to host every test below.

---

## 2. External EQU symbols (firmware references)

These exercise the EQU prologue and label substitution in operands.
The firmware addresses are the standard Amstrad CPC firmware jump-block
entries at `#BB00` and up.

| Symbol     | Address  | Purpose                                 |
|------------|----------|-----------------------------------------|
| `KL_LOG_EXT` | `#BCD1`| Register an RSX command table           |
| `TXT_OUTPUT` | `#BB5A`| Print a character                       |
| `KL_TIME_PLEASE` | `#BD0D` | Read system time                    |
| `SOUND_ENGINE` | `#BCA7` | Tone queue                           |
| `rsx_workspace` | `#A700` | RAM workspace for `KL_LOG_EXT` (not a firmware entry — user RAM) |

(`#BB00` = `KL_INIT` is deliberately **not** used — we don't want the
test ROM to actually run on real hardware; only the raw bytes matter.)

`rsx_workspace` is user RAM (`#A700`), not ROM.  `#C700` would fall
inside ROM address space and cannot be used as writable workspace.

---

## 3. Feature coverage matrix

Every row is a clean-emitter code path that must be exercised:

| # | Emitter path                                   | Exercised by                                      |
|---|------------------------------------------------|---------------------------------------------------|
| 1 | EQU prologue (`NAME equ $XXXX`)                | The 4 external symbols in §2                      |
| 2 | `org $C000`                                    | ROM start                                         |
| 3 | `NAME:` label, flush-left                      | Every subroutine label                            |
| 4 | Blank line before `CODE_SUB`                   | Every subroutine boundary                         |
| 5 | Local label `.name_l`                          | Forward JR Z / JR NZ target                       |
| 6 | Local loop `.name_loop`                        | Backward DJNZ target                              |
| 7 | `defb` grouping — 8 bytes per line             | ROM header + byte table                           |
| 8 | `defs N, 0` for zero run ≥ 16                  | `fill_pattern` 32-byte zero block                 |
| 9 | `defb` with embedded zeros < 16                | Mixed data area with 8-byte zero gap              |
|10 | `defw LABEL` (16-bit address reference)        | Name-table pointer in header + jump-table-as-data |
|11 | CPC RST 3-byte expansion (`rst $18` + `defw`)  | `print_string` calling `TXT_OUTPUT`               |
|12 | 1-byte CPC RST                                 | `rst $30` (USER restart)                          |
|13 | Unconditional JP + conditional JP Z/NZ/C/NC/PO/PE/P/M | `jump_demo` routine                      |
|14 | Unconditional JR + conditional JR Z/NZ/C/NC    | `print_string` / `delay` routines                 |
|15 | DJNZ                                           | `delay` inner loop                                |
|16 | CALL + RET, conditional CALL / RET             | Handler routines                                  |
|17 | Block instructions: LDIR, CPIR                 | `cmd_fill`, `find_byte`                           |
|18 | IX/IY indexed addressing `(IX+d)`              | `read_params` routine                             |
|19 | Bit ops BIT / SET / RES on register and (IX+d) | `bit_demo` routine                                |
|20 | Shift/rotate: RLC, RL, SRL, SLA                | `bit_demo` routine                                |
|21 | Stack ops PUSH / POP for AF, BC, DE, HL, IX    | Handler prologue / epilogue                       |
|22 | Exchange: EX DE,HL / EX AF,AF' / EXX           | `swap_demo` routine                               |
|23 | I/O: IN A,(n) / OUT (n),A / IN A,(C) / OUT (C),A, CPC port idiom (LD BC,port then IN/OUT (C)) | `io_demo` routine |
|24 | 8-bit ALU: ADD, ADC, SUB, SBC, AND, OR, XOR, CP | `alu_demo` routine                               |
|25 | 16-bit ADD HL,rr                               | `alu_demo` routine                                |
|26 | INC / DEC for reg and (HL)                     | `alu_demo` routine                                |
|27 | Interrupt control: DI, EI, HALT                | `int_demo` routine                                |
|28 | IM 1 / IM 2                                    | `int_demo` routine                                |
|29 | `jp (hl)` indirect jump                        | `dispatch` routine                                |
|30 | ASCII string data (printable run)              | `banner_msg`                                      |
|31 | RSX name-table encoding (high-bit terminator)  | `rsx_names`                                       |
|32 | Word table (`defw`'s pointing at labels)       | `handler_table`                                   |
|33 | Gap handling — two `org` blocks                | Trailing padding region at `#C0F0` with its own `org` |
|34 | DATA_LBL mid-region breaks grouping            | Label inside `misc_data`                          |
|35 | Subroutine called from ≥ 2 sites → `CODE_SUB`  | `print_string` called by `cmd_hello` and `cmd_beep`|
|36 | All four opcode prefixes present: `CB`, `DD`, `ED`, `FD` | `prefix_demo` routine (see §5.22)        |
|37 | `FDCB` two-byte prefix (`(IY+d)` bit ops)      | `prefix_demo` routine                             |

Rows 1–12 are the **core** — they are the reason this fixture exists.
Rows 13–29 broaden coverage to the rest of the Z80 instruction set so
that the dialect mnemonic tables and dialect-specific hex rendering get
real-world use.  Rows 30–35 cover data-side grouping and structure.
Rows 36–37 ensure every Z80 opcode prefix byte is exercised.

---

## 4. Memory map (proposed)

```
#C000  rom_header        6 bytes (type/mark/ver/mod + defw rsx_names)
#C006  cmd_jp_table      JP init / JP cmd_hello / JP cmd_beep / JP cmd_fill  (12 bytes, 4 × JP)
#C012  init              call delay; ld bc,rsx_names; ld hl,rsx_workspace; jp KL_LOG_EXT
#C01E  cmd_hello         push/call print_string + jump_demo + bit_demo/pop/ret
#C02D  cmd_beep          push bc; DJNZ loop (rst $18); call alu_demo + io_demo; pop bc; ret
#C043  cmd_fill          LDIR + CPIR + call swap_demo + int_demo + dispatch + prefix_demo
#C06B  print_string      bit-7 termination loop via rst $18 + defw TXT_OUTPUT
#C077  delay             DJNZ inner loop (local loop label)
#C07E  jump_demo         9 JP variants (unconditional + 8 conditional)
#C09A  bit_demo          BIT/SET/RES + CB-shifts, (IX+d) — 23 bytes
#C0B1  alu_demo          8-bit ALU + ADD HL,BC + INC (HL) + DEC (IX+0)
#C0C4  io_demo           IN A,(n) / OUT (n),A + CPC BC-port idiom
#C0D3  swap_demo         EX DE,HL / EX AF,AF' / EXX / EX (SP),HL
#C0D8  int_demo          DI / IM 1 / EI / IM 2 / HALT
#C0E0  dispatch          RST $30 + LD HL,handler_table + JP (HL)
#C0E5  prefix_demo       one instruction per prefix: CB DD ED FD DDCB FDCB
#C0FA  banner_msg        11 bytes: "Hello, CPC" + '!' + $80
#C105  misc_data         16 bytes: 4 data + 8 zeros (embedded_lbl at #C111) + 4 data
#C115  handler_table     6 bytes: defw dispatch / cmd_hello / cmd_beep
#C11B  byte_table        16 bytes: $10..$1F
#C12B  rsx_names         22 bytes: "INIT ROM" + "HELLO" + "BEEP" + "FILL" + $00
        ─────── gap ───────  (assembler hole to force a new ORG block)
#C200  fill_pattern      32 zero bytes (triggers `defs 32, 0`)
```

Addresses are derived from the assembled `smoke_test.s` (verified by hand).
The important property is the **ordering** and the **gap** between the
first block and `#C200` that forces row 33 (two `org` blocks).

---

## 5. Per-section test inventory

### 5.1 `rom_header` (§3 rows 7, 10)

Plain data bytes followed by a `defw` to `rsx_names`.  In the clean
output this must come out as two `defb` lines (or one 4-byte line + one
`defw`) — either way, byte-identical.

### 5.2 `cmd_jp_table` (§3 rows 2, 3, 4)

Five contiguous `jp` instructions.  Entry 0 is the ROM initialisation
entry: the CPC firmware jumps to the first JP in the table when it
initialises this ROM.  The corresponding name in `rsx_names` is
`"INIT ROM"` — the embedded space makes it impossible to invoke from
BASIC, acting as an accidental-call guard.  Entries 1–4 are the four
user-callable RSX commands.

```
cmd_jp_table:
    jp   init              ; entry 0 — called by CPC firmware at ROM init
    jp   cmd_hello         ; entry 1 — |HELLO
    jp   cmd_beep          ; entry 2 — |BEEP
    jp   cmd_fill          ; entry 3 — |FILL
```

Validates that forward cross-references from the JP table to labels defined
later in the ROM resolve correctly, and that the JP table itself lives in
the main code stream (not data).

### 5.3 `init` — initialisation (§3 rows 16, 17)

```
init:
    call delay                 ; reachability: pulls delay into the walk
    ld   bc, rsx_names
    ld   hl, rsx_workspace
    jp   KL_LOG_EXT
```
Uses an EQU target (`KL_LOG_EXT`).  Ends with `jp` not `ret` — tests
that the walk terminates correctly on an unconditional branch to an EQU.
`call delay` is the only call-site for `delay`, making it reachable from
JP-table entry 0.

### 5.4 `cmd_hello` (§3 row 35)

```
cmd_hello:
    push hl
    ld   hl, banner_msg
    call print_string          ; call-site 1 of 2 → makes print_string CODE_SUB
    call jump_demo             ; reachability: pulls jump_demo into the walk
    call bit_demo              ; reachability: pulls bit_demo into the walk
    pop  hl
    ret
```
One of two call-sites for `print_string` — makes it a `CODE_SUB`.
Also the sole call-site for `jump_demo` and `bit_demo`, reached from
JP-table entry 1.

### 5.5 `cmd_beep` (§3 rows 11, 35, 14)

```
cmd_beep:
    push bc
    ld   b, 8
.loop:
    ld   hl, banner_msg
    call print_string          ; call-site 2 of 2
    rst  $18
    defw SOUND_ENGINE
    djnz .loop
    call alu_demo              ; reachability: pulls alu_demo into the walk
    call io_demo               ; reachability: pulls io_demo into the walk
    pop  bc
    ret
```
Exercises CPC 3-byte RST and DJNZ in the same routine.  The two demo
calls after the loop are the sole call-sites for `alu_demo` and `io_demo`,
reached from JP-table entry 2.

### 5.6 `cmd_fill` (§3 row 17)

```
cmd_fill:
    push hl
    push de
    push bc
    ld   hl, banner_msg
    ld   de, misc_data
    ld   bc, 8
    ldir
    ld   hl, misc_data
    ld   bc, 16
    ld   a, 5
    cpir
    call swap_demo             ; reachability: pulls swap_demo into the walk
    call int_demo              ; reachability: pulls int_demo into the walk
    call dispatch              ; reachability: pulls dispatch into the walk
    call prefix_demo           ; reachability: pulls prefix_demo into the walk
    pop  bc
    pop  de
    pop  hl
    ret
```
The four demo calls are the sole call-sites for those routines, reached
from JP-table entry 3.  `dispatch` ends with `jp (hl)` so it never
returns at runtime, but the disassembler still walks `cmd_fill`'s code
after the `call` because it follows both branches statically.

### 5.7 `print_string` (§3 rows 11, 5, 14)

```
print_string:
    ld   a, (hl)
    bit  7, a                 ; CPC bit-7 termination test
    ret  nz                   ; last char has bit 7 set → done
    push hl
    rst  $18
    defw TXT_OUTPUT
    pop  hl
    inc  hl
    jr   print_string
```
Validates `rst $18` + `defw LABEL` emission and a simple JR backward
branch to a `CODE_SUB` (not a local loop — jumping to the sub's own
entry point is a normal recursion-style reference, not `.name_loop`).

### 5.8 `delay` (§3 rows 6, 15)

```
delay:
    ld   b, $FF
.loop:                         ; disassembler names this .delay_loop
    push bc
    pop  bc
    djnz .loop
    ret
```
The backward `DJNZ` target becomes `CODE_LOCAL_LOOP` named `.delay_loop`.

### 5.9 `jump_demo` (§3 row 13)

One routine containing all 8 JP variants: `jp`, `jp z`, `jp nz`, `jp c`,
`jp nc`, `jp po`, `jp pe`, `jp p`, `jp m` — each targeting a local
label so both the condition codes and forward-reference resolution get
tested.

Each conditional JP falls through to the next label, so execution reaches
`ret` regardless of flags.  The unconditional `jp` at the top acts as an
entry-point jump over nothing (the target is the very next instruction),
which still exercises the emitter's unconditional-JP code path.

```
jump_demo:
    jp   .j_nz             ; unconditional JP
.j_nz:
    jp   nz, .j_z          ; JP NZ
.j_z:
    jp   z,  .j_nc         ; JP Z
.j_nc:
    jp   nc, .j_c          ; JP NC
.j_c:
    jp   c,  .j_po         ; JP C
.j_po:
    jp   po, .j_pe         ; JP PO  (parity odd)
.j_pe:
    jp   pe, .j_p          ; JP PE  (parity even)
.j_p:
    jp   p,  .j_m          ; JP P   (sign positive)
.j_m:
    jp   m,  .j_end        ; JP M   (sign minus)
.j_end:
    ret
```

All nine jump targets are forward references at assembly time; the
disassembler will name them using its local-label scheme (e.g.
`.jump_demo_l0`, `.jump_demo_l1`, …).  The exact auto-names do not matter
for the round-trip — what matters is that every `JP cc` opcode and its
3-byte encoding survive the emit → assemble cycle unchanged.

### 5.10 `bit_demo` (§3 rows 19, 20, 18)

```
bit_demo:
    push ix
    bit  7, a                  ; CB
    set  0, b                  ; CB
    res  3, (hl)               ; CB
    bit  4, (ix+2)             ; DD CB prefix
    rlc  c                     ; CB
    rl   b                     ; CB
    sla  d                     ; CB
    srl  e                     ; CB
    pop  ix
    ret
```

### 5.11 `alu_demo` (§3 rows 24, 25, 26)

Representative 8-bit ALU ops, 16-bit `add hl, bc`, and `inc (hl)` /
`dec (ix+0)`.

```
alu_demo:
    push af
    ld   a, $10
    add  a, b              ; ADD
    adc  a, c              ; ADC
    sub  d                 ; SUB
    sbc  a, e              ; SBC
    and  h                 ; AND
    or   l                 ; OR
    xor  a                 ; XOR (also clears A)
    cp   $FF               ; CP
    add  hl, bc            ; 16-bit ADD HL,rr  (row 25)
    inc  (hl)              ; INC (HL)          (row 26)
    dec  (ix+0)            ; DEC (IX+d)        (row 26, DDCB)
    pop  af
    ret
```

### 5.12 `io_demo` (§3 row 23)

Exercises all four I/O forms, including the CPC idiom of loading a full
16-bit port address into BC before using `IN A,(C)` / `OUT (C),A`.

```
io_demo:
    in   a, ($FE)              ; IN A,(n)       — direct port byte
    out  ($FE), a              ; OUT (n),A      — direct port byte

    ; CPC Gate Array: b15=0, b14=1 in high byte → Gate Array responds.
    ; A carries the Gate Array command byte.
    ld   bc, $7F00
    out  (c), a                ; OUT (C),A — Gate Array write

    ; CPC PPI Port C (b11=0 in $F6), b9:b8=10 → Port C,
    ; low byte $40 = keyboard row to read.
    ld   bc, $F640
    in   a, (c)                ; IN A,(C)  — PPI / keyboard read

    ret
```

`IN A,(C)` uses the full BC port address; `IN A,(n)` uses only the byte
operand as the port number (B is irrelevant).  Both forms produce different
opcodes (`ED 78` vs `DB nn`) and must round-trip correctly.

### 5.13 `swap_demo` (§3 row 22)

```
swap_demo:
    ex   de, hl
    ex   af, af'
    exx
    ex   (sp), hl
    ret
```

### 5.14 `int_demo` (§3 rows 27, 28)

```
int_demo:
    di
    im   1                     ; ED
    ei
    im   2                     ; ED
    halt
    ret
```

### 5.15 `dispatch` (§3 row 29, 12)

```
dispatch:
    rst  $30                    ; CPC 1-byte RST — USER restart
    ld   hl, handler_table
    jp   (hl)
```

### 5.16 `banner_msg` (§3 row 30)

CPC string convention: the final character has bit 7 set; there is no
null terminator.  `print_string` detects end-of-string by testing `a >= $80`
(or equivalently `bit 7, a`).

```
banner_msg:
    defb "Hello, CPC", '!' + $80
```

This exercises `defb` grouping on a printable ASCII run and ensures the
high-bit terminator byte round-trips as a plain `defb $xx` value.

### 5.17 `misc_data` (§3 rows 9, 34)

Mixed layout:

```
misc_data:
    defb 1, 2, 3, 4
    defb 0, 0, 0, 0, 0, 0, 0, 0     ; 8-byte zero gap (< 16 → still defb)
embedded_lbl:                         ; DATA_LBL breaks grouping here
    defb 5, 6, 7, 8
```

### 5.18 `handler_table` (§3 row 32)

`defw dispatch, cmd_hello, cmd_beep`.  Three word-sized label references
in a data area.

### 5.19 `byte_table` (§3 row 7)

16 monotonically increasing bytes (`$10..$1F`) — a clean two-line
`defb` group.

### 5.20 `rsx_names` (§3 row 31)

`KL_LOG_EXT` maps name-table entry N to jump-table entry N, so the order
here must match `cmd_jp_table` exactly.  Entry 0 is `"INIT ROM"`:
`KL_LOG_EXT` registers it, but BASIC's RSX parser stops at the space and
can never invoke it — making the init routine effectively private.

```
rsx_names:
    defb "INIT RO", 'M' + $80  ; entry 0 — space blocks BASIC; maps to JP init
    defb "HELL",    'O' + $80  ; entry 1 — |HELLO
    defb "BEE",     'P' + $80  ; entry 2 — |BEEP
    defb "FIL",     'L' + $80  ; entry 3 — |FILL
    defb 0                      ; end of table
```

Each name is stored with the final character having bit 7 set (the
CPC firmware convention).  These bytes round-trip as plain `defb $xx`
values — nothing dialect-specific.

### 5.22 `prefix_demo` (§3 rows 36, 37)

One instruction per Z80 prefix byte, placed just before the gap so the
section stays small.  Prefix coverage map:

| Prefix | Bytes   | Instruction used | Also in fixture?                  |
|--------|---------|------------------|-----------------------------------|
| `CB`   | `CB`    | `rlc a`          | `bit_demo` has CB — backup here   |
| `DD`   | `DD`    | `ld ix, $0000`   | `bit_demo` / `alu_demo` have DD   |
| `ED`   | `ED`    | `neg`            | `int_demo` has ED via `im 1`      |
| `FD`   | `FD`    | `ld iy, $0000`   | **not elsewhere — required here** |
| `DDCB` | `DD CB` | `bit 0, (ix+0)` | `bit_demo` has DDCB               |
| `FDCB` | `FD CB` | `bit 0, (iy+0)` | **not elsewhere — required here** |

```
prefix_demo:
    ld   ix, $0000             ; DD prefix
    ld   iy, $0000             ; FD prefix
    neg                        ; ED prefix
    rlc  a                     ; CB prefix
    bit  0, (ix+0)             ; DD CB prefix
    bit  0, (iy+0)             ; FD CB prefix
    ret
```

The `FD` and `FDCB` rows are the primary reason this section exists —
they are the only two prefixes not guaranteed to appear elsewhere in the
fixture.

### 5.21 `fill_pattern` (§3 rows 8, 33)

32 zero bytes located after a 2-byte gap in memory.  The disassembler
should emit:

```
<blank line>
        org  $C200
fill_pattern:
        defs 32, 0
```

The gap between the end of the first block and `#C200` is deliberately
unassigned — this is the only way to force a second `org` directive
without contriving a second binary file.  It is achieved in the source
with:

```
        org  $C200
fill_pattern:
        ds   32, 0
```
letting the assembler generate the hole (padded as `0xFF` or whatever
the assembler's default is — the disassembler won't see it because those
addresses never get `ASSIGNED`).  **Note:** the padding bytes are NOT part
of `firmware_test.bin`; only the assigned `defb`/code bytes are.  The
build recipe in §6 uses `--raw` to strip the hole.

---

## 6. Build recipe (for the smoke-test run)

```sh
# 1. Assemble — SAVEBIN directives in the source produce two separate
#    binary files, one per ORG block.  No --raw flag needed; no gap warning.
#    Block 1: src/tests/data/smoke_test_block1.bin  ($C000–$C140, 321 bytes)
#    Block 2: src/tests/data/smoke_test_block2.bin  ($C200–$C21F,  32 bytes)
sjasmplus src/tests/data/smoke_test.s

# 2. Disassemble through the clean emitter.
#    Two --bin loads place each block at its correct address; the gap
#    between them ($C141–$C1FF) stays UNUSED so the emitter produces
#    a second org $C200.
#
#    Addresses verified against smoke_test.s by hand.
#    --codelabels cover the 4 JP-table entries (fixed relative to #C006).
#    All data sections from banner_msg through rsx_names are contiguous, so
#    they collapse into a single --datarange.
#
node out/z80dismblr.js \
    --bin 0xC000 src/tests/data/smoke_test_block1.bin \
    --bin 0xC200 src/tests/data/smoke_test_block2.bin \
    \
    --codelabel 0xC006 cmd_jp_table \
    --codelabel 0xC009 jp_cmd_hello \
    --codelabel 0xC00C jp_cmd_beep  \
    --codelabel 0xC00F jp_cmd_fill  \
    \
    --symbols src/tests/data/smoke_test.sym \
    \
    --datarange 0xC000  6  \
    --datarange 0xC0FA 71  \
    --datarange 0xC200 32  \
    \
    --machine cpc \
    --cleanout src/tests/data/smoke_test_out.s \
    --cleanout-format sjasmplus

# 3. Golden diff — compare the clean output against the checked-in reference.
#    smoke_test_in.s is the known-good disassembly committed to the repo.
#    Any difference here means the clean emitter changed its output.
diff src/tests/data/smoke_test_in.s src/tests/data/smoke_test_out.s && \
echo "Golden diff: OK" || echo "Golden diff: FAIL"

# 4. Re-assemble the clean output — it also has two ORG blocks, so the
#    same SAVEBIN trick is needed.  Add to smoke_test_out.s manually once,
#    or use a wrapper script; for a one-shot test just split with head/tail:
sjasmplus --raw=src/tests/data/smoke_test_out_raw.bin src/tests/data/smoke_test_out.s
head -c 321 src/tests/data/smoke_test_out_raw.bin > src/tests/data/smoke_test_out_block1.bin
tail -c  32 src/tests/data/smoke_test_out_raw.bin > src/tests/data/smoke_test_out_block2.bin

# 5. Byte-diff — compare each block separately.
cmp src/tests/data/smoke_test_block1.bin src/tests/data/smoke_test_out_block1.bin && \
cmp src/tests/data/smoke_test_block2.bin src/tests/data/smoke_test_out_block2.bin && \
echo "Binary round-trip: OK" || echo "Binary round-trip: FAIL"
```

`--machine cpc` is mandatory — it enables 3-byte RST handling, which is what
drives the `rst $18` / `defw TXT_OUTPUT` expansion.  Without it, the
`rst $18` opcode is decoded as a 1-byte Z80 instruction and the two
inline bytes become orphan data, breaking the round-trip.

For the maxam pass, re-run steps 2–4 with `--cleanout-format maxam`.
The fixture contains no ZX Next opcodes, so the maxam path must not
refuse.

---

## 7. Explicit non-goals

The following are **out of scope** for this fixture and must not be
added without a separate design decision:

- **Self-modifying code.** Changes the disassembler's label scheme
  (`SELF_MOD_*`) and clouds the round-trip contract.
- **Relocatable code.** The ROM is position-dependent — `org $C000`
  and we live with it.
- **ZX Next opcodes.** Already covered by dedicated unit tests; adding
  them here would make the maxam smoke-test pass refuse (by design).
- **Undocumented opcodes** (`sll`, `ixh/ixl/iyh/iyl` as 8-bit regs).
  Dialect-variant; covered by §6.7.3 of the design doc with its own
  separate test path.
- **Actual firmware calls that depend on CPC state** — we never execute
  this ROM; we only assemble and compare bytes.

---

## 8. Decisions

1. **Size cap:** let it float; hard cap at 1024 bytes.
2. **Two `org` blocks:** single-source gap — one `firmware_test.s`, one
   binary, one assembler hole forces the second `org` in the clean output.
3. **Per-section byte-count CI assertion:** skipped — not needed for the
   smoke-test goal.
