# `--cleanout` Manual Smoke Test Procedure

Pre-release checklist item. Run this locally before tagging a release that
touches the clean emitter.

## Goal

Verify that `--cleanout` output re-assembles byte-for-byte to the original
binary under both supported assemblers.

---

## Requirements

| Tool | Minimum version | Install |
|------|-----------------|---------|
| `sjasmplus` | 1.20+ | https://github.com/z00m128/sjasmplus/releases |
| `maxam` / WinApe | any recent | https://www.winape.net |
| `z80dismblr` | current build | `npm run compile` |
| a known test binary | — | e.g. `test/fixtures/firmware.bin` |

---

## Procedure

### 1. Disassemble to clean source (sjasmplus)

```sh
node out/z80dismblr.js \
  --bin 0x0000 firmware.bin \
  --codelabel 0x0000 START \
  --cleanout firmware_sjas.s \
  --cleanout-format sjasmplus
```

### 2. Re-assemble with sjasmplus

```sh
sjasmplus --raw firmware_sjas.bin firmware_sjas.s
```

### 3. Byte-diff against original

```sh
diff <(xxd firmware.bin) <(xxd firmware_sjas.bin)
```

Expected: no output (identical).

---

### 4. Disassemble to clean source (maxam)

```sh
node out/z80dismblr.js \
  --bin 0x0000 firmware.bin \
  --codelabel 0x0000 START \
  --cleanout firmware_maxam.s \
  --cleanout-format maxam
```

> Skip this step if the binary contains ZX Next opcodes — maxam does not
> support them and `--cleanout-format maxam` will refuse with an error.

### 5. Re-assemble with maxam / WinApe

Assemble `firmware_maxam.s` in WinApe and export the binary.

### 6. Byte-diff against original

```sh
diff <(xxd firmware.bin) <(xxd firmware_maxam.bin)
```

Expected: no output (identical).

---

## Known acceptable differences

| Situation | Effect | Acceptable? |
|-----------|--------|-------------|
| `defs N, 0` fill regions | Assembled bytes match — `defs` fills with the specified value | Yes |
| `WARNING:` lines in output | Emitter flags unresolved self-mod/indirect-jump — assembly still succeeds | Yes, but investigate |

---

## Failure triage

**Diff shows changed bytes at address X:**
1. Find the corresponding line in the clean source.
2. Check the emitter path that produced it (code / data / invalid / CPC RST).
3. Run the relevant golden test from `src/tests/cleanout.golden.test.ts` in isolation.

**Assembler reports syntax error:**
1. Check the hex style used (`--cleanout-hex`).
2. Check that no reserved-word label collision slipped through (the emitter
   should have thrown before this point).
