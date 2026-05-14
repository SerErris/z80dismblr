# z80map

**z80map** is a command-line Z80 disassembler for iterative ROM reverse engineering. It follows every reachable branch (CALL, JP, JR, RST, conditionals) rather than doing a linear sweep, cleanly separating code from data and producing a structured, annotated listing.

---

## What it does

- **Code-flow-graph analysis** — traces all reachable paths from declared entry points; the rest is marked as data.
- **Iterative annotation workflow** — the output `.asm` file is also the annotation workspace. Rename labels, fill in documentation, add inline notes with `;;`, then re-run the same command. All edits are preserved and merged with freshly re-analysed data.
- **Firmware-style subroutine banners** — each subroutine gets a structured 15–19 line header with address, size, cyclomatic complexity, register corruption/preservation analysis, and caller/callee cross-references.
- **Amstrad CPC support** — `--machine cpc` decodes the CPC firmware's RST calling convention (RST 0/1/2 as 1-byte or 3-byte firmware calls).
- **Vortex hardware decoder** — `--decoder vortex` transparently decodes XOR-encrypted Vortex disk-controller ROMs.
- **I/O port labels** — `port:XXXX NAME` declarations in the symbols file annotate `IN r,(C)` / `OUT (C),r` instructions with the effective port name.
- **Clean reassembleable output** — `--cleanout` emits sjasmplus- or maxam-compatible source that re-assembles to the original binary byte-for-byte.
- **Manual line-protection blocks** — `;;{ XXXX YYYY` / `;;}` markers preserve hand-written content verbatim across re-runs (for encrypted or indirectly-executed code regions).

---

## Quick start

```bash
# Install and compile from source
npm install && npm run compile

# Or download a pre-built binary from the Releases page
# and rename it to z80map (see user manual §2.3)

# First disassembly pass
z80map --bin 0x0000 firmware.rom --out firmware.asm --addbytes

# Re-run after editing firmware.asm — your annotations are preserved
z80map --bin 0x0000 firmware.rom --out firmware.asm --addbytes
```

All options can be collected in an args file for reproducible runs:

```bash
z80map --args project.args
```

---

## Documentation

| Document | Content |
|----------|---------|
| [User Manual](documentation/user_manual.md) | Complete reference — installation, iterative workflow, all options, platform-specific guides |
| [AI Reverse-Engineering Guide](documentation/ai_reverse_engineering_guide.md) | Template for AI-assisted sessions (Claude Code / VS Code); project layout, annotation workflow, Vortex VDOS example |
| [Changelog](CHANGELOG.md) | Version history |

---

## Installation

**Pre-built binaries** (no Node.js required) are available on the [Releases page](https://github.com/SerErris/z80map/releases). Download the zip for your platform, extract, and optionally rename to `z80map` and place on your `PATH`.

**From source** — requires Node.js ≥ 18:

```bash
git clone https://github.com/SerErris/z80map.git
cd z80map
npm install
npm run compile
node out/z80map.js --help
```

---

## Origin and attribution

z80map is a fork of [**z80dismblr**](https://github.com/maziac/z80dismblr) by [maziac](https://github.com/maziac), which is no longer actively maintained. The original project provided the foundational disassembly engine, opcode tables, CFG analysis, and output formatting.

Significant new work added in this fork:

- Firmware-style subroutine headers with static register analysis
- Iterative round-trip annotation workflow (Stream A)
- Clean reassembleable output for sjasmplus and maxam (Stream B)
- Amstrad CPC RST dispatch decoding (`--machine cpc`)
- Vortex hardware ROM decoder (`--decoder vortex`)
- I/O port label system with wildcard matching and BC-tracker annotation
- Manual line-protection blocks (`;;{` / `;;}`)
- Level-2 data grouping (`defw` for 16-bit accessed labels)

**Original author:** Thomas Busse (maziac)  
**Fork maintainer:** Christoph Linden

---

## License

MIT — see [LICENSE](LICENSE) (original licence from maziac/z80dismblr applies).
