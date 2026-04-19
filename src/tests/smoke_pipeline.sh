#!/usr/bin/env bash
# Smoke-test pipeline: steps 6.2–6.5 from design/firmware_test.md.
# Must be run from the repository root.
set -euo pipefail

DATA="src/tests/data"

# ── Step 6.2 — Disassemble ──────────────────────────────────────────────────
echo "6.2  Disassembling..."
node out/z80dismblr.js \
    --bin 0xC000 "$DATA/smoke_test_block1.bin" \
    --bin 0xC200 "$DATA/smoke_test_block2.bin" \
    --codelabel 0xC006 cmd_jp_table \
    --codelabel 0xC009 jp_cmd_hello \
    --codelabel 0xC00C jp_cmd_beep  \
    --codelabel 0xC00F jp_cmd_fill  \
    --symbols "$DATA/smoke_test.sym" \
    --datarange 0xC000  6  \
    --datarange 0xC0FA 71  \
    --datarange 0xC200 32  \
    --cpc \
    --cleanout "$DATA/smoke_test_out.s" \
    --cleanout-format sjasmplus

# ── Step 6.3 — Golden diff ──────────────────────────────────────────────────
echo "6.3  Golden diff..."
diff "$DATA/smoke_test_in.s" "$DATA/smoke_test_out.s"
echo "     Golden diff: OK"

# ── Steps 6.4 + 6.5 — Re-assemble and binary round-trip ────────────────────
if ! command -v sjasmplus &>/dev/null; then
    echo "ERROR: sjasmplus not found — steps 6.4 and 6.5 require it to be installed" >&2
    exit 1
fi

echo "6.4  Re-assembling clean output..."
sjasmplus --raw="$DATA/smoke_test_out_raw.bin" "$DATA/smoke_test_out.s"
head -c 321 "$DATA/smoke_test_out_raw.bin" > "$DATA/smoke_test_out_block1.bin"
tail -c  32 "$DATA/smoke_test_out_raw.bin" > "$DATA/smoke_test_out_block2.bin"

echo "6.5  Binary round-trip..."
cmp "$DATA/smoke_test_block1.bin" "$DATA/smoke_test_out_block1.bin"
cmp "$DATA/smoke_test_block2.bin" "$DATA/smoke_test_out_block2.bin"
echo "     Binary round-trip: OK"
