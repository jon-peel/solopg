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

import { rollTable } from "../core/table.js";
import { pick as pickFrom } from "../core/rng.js";
import { RACE_NAME_POOLS } from "./culture-data.js";

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

// --- Meaning / inspiration (Phase 9.3) ------------------------------------
//
// When a result is open-ended (or a Yes/No flagged a random event), roll an
// evocative ACTION × SUBJECT pair to interpret — "Pursue · Secrets". Deliberately
// abstract so it reads onto any scene. Two flat JSON tables (oracle-action /
// oracle-subject); prose composed at render like everything else.

/**
 * Roll a Meaning pair (Phase 9.3). Draws an action then a subject, in that fixed
 * order (deterministic for a given rng stream).
 * @param {Map<string,object>} tables incl. oracle-action / oracle-subject
 * @param {() => number} rng
 * @returns {{ kind:"meaning", action:string, subject:string }}
 */
export function rollMeaning(tables, rng) {
  const action = rollTable(tables.get("oracle-action"), rng).value;
  const subject = rollTable(tables.get("oracle-subject"), rng).value;
  return { kind: "meaning", action, subject };
}

// --- Complication / twist (Phase 9.4) -------------------------------------
//
// A terse setback to drop into a "yes, but…" / "no, and…" beat or to spice a
// quiet scene. A single flat table; reads as a GM prompt, never a stat.

/**
 * Roll a Complication (Phase 9.4).
 * @param {Map<string,object>} tables incl. oracle-complication
 * @param {() => number} rng
 * @returns {{ kind:"complication", text:string }}
 */
export function rollComplication(tables, rng) {
  return { kind: "complication", text: rollTable(tables.get("oracle-complication"), rng).value };
}

// --- Settlement situation (Phase 9.5) -------------------------------------
//
// "What's stirring in this town right now" — a composed MOOD × HAPPENING, plus a
// faction note when a power holds or borders the hex (the app decides that and
// passes the faction's name). Strictly situational — never an NPC. The picks are
// system-agnostic; the app supplies the where (place label) and the who (faction).

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Roll a Settlement situation (Phase 9.5). Draws a mood then a happening, then —
 * only when `factionName` is given — a faction-presence note with {faction}
 * substituted. Fixed draw order (mood → event → faction) for determinism.
 * @param {Map<string,object>} tables incl. settlement-mood / settlement-event /
 *   settlement-faction
 * @param {() => number} rng
 * @param {{ factionName?: string|null }} [opts]
 * @returns {{ kind:"settlement", mood:string, event:string, factionNote:string|null }}
 */
export function rollSettlement(tables, rng, opts = {}) {
  const mood = rollTable(tables.get("settlement-mood"), rng).value;
  const event = rollTable(tables.get("settlement-event"), rng).value;
  let factionNote = null;
  if (opts.factionName) {
    const tmpl = rollTable(tables.get("settlement-faction"), rng).value;
    factionNote = tmpl.replace(/\{faction\}/g, opts.factionName);
  }
  return { kind: "settlement", mood, event, factionNote };
}

// --- Tavern / shop (Phase 9.6) --------------------------------------------
//
// A quick establishment to make a stop memorable: a SIGN (name) × a SPECIALTY
// (what it's known for) × a QUIRK. No proprietor NPC — the people in it are the
// GM's to voice. Context-free, like Meaning.

/**
 * Roll a Tavern / shop (Phase 9.6). Draws sign → specialty → quirk in that fixed
 * order (deterministic for a given rng stream).
 * @param {Map<string,object>} tables incl. tavern-sign / tavern-specialty / tavern-quirk
 * @param {() => number} rng
 * @param {string} [race] (Phase 14.1 — "elf" | "dwarf" | "halfling" | "gnome")
 *   composes the sign from that race's tavern-word pool instead of the curated
 *   Human tavern-sign table; specialty/quirk are unaffected. Omitted/unknown
 *   race = Human, byte-for-byte as before.
 * @returns {{ kind:"tavern", sign:string, specialty:string, quirk:string }}
 */
export function rollTavern(tables, rng, race) {
  const racePools = race && RACE_NAME_POOLS[race];
  const sign = racePools ? raceTavernSign(rng, racePools) : rollTable(tables.get("tavern-sign"), rng).value;
  const specialty = rollTable(tables.get("tavern-specialty"), rng).value;
  const quirk = rollTable(tables.get("tavern-quirk"), rng).value;
  return { kind: "tavern", sign, specialty, quirk };
}

// Race-flavored tavern sign (Phase 14.1) — composes "The <word> <word>" from the
// race's own sign-word pool (culture-data.js) instead of the curated Human
// tavern-sign.json table. A few retries avoid the same word twice ("The Cog
// Cog"); a tiny pool (<2 words) just accepts the repeat rather than looping.
function raceTavernSign(rng, pools) {
  const words = pools.tavernWords;
  const a = pickFrom(rng, words);
  let b = pickFrom(rng, words);
  for (let i = 0; i < 5 && b === a && words.length > 1; i++) b = pickFrom(rng, words);
  return `The ${a} ${b}`;
}

// How many taverns a settlement keeps as a persistent fixture (Phase 12.7) — a
// seeded range that scales with size. TUNING, not content: retune freely. A keep
// or an unknown size falls back to a single establishment.
const TAVERN_COUNTS = { Hamlet: [1, 1], Village: [1, 2], Town: [2, 3], City: [3, 4] };
export function tavernCountForSize(size, rng) {
  const [lo, hi] = TAVERN_COUNTS[size] || [1, 1];
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// --- Wilderness encounter check (Phase 9.7) -------------------------------
//
// A TRIGGER-AND-PROMPT oracle: the app decides WHETHER an encounter happens (a
// per-terrain check) and names the terrain — the GM rolls the actual encounter on
// their OWN tables. The app never invents a monster. Fires automatically per
// travel-day and on a manual button.

// Per-terrain encounter chance PER DAY. B/X-flavoured "N-in-6" odds; TUNING, not
// content (like TRAVEL_COST in travel.js) — retune freely. Sea/Lake are low (the
// party doesn't cross water, but a manual check stays valid).
export const ENCOUNTER_CHANCE = {
  Plains: 1 / 6,
  Forest: 2 / 6,
  Hills: 2 / 6,
  Mountains: 2 / 6,
  Desert: 2 / 6,
  Swamp: 3 / 6,
  Lake: 1 / 6,
  Sea: 1 / 6,
};
const DEFAULT_ENCOUNTER_CHANCE = 1 / 6;

/**
 * Wilderness encounter CHECK (Phase 9.7) — pure. Rolls the per-terrain chance and
 * reports only WHETHER an encounter occurs; the GM rolls what it is.
 * @param {string} terrain the terrain to check (party's hex)
 * @param {() => number} rng
 * @returns {{ kind:"encounter", terrain:string, encounter:boolean, chance:number }}
 */
export function rollEncounterCheck(terrain, rng) {
  const chance = ENCOUNTER_CHANCE[terrain] ?? DEFAULT_ENCOUNTER_CHANCE;
  return { kind: "encounter", terrain, encounter: rng() < chance, chance };
}

// --- Monastery library research (Phase 15) --------------------------------
// TRIGGER-AND-PROMPT: the app rolls the library's ODDS by monastery size and
// reports only the RESULT TIER; the GM supplies the actual book/answer (never
// invents a title). Bigger libraries skew toward "exact". TUNING, not content.
export const RESEARCH_ODDS = {
  Hamlet:  [["exact",0.05],["related",0.15],["topical",0.35],["nothing",0.45]],
  Village: [["exact",0.12],["related",0.23],["topical",0.35],["nothing",0.30]],
  Town:    [["exact",0.25],["related",0.30],["topical",0.30],["nothing",0.15]],
  City:    [["exact",0.45],["related",0.30],["topical",0.20],["nothing",0.05]],
};

/**
 * Library research CHECK (Phase 15) — pure. Rolls the library's odds by monastery
 * size and reports only the RESULT TIER; the GM supplies the actual book/answer.
 * @param {() => number} rng float in [0,1)
 * @param {string} size the monastery's size (Hamlet|Village|Town|City)
 * @returns {{ kind:"research", size:string, result:"exact"|"related"|"topical"|"nothing" }}
 */
export function rollResearch(rng, size) {
  const ladder = RESEARCH_ODDS[size] || RESEARCH_ODDS.Village;
  const r = rng();
  let acc = 0, result = ladder[ladder.length - 1][0];
  for (const [res, p] of ladder) { acc += p; if (r < acc) { result = res; break; } }
  return { kind: "research", size, result };
}

// GM prompts per research result tier — a trigger-and-prompt cue, never the book
// itself (the GM names the source/answer). Bigger libraries just land higher on
// this ladder more often.
const RESEARCH_PROMPT = {
  exact: "The stacks hold the exact source — name the book or answer the party turns up.",
  related: "A closely related source — a partial or adjacent answer; decide what it gives.",
  topical: "Something on the topic — a hint or general lore; supply it.",
  nothing: "Nothing useful in the library on this.",
};

/**
 * Compose the one-line display string for an oracle pick (compose-at-render).
 * Each oracle kind knows how to phrase its own pick; unknown kinds fall back to
 * the raw answer so a new kind can't crash the log before its prose lands. The
 * random-event flag is NOT folded in here — the UI shows it as its own note.
 * @param {{ kind:string, answer?:string, tone?:string|null, action?:string, subject?:string, text?:string, mood?:string, event?:string, sign?:string }} pick
 * @returns {string}
 */
export function oracleLine(pick) {
  if (!pick) return "";
  if (pick.kind === "yesno") return pick.tone ? `${pick.answer}, ${pick.tone}` : pick.answer;
  if (pick.kind === "meaning") return `${pick.action} · ${pick.subject}`;
  if (pick.kind === "complication") return pick.text;
  if (pick.kind === "settlement") return `${cap(pick.mood)}. ${pick.event}`;
  if (pick.kind === "tavern") return pick.sign; // the headline; specialty + quirk are the body
  if (pick.kind === "encounter") {
    return pick.encounter
      ? `Encounter! Roll a ${pick.terrain} wilderness encounter on your table.`
      : `No encounter (${pick.terrain}).`;
  }
  if (pick.kind === "research") return RESEARCH_PROMPT[pick.result] ?? RESEARCH_PROMPT.nothing;
  return String(pick.answer ?? "");
}

/** Human labels for each oracle kind — a section heading in the tab. */
export const ORACLE_LABELS = {
  yesno: "Yes / No",
  meaning: "Meaning",
  complication: "Complication",
  settlement: "Settlement",
  tavern: "Tavern / shop",
  encounter: "Wilderness encounter",
  research: "Library research",
};

/** Table ids the table-backed oracles (Meaning, Complication, Settlement, Tavern) need. */
export const ORACLE_TABLE_IDS = [
  "oracle-action", "oracle-subject", "oracle-complication",
  "settlement-mood", "settlement-event", "settlement-faction",
  "tavern-sign", "tavern-specialty", "tavern-quirk",
];
