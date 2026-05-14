/**
 * Stage-1 line classifier for round-trip .asm parsing (Stream A, §4.1).
 *
 * Reads a .asm file line-by-line and emits a stream of typed AsmEvents.
 * Each line is classified independently — no multi-line context is needed
 * at this stage. The semantic consumer (added in later phases) turns the
 * event stream into updates to labels, addressComments, and
 * addressStructured.
 */

import { readFileSync } from 'fs';
import { HEADER_WIDTH } from './headerFormatters';


// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AsmEvent =
    | { kind: 'blank' }
    | { kind: 'banner-rule' }   // raw; only emitted by classifyLine(), never by classifyAsmLines()
    | { kind: 'banner-open' }   // first rule of a banner block  (classifyAsmLines() only)
    | { kind: 'banner-mid'; name: string }
    | { kind: 'banner-close' }  // closing rule of a banner block (classifyAsmLines() only)
    | { kind: 'banner-field'; field: string; value: string }
    | { kind: 'label'; address: number; name: string }
    | { kind: 'instruction'; address: number; inlineComment?: { text: string; suppressAuto: boolean } }
    | { kind: 'data-directive'; address: number }
    | { kind: 'free-comment'; text: string }
    | { kind: 'orphan-header'; address: number }  // ;; ORPHANED: $XXXX ...
    | { kind: 'orphan-label'; name: string }      // ;; LABEL: <name>
    | { kind: 'orphan-close' }                    // ;; (bare) — closes an orphan block
    | { kind: 'other'; text: string }
    // ── Manual line-protection block markers (§10) ──────────────────────────
    | { kind: 'protect-start'; startAddr: number; endAddr: number }
    //   Short form:  ;;{ XXXX YYYY
    //   Long form:   ;;PROTECT-START XXXX YYYY
    | { kind: 'protect-end' }
    //   Short form:  ;;}
    //   Long form:   ;;PROTECT-END
    | { kind: 'protect-content'; text: string };
    //   Any line between protect-start and protect-end.
    //   Only emitted by classifyAsmLines(); classifyLine() never produces it.


// ---------------------------------------------------------------------------
// Compiled patterns
// ---------------------------------------------------------------------------

/** Exact banner rule string: '; ' + 77 asterisks = 79 chars. */
const BANNER_RULE = '; ' + '*'.repeat(HEADER_WIDTH - 2);

/**
 * '; *** sub NAME<spaces> ***'
 * Captured group 1 is the name with trailing spaces; trim() after matching.
 */
const BANNER_MID_RE = /^; \*\*\* sub (.+?) \*\*\*\s*$/;

/**
 * Structured field line inside (or adjacent to) a banner.
 * Group 1 = field name, group 2 = value (may be empty or '—').
 */
const BANNER_FIELD_RE =
    /^; (Address|Type|Summary|Action|Entry|Exit \(success\)|Exit \(failure\)|Corrupted|Preserved|Called by|Calls):\s*(.*)/;

/**
 * Label line: 4-digit hex address, whitespace, identifier, colon.
 * Identifier may start with '.' for local labels.
 * Group 1 = address hex, group 2 = name (without the colon).
 */
const LABEL_RE = /^([0-9A-Fa-f]{4})\s+([\w.]+):\s*$/;

/**
 * Data-directive line: 4-digit hex address, then one or more hex-byte groups
 * (each exactly two hex digits followed by whitespace), then DEFB / DEFW / DEFS
 * as a whole word.  The one-or-more quantifier handles both single-byte DEFB
 * lines and two-byte DEFW lines (e.g. from CPC RST expansion).
 * Group 1 = address hex.
 */
const DATA_DIRECTIVE_RE =
    /^([0-9A-Fa-f]{4})\s+(?:[0-9A-Fa-f]{2}\s+)+(?:DEFB|DEFW|DEFS)\b/i;

/**
 * Instruction line: 4-digit hex address, whitespace, then exactly two hex
 * digits followed by whitespace (the first opcode byte).  Checked after
 * DATA_DIRECTIVE_RE so data lines are not misclassified as instructions.
 * Group 1 = address hex.
 */
const INSTRUCTION_RE = /^([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]{2}\s/;

/**
 * Orphan block opener: ';; ORPHANED: $XXXX …'
 * Group 1 = 4-digit hex address of the orphaned label.
 */
const ORPHAN_HEADER_RE = /^;; ORPHANED: \$([0-9A-Fa-f]{4})/;

/** Orphan label line: ';; LABEL: <name>' */
const ORPHAN_LABEL_RE = /^;; LABEL: (\S+)$/;

/**
 * Manual protect-block start marker (§10).
 * Short form:  `;;{ XXXX YYYY`
 * Long form:   `;;PROTECT-START XXXX YYYY`
 * Groups 1 and 2: start and end addresses (4-digit hex, both inclusive).
 */
const PROTECT_START_RE = /^;;(?:\{|PROTECT-START)\s+([0-9A-Fa-f]{4})\s+([0-9A-Fa-f]{4})/;


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies a single line from a .asm file.
 * The classification is stateless — each line is judged in isolation.
 */
export function classifyLine(line: string): AsmEvent {
    // Blank / whitespace-only
    if (line.trim() === '')
        return { kind: 'blank' };

    // ';;' lines — protect markers (§10) and orphan block markers (A8).
    // Protect markers are tested first so ';;{' / ';;PROTECT-START' are
    // never confused with orphan syntax.
    if (line.startsWith(';;')) {
        const protectMatch = PROTECT_START_RE.exec(line);
        if (protectMatch)
            return {
                kind:      'protect-start',
                startAddr: parseInt(protectMatch[1], 16),
                endAddr:   parseInt(protectMatch[2], 16),
            };
        if (line.trimEnd() === ';;}' || /^;;PROTECT-END\b/.test(line))
            return { kind: 'protect-end' };
        const headerMatch = ORPHAN_HEADER_RE.exec(line);
        if (headerMatch)
            return { kind: 'orphan-header', address: parseInt(headerMatch[1], 16) };
        const labelMatch = ORPHAN_LABEL_RE.exec(line);
        if (labelMatch)
            return { kind: 'orphan-label', name: labelMatch[1] };
        return { kind: 'orphan-close' };
    }

    // Comment lines (start with '; ' or are exactly ';')
    if (line === ';' || line.startsWith('; ')) {
        if (line === BANNER_RULE)
            return { kind: 'banner-rule' };

        const midMatch = BANNER_MID_RE.exec(line);
        if (midMatch)
            return { kind: 'banner-mid', name: midMatch[1].trim() };

        const fieldMatch = BANNER_FIELD_RE.exec(line);
        if (fieldMatch)
            return { kind: 'banner-field', field: fieldMatch[1], value: fieldMatch[2].trim() };

        return { kind: 'free-comment', text: line };
    }

    // Data directives and instruction lines both start with a 4-digit hex
    // address followed by hex bytes.  DATA_DIRECTIVE_RE is checked first so
    // DEFB / DEFW / DEFS lines get their own event kind rather than being
    // lumped in with true instructions.
    const dataMatch = DATA_DIRECTIVE_RE.exec(line);
    if (dataMatch)
        return { kind: 'data-directive', address: parseInt(dataMatch[1], 16) };

    const instrMatch = INSTRUCTION_RE.exec(line);
    if (instrMatch) {
        const addr = parseInt(instrMatch[1], 16);
        const doubleIdx = line.indexOf(';;');
        if (doubleIdx >= 0) {
            const before = line.slice(0, doubleIdx);
            const userText = line.slice(doubleIdx + 2).trim();
            const suppressAuto = !before.includes(';');
            return { kind: 'instruction', address: addr, inlineComment: { text: userText, suppressAuto } };
        }
        return { kind: 'instruction', address: addr };
    }

    const labelMatch = LABEL_RE.exec(line);
    if (labelMatch)
        return { kind: 'label', address: parseInt(labelMatch[1], 16), name: labelMatch[2] };

    // ORG directives, EQU prologue lines, and anything unrecognised.
    return { kind: 'other', text: line };
}

/**
 * Classifies an array of lines into an event stream, applying multi-line
 * context to banner blocks (A3).
 *
 * Banner structure in the .asm output:
 *   rule          ← opening  → banner-open
 *   banner-mid    ← name
 *   rule          ← title divider (DROPPED from output — cosmetic only)
 *   banner-field* ← structured fields
 *   free-comment* ← auto lines inside banner (analysis-unavailable, etc.)
 *   rule          ← closing  → banner-close
 *
 * classifyLine() banner-rule events never appear in the output of this
 * function; they are replaced by banner-open / banner-close pairs.
 */
export function classifyAsmLines(lines: string[]): AsmEvent[] {
    type State = 'normal' | 'banner-opened' | 'banner-titled' | 'banner-body' | 'in-protect';
    const out: AsmEvent[] = [];
    let state: State = 'normal';

    for (const line of lines) {
        // In-protect: preserve every line verbatim as protect-content; only
        // the end marker (detected by classifyLine) exits this state.
        if (state === 'in-protect') {
            const ev = classifyLine(line);
            if (ev.kind === 'protect-end') {
                out.push({ kind: 'protect-end' });
                state = 'normal';
            } else {
                // Emit raw text — do NOT emit the classified event, so that
                // instruction / label / comment lines inside the block are
                // not acted on by the round-trip consumer.
                out.push({ kind: 'protect-content', text: line });
            }
            continue;
        }

        const ev = classifyLine(line);

        switch (state) {
            case 'normal':
                if (ev.kind === 'banner-rule') {
                    out.push({ kind: 'banner-open' });
                    state = 'banner-opened';
                } else if (ev.kind === 'protect-start') {
                    out.push(ev);
                    state = 'in-protect';
                } else {
                    out.push(ev);
                }
                break;

            case 'banner-opened':
                if (ev.kind === 'banner-mid') {
                    out.push(ev);
                    state = 'banner-titled';
                } else {
                    // Malformed: no mid-line after opening rule. Recover and
                    // emit the current event as if we were in normal context.
                    out.push(ev);
                    state = 'normal';
                }
                break;

            case 'banner-titled':
                if (ev.kind === 'banner-rule') {
                    // Title divider — purely cosmetic, drop it.
                    state = 'banner-body';
                } else {
                    // Malformed: no divider after mid-line. Treat as body start.
                    out.push(ev);
                    state = 'banner-body';
                }
                break;

            case 'banner-body':
                if (ev.kind === 'banner-rule') {
                    out.push({ kind: 'banner-close' });
                    state = 'normal';
                } else {
                    out.push(ev);
                }
                break;
        }
    }

    return out;
}

/**
 * Reads a .asm file from disk and returns its event stream.
 * A trailing empty element produced by a final newline is removed before
 * classification so callers see only real lines.
 */
export function classifyAsmFile(path: string): AsmEvent[] {
    const lines = readFileSync(path, 'utf8').split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '')
        lines.pop();
    return classifyAsmLines(lines);
}
