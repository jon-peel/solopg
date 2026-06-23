import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { TERRAIN_ART, artFor } from "../js/ui/terrain-art.js";
import { TERRAIN_COLORS } from "../js/ui/terrain-style.js";

test("every styled terrain has 2+ art variants", () => {
  for (const terrain of Object.keys(TERRAIN_COLORS)) {
    const variants = artFor(terrain);
    assert.ok(Array.isArray(variants) && variants.length >= 2, terrain);
  }
});

test("every art file exists and is an SVG", () => {
  for (const urls of Object.values(TERRAIN_ART)) {
    for (const url of urls) {
      assert.ok(existsSync(url), `missing ${url}`);
      const body = readFileSync(url, "utf8").trimStart();
      assert.ok(body.startsWith("<svg"), `not an svg: ${url}`);
    }
  }
});

test("artFor returns [] for unknown terrain", () => {
  assert.deepEqual(artFor("Nope"), []);
});
