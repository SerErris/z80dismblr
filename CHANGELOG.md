## 3.0.0
- **Project renamed from `z80dismblr` to `z80map`.**  All source files, documentation, configuration, and npm package name updated. Entry point is now `out/z80map.js`. GitHub repository URLs (`maziac/z80dismblr`, `SerErris/z80dismblr`) are preserved as-is since the GitHub repos have not been renamed.
- `package.json` cleaned up: removed stale VS Code extension fields (`publisher`, `vsce` scripts), moved `ts-node` to `devDependencies`, added `engines: { node: ">=18.0.0" }`, corrected author/contributors, updated repository URL.


## 2.4.0
- Level-2 data grouping: `DATA_LBL` addresses accessed by 16-bit load instructions (`LD HL,(nn)`, `LD DE,(nn)`, `LD (nn),HL`, `LD IX,(nn)`, etc.) are now emitted as a single `defw` instead of two `defb` bytes in clean (`--cleanout`) output. "Larger wins" on conflicting access widths (same address loaded as both byte and word → word wins). No change to verbose `.asm` output.
- New `DisLabel.accessWidth?: 1 | 2` field populated during `collectLabels()` by inspecting the register name in the opcode (16-bit pair → width 2).
- New documentation: `documentation/ai_reverse_engineering_guide.md` — a project template for AI-assisted reverse-engineering sessions, covering directory layout, annotation mechanics, a complete `project.args` example, and a Claude Code session workflow.
- User manual (`documentation/user_manual.md`) substantially expanded: required vs recommended parameter tables, round-trip safety of all display options, detailed iterative workflow guidance (args file pattern, `--addbytes`, `--fresh`, multi-pass strategy), Vortex VDOS complete workflow example, and a new §19 on AI-assisted reverse engineering.


## 2.3.0
- `port:XXXX NAME` syntax in `--symbols` files declares named I/O port labels. Each of the four nibbles may be a literal hex digit or `?` wildcard (e.g. `port:7F??` matches any `LD BC,#7Fxx`). Wildcards are required on CPC where the low byte carries data, not address.
- Every `IN r,(C)` / `OUT (C),r` instruction is annotated with `; Port #xxxx (NAME)` when the effective BC value is statically known at the I/O site.
- BC linear-walk tracker resolves the effective port from the preceding `LD BC,nn`, `LD B,#n`, `LD C,#n`, `INC B`, `DEC B`, `INC BC`, `DEC BC`, and register-to-register propagation (`LD B,C` / `LD C,B`) within a basic block. Handles the FDC `INC BC` adjacent-port pattern and the CRTC/PPI `INC B + LD C,#n` data-piggyback pattern.
- When the effective BC is only partially known (B known, C unknown), the annotation renders as `; Port #7F?? (GATE_ARRAY, low byte unknown)`.
- `LD BC,nn` operand substituted with the port label name when an exact 16-bit match (`mask === 0xFFFF`) exists and BC reaches the I/O instruction unmodified. Wildcard labels never substitute into `LD BC` operands.
- `IN A,(n)` / `OUT (n),A`: corrected a long-standing cosmetic bug where the immediate byte was formatted as 4 digits (`IN A,(00FEh)`) — now emits the correct 2-digit form (`IN A,(FEh)`). Annotated with `; Port #??n (NAME, high byte = A at runtime)`.
- `NumberType.PORT_LBL` removed; `IN A,(n)` / `OUT (n),A` immediates now use `NUMBER_BYTE`.
- `--symbolsout` includes a `; --- discovered I/O ports ---` section: matched named port labels emitted as active `port:XXXX NAME` lines (wildcards preserved); accessed but unnamed ports emitted as commented stubs with placeholder names.
- Port lookup uses "most-specific mask wins" (highest popcount); first-declared breaks ties.


## 2.2.0
- **Breaking change:** `--cpc` flag removed. Use `--machine cpc` instead.
- New `--machine <name>` option introduced as the general target-machine selector. Only accepted value for now is `cpc`; future Z80 targets (other firmware ROMs with machine-specific RST conventions) can be added under the same flag without further CLI proliferation.
- Any existing `--args` file or wrapper script that still passes `--cpc` will fail with "unknown option". No deprecation alias is provided — update call sites to `--machine cpc`.
- Internally, `Disassembler.cpcMode: boolean` has been replaced with `Disassembler.machine: 'none' | 'cpc'`.
- `--decoder name`: enables a hardware ROM decoder for encrypted Z80 firmware. Currently supported: `vortex` (Vortex disk-controller ROM — XOR of D5/D3 based on A2/A4 address bits). Opcode bytes (M1 cycles) are always read raw; operand and data bytes pass through the decoder. Assembled output is cleartext and will not reproduce the original encrypted binary byte-for-byte.
- New `BaseMemory.getRawAt()` accessor always bypasses any installed decoder (used for M1 opcode-fetch paths throughout the disassembler and clean emitter).
- New `BaseMemory.setDecoder()` installs or clears the non-M1 byte decoder.


## 2.1.0
- Stream A: round-trip comment preservation — annotations in the `.asm` output file are automatically re-imported on the next run.
- Line classifier (`asmClassifier.ts`) produces a typed event stream from any `.asm` file; each line is classified independently.
- Banner blocks (open rule, name, structured fields, close rule) are recognised and decoded on re-read.
- Structured fields (`Summary:`, `Action:`, `Entry:`, `Exit (success/failure):`) are imported back into the disassembler state; multi-line continuation blocks supported.
- `—` sentinel: a field value of `—` means "not yet documented" and is ignored on re-import; any other value is preserved.
- Label renaming: if a label name in the `.asm` file does not match the auto-generated pattern it is locked in as a fixed label (`isFixed`) that survives re-numbering.
- Pre-label and pre-instruction comments (`linesBefore`) are captured and re-emitted on the next run; blank lines reset the buffer.
- Auto-import rule: if `--out foo.asm` already exists it is automatically fed through the round-trip parser before analysis — no extra flag required.
- Auto-generated label suffixes are zero-padded to a minimum of three digits (`SUB001`, `LBL042`, …), widening dynamically when the count exceeds 999.
- Idempotence harness (A7): `disassemble → emit → re-disassemble → emit` is enforced to produce byte-identical output by a dedicated test suite.
- Orphaned annotation handling (A8): annotations for addresses no longer present in the binary are preserved at the top of the `.asm` file in a `;;`-prefixed machine-readable block rather than silently dropped.
- Orphan blocks are stable across multiple round trips and only emitted when actual user data exists.
- Inline instruction comments (A9): text after `;;` on an instruction line is user-owned and survives the round trip; text before `;;` is auto-generated and regenerated each run.
- `suppressAuto` mode: if no `;` auto-comment precedes `;;`, the emitter omits the auto-generated comment entirely.
- `--symbolsout` skeleton emitter (A10): writes a `--symbols`-ready file with named labels, structured-field placeholders for subroutines, and no auto-generated prose.
- Fixed stale `--commentsout` reference in `--argsout` help text.


## 2.0.0
- Firmware-style subroutine header banners: each subroutine is preceded by a structured 15–19 line block containing address, size, instruction count, cyclomatic complexity, type, summary, action, entry/exit conditions, corrupted/preserved registers, caller list, and callee list.
- Register analysis engine (`reganalyzer.ts`): static dataflow analysis determines which registers each subroutine reads, writes, and preserves.
- `Corrupted:` and `Preserved:` fields are auto-populated from the register analyser; `—` is used when analysis is unavailable.
- `--cpc` flag: activates Amstrad CPC firmware RST dispatch decoding; RST 1 and RST 2 opcodes are decoded as 1-byte or 3-byte firmware calls with named targets resolved from `--symbols`.
- `--cpc` and `--opcode` (user opcode extensions) are mutually exclusive.
- `--comments` / `--commentsout` renamed to `--symbols` / `--symbolsout`; `--symbolsout` now emits a clean skeleton file (named labels only, no prose).
- `--argsout` writes a complete merged args file (all input options plus auto-discovered data ranges) for re-use as `--args` input.
- `--hexformat` option (`intel` / `intel0` / `cpc` / `z80` / `c`) applied universally to all hex output.
- `--cleanout file`: emits an assembleable source file stripped of all commentary, suitable for direct input to `sjasmplus` or `maxam`.
- `--cleanout-format sjasmplus|maxam`: selects the assembler dialect.
- `--cleanout-hex`: overrides the hex literal style per dialect.
- Data bytes are grouped in clean output: up to 8 per `defb` line; zero-fill runs of 16 or more bytes emit a `defs` directive.
- Invalid opcodes in clean output are emitted as raw `defb` bytes; custom `--opcode` extensions are split back into instruction plus trailing `defb`.
- CPC RST 3-byte opcodes in clean output emit `rst` plus `defw` target (active only with `--cpc`).
- Label name collision with assembler reserved words is a hard error in clean output.
- ZX Next opcodes targeting the maxam dialect are refused with a clear error message.
- EQU prologue emitted for all external symbols before any code in clean output.
- CI golden-file regression tests lock in both sjasmplus and maxam dialect outputs.


## 1.6.0
- Opcodes refactored and fixed.
- Testcases added for all opcodes.


## 1.5.2
- REG_VERSION string conversion fixed.
- Changed >> to >>>.
- Merged with DeZog.


## 1.5.1
- Fixed disassembly of ZX Next opcode 'PUSH nn'.
- Updated libraries.


## 1.5.0
- Renamed '--lblsin' to '--comments'.
- Fix: Labels in dot file now support dot-notation.
- New parameter '--rstend address' to stop the disassembler diving into the RST subroutine. Use e.g. '--rstend 8' to get correct disassembly results if ESXDOS file handling is used.
- Added parameter '--callgraphnode addr|label' to output only a certain label in the dot graph.
- Added parameter '--callgraphformat format' to offer more format options for dot.
- Renamed old parameter '--callgraphformat format' to '--callgraphnodeformat format'.
- '--callgraphhighlight' now also allows labels as input.


## 1.4.2
- Corrected opcode "SUB A,s" to "SUB s".
- Added new Z80N barrel shift and "JP (C)" opcodes.
- Corrected "JP (IX)" and "JP (IY)" disassembly.
- Made "JP (HL)" etc. a stopping insruction.


## 1.4.1
- Improved decoding of 'NEXTREG': Register names are decoded.
- Internal changes for z80-debug.


## 1.4.0
- "--opcode": User opcode extensions
- Branch labels that jump into the middle of an opcode adjusted. These use offsets now (e.g. "JP LBL1+1").
- Warnings added for wrong branch labels.
- Warnings added for code that is accessed as data (self-modifying code).
- Corrected handling of apostrophes in argument files.


## 1.3.0
- Output of flowcharts:
  "--flowchartout" and "--flowchartaddresses: Output flow-chart for a particular address (subroutine).
- "--dot..." renamed to "--callgraph...".


## 1.2.0
- "--dotformat": Formatting of dot node output.
- Changed "--noaddr0" to "--noautomaticaddr". Also suppresses the SNA start address.
- Subroutines are divided into several subroutines if not in a coherent block.
- Opcodes use hex numbers now, comments decimal.
- "--lblsin": Input of labels with comments.


## 1.1.0
- Supports output of callgraphs into dot files for visualization with graphviz.
- Callgraph visualization emphasizes:
  - Code start
  - Leafs
  - Interrupt
- Improved trace file parsing.
- Better interrupt recognition.


## 1.0.0
- Disassembles the given binary via Code-Flow-Grap analysis.
- Divides into data and code area.
- Creates labels from hex addresses.
- Distinguishes labels for subroutines or jump addresses.
- Separates subroutines visually.
- Uses "local" label syntax inside subroutines.
- Points out all callers of a subroutine.
- Customization of the output
- Label prefixes
- List file with or without address and opcode bytes
- Opcodes in upper or lower case
- Can read MAME trace (*.tr) files for better results.
- Supports *.sna (snapshot) files.
- Supports undocumented opcodes.
- Supports Spectrum Next opcodes.


## 0.2.0
- Support for mame .tr (trace) files.

## 0.1.0
Initial version.
