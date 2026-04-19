; CPC ROM smoke-test fixture
; Exercises every z80dismblr clean-emitter code path.
; See design/firmware_test.md for the full specification.
;
; Assemble:
;   sjasmplus src/tests/data/smoke_test.s
;   Produces smoke_test_block1.bin ($C000) and smoke_test_block2.bin ($C200).

KL_LOG_EXT      equ     $BCD1
TXT_OUTPUT      equ     $BB5A
KL_TIME_PLEASE  equ     $BD0D
SOUND_ENGINE    equ     $BCA7
rsx_workspace   equ     $A700

        DEVICE  NOSLOT64K

        org     $C000

; ── ROM header (6 bytes: type, mark, version, mod, defw rsx_names) ──────────

rom_header:
        defb    1, 0, 1, 0
        defw    rsx_names

; ── JP table (4 entries × 3 bytes = 12 bytes) ───────────────────────────────
; Entry 0: init — called by CPC firmware at ROM initialisation
; Entries 1–3: user-callable RSX commands

cmd_jp_table:
        jp      init
        jp      cmd_hello
        jp      cmd_beep
        jp      cmd_fill

; ── init ────────────────────────────────────────────────────────────────────

init:
        call    delay
        ld      bc, rsx_names
        ld      hl, rsx_workspace
        jp      KL_LOG_EXT              ; tail-call — no ret

; ── cmd_hello ───────────────────────────────────────────────────────────────

cmd_hello:
        push    hl
        ld      hl, banner_msg
        call    print_string            ; call-site 1/2 → CODE_SUB
        call    jump_demo
        call    bit_demo
        pop     hl
        ret

; ── cmd_beep ────────────────────────────────────────────────────────────────

cmd_beep:
        push    bc
        ld      b, 8
.loop:
        ld      hl, banner_msg
        call    print_string            ; call-site 2/2
        rst     $18
        defw    SOUND_ENGINE
        djnz    .loop
        call    alu_demo
        call    io_demo
        pop     bc
        ret

; ── cmd_fill ────────────────────────────────────────────────────────────────

cmd_fill:
        push    hl
        push    de
        push    bc
        ld      hl, banner_msg
        ld      de, misc_data
        ld      bc, 8
        ldir
        ld      hl, misc_data
        ld      bc, 16
        ld      a, 5
        cpir
        call    swap_demo
        call    int_demo
        call    dispatch
        call    prefix_demo
        pop     bc
        pop     de
        pop     hl
        ret

; ── print_string ─────────────────────────────────────────────────────────────
; CPC bit-7 string termination: last char has bit 7 set.

print_string:
        ld      a, (hl)
        bit     7, a
        ret     nz
        push    hl
        rst     $18
        defw    TXT_OUTPUT
        pop     hl
        inc     hl
        jr      print_string

; ── delay ────────────────────────────────────────────────────────────────────

delay:
        ld      b, $FF
.loop:
        push    bc
        pop     bc
        djnz    .loop
        ret

; ── jump_demo ────────────────────────────────────────────────────────────────
; All 8 conditional JPs + 1 unconditional JP.
; Each conditional falls through to the next label, so ret is always reached.

jump_demo:
        jp      .j_nz
.j_nz:
        jp      nz, .j_z
.j_z:
        jp      z,  .j_nc
.j_nc:
        jp      nc, .j_c
.j_c:
        jp      c,  .j_po
.j_po:
        jp      po, .j_pe
.j_pe:
        jp      pe, .j_p
.j_p:
        jp      p,  .j_m
.j_m:
        jp      m,  .j_end
.j_end:
        ret

; ── bit_demo ─────────────────────────────────────────────────────────────────
; CB / DDCB prefixes; IX indexed addressing.

bit_demo:
        push    ix
        bit     7, a                    ; CB
        set     0, b                    ; CB
        res     3, (hl)                 ; CB
        bit     4, (ix+2)              ; DD CB
        rlc     c                       ; CB
        rl      b                       ; CB
        sla     d                       ; CB
        srl     e                       ; CB
        pop     ix
        ret

; ── alu_demo ─────────────────────────────────────────────────────────────────
; 8-bit ALU, 16-bit ADD HL,rr, INC/DEC with (HL) and (IX+d).

alu_demo:
        push    af
        ld      a, $10
        add     a, b
        adc     a, c
        sub     d
        sbc     a, e
        and     h
        or      l
        xor     a
        cp      $FF
        add     hl, bc
        inc     (hl)
        dec     (ix+0)                 ; DD
        pop     af
        ret

; ── io_demo ──────────────────────────────────────────────────────────────────
; Direct IN/OUT and CPC-specific BC-port idiom.

io_demo:
        in      a, ($FE)               ; DB nn
        out     ($FE), a               ; D3 nn
        ld      bc, $7F00              ; Gate Array port
        out     (c), a                 ; ED — Gate Array write
        ld      bc, $F640              ; PPI Port C, row $40
        in      a, (c)                 ; ED — keyboard read
        ret

; ── swap_demo ────────────────────────────────────────────────────────────────

swap_demo:
        ex      de, hl
        ex      af, af'
        exx
        ex      (sp), hl
        ret

; ── int_demo ─────────────────────────────────────────────────────────────────

int_demo:
        di
        im      1                       ; ED
        ei
        im      2                       ; ED
        halt
        ret

; ── dispatch ─────────────────────────────────────────────────────────────────
; 1-byte CPC RST ($30) then indirect JP via handler_table.

dispatch:
        rst     $30
        ld      hl, handler_table
        jp      (hl)

; ── prefix_demo ──────────────────────────────────────────────────────────────
; One instruction per prefix to guarantee full prefix coverage.
; FD and FDCB are the only two not guaranteed elsewhere.

prefix_demo:
        ld      ix, $0000              ; DD
        ld      iy, $0000              ; FD
        neg                            ; ED
        rlc     a                      ; CB
        bit     0, (ix+0)             ; DD CB
        bit     0, (iy+0)             ; FD CB
        ret

; ── data ─────────────────────────────────────────────────────────────────────

banner_msg:
        defb    "Hello, CPC", '!' + $80

misc_data:
        defb    1, 2, 3, 4
        defb    0, 0, 0, 0, 0, 0, 0, 0
embedded_lbl:
        defb    5, 6, 7, 8

handler_table:
        defw    dispatch
        defw    cmd_hello
        defw    cmd_beep

byte_table:
        defb    $10, $11, $12, $13, $14, $15, $16, $17
        defb    $18, $19, $1A, $1B, $1C, $1D, $1E, $1F

rsx_names:
        defb    "INIT RO", 'M' + $80
        defb    "HELL",    'O' + $80
        defb    "BEE",     'P' + $80
        defb    "FIL",     'L' + $80
        defb    0

; ── save block 1 before the gap ─────────────────────────────────────────────

        SAVEBIN "src/tests/data/smoke_test_block1.bin", $C000, $-$C000

; ── second ORG block (forces two org directives in clean output) ─────────────

        org     $C200

fill_pattern:
        ds      32, 0

        SAVEBIN "src/tests/data/smoke_test_block2.bin", $C200, $-$C200
