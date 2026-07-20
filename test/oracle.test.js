import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askYesNo, rollMeaning, rollComplication, rollSettlement, oracleLine, ORACLE_LABELS, ORACLE_ODDS, DEFAULT_ODDS, ORACLE_TABLE_IDS } from "../js/gen/oracle.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

// Load the real oracle tables the way the app does, validated on arrival.
function oracleTables() {
  const map = new Map();
  for (const id of ORACLE_TABLE_IDS) {
    const t = validateTable(JSON.parse(readFileSync(new URL(`../data/${id}.json`, import.meta.url))));
    map.set(id, t);
  }
  return map;
}

// A constant-value rng for pinning exact zones (askYesNo draws rng() exactly once).
const at = (v) => () => v;

test("odds ladder: yes-threshold governs Yes vs No", () => {
  // Even (0.5): the boundary.
  assert.equal(askYesNo(at(0.49), { odds: "even" }).answer, "Yes");
  assert.equal(askYesNo(at(0.5), { odds: "even" }).answer, "No"); // 0.5 not < 0.5
  // Certain (0.9): a high roll can still be Yes.
  assert.equal(askYesNo(at(0.85), { odds: "certain" }).answer, "Yes");
  assert.equal(askYesNo(at(0.95), { odds: "certain" }).answer, "No");
  // Impossible (0.1): a low roll can still slip to Yes.
  assert.equal(askYesNo(at(0.05), { odds: "impossible" }).answer, "Yes");
  assert.equal(askYesNo(at(0.5), { odds: "impossible" }).answer, "No");
});

test("default odds is even (no opts = even)", () => {
  assert.equal(askYesNo(at(0.1)).answer, "Yes");
  assert.equal(askYesNo(at(0.9)).answer, "No");
  assert.equal(askYesNo(at(0.1)).odds, DEFAULT_ODDS);
});

test("six-outcome spectrum: …and at the extremes, …but by the boundary (even odds)", () => {
  const tone = (v) => { const p = askYesNo(at(v), { odds: "even" }); return `${p.answer}${p.tone ? ", " + p.tone : ""}`; };
  // Yes zone [0,0.5): pos = r/0.5.
  assert.equal(tone(0.02), "Yes, and"); // pos 0.04 < 0.2 → emphatic
  assert.equal(tone(0.25), "Yes");      // pos 0.5 → plain
  assert.equal(tone(0.47), "Yes, but"); // pos 0.94 ≥ 0.8 → marginal
  // No zone [0.5,1): pos = (r-0.5)/0.5.
  assert.equal(tone(0.53), "No, but");  // pos 0.06 < 0.2 → marginal
  assert.equal(tone(0.75), "No");       // pos 0.5 → plain
  assert.equal(tone(0.98), "No, and");  // pos 0.96 ≥ 0.8 → emphatic
});

test("emphatic flag matches the …and tone", () => {
  assert.equal(askYesNo(at(0.02), { odds: "even" }).emphatic, true);
  assert.equal(askYesNo(at(0.25), { odds: "even" }).emphatic, false);
  assert.equal(askYesNo(at(0.98), { odds: "even" }).emphatic, true);
});

test("random-event flag fires on a doubles roll", () => {
  assert.equal(askYesNo(at(0.0)).event, true);   // d100 00
  assert.equal(askYesNo(at(0.11)).event, true);  // d100 11
  assert.equal(askYesNo(at(0.55)).event, true);  // d100 55
  assert.equal(askYesNo(at(0.99)).event, true);  // d100 99
  assert.equal(askYesNo(at(0.12)).event, false); // d100 12
  assert.equal(askYesNo(at(0.34)).event, false); // d100 34
});

test("pick carries the odds it was rolled at", () => {
  const p = askYesNo(at(0.4), { odds: "likely" });
  assert.equal(p.odds, "likely");
  assert.equal(p.oddsLabel, "Likely");
  assert.equal(p.kind, "yesno");
});

test("unknown odds key falls back to even", () => {
  const p = askYesNo(at(0.49), { odds: "bogus" });
  assert.equal(p.answer, "Yes"); // even threshold applied
});

test("oracleLine composes answer + tone; tolerates junk", () => {
  assert.equal(oracleLine({ kind: "yesno", answer: "Yes", tone: null }), "Yes");
  assert.equal(oracleLine({ kind: "yesno", answer: "Yes", tone: "and" }), "Yes, and");
  assert.equal(oracleLine({ kind: "yesno", answer: "No", tone: "but" }), "No, but");
  assert.equal(oracleLine(null), "");
  assert.equal(oracleLine({ kind: "future", answer: "x" }), "x");
});

test("even odds ≈ 50/50 Yes over many rolls", () => {
  const rng = mulberry32(42);
  let yes = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (askYesNo(rng, { odds: "even" }).answer === "Yes") yes++;
  const ratio = yes / N;
  assert.ok(ratio > 0.46 && ratio < 0.54, `ratio ${ratio} not ~0.5`);
});

test("likely odds skews Yes; unlikely skews No", () => {
  const count = (odds) => {
    const rng = mulberry32(7);
    let yes = 0;
    for (let i = 0; i < 3000; i++) if (askYesNo(rng, { odds }).answer === "Yes") yes++;
    return yes / 3000;
  };
  assert.ok(count("likely") > 0.64 && count("likely") < 0.76, "likely ~0.7");
  assert.ok(count("unlikely") > 0.24 && count("unlikely") < 0.36, "unlikely ~0.3");
});

test("ORACLE_ODDS is an ordered ladder with the expected keys", () => {
  assert.deepEqual(ORACLE_ODDS.map((o) => o.key), ["certain", "likely", "even", "unlikely", "impossible"]);
  assert.equal(ORACLE_LABELS.yesno, "Yes / No");
});

// --- Meaning oracle (9.3) ---

test("oracle tables are valid and non-trivial", () => {
  const t = oracleTables();
  for (const id of ORACLE_TABLE_IDS) {
    const table = t.get(id);
    assert.ok(table, `${id} loaded`);
    assert.ok(table.entries.length >= 12, `${id} has a decent spread`);
  }
});

test("rollMeaning draws an action + subject from the tables", () => {
  const t = oracleTables();
  const actions = new Set(t.get("oracle-action").entries.map((e) => e.value));
  const subjects = new Set(t.get("oracle-subject").entries.map((e) => e.value));
  const p = rollMeaning(t, mulberry32(1));
  assert.equal(p.kind, "meaning");
  assert.ok(actions.has(p.action), `action "${p.action}" is from the table`);
  assert.ok(subjects.has(p.subject), `subject "${p.subject}" is from the table`);
});

test("rollMeaning is deterministic for a given stream", () => {
  const t = oracleTables();
  const a = rollMeaning(t, mulberry32(1234));
  const b = rollMeaning(t, mulberry32(1234));
  assert.deepEqual(a, b);
});

test("oracleLine composes a Meaning pair", () => {
  assert.equal(oracleLine({ kind: "meaning", action: "Pursue", subject: "Secrets" }), "Pursue · Secrets");
  assert.equal(ORACLE_LABELS.meaning, "Meaning");
});

// --- Complication oracle (9.4) ---

test("rollComplication draws a twist from the table", () => {
  const t = oracleTables();
  const twists = new Set(t.get("oracle-complication").entries.map((e) => e.value));
  const p = rollComplication(t, mulberry32(3));
  assert.equal(p.kind, "complication");
  assert.ok(twists.has(p.text), `text "${p.text}" is from the table`);
});

test("rollComplication is deterministic for a given stream", () => {
  const t = oracleTables();
  assert.deepEqual(rollComplication(t, mulberry32(99)), rollComplication(t, mulberry32(99)));
});

test("oracleLine composes a Complication; label present", () => {
  assert.equal(oracleLine({ kind: "complication", text: "The door locks behind you." }), "The door locks behind you.");
  assert.equal(ORACLE_LABELS.complication, "Complication");
});

// --- Settlement situation oracle (9.5) ---

test("rollSettlement draws mood + happening from the tables; no faction note by default", () => {
  const t = oracleTables();
  const moods = new Set(t.get("settlement-mood").entries.map((e) => e.value));
  const events = new Set(t.get("settlement-event").entries.map((e) => e.value));
  const p = rollSettlement(t, mulberry32(5));
  assert.equal(p.kind, "settlement");
  assert.ok(moods.has(p.mood));
  assert.ok(events.has(p.event));
  assert.equal(p.factionNote, null);
});

test("rollSettlement adds a faction note with {faction} substituted when a faction is present", () => {
  const t = oracleTables();
  const p = rollSettlement(t, mulberry32(5), { factionName: "The Ashen Hand" });
  assert.ok(p.factionNote, "a note is produced");
  assert.ok(p.factionNote.includes("The Ashen Hand"), "name substituted");
  assert.ok(!p.factionNote.includes("{faction}"), "placeholder consumed");
});

test("rollSettlement is deterministic for a given stream", () => {
  const t = oracleTables();
  assert.deepEqual(
    rollSettlement(t, mulberry32(21), { factionName: "X" }),
    rollSettlement(t, mulberry32(21), { factionName: "X" }),
  );
});

test("oracleLine composes a Settlement situation (Mood. Happening.)", () => {
  const line = oracleLine({ kind: "settlement", mood: "tense and watchful", event: "A caravan has just arrived.", factionNote: null });
  assert.equal(line, "Tense and watchful. A caravan has just arrived.");
  assert.equal(ORACLE_LABELS.settlement, "Settlement");
});
