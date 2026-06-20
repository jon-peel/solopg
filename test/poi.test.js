import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generatePoi } from "../js/gen/poi.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

function tables() {
  const ids = ["poi-types", "poi-occupant", "creatures", "occupiers"];
  return new Map(
    ids.map((id) => [
      id,
      validateTableMaybe(JSON.parse(readFileSync(`./data/${id}.json`, "utf8"))),
    ]),
  );
}
// poi-types / poi-occupant aren't canonical weighted tables (no top-level
// weights), so only validate the ones that are.
function validateTableMaybe(t) {
  if (t.id === "creatures" || t.id === "occupiers") validateTable(t);
  return t;
}

const forced = (vals) => {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
};

test("generatePoi is deterministic for a given seed", () => {
  const a = generatePoi(tables(), mulberry32(42), { terrain: "Hills", index: 0 });
  const b = generatePoi(tables(), mulberry32(42), { terrain: "Hills", index: 0 });
  assert.deepEqual(a, b);
});

test("Water never yields a dungeon (terrain-weighted types)", () => {
  const t = tables();
  for (let s = 0; s < 200; s++) {
    const poi = generatePoi(t, mulberry32(s), { terrain: "Water", index: 0 });
    assert.notEqual(poi.type, "dungeon");
  }
});

test("a camp is occupier-leaning; a lair yields a creature", () => {
  const t = tables();
  // camp -> occupied lean: force type roll to camp by using a terrain whose
  // table contains camp, then force kind to "occupied".
  // Plains allows camp. Force rng: first picks type, then occupant kind, then label.
  const camp = generatePoi(t, forced([0.5, 0.0, 0.0]), { terrain: "Plains", index: 0 });
  // Not asserting exact type (depends on weights), but if it's a camp it must be occupied/none.
  if (camp.type === "camp") {
    assert.ok(["occupied", "none"].includes(camp.occupant.kind));
  }
  // A lair type must carry a creature occupant or none.
  const lair = generatePoi(t, forced([0.0, 0.0, 0.0]), { terrain: "Forest", index: 1 });
  if (lair.occupant.kind === "lair") {
    assert.ok(typeof lair.occupant.creature === "string");
  }
});

test("a dungeon POI is typed but carries no interior (generated lazily)", () => {
  const t = tables();
  // Mountains weights include dungeon; search seeds for one.
  let found = null;
  for (let s = 0; s < 300 && !found; s++) {
    const poi = generatePoi(t, mulberry32(s), { terrain: "Mountains", index: 0 });
    if (poi.type === "dungeon") found = poi;
  }
  assert.ok(found, "expected to roll a dungeon in Mountains");
  // The interior (detail.dungeon) is built on first open, not at POI roll time.
  assert.equal(found.detail.stub, undefined);
  assert.equal(found.detail.dungeon, undefined);
});

test("POI id reflects its index", () => {
  const poi = generatePoi(tables(), mulberry32(1), { terrain: "Plains", index: 3 });
  assert.equal(poi.id, "poi:3");
});

test("forceType overrides the terrain-weighted type roll", () => {
  // Water can't roll a dungeon, but a manual add with forceType can place one.
  const poi = generatePoi(tables(), mulberry32(1), {
    terrain: "Water",
    index: 0,
    forceType: "dungeon",
  });
  assert.equal(poi.type, "dungeon");
  assert.equal(poi.detail.stub, undefined); // interior is generated lazily on open
});

test("forceType supports the cave type", () => {
  const poi = generatePoi(tables(), mulberry32(2), {
    terrain: "Plains",
    index: 0,
    forceType: "cave",
  });
  assert.equal(poi.type, "cave");
});

test("name embeds the occupant for lair/occupied", () => {
  const t = tables();
  for (let s = 0; s < 100; s++) {
    const poi = generatePoi(t, mulberry32(s), { terrain: "Forest", index: 0, forceType: "ruin" });
    if (poi.occupant.kind === "lair") {
      assert.ok(poi.name.includes(poi.occupant.creature));
      break;
    }
  }
});
