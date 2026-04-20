# z80dismblr

z80dismblr is a Z80 command line disassembler written in TypeScript.

This is a fork of the original [z80dismblr](https://github.com/maziac/z80dismblr) project by maziac, which is no longer actively maintained. Development continues here with a focus on Amstrad CPC support and enhanced disassembly features.


## Features

- Supports binary and `*.sna` (snapshot) files.
- Can read MAME trace (`*.tr`) files for better results.
- Supports undocumented opcodes.
- Supports Spectrum Next opcodes.
- Graphical visualization via Graphviz `.dot` of
  - call graphs
  - flow-charts
- Disassembles the given binary via Code-Flow-Graph analysis.
- Divides into data and code area.
- Separates subroutines visually.
- Creates labels from hex addresses.
- Uses "local" label syntax inside subroutines.
- **Firmware-style subroutine headers** — each subroutine gets a prominent
  79-column banner with address, size, cyclomatic complexity, caller list,
  callee list, and register Corrupted/Preserved information.
- **Auto-detected register usage** — static analysis determines which
  registers a subroutine corrupts and which it preserves, with PUSH/POP
  symmetry detection and bottom-up callee propagation.
- **Structured documentation via `--comments`** — label and comment files
  now support structured markers (`summary:`, `action:`, `entry:`,
  `exit-success:`, `exit-failure:`, `corrupted:`, `preserved:`) that map
  directly to the firmware-style header fields.
- **Machine-specific RST handling** — configurable behaviour for RST
  instructions on platforms such as the Amstrad CPC (see below).
- Customization of the output
  - Label prefixes
  - List file with or without address and opcode bytes
  - Opcodes in upper or lower case


## Installation

At the moment there is no npm install package available but you can install the executable directly.
Executables exist for Windows, Mac and Linux.
Just download [here](https://github.com/maziac/z80dismblr/releases), unzip and execute from the command line.


## Usage

Simply execute the unzipped file from the shell.

_Note: Usage is shown here for MacOS only, it should work similar for Linux and Windows._

To create an assembler listing for the snapshot file 'myfile.sna' just use:
~~~
$ ./z80dismblr-macos --sna myfile.sna --out myfile.list
~~~

It reads in the file (which is in SNA file format) and writes it to the 'myfile.list' file.

For example the disassembly looks like this:
~~~
; *****************************************************************************
; *** sub SUB166                                                            ***
; *****************************************************************************
; Address:   901Ch     Size: 38 bytes   Instructions: 20   CC: 4
; Type:      Subroutine
; Summary:   —
; Action:    —
; Entry:     —
; Exit (success): —
; Exit (failure): —
; Corrupted: A, DE, HL, F
; Preserved: BC, IX, IY
; Called by: INTRPT1[A612h]
; Calls:     SUB164
; *****************************************************************************
901C SUB166:
901C 2A ED 8F     LD   HL,(DATA146) ; 8FEDh
...
~~~

A SNA file contains an entry point into the code. So it is not necessary to provide a `--codelabel`.
However, the entry point in the SNA file might not be very good for disassembly purposes; in that case
prepare more information via `--codelabel`.


You can also read in binary files (without headers), e.g. MAME roms.
For binary files you have to provide additional info of the offset address
of the loaded file.
~~~
$ ./z80dismblr-macos --bin 0 rom1.bin --bin 0x1000 rom2.bin --bin 0x2000 rom3.bin --codelabel 0x800 MAIN_START --out roms.list
~~~
This will load 3 binary files (rom1.bin, rom2.bin and rom3.bin).
rom1.bin starts at address 0, rom2.bin at address 0x1000 and rom3.bin at address 0x2000.
There are 2 initial labels where code starts: at 0x800 the main program starts. Address 0 is added automatically as program start.

If you know nothing about the code the better way will be to provide a MAME trace file. I.e. you run MAME with the debugger and the trace option
and save it to a file, e.g. myfile.tr.
Now you start a disassembly and provide the file:
~~~
$ ./z80dismblr-macos --bin 0 rom1.bin --bin 0x1000 rom2.bin --bin 0x2000 rom3.bin --tr myfile.tr --out roms.list
~~~
Note that you can but you don't have to provide a `--codelabel` in this case.


You can highly customize the appearance of the output, e.g. you can suppress the shown address or the opcode bytes.


Please use
~~~
$ ./z80dismblr-macos -h
~~~
to print a help for all allowed arguments.


### Arguments File

Instead of a big argument list you can also pass all arguments via a file.
The format is exactly the same as on the commandline.
To disassemble the rom file from above you would need a file with
the following contents:
~~~
$ cat argsfile
--bin 0 rom1.bin
--bin 0x1000 rom2.bin
--bin 0x2000 rom3.bin
--tr myfile.tr
~~~

~~~
$ ./z80dismblr-macos --args argsfile --out roms.list
~~~


## Subroutine Headers

Each subroutine in the disassembly output is preceded by a prominent
firmware-style header block. The format mirrors the Amstrad CPC firmware
manual documentation style and is designed to be both machine-readable and
easy to spot when scrolling through a long listing.

~~~
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
BB15 KM_EXP_BUFFER:
~~~

**Auto-generated fields** (produced by the disassembler on every run):

| Field | Content |
|-------|---------|
| Address | Hex address of the subroutine entry point |
| Size | Size in bytes |
| Instructions | Instruction count |
| CC | Cyclomatic complexity |
| Type | `Subroutine`, `Restart`, or `Recursive subroutine` |
| Registers: Corrupted | Registers whose value changes and is not restored |
| Registers: Preserved | Registers guaranteed unchanged on exit |
| Called by | All known callers with their parent subroutine and address |
| Calls | All subroutines called by this one |

Fields that cannot be determined statically (e.g. when the subroutine
contains `JP (HL)`) are shown as `—` with an explanatory note:

~~~
; Corrupted: —
; Preserved: —
; (analysis unavailable: JP (HL) at $A123 prevents static classification)
~~~

**User-supplied fields** (via `--comments` file, shown as `—` until filled):
Summary, Action, Entry, Exit (success), Exit (failure).


### Documenting Subroutines via `--comments`

The `--comments` file format is extended with structured markers that map
directly to the header fields. Place them as comment lines immediately before
the address line:

~~~
; summary: Allocate a buffer for expansion strings.
; action: Set the address and length of the expansion buffer.
;         Initialise the buffer with the default expansion strings.
; entry:  DE = address of the buffer
;         HL = length of the buffer
; exit-success: Carry set
; exit-failure: Carry clear (buffer too short)
; corrupted: A, BC, DE, HL, F
; preserved: IX, IY
BB15: KM_EXP_BUFFER
~~~

Continuation lines are indented by at least one extra space after `; `.
The `corrupted:` and `preserved:` markers override the auto-detected
register lists; other markers add documentation that the analyser cannot
infer.

Use `--commentsout` to generate a skeleton file for all discovered
subroutines, then fill in the structured fields incrementally.


## Statistics

Apart from the disassembly output with the labels and the mnemonics z80dismblr also prints out a few statistics in the comments.
For each subroutine it lists the callers and callees, the size in bytes, the cyclomatic complexity (CC), and the auto-detected Corrupted/Preserved register lists.

The Registers fields are computed by static analysis:
- **Corrupted** — any register written by the subroutine or its callees and not restored before returning.
- **Preserved** — any register guaranteed to hold its entry value on exit (either never written, or saved via PUSH/POP and restored on all paths).
- When static analysis cannot classify registers (indirect jumps, self-modifying code) both lists show `—` and an explanatory note is added.


## Machine-specific RST Handling

RST instructions (`RST 00h` … `RST 38h`) are handled differently depending
on the target platform.

### Standard Z80

On a standard Z80 machine each `RST n` is treated as a direct call to a
fixed address (0x00, 0x08, 0x10, …, 0x38). The disassembler follows the
call and marks the target as a subroutine entry point, exactly like a
`CALL` instruction.

### Amstrad CPC

The Amstrad CPC uses RST instructions for far calls to firmware routines
in the extension ROM bank. The mechanism works as follows:

1. `RST 3` (or another designated RST vector) is executed.
2. The firmware RST handler reads a two-byte identifier in the bytes
   immediately following the RST opcode in the calling code.
3. Based on the identifier it dispatches to the correct firmware routine,
   which may live in a different ROM bank.

Because the ROM bank number is assigned at hardware level (jumper-selectable
by the user) and is not encoded in the ROM image itself, a static
disassembler **cannot resolve which routine a CPC-style RST actually calls**
without running the code on real hardware. The ROM itself has no way of
knowing which slot number it occupies.

For this reason z80dismblr treats CPC RST targets the same as ordinary
subroutines in the banner display (using `sub` rather than `rst` as the
banner prefix) and does **not** attempt to follow the far-call dispatch.
This avoids generating authoritative-looking but incorrect cross-references.

You can use `--rstend address` to stop the disassembler from following
a specific RST address entirely, which is useful if the RST handler lives
in ROM that was not loaded:

~~~
$ ./z80dismblr-macos --bin 0 cpc_rom.bin --rstend 0x0018 --out cpc.list
~~~

The `--opcode` argument can be used to annotate the bytes that follow a
CPC RST with a descriptive name, making the listing more readable even
though the target cannot be resolved:

~~~
$ ./z80dismblr-macos --bin 0 cpc_rom.bin --opcode 0xDF ",FUNC=#nn" --out cpc.list
~~~


## Visualization

### Caller Graphs

With the `--callgraphout` option it is possible to let z80dismblr create `.dot` files for use with [Graphviz](http://www.graphviz.org).

Here is an example for the program "Star Warrior" (48K ZX Spectrum). Use z80dismblr like this:
~~~
$ ./z80dismblr-macos --sna starwarrior.sna --out starwarrior.list --callgraphout starwarrior.dot
~~~

It will generate the 'starwarrior.dot' file from the SNA file.
If you look at the dot file with Graphviz it will look like this:

![](documentation/images/starwarrior_dot.jpg)

Although this looks very confusing on first sight a few things can be learned from this view:

- We get an overview of all subroutines and how there are interconnected. Each arrow means: subroutine "SUBn" calls subroutine "SUBm".
- Each bubble represents a subroutine (or entry point). It contains the name, its size in bytes and its cyclomatic complexity.
- The size of the bubble is related to its size in bytes. I.e. bigger subroutines lead to bigger bubbles.
- We can see the leafs, i.e. the subroutines that do not call other subroutines. Often these are very generic functions like math calculations etc. When doing reverse engineering it is often helpful to start with those functions and work from bottom to top to understand the higher layer subroutines.
- We can see one or more roots, e.g. the main routine. We can also try a top-down analysis to understand the called subroutines.
- Calls into unassigned memory (i.e. addresses outside of the given binary) are shown in gray.


The highlighted roots:

![](documentation/images/starwarrior_dot_root.jpg)
![](documentation/images/starwarrior_dot_root2.jpg)
![](documentation/images/starwarrior_wrong_sub.jpg)


#### Sub Call Graphs

It is also possible to let z80dismblr generate only a part of the caller graphs e.g. to focus on a certain subroutine.

For this add `--noautomaticaddr` to the commandline. This will prevent z80dismblr from using address 0000 or the SNA start address automatically.

Additionally add the address of the subroutine you want to see with a `--codelabel` option:
~~~
$ ./z80dismblr-macos --sna starwarrior.sna --callgraphout starwarrior.dot --noautomaticaddr --codelabel 0x735E SUB19
~~~
You can additionally add a label name (here we chose "SUB19" so that it is the same name as in the big caller graph diagram).
You can get the address from the previously created 'starwarrior.list' file.

The result is a call graph just for the subroutine at address 0x753E:

![](documentation/images/starwarrior_sub19.jpg)


### Flow Charts

Via the `--flowchart...` arguments it is possible to create flowcharts of subroutines.

With `--flowchartout filename` you specify the output path. The generated file is a `.dot` file that can be visualized with [Graphviz](http://www.graphviz.org).

With `--flowchartaddresses addr1 addr2 ... addrN` you can specify one or more subroutines that you want to visualize.

E.g.:
~~~
$ ./z80dismblr-macos --sna starwarrior.sna --flowchartout fc.dot --flowchartaddresses 7015h A3ABh
~~~
will create the following graph:

![starwarrior_fc_dot](documentation/images/starwarrior_fc_dot.jpg)


## "Interactive" Usage

During reverse engineering of a binary at first very little is known about the code.
Then after looking at the disassembly the one or the other subroutine is understood and can be commented with more senseful comments than the one that z80dismblr generates.

Therefore you can input a file with labels and comments via the `--comments file` option.

The file is read and substitutes the label name and the comments for a given address.

Here is a small real world example of a printing subroutine.
The original disassembled code:
~~~
; *****************************************************************************
; *** sub SUB055                                                            ***
; *****************************************************************************
; Address:   760Ah     Size: 44 bytes   Instructions: 22   CC: 4
; Type:      Recursive subroutine
; Summary:   —
; Action:    —
; Entry:     —
; Exit (success): —
; Exit (failure): —
; Corrupted: A, HL, F
; Preserved: BC, DE, IX, IY
; Called by: SUB443[D752h], SUB442[D734h], SUB178[8405h], self[7631h], ...
; Calls:     SUB039, SUB103
; *****************************************************************************
760A SUB055:
760A 7E           ld   a,(hl)
760B 23           inc  hl
760C FE FF        cp   FFh
760E C8           ret  z
...
~~~

After analyzing we find out what the purpose is and add a structured comments file:
~~~
; summary: Print a text in HL until end-of-string (0xFF).
; action: Reads bytes from HL. FEh introduces a 16-bit integer argument,
;         FDh introduces a pointer to another text string (recursive).
; entry:  HL = pointer to formatted text
; exit-success: HL advanced past the terminator
; corrupted: A, HL, F
; preserved: BC, DE, IX, IY
760a sub_print_formatted_text_hl

760c ; End of string
760f ; integer (%d)
7613 ; string (%s)
~~~

This results in the more readable disassembly:
~~~
; *****************************************************************************
; *** sub sub_print_formatted_text_hl                                       ***
; *****************************************************************************
; Address:   760Ah     Size: 44 bytes   Instructions: 22   CC: 4
; Type:      Recursive subroutine
; Summary:   Print a text in HL until end-of-string (0xFF).
; Action:
;   Reads bytes from HL. FEh introduces a 16-bit integer argument,
;   FDh introduces a pointer to another text string (recursive).
; Entry:
;   HL = pointer to formatted text
; Exit (success): HL advanced past the terminator.
; Exit (failure): —
; Corrupted: A, HL, F
; Preserved: BC, DE, IX, IY
; Called by: SUB443[D752h], SUB442[D734h], self[7631h], ...
; Calls:     SUB039, SUB103
; *****************************************************************************
760A sub_print_formatted_text_hl:
760A 7E           ld   a,(hl)
760B 23           inc  hl
760C FE FF        cp   FFh    	; End of string
760E C8           ret  z
760F FE FE        cp   FEh    	; integer (%d)
7613 FE FD        cp   FDh    	; string (%s)
~~~


## Recommendations

If you know nothing about the binary that you disassemble the output of the z80dismblr might be disappointing.
According to the way how it executes the disassembly (see [How it works](#how-it-works)) it can easily happen that not all code paths are found.

Thus the more you know about the code and the more `--codelabel` entries you can pass as arguments the better.

If you still don't know nothing about the binary then you should get a trace file e.g. from MAME. This trace file is obtained from the MAME debugger while executing the binary.
It's format is a simple disassembly with the first number being the hex address (in ASCII) followed by the disassembly of the executed code.
z80dismblr does mainly look for the hex address and assumes all of these addresses to be CODE area that need to be disassembled. It only looks into the disassembly part of the trace file to find `jp (hl)` instructions. It uses those to define the right references to the labels.

Please note that using a trace file can result in surprising issues in case of self modifying code.
As z80dismblr doesn't know about dynamic changes you might find code areas with senseless opcodes (or NOPs). This is because the code is re-written by the assembler program during runtime. For code based on ROMs this shouldn't happen, but for code that resides in RAM (e.g. ZX Spectrum programs) this can be an issue.


## How It Works

The z80dismblr uses a [Control-Flow-Graph](https://en.wikipedia.org/wiki/Control_flow_graph) (CFG) to analyze the binary file(s).
I.e. it runs through the code through all possible paths and disassembles it.

Consider the following example:

~~~
0008h 87           ADD  A,A
0009h 30 05        JR   NC,0010h
000Bh 24           INC  H
000Ch C3 10 00     JP   0010h

000Fh FF           ??

0010h 85           ADD  A,L
0011h 6F           LD   L,A
0012h D0           RET  NC
0013h 24           INC  H
0014h 3A 18 00     LD   A,(0018h)
0017h C9           RET

0018h FF           ??
~~~

If z80dismblr is told to start at address 0008h it steps through the code until a branch (JR, JR cc, JP, JP cc, CALL or CALL cc) is found.
It then uses the new address as another start point to opcodes.
Depending on the branch instruction it continues to disassemble at the following address or stops (e.g. JP unconditional).

For the code above this leads to the following CFG:
~~~
 ┌──────────────┐
 │ 08h: ADD A,A │      Start
 └──────────────┘
         │
         ▼
 ┌──────────────┐
 │09h: JR NC,10h│───────────┐
 └──────────────┘           │
         │                  ▼
         │          ┌──────────────┐
         │          │  0Bh: INC H  │
         │          └──────────────┘
         │                  │
         │                  ▼
         │          ┌──────────────┐
         │          │ 0Ch: JP 10h  │
         │          └──────────────┘
         │                  │
         ▼                  │
 ┌──────────────┐           │
 │ 10h: ADD A,L │◀──────────┘
 └──────────────┘
         │
         ▼
 ┌──────────────┐
 │ 11h: LD L,A  │
 └──────────────┘
         │
         ▼
 ┌──────────────┐    As the return address is unknown
 │ 12h: RET NC  │    to the disassembler this opcode
 └──────────────┘    doesn't imply branching.
         │
         ▼
 ┌──────────────┐
 │  13h: INC H  │
 └──────────────┘
         │
         ▼
┌─────────────────┐
│14h: LD A,(0018h)│
└─────────────────┘
         │
         ▼
 ┌──────────────┐
 │   17h: RET   │      Stop
 └──────────────┘
~~~

We can see already a few important points:
- The data at address 000Fh is not disassembled as this data is not reachable.
- The disassembly will stop if all branch addresses have been analyzed.

Additionally to the CFG analysis there is also a code and data label analysis.
This is why address 0018h can be interpreted.
The disassembler interprets all opcodes that deal with data addresses like in `LD A,(0018h)`.
These addresses are known to contain data and so the disassembler disassembles the bytes
to a `DEFB` and assigns a label to it.


### Flow-through

Consider the following code:
~~~
SUB1:
             LD   B,34
             LD   D,1

SUB2:
             LD   A,33
             RET

START:
             CALL SUB1
             CALL SUB2
             RET
~~~
There are 2 subroutines SUB1 and SUB2. SUB1 flows-through into SUB2.
So for the disassembler it is not clear to which subroutine the bytes "LD A,33" belong.
This is solved by the following idea:
The code above is logically the same as this:
~~~
SUB1:
             LD   B,34
             LD   D,1
             CALL SUB2    <- Instead of flow-through
             RET          <- Instead of flow-through

SUB2:
             LD   A,33
             RET

START:
             CALL SUB1
             CALL SUB2
             RET
~~~
I.e. z80dismblr will only treat "LD B,34" and "LD D,1" as belonging to SUB1.
"LD A,33" and the following "RET" belong to SUB2.
Additionally it adds a reference from SUB1 to SUB2 because SUB1 flows-through/calls
SUB2. The references can be found in the comments output of the disassembler.


## Misc

### Opcode Extensions

It is possible to tweak some opcodes a little bit. I.e. it is possible to instruct z80dismblr to treat the data following the opcode in a special way and add it to the disassembly text of the preceding opcode.

E.g. consider the following assembler listing

~~~
LD A,05h
RST 08h
DEFB 3Eh
LD HL,1234h
~~~

In this example the "RST 8" will modify the stack in such a way that it a) looks for the value following the "RST 8" instruction and b) returns to the instruction after the additional byte, i.e. "LD HL,1234h".

To modify an opcode you need the `--opcode byte appendtext` argument.

`byte` is the opcode to extend (in this case 0xCF for "RST 8") and `appendtext` contains the formatting for the additional byte.

I.e. with this argument `--opcode 0xCF ", CODE=#n"` the disassembly will look like:

~~~
LD A,05h
RST 08h, CODE=3Eh  	; Custom opcode
LD HL,1234h
~~~

Please note that without the extended opcode z80dismblr would have interpreted the 3Eh as an opcode. Now it ignores it and the disassembly continues at "LD HL,1234h".


---

## Release Notes

### v2.0.0 — Firmware-style headers, register analysis, symbol files

This is the first release of the fork. It diverges significantly from
the original v1.6.2 upstream.

**Breaking changes**

- `--comments` renamed to `--symbols`. Update any scripts or `.args`
  files that use the old name.
- `--commentsout` renamed to `--symbolsout`. Same.
- The `--symbols` / `--symbolsout` file format no longer carries plain
  prose comments — it is now a structured symbol definition file only.
  Any plain comments previously in `--comments` files should be moved
  into the `--out` disassembly output instead.

**New features**

- **Firmware-style subroutine headers** — every `CODE_SUB` / `CODE_RST`
  label is preceded by a compact 15-19 line banner modelled on the
  Amstrad CPC firmware manual, including address, size, cyclomatic
  complexity, type, summary, action, entry/exit conditions, and caller/
  callee cross-references.
- **Auto-detected register usage** — static analysis determines which
  registers a subroutine corrupts and which it preserves. PUSH/POP
  symmetry is detected; callee effects propagate bottom-up. When static
  analysis cannot classify (indirect jumps, self-modifying code) both
  lists show `—` and an explanatory note is added.
- **Structured symbol files (`--symbols`)** — the sidecar file now
  carries machine-readable structured fields (`summary:`, `action:`,
  `entry:`, `exit-success:`, `exit-failure:`, `corrupted:`,
  `preserved:`) that map directly into the subroutine header. Plain
  prose belongs in the `--out` round-trip file instead.
- **Amstrad CPC RST handling** — `--cpc` activates firmware far-call
  RST decoding. See the *Machine-specific RST Handling* section.

**Design documents**

Detailed design documents covering all new features are in the
[design/](design/) directory:

- [`sub_header.md`](design/sub_header.md) — firmware-style header spec
- [`iterative_workflow.md`](design/iterative_workflow.md) — round-trip
  `.asm` workflow and clean assembler output (Stream A / B, in progress)
- [`amstrad_cpc_rst_handling.md`](design/amstrad_cpc_rst_handling.md) — CPC RST design

---

### v1.6.2 and earlier

See the original project at
[github.com/maziac/z80dismblr](https://github.com/maziac/z80dismblr)
and its [CHANGELOG.md](CHANGELOG.md).
