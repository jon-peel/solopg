import { test } from "node:test";
import assert from "node:assert/strict";
import { askYesNo, oracleLine, ORACLE_LABELS, ORACLE_ODDS, DEFAULT_ODDS } from "../js/gen/oracle.js";
import { mulberry32 } from "../js/core/rng.js";

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
