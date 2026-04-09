# Amstrad CPC Architecture

This document captures technical details of the Amstrad CPC relevant to ROM analysis with z80dismblr, including required configuration hints for `--comments`, `--codelabel`, and related options.

---

## 1. ROM Memory Layout

All ROMs (upper ROMs) are mapped to:

```
#C000 - #FFFF  (16 KB)
```

Up to **252 expansion ROMs** can be addressed. The active ROM is selected by writing its ROM number (0–251) to I/O port **#DF00**. When no expansion ROM is fitted at the selected address, the on-board ROM is returned.

---

## 2. ROM Prefix Format (starting at #C000)

Every expansion ROM starts with a fixed-format header at `#C000`:

| Offset | Size   | Name                     | Description |
|--------|--------|--------------------------|-------------|
| +0     | 1 byte | **ROM Type**             | `#00` = Foreground, `#01` = Background, `#02` = Extension, `#80` = On-board ROM |
| +1     | 1 byte | **ROM Mark Number**      | Arbitrary version marker |
| +2     | 1 byte | **ROM Version Number**   | Arbitrary version number |
| +3     | 1 byte | **ROM Modification Level** | Arbitrary modification level |
| +4     | 2 bytes| **Ext. Command Table ptr** | 16-bit address of the External Command Table |
| +6     | 3 bytes| **Jumpblock entry 0**    | `JP <addr>` — first command entry (background ROM: init routine) |
| +9     | 3 bytes| **Jumpblock entry 1**    | `JP <addr>` — second command entry |
| ...    | ...    | ...                      | ... |

> **Note:** The on-board ROM has bit 7 set in the type byte (`#80`). This marker signals the firmware to stop searching for foreground ROMs.

### ROM Type Values

| Value | Meaning |
|-------|---------|
| `#00` | Foreground ROM (e.g. BASIC, CP/M, application) |
| `#01` | Background ROM (service/peripheral, up to 16 active) |
| `#02` | Extension ROM (overflow for multi-ROM foreground programs) |
| `#80` | On-board ROM (BASIC) — unique, bit 7 set |

---

## 3. External Command Table Structure

The External Command Table is pointed to by bytes +4/+5 of the ROM prefix. It contains:

```
Bytes 0..1 : 16-bit address of the Command Name Table
Bytes 2..4 : Jumpblock entry 0  (JP <addr>)
Bytes 5..7 : Jumpblock entry 1  (JP <addr>)
...
```

### Command Name Table

- Each name is up to **16 characters**, ASCII, upper-case for BASIC compatibility.
- The **last character** of each name has **bit 7 set** (`char | #80`).
- No other character may have bit 7 set.
- Table is **terminated by a null byte** (`#00`) after the last name's last character.

### On-board ROM Prefix Example

```asm
ORG #C000
DEFB #80        ; On-board ROM, Foreground type
DEFB 1          ; Mark 1
DEFB 0          ; Version 0
DEFB 0          ; Modification 0
DEFW NAME_TABLE ; Pointer to name table
JP   START_BASIC; Jumpblock entry 0

NAME_TABLE:
DEFB 'BASI','C'+#80  ; "BASIC" — last char has bit 7 set
DEFB 0               ; End of table
```

### Background ROM Prefix Example (Serial I/O)

```asm
ORG #C000
DEFB #01        ; Background ROM
DEFB 0          ; Mark 0
DEFB 5          ; Version 5
DEFB 0          ; Modification 0
DEFW NAME_TABLE
JP   EMS_ENTRY  ; Entry 0: power-up/init (NOT user-callable)
JP   RESET      ; Entry 1
JP   SET_BAUD   ; Entry 2
...

NAME_TABLE:
DEFB 'SIO DRIVE','R'+#80  ; Entry 0 (space makes it uncallable from BASIC)
DEFB 'SIO.RESE','T'+#80   ; Entry 1
...
DEFB 0
```

> **Important for analysis:** In a background ROM, **jumpblock entry 0 is always the init routine**, not a user command. The space character in its name is intentional — BASIC cannot generate such a name, preventing accidental user invocation.

---

## 4. ROM Selection I/O

| I/O Port | Purpose |
|----------|---------|
| `#DF00`  | Write ROM number (0–251) to select the active upper ROM |

After writing to `#DF00`, all reads from `#C000`–`#FFFF` return data from that ROM.

---

## 5. Memory Map (Foreground Program Context)

| Address Range  | Description |
|----------------|-------------|
| `#0000–#003F`  | System / lower ROM area |
| `#0040–#ABFF`  | Main memory pool (available to foreground program) |
| `#AC00–#B0FF`  | Static Variable Area (reserved for foreground program) |
| `#B100–#BFFF`  | Stack area (at least 256 bytes below `#C000`) |
| `#C000–#FFFF`  | Upper ROM (active expansion or on-board ROM) |

### Entry Registers on Foreground Program Start

| Register | Value   | Meaning |
|----------|---------|---------|
| `BC`     | `#B0FF` | Highest usable byte in memory |
| `DE`     | `#0040` | Lowest byte of memory pool |
| `HL`     | `#ABFF` | Highest byte of memory pool |
| `SP`     | `#C000` | Stack pointer (grows downward) |

---

## 6. Far Call Mechanism (RST 3)

External commands in background ROMs or RSXs are invoked via a **far call**:

```asm
RST 3
DEFW FAR_ADDRESS_PTR   ; Pointer to 3-byte far address (2 bytes addr + 1 byte ROM#)
```

A **far address** is a 3-byte structure:
- Bytes 0–1: 16-bit address within the ROM
- Byte 2: ROM select number

The Kernel uses `KL FIND COMMAND` to resolve a command name to its far address at runtime.

---

## 7. External Command Calling Convention

Used when a foreground program (BASIC or other) invokes a background ROM or RSX command:

| Register | Role |
|----------|------|
| `A`      | Number of parameters |
| `IX`     | Address of parameter block |
| `IY`     | Address of ROM's upper data area (background ROM) or undefined (RSX) |

**Parameter block layout:** Parameters are stored in reverse order. Parameter `i` is at offset `(n-i)×2` from `IX`. Each parameter is a 2-byte value:

| Parameter Type | Value passed |
|----------------|-------------|
| Integer expression | Two's complement integer |
| Real expression | Forced to unsigned integer |
| Variable reference | Address of variable (string: address of 3-byte descriptor) |

**String descriptor (3 bytes):**
- Byte 0: Length
- Bytes 1–2: Address of string data

---

## 8. z80dismblr Configuration Notes

### Data Labels (`--datalabel`) vs Data Ranges (`--datarange`)

- `--datarange` tells the disassembler to **never decode** those bytes as code. This is the key option for protecting known data areas.
- `--datalabel` places a named symbol at an address as a data label, but does **not** prevent code decoding. It is mainly useful for addresses that are **not** covered by a `--datarange` and whose label needs to appear in `--argsout` output.

A label in the `--comments` file is inserted with exactly the same symbol type (`DATA_LBL`) as `--datalabel`, so for any address that already has a `--comments` entry, `--datalabel` is redundant.

Always prefer a single large `--datarange` over multiple small ones.

### ROM Header: one data range, named via `--comments`

The entire ROM prefix (`#C000`–`#C005`) is one contiguous data area — header bytes plus the command table pointer. The label `ROM_HEADER` is provided by the `--comments` file (see below), so no `--datalabel` is needed:

```
--datarange  0xC000 6    ; 6 bytes: type, mark, version, mod, cmd-table ptr (word)
```

### Code Labels (`--codelabel`)

The jumpblock begins at `#C006`. Each entry is a `JP` instruction and is genuine code:

```
--codelabel 0xC006 JUMPBLOCK_0      ; First JP entry (background ROMs: init/power-up)
--codelabel 0xC009 JUMPBLOCK_1      ; Second JP entry
```

Adjust the number of jumpblock entries based on how many commands the ROM exports.

The command name table itself should be an additional `--datarange` — its address is only known after reading the 16-bit pointer at `#C004`/`#C005`.

### Comments file (`--comments`)

The `--comments` argument takes a **file**. The file format is:

```
; ROM header
C000 ROM_START ; ROM type: 00=Foreground 01=Background 02=Extension 80=On-board
C001           ; ROM mark number
C002           ; ROM version number
C003           ; ROM modification level
C004 EXT_CMD_TABLE ; Low byte of external command name table address
C005           ; High byte of external command name table address

; Jumpblock
C006 JUMPBLOCK_0 ; JP: background ROM init/power-up entry (not user-callable)
C009 JUMPBLOCK_1 ; JP: first user-callable command
```

### Disassembly Entry Point

Code tracing starts at `#C006` (jumpblock entry 0). Pass this as the first `--codelabel` so the disassembler begins analysis there.

### Iterative workflow with `--commentsout`

On the first pass, use `--commentsout` to capture auto-discovered labels (e.g. FAR CALL targets) in comments file format:

```
z80dismblr --bin 0xC000 amsdos.rom --cpc --codelabel 0xC006 --commentsout discovered.comments
```

Review `discovered.comments`, annotate the entries, and merge them into your main comments file. Subsequent passes use only `--comments`:

```
z80dismblr --bin 0xC000 amsdos.rom --cpc --codelabel 0xC006 --comments amsdos.comments
```

Any `datarange` entries discovered during the pass are emitted as commented-out `--datarange` hints in the `--commentsout` file — add those to a separate `--args` file.

---

## 9. Sources

- Amstrad CPC Firmware Manual, Section 10: *Expansion ROMs, Resident System Extensions and RAM Programs* (s968se10.pdf)
  - URL: https://cpctech.cpcwiki.de/docs/manual/s968se10.pdf
