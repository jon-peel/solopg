import { test } from "node:test";
import assert from "node:assert/strict";
import { askYesNo, oracleLine, ORACLE_LABELS } from "../js/gen/oracle.js";
import { mulberry32 } from "../js/core/rng.js";

test("askYesNo: low half of the stream is Yes, high half is No", () => {
  assert.equal(askYesNo(() => 0).answer, "Yes");
  assert.equal(askYesNo(() => 0.1).answer, "Yes");
  assert.equal(askYesNo(() => 0.49).answer, "Yes");
  assert.equal(askYesNo(() => 0.5).answer, "No"); // boundary: 0.5 is not < 0.5
  assert.equal(askYesNo(() => 0.9).answer, "No");
});

test("askYesNo: shape", () => {
  const pick = askYesNo(() => 0.2);
  assert.equal(pick.kind, "yesno");
  assert.ok(pick.answer === "Yes" || pick.answer === "No");
});

test("askYesNo: deterministic for a given seed stream", () => {
  const a = askYesNo(mulberry32(1234));
  const b = askYesNo(mulberry32(1234));
  assert.equal(a.answer, b.answer);
});

test("askYesNo: even split over many rolls (~50/50)", () => {
  const rng = mulberry32(42);
  let yes = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (askYesNo(rng).answer === "Yes") yes++;
  const ratio = yes / N;
  assert.ok(ratio > 0.46 && ratio < 0.54, `ratio ${ratio} not ~0.5`);
});

test("oracleLine composes a yesno pick, tolerates junk", () => {
  assert.equal(oracleLine({ kind: "yesno", answer: "Yes" }), "Yes");
  assert.equal(oracleLine({ kind: "yesno", answer: "No" }), "No");
  assert.equal(oracleLine(null), "");
  assert.equal(oracleLine({ kind: "future", answer: "x" }), "x");
});

test("ORACLE_LABELS has the yesno kind", () => {
  assert.equal(ORACLE_LABELS.yesno, "Yes / No");
});
