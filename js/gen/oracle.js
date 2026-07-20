// Small oracles (Phase 9) — the pure engine behind the on-demand referee's
// oracles a solo GM rolls during play. Like feature-detail.js / hooks.js: given a
// seeded rng (and, from 9.3 on, JSON tables), return a STRUCTURED pick; the prose
// is composed at render (`oracleLine`) — the pick is what's stored, the sentence
// isn't.
//
// solopg is a referee's ORACLE, not a rulebook: this module owns the fiction-level
// prompts no game system tables (yes/no, meaning, complications, town/tavern
// colour). System-level rolls (wilderness encounters, treasure) are handled
// elsewhere as trigger-and-prompt — the app says WHEN and WHAT, the GM rolls their
// own tables. See docs/plans/phase-9-oracles.md.

// --- Yes/No fate oracle (Phase 9.2) ---------------------------------------
//
// One roll yields a SIX-POINT answer — "Yes, and" · "Yes" · "Yes, but" ·
// "No, but" · "No" · "No, and". This unifies the plan's two refinements into a
// single roll: the emphatic "…and" IS the exceptional result (it sits at the far
// end of each zone), and the marginal "…but" sits next to the 50/50 boundary. On
// top, a doubles roll flags "a random event intrudes" (a nudge to roll Meaning,
// 9.3) — the GM chooses whether to follow it.

// The odds ladder the GM picks before rolling. `yes` is P(Yes). This is TUNING,
// not content — you PICK from it, you don't ROLL on it — so it's a const here,
// not a JSON weighted table (which rollTable is for). Ordered most→least likely
// for the button row. Retunable like every generation constant.
export const ORACLE_ODDS = [
  { key: "certain", label: "Certain", yes: 0.9 },
  { key: "likely", label: "Likely", yes: 0.7 },
  { key: "even", label: "Even", yes: 0.5 },
  { key: "unlikely", label: "Unlikely", yes: 0.3 },
  { key: "impossible", label: "Impossible", yes: 0.1 },
];
export const DEFAULT_ODDS = "even";

const oddsFor = (key) => ORACLE_ODDS.find((o) => o.key === key) || ORACLE_ODDS.find((o) => o.key === DEFAULT_ODDS);

// Fraction of each yes/no zone that reads as the EMPHATIC "…and" extreme and as
// the MARGINAL "…but" band by the 50/50 boundary (outer / inner fifths).
const EMPHATIC = 0.2;
const MARGINAL = 0.2;

/**
 * Yes/No fate oracle (Phase 9.2). One roll → a six-point answer plus a
 * random-event flag. `odds` is the GM's picked likelihood key (see ORACLE_ODDS);
 * omitted → even.
 * @param {() => number} rng float in [0,1)
 * @param {{ odds?: string }} [opts]
 * @returns {{ kind:"yesno", odds:string, oddsLabel:string, answer:"Yes"|"No",
 *   tone:"and"|"but"|null, emphatic:boolean, event:boolean }}
 */
export function askYesNo(rng, opts = {}) {
  const odds = oddsFor(opts.odds || DEFAULT_ODDS);
  const p = odds.yes;
  const r = rng();
  const event = Math.floor(r * 100) % 11 === 0; // doubles (00,11,…,99) → a random event
  const yes = r < p;

  // How deep into the chosen zone the roll landed → the …and / …but tone.
  let tone = null, emphatic = false;
  if (yes) {
    const pos = p > 0 ? r / p : 0; // 0 = deep yes, 1 = barely yes
    if (pos < EMPHATIC) { tone = "and"; emphatic = true; } // Yes, and (exceptional)
    else if (pos >= 1 - MARGINAL) tone = "but"; // Yes, but (marginal)
  } else {
    const pos = p < 1 ? (r - p) / (1 - p) : 0; // 0 = barely no, 1 = deep no
    if (pos >= 1 - EMPHATIC) { tone = "and"; emphatic = true; } // No, and (exceptional)
    else if (pos < MARGINAL) tone = "but"; // No, but (marginal)
  }

  return { kind: "yesno", odds: odds.key, oddsLabel: odds.label, answer: yes ? "Yes" : "No", tone, emphatic, event };
}

/**
 * Compose the one-line display string for an oracle pick (compose-at-render).
 * Each oracle kind knows how to phrase its own pick; unknown kinds fall back to
 * the raw answer so a new kind can't crash the log before its prose lands. The
 * random-event flag is NOT folded in here — the UI shows it as its own note.
 * @param {{ kind:string, answer?:string, tone?:string|null }} pick
 * @returns {string}
 */
export function oracleLine(pick) {
  if (!pick) return "";
  if (pick.kind === "yesno") return pick.tone ? `${pick.answer}, ${pick.tone}` : pick.answer;
  return String(pick.answer ?? "");
}

/** Human labels for each oracle kind — a section heading in the tab. */
export const ORACLE_LABELS = {
  yesno: "Yes / No",
};
