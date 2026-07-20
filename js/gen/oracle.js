// Small oracles (Phase 9) — the pure engine behind the on-demand referee's
// oracles a solo GM rolls during play. Like feature-detail.js / hooks.js: given a
// seeded rng (and, from 9.2 on, JSON tables), return a STRUCTURED pick; the prose
// is composed at render (`oracleLine`) — the pick is what's stored, the sentence
// isn't.
//
// solopg is a referee's ORACLE, not a rulebook: this module owns the fiction-level
// prompts no game system tables (yes/no, meaning, complications, town/tavern
// colour). System-level rolls (wilderness encounters, treasure) are handled
// elsewhere as trigger-and-prompt — the app says WHEN and WHAT, the GM rolls their
// own tables. See docs/plans/phase-9-oracles.md.
//
// 9.1 lays the plumbing with the keystone Yes/No fate oracle at EVEN odds — the
// coin flip every solo session leans on. 9.2 extends `askYesNo` with an odds
// ladder, exceptional results, and an "and/but" modifier; 9.3-9.6 add the other
// oracle kinds alongside it.

/**
 * Yes/No fate oracle (Phase 9.1 — even odds; 9.2 adds odds/exceptional/and-but).
 * A fair coin: Yes on the low half of the stream, No on the high half.
 * @param {() => number} rng float in [0,1)
 * @returns {{ kind:"yesno", answer:"Yes"|"No" }}
 */
export function askYesNo(rng) {
  return { kind: "yesno", answer: rng() < 0.5 ? "Yes" : "No" };
}

/**
 * Compose the one-line display string for an oracle pick (compose-at-render).
 * Each oracle kind knows how to phrase its own pick; unknown kinds fall back to
 * the raw answer so a new kind can't crash the log before its prose lands.
 * @param {{ kind:string, answer?:string }} pick
 * @returns {string}
 */
export function oracleLine(pick) {
  if (!pick) return "";
  if (pick.kind === "yesno") return pick.answer;
  return String(pick.answer ?? "");
}

/** Human labels for each oracle kind — the roll button's caption + the log tag. */
export const ORACLE_LABELS = {
  yesno: "Yes / No",
};
