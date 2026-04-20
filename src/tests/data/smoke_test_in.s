rsx_workspace		equ	$A700
TXT_OUTPUT		equ	$BB5A
SOUND_ENGINE		equ	$BCA7
KL_LOG_EXT		equ	$BCD1
KL_TIME_PLEASE		equ	$BD0D

			org	$C000
rom_header:
			defb	$01, $00, $01, $00, $2B, $C1
cmd_jp_table:
			jp init

jp_cmd_hello:
			jp cmd_hello

jp_cmd_beep:
			jp cmd_beep

jp_cmd_fill:
			jp cmd_fill
init:
			call delay
			ld bc,$C12B
			ld hl,$A700
			jp KL_LOG_EXT

cmd_hello:
			push hl
			ld hl,$C0FA
			call print_string
			call jump_demo
			call bit_demo
			pop hl
			ret

cmd_beep:
			push bc
			ld b,$08
.cmd_beep_loop:
			ld hl,$C0FA
			call print_string
			rst	$18
			defw	SOUND_ENGINE
			djnz .cmd_beep_loop
			call alu_demo
			call io_demo
			pop bc
			ret

cmd_fill:
			push hl
			push de
			push bc
			ld hl,$C0FA
			ld de,$C105
			ld bc,$0008
			ldir
			ld hl,$C105
			ld bc,$0010
			ld a,$05
			cpir
			call swap_demo
			call int_demo
			call dispatch
			call prefix_demo
			pop bc
			pop de
			pop hl
			ret

print_string:
			ld a,(hl)
			bit 7,a
			ret nz
			push hl
			rst	$18
			defw	TXT_OUTPUT
			pop hl
			inc hl
			jr print_string

delay:
			ld b,$FF
.delay_loop:
			push bc
			pop bc
			djnz .delay_loop
			ret

jump_demo:
			jp .jump_demo_l1
.jump_demo_l1:
			jp nz,.jump_demo_l2
.jump_demo_l2:
			jp z,.jump_demo_l3
.jump_demo_l3:
			jp nc,.jump_demo_l4
.jump_demo_l4:
			jp c,.jump_demo_l5
.jump_demo_l5:
			jp po,.jump_demo_l6
.jump_demo_l6:
			jp pe,.jump_demo_l7
.jump_demo_l7:
			jp p,.jump_demo_l8
.jump_demo_l8:
			jp m,.jump_demo_l9
.jump_demo_l9:
			ret

bit_demo:
			push ix
			bit 7,a
			set 0,b
			res 3,(hl)
			bit 4,(ix+2)
			rlc c
			rl b
			sla d
			srl e
			pop ix
			ret

alu_demo:
			push af
			ld a,$10
			add a,b
			adc a,c
			sub d
			sbc a,e
			and h
			or l
			xor a
			cp $FF
			add hl,bc
			inc (hl)
			dec (ix+0)
			pop af
			ret

io_demo:
			in a,($00FE)
			out ($00FE),a
			ld bc,$7F00
			out (c),a
			ld bc,$F640
			in a,(c)
			ret

swap_demo:
			ex de,hl
			ex af,af'
			exx
			ex (sp),hl
			ret

int_demo:
			di
			im 1
			ei
			im 2
			halt
			ret

dispatch:
			rst	$30
			ld hl,$C115
			jp (hl)

prefix_demo:
			ld ix,$0000
			ld iy,$0000
			neg
			rlc a
			bit 0,(ix+0)
			bit 0,(iy+0)
			ret
banner_msg:
			defb	$48, $65, $6C, $6C, $6F, $2C, $20, $43
			defb	$50, $43, $A1
misc_data:
			defb	$01, $02, $03, $04, $00, $00, $00, $00
			defb	$00, $00, $00, $00
embedded_lbl:
			defb	$05, $06, $07, $08
handler_table:
			defb	$E0, $C0, $1E, $C0, $2D, $C0
byte_table:
			defb	$10, $11, $12, $13, $14, $15, $16, $17
			defb	$18, $19, $1A, $1B, $1C, $1D, $1E, $1F
rsx_names:
			defb	$49, $4E, $49, $54, $20, $52, $4F, $CD
			defb	$48, $45, $4C, $4C, $CF, $42, $45, $45
			defb	$D0, $46, $49, $4C, $CC, $00

			org	$C200
fill_pattern:
			defs	32, 0
