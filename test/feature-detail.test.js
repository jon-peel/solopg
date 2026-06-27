import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeFeature,
  featureName,
  featureDescription,
  FEATURE_BUILD,
} from "../js/gen/feature-detail.js";
import { SHRINE_SETTING, SHRINE_FORM_BIAS } from "../js/gen/terrain-profile.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

function tables() {
  const ids = [
    "shrine-form",
    "shrine-dedication",
    "shrine-condition",
    "shrine-detail",
    "creatures",
  ];
  return new Map(
    ids.map((id) => [
      id,
      validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8"))),
    ]),
  );
}

const valuesOf = (t) => new Set(t.entries.map((e) => e.value));

test("describeFeature(shrine) returns structured picks drawn from the tables", () => {
  const t = tables();
  const forms = valuesOf(t.get("shrine-form"));
  const dedications = valuesOf(t.get("shrine-dedication"));
  const conditions = valuesOf(t.get("shrine-condition"));
  const details = valuesOf(t.get("shrine-detail"));
  for (let s = 0; s < 50; s++) {
    const f = describeFeature(t, mulberry32(s), { type: "shrine", terrain: "Forest" });
    assert.equal(f.type, "shrine");
    assert.equal(f.build, FEATURE_BUILD);
    assert.ok(forms.has(f.form), `form ${f.form} from manifest`);
    assert.ok(dedications.has(f.dedication));
    assert.ok(conditions.has(f.condition));
    assert.ok(details.has(f.detail));
    assert.ok(SHRINE_SETTING.Forest.includes(f.setting), `setting from terrain skin`);
  }
});

test("describeFeature is deterministic for a given seed + terrain", () => {
  const a = describeFeature(tables(), mulberry32(7), { type: "shrine", terrain: "Desert" });
  const b = describeFeature(tables(), mulberry32(7), { type: "shrine", terrain: "Desert" });
  assert.deepEqual(a, b);
});

test("form is terrain-biased: Mountains can yield a colossal carving, Plains never does", () => {
  const t = tables();
  let mountainCarving = false;
  for (let s = 0; s < 300; s++) {
    const f = describeFeature(t, mulberry32(s), { type: "shrine", terrain: "Mountains" });
    if (f.form === "a colossal carving") mountainCarving = true;
    // Plains bias excludes the colossal carving entirely.
    const p = describeFeature(t, mulberry32(s), { type: "shrine", terrain: "Plains" });
    assert.ok(SHRINE_FORM_BIAS.Plains[p.form], `${p.form} is a Plains form`);
    assert.notEqual(p.form, "a colossal carving");
  }
  assert.ok(mountainCarving, "expected a colossal carving in Mountains over many seeds");
});

test("a watcher only appears at a desecrated/overgrown shrine", () => {
  const t = tables();
  const desecrated = new Set([
    "Toppled and cracked",
    "Defaced and desecrated",
    "Overgrown with vines",
  ]);
  const creatures = valuesOf(t.get("creatures"));
  let sawWatcher = false;
  for (let s = 0; s < 400; s++) {
    const f = describeFeature(t, mulberry32(s), { type: "shrine", terrain: "Swamp" });
    if (f.watcher) {
      sawWatcher = true;
      assert.ok(desecrated.has(f.condition), "watcher implies a desecrated condition");
      assert.ok(creatures.has(f.watcher), "watcher is a creature");
    }
  }
  assert.ok(sawWatcher, "expected at least one watcher over many seeds");
});

test("featureName + featureDescription compose prose from the picks", () => {
  const feature = {
    build: FEATURE_BUILD,
    type: "shrine",
    form: "a standing stone",
    dedication: "to a war-god",
    condition: "Half-buried",
    setting: "beside an old road",
    detail: "a scatter of offering-coins",
    watcher: null,
  };
  assert.equal(featureName(feature), "Shrine to a war-god");
  const lines = featureDescription(feature);
  assert.deepEqual(lines, [
    "A standing stone to a war-god, beside an old road.",
    "Half-buried — a scatter of offering-coins.",
  ]);
  // The watcher adds a third line when present.
  const withWatcher = featureDescription({ ...feature, watcher: "Ghouls" });
  assert.equal(withWatcher.length, 3);
  assert.match(withWatcher[2], /Ghouls/);
});

test("describeFeature returns null for a type with no Tier-1 detail yet", () => {
  assert.equal(describeFeature(tables(), mulberry32(1), { type: "tower", terrain: "Hills" }), null);
});
