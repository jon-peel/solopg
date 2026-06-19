import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTable, rollTable } from "../js/core/table.js";

const good = {
  id: "terrain",
  title: "Terrain",
  entries: [
    { weight: 3, value: "Forest" },
    { weight: 1, value: "Swamp", roll: { table: "swamp-feature" } },
  ],
};

test("validateTable accepts a well-formed table", () => {
  assert.equal(validateTable(good), good);
});

test("validateTable rejects bad shapes", () => {
  assert.throws(() => validateTable(null));
  assert.throws(() => validateTable({ entries: [{ value: 1 }] }), /id/);
  assert.throws(() => validateTable({ id: "x", entries: [] }), /non-empty/);
  assert.throws(
    () => validateTable({ id: "x", entries: [{ weight: 1 }] }),
    /value/,
  );
  assert.throws(
    () => validateTable({ id: "x", entries: [{ weight: 0, value: "a" }] }),
    /weight/,
  );
  assert.throws(
    () => validateTable({ id: "x", entries: [{ value: "a", roll: {} }] }),
    /roll/,
  );
});

test("rollTable respects weights", () => {
  const table = {
    id: "two",
    entries: [
      { weight: 9, value: "common" },
      { weight: 1, value: "rare" },
    ],
  };
  // Deterministic boundary checks against the cumulative-weight algorithm:
  // total weight is 10; target = rng()*10.
  assert.equal(rollTable(table, () => 0).value, "common"); // target 0 -> first
  assert.equal(rollTable(table, () => 0.5).value, "common"); // target 5 -> still first
  assert.equal(rollTable(table, () => 0.95).value, "rare"); // target 9.5 -> second
});

test("omitted weight defaults to 1", () => {
  const table = {
    id: "even",
    entries: [{ value: "a" }, { value: "b" }],
  };
  assert.equal(rollTable(table, () => 0.25).value, "a");
  assert.equal(rollTable(table, () => 0.75).value, "b");
});

test("rollTable resolves nested rolls", () => {
  const sub = { id: "swamp-feature", entries: [{ value: "Bog" }] };
  const resolve = (id) => (id === "swamp-feature" ? sub : null);
  const result = rollTable(good, () => 0.99, { resolve }); // hits the Swamp entry
  assert.equal(result.value, "Swamp");
  assert.equal(result.sub.value, "Bog");
});

test("nested roll without resolver throws", () => {
  assert.throws(() => rollTable(good, () => 0.99), /resolve/);
});
