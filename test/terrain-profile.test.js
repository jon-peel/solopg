import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERRAIN_PROFILE,
  profileFor,
  cappedSizeTable,
  poiTypeTable,
  SIZE_ORDER,
  KNOWN_TERRAINS,
} from "../js/gen/terrain-profile.js";

const sizeTable = {
  id: "settlement-size",
  entries: SIZE_ORDER.map((size) => ({ value: { size } })),
};

test("Water allows no settlement", () => {
  assert.equal(TERRAIN_PROFILE.Water.settlement, null);
});

test("every styled terrain has a profile", () => {
  for (const t of KNOWN_TERRAINS) {
    assert.ok(profileFor(t), `missing profile for ${t}`);
  }
});

test("Desert caps at Town; Mountains/Swamp at Hamlet", () => {
  assert.equal(TERRAIN_PROFILE.Desert.settlement.maxSize, "Town");
  assert.equal(TERRAIN_PROFILE.Mountains.settlement.maxSize, "Hamlet");
  assert.equal(TERRAIN_PROFILE.Swamp.settlement.maxSize, "Hamlet");
});

test("cappedSizeTable excludes oversized sizes and never mutates base", () => {
  const snapshot = JSON.parse(JSON.stringify(sizeTable));
  const capped = cappedSizeTable(sizeTable, "Town");
  const sizes = capped.entries.map((e) => e.value.size);
  assert.deepEqual(sizes, ["Thorp", "Hamlet", "Village", "Town"]);
  assert.ok(!sizes.includes("City"));
  assert.deepEqual(sizeTable, snapshot); // unchanged
});

test("Water POI weights exclude dungeon/mine/tower/camp", () => {
  const types = Object.keys(TERRAIN_PROFILE.Water.poi.weights);
  for (const banned of ["dungeon", "mine", "tower", "camp"]) {
    assert.ok(!types.includes(banned), `Water should not allow ${banned}`);
  }
});

test("poiTypeTable builds weighted entries from the profile", () => {
  const t = poiTypeTable("Mountains");
  const values = t.entries.map((e) => e.value);
  assert.ok(values.includes("mine") && values.includes("dungeon"));
  assert.ok(t.entries.every((e) => typeof e.weight === "number"));
});
