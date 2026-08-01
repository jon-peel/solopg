import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mulberry32 } from "../js/core/rng.js";
import { RACE_DEITIES, RACE_NAME_POOLS } from "../js/gen/culture-data.js";
import { stampMonasteries, pickDistinctWeighted, monasteryName } from "../js/gen/monastery.js";

// --- table shim -------------------------------------------------------------
// The pure generator takes a preloaded Map of tables (same contract app.js gives
// it via loadTables). Load the shipped JSON straight off disk into a Map.get shim.
const TABLE_IDS = ["monastery-product", "monastery-provisioning", "monastery-trait", "shrine-dedication", "monastery-name"];
const tables = new Map(TABLE_IDS.map((id) => [id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8"))]));

const PRODUCTS = new Set(tables.get("monastery-product").entries.map((e) => e.value));
const PROVISIONING = new Set(tables.get("monastery-provisioning").entries.map((e) => e.value));
const TRAITS = new Set(tables.get("monastery-trait").entries.map((e) => e.value));
const SHRINE_DEDICATIONS = new Set(tables.get("shrine-dedication").entries.map((e) => e.value));

// Class-partitioned name elements (Step 3) — for asserting a proper name is
// composed from the shipped monastery-name table.
const nameByClass = (cls) => tables.get("monastery-name").entries.filter((e) => e.value.class === cls).map((e) => e.value.text);
const HOUSES = nameByClass("house");
const SAINTS = new Set(nameByClass("saint"));
const VIRTUES = new Set(nameByClass("virtue"));
const COLOURS = new Set(nameByClass("colour"));
// A name always contains a house word as a whole token, whichever form it takes
// ("Saint X's Priory", "the Abbey of Y", "Whitethorn Hermitage", "Dur Grange").
const HOUSE_RE = new RegExp(`\\b(${HOUSES.join("|")})\\b`);

// --- helpers ----------------------------------------------------------------

/** A pending monastery hex at (q,r) of `size`, optional demihuman `race`. */
const monHex = (q, r, size, race, gen = 0) => ({
  coords: { q, r },
  gen,
  settlement: { present: true, kind: "monastery", size, ...(race ? { race } : {}) },
});

/** Bake a fresh single-hex world and return the baked monastery object. */
const bake = (seed, q, r, size, race, gen = 0) => {
  const h = monHex(q, r, size, race, gen);
  stampMonasteries(seed, [h], tables);
  return h.settlement.monastery;
};

// ---------------------------------------------------------------------------
// Determinism & idempotency (mirrors culture.test.js §5.4 / stampSettlements).
// ---------------------------------------------------------------------------

test("determinism: identical inputs bake byte-identical monasteries", () => {
  for (const size of ["Hamlet", "Village", "Town", "City"]) {
    const a = bake("world", 3, 7, size, "dwarf");
    const b = bake("world", 3, 7, size, "dwarf");
    assert.deepEqual(a, b, `${size} bake not reproducible`);
  }
});

test("idempotency: a second pass leaves an already-baked monastery untouched", () => {
  const h = monHex(2, 2, "Village");
  stampMonasteries("s", [h], tables);
  const first = JSON.parse(JSON.stringify(h.settlement.monastery));
  const ref = h.settlement.monastery; // same object identity must survive
  stampMonasteries("s", [h], tables);
  assert.equal(h.settlement.monastery, ref, "the frozen object was replaced on re-run");
  assert.deepEqual(h.settlement.monastery, first, "an already-baked monastery changed on re-run");
});

test("only kind==='monastery' settlements are baked; plain and keep settlements are untouched", () => {
  const monastery = monHex(0, 0, "Town");
  const plain = { coords: { q: 1, r: 0 }, gen: 0, settlement: { present: true, size: "Town" } };
  const keep = { coords: { q: 2, r: 0 }, gen: 0, settlement: { present: true, kind: "keep", size: "Town" } };
  const empty = { coords: { q: 3, r: 0 }, gen: 0, settlement: { present: false } };
  stampMonasteries("s", [monastery, plain, keep, empty], tables);
  assert.ok(monastery.settlement.monastery, "the monastery hex was baked");
  assert.equal(plain.settlement.monastery, undefined, "a plain settlement must not be baked");
  assert.equal(keep.settlement.monastery, undefined, "a keep must not be baked");
  assert.equal(empty.settlement.monastery, undefined, "an empty hex must not be baked");
});

test("stampMonasteries with nothing pending returns early without mutating", () => {
  const hexes = [{ coords: { q: 0, r: 0 }, settlement: { present: true, size: "Town" } }];
  const snapshot = JSON.parse(JSON.stringify(hexes));
  stampMonasteries("s", hexes, tables);
  assert.deepEqual(hexes, snapshot);
  assert.equal(stampMonasteries("s", [], tables).length, 0); // empty array is fine
});

// ---------------------------------------------------------------------------
// Size -> self-sufficiency & industry count (phase-15 §2 size rules).
// ---------------------------------------------------------------------------

test("size drives self-sufficiency: Hamlet/Village dependent, Town/City self-sufficient", () => {
  const expected = { Hamlet: false, Village: false, Town: true, City: true };
  for (const [size, sufficient] of Object.entries(expected)) {
    // Sweep coords so the value is a stable property of size, not one lucky roll.
    for (let q = 0; q < 8; q++) {
      const m = bake("ss", q, q * 2, size);
      assert.equal(m.selfSufficient, sufficient, `${size} selfSufficient should be ${sufficient}`);
    }
  }
});

test("industry count follows size (1 / 1-2 / 2-3 / 3-4) and every industry is distinct & valid", () => {
  const ranges = { Hamlet: [1, 1], Village: [1, 2], Town: [2, 3], City: [3, 4] };
  for (const [size, [lo, hi]] of Object.entries(ranges)) {
    const seen = new Set();
    for (let q = 0; q < 40; q++) {
      const ind = bake("ic", q, 100 - q, size).industries;
      assert.ok(ind.length >= lo && ind.length <= hi, `${size} count ${ind.length} outside [${lo},${hi}]`);
      assert.equal(new Set(ind).size, ind.length, `${size} industries not distinct: ${ind}`);
      for (const v of ind) assert.ok(PRODUCTS.has(v), `${size} industry "${v}" not a product-table value`);
      seen.add(ind.length);
    }
    // A ranged size should actually vary across coords (not pinned to one count).
    if (lo !== hi) assert.ok(seen.size > 1, `${size} count never varied across the sweep`);
  }
});

// ---------------------------------------------------------------------------
// Dedication source (RACE_DEITIES for demihuman, shrine-dedication for Human).
// ---------------------------------------------------------------------------

test("dedication source: a dwarf house honours dwarf gods; a Human/no-race house rolls shrine-dedication", () => {
  for (let q = 0; q < 30; q++) {
    const dwarf = bake("ded", q, q + 1, "Town", "dwarf");
    assert.ok(RACE_DEITIES.dwarf.includes(dwarf.dedication), `dwarf dedication "${dwarf.dedication}" not in RACE_DEITIES.dwarf`);
    assert.ok(!SHRINE_DEDICATIONS.has(dwarf.dedication), "dwarf dedication should not come from the shrine table");

    const human = bake("ded", q, q + 1, "Town"); // no race == Human
    assert.ok(SHRINE_DEDICATIONS.has(human.dedication), `Human dedication "${human.dedication}" not in shrine-dedication`);
  }
});

// ---------------------------------------------------------------------------
// Provisioning present only for dependent houses; trait ∈ the trait table.
// ---------------------------------------------------------------------------

test("provisioning is present only for dependent (small) houses, and reads from the provisioning table", () => {
  for (let q = 0; q < 30; q++) {
    for (const size of ["Hamlet", "Village"]) {
      const m = bake("prov", q, q + 3, size);
      assert.ok("provisioning" in m, `${size} (dependent) must carry a provisioning clause`);
      assert.ok(PROVISIONING.has(m.provisioning), `provisioning "${m.provisioning}" not in the table`);
    }
    for (const size of ["Town", "City"]) {
      const m = bake("prov", q, q + 3, size);
      assert.equal("provisioning" in m, false, `${size} (self-sufficient) must NOT carry provisioning`);
    }
  }
});

test("a trait, when present, is a value from the monastery-trait table (and often absent)", () => {
  let withTrait = 0;
  let without = 0;
  for (let q = 0; q < 60; q++) {
    const m = bake("tr", q, q * 3 + 1, "Village");
    if ("trait" in m) {
      assert.ok(TRAITS.has(m.trait), `trait "${m.trait}" not in the trait table`);
      withTrait++;
    } else {
      without++;
    }
  }
  assert.ok(withTrait > 0 && without > 0, `trait should sometimes be present and sometimes absent (with=${withTrait}, without=${without})`);
});

// ---------------------------------------------------------------------------
// gen re-bake independence: each `gen` is its own deterministic sub-stream.
// ---------------------------------------------------------------------------

test("gen re-bake independence: each gen bakes deterministically, and gen participates in the stream", () => {
  const sigs = new Set();
  for (let gen = 0; gen < 12; gen++) {
    const a = bake("g", 5, 5, "City", "elf", gen);
    const b = bake("g", 5, 5, "City", "elf", gen); // same gen reproduces
    assert.deepEqual(a, b, `gen ${gen} not reproducible`);
    sigs.add(JSON.stringify(a));
  }
  assert.ok(sigs.size > 1, "changing gen must be able to change the bake (independent streams)");
});

// ---------------------------------------------------------------------------
// pickDistinctWeighted — focused unit test (bias, distinctness, clamp, purity).
// ---------------------------------------------------------------------------

test("pickDistinctWeighted: the weight multiplier shifts selection frequency", () => {
  const flat = [{ value: "A", weight: 1 }, { value: "B", weight: 1 }, { value: "C", weight: 1 }];
  const biased = [{ value: "A", weight: 1 }, { value: "B", weight: 10 }, { value: "C", weight: 1 }];
  const N = 4000;
  let flatB = 0;
  let biasedB = 0;
  for (let i = 0; i < N; i++) {
    if (pickDistinctWeighted(mulberry32(i), flat, 1)[0] === "B") flatB++;
    if (pickDistinctWeighted(mulberry32(i), biased, 1)[0] === "B") biasedB++;
  }
  assert.ok(Math.abs(flatB / N - 1 / 3) < 0.05, `flat B frequency ${(flatB / N).toFixed(3)} should be ~0.33`);
  assert.ok(biasedB / N > 0.7, `biased B frequency ${(biasedB / N).toFixed(3)} should dominate (weight 10 of 12)`);
  assert.ok(biasedB > flatB, "the bias multiplier must raise B's selection frequency");
});

test("pickDistinctWeighted: distinct without replacement, count clamped to list length, input never mutated", () => {
  const entries = [{ value: "A", weight: 3 }, { value: "B", weight: 2 }, { value: "C", weight: 1 }];
  const snapshot = JSON.parse(JSON.stringify(entries));
  for (let i = 0; i < 200; i++) {
    const three = pickDistinctWeighted(mulberry32(i), entries, 3);
    assert.equal(three.length, 3);
    assert.equal(new Set(three).size, 3, "picks must be distinct");
    const over = pickDistinctWeighted(mulberry32(i), entries, 9); // clamp to 3
    assert.equal(over.length, 3, "count must clamp to the entry-list length");
    assert.equal(new Set(over).size, 3);
  }
  assert.deepEqual(entries, snapshot, "the caller's entry list must never be mutated");
});

// ---------------------------------------------------------------------------
// monasteryName (Step 3) — proper monastic names, composed from monastery-name.
// ---------------------------------------------------------------------------

const nameTable = tables.get("monastery-name");

/**
 * Decompose a proper name back into its class + epithet, validating that every
 * piece comes from the shipped table. Returns null if it fits no known form.
 *   saint : "<saint>'s <house>"      virtue: "the <house> of <virtue>"
 *   colour: "<colour> <house>"       prefix: "<race-stem> <house>"
 */
function decompose(name) {
  for (const house of HOUSES) {
    if (name.endsWith(`'s ${house}`)) {
      const s = name.slice(0, -(`'s ${house}`).length);
      if (SAINTS.has(s)) return { form: "saint", house, epithet: s };
    }
    if (name.startsWith(`the ${house} of `)) {
      const v = name.slice(`the ${house} of `.length);
      if (VIRTUES.has(v)) return { form: "virtue", house, epithet: v };
    }
    if (name.endsWith(` ${house}`)) {
      const p = name.slice(0, -(` ${house}`).length);
      if (COLOURS.has(p)) return { form: "colour", house, epithet: p };
      return { form: "prefix", house, epithet: p }; // race-stem (or unknown single-token)
    }
  }
  return null;
}

test("monasteryName: deterministic — same rng seed yields the same string", () => {
  for (const s of [1, 7, 42, 1000]) {
    const a = monasteryName(mulberry32(s), nameTable);
    const b = monasteryName(mulberry32(s), nameTable);
    assert.equal(a, b, `seed ${s} not reproducible`);
    const d = monasteryName(mulberry32(s), nameTable, { race: "dwarf" });
    const e = monasteryName(mulberry32(s), nameTable, { race: "dwarf" });
    assert.equal(d, e, `seed ${s} (dwarf) not reproducible`);
  }
});

test("monasteryName: a non-empty name always built around a real house word", () => {
  for (let i = 0; i < 300; i++) {
    const n = monasteryName(mulberry32(i), nameTable);
    assert.ok(typeof n === "string" && n.length > 0, `empty name at seed ${i}`);
    assert.ok(HOUSE_RE.test(n), `name "${n}" carries no house word`);
  }
});

test("monasteryName: a Human (no-race) name is composed from saint/virtue/colour table entries", () => {
  for (let i = 0; i < 300; i++) {
    const n = monasteryName(mulberry32(i), nameTable);
    const d = decompose(n);
    assert.ok(d, `"${n}" fits no known monastic name form`);
    assert.ok(["saint", "virtue", "colour"].includes(d.form), `Human name "${n}" used form ${d.form}`);
  }
});

test("monasteryName: a demihuman (dwarf) house can take its own people's name-stem", () => {
  const dwarfStems = new Set(RACE_NAME_POOLS.dwarf.prefixes);
  let stemNames = 0;
  let epithetNames = 0;
  for (let i = 0; i < 300; i++) {
    const n = monasteryName(mulberry32(i), nameTable, { race: "dwarf" });
    const d = decompose(n);
    assert.ok(d, `"${n}" fits no known monastic name form`);
    if (d.form === "prefix") {
      assert.ok(dwarfStems.has(d.epithet), `stem "${d.epithet}" in "${n}" is not a dwarf prefix`);
      stemNames++;
    } else {
      epithetNames++;
    }
  }
  assert.ok(stemNames > 0, "no dwarf-stem names appeared across the sweep");
  assert.ok(epithetNames > 0, "a dwarf house should still sometimes use an epithet name");
});

// ---------------------------------------------------------------------------
// stampMonasteries now stores a proper `name` (Step 3).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Library tier (Step 5) — a pure size->label lookup baked onto the house.
// ---------------------------------------------------------------------------

test("stampMonasteries bakes a library label that maps by size", () => {
  const expected = {
    Hamlet: "a few shelves",
    Village: "a modest library",
    Town: "a fine library",
    City: "a renowned library",
  };
  for (const [size, label] of Object.entries(expected)) {
    // Sweep coords so the value is a stable property of size, not one lucky roll.
    for (let q = 0; q < 8; q++) {
      const m = bake("lib", q, q * 2 + 1, size);
      assert.equal(m.library, label, `${size} library should be "${label}"`);
    }
  }
});

test("library is deterministic and idempotent like the other baked fields", () => {
  const a = bake("libdet", 3, 7, "Town", "dwarf");
  const b = bake("libdet", 3, 7, "Town", "dwarf");
  assert.equal(a.library, "a fine library");
  assert.equal(b.library, a.library, "library not reproducible");
  // Idempotent — a re-run must not change the stored label.
  const h = monHex(4, 4, "City", "elf");
  stampMonasteries("libidem", [h], tables);
  const first = h.settlement.monastery.library;
  assert.equal(first, "a renowned library");
  stampMonasteries("libidem", [h], tables);
  assert.equal(h.settlement.monastery.library, first, "library changed on re-run");
});

test("stampMonasteries stores a non-empty proper name, deterministic and idempotent", () => {
  for (const size of ["Hamlet", "Village", "Town", "City"]) {
    const a = bake("nm", 4, 9, size, "dwarf");
    assert.ok(typeof a.name === "string" && a.name.length > 0, `${size} baked no name`);
    assert.ok(HOUSE_RE.test(a.name), `${size} name "${a.name}" carries no house word`);
    const b = bake("nm", 4, 9, size, "dwarf");
    assert.equal(b.name, a.name, `${size} name not reproducible`);
  }
  // Idempotent: a re-run must not change the stored name.
  const h = monHex(6, 1, "Town", "elf");
  stampMonasteries("nm2", [h], tables);
  const first = h.settlement.monastery.name;
  stampMonasteries("nm2", [h], tables);
  assert.equal(h.settlement.monastery.name, first, "name changed on re-run");
});
