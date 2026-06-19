import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, SCHEMA_VERSION } from "../js/world/world.js";
import { exportWorld, importWorld } from "../js/data/portability.js";

test("createWorld produces a valid empty world", () => {
  const w = createWorld({ name: "Greyvale", seed: 42 });
  assert.equal(w.schemaVersion, SCHEMA_VERSION);
  assert.equal(w.name, "Greyvale");
  assert.equal(w.seed, 42);
  assert.ok(typeof w.id === "string" && w.id.length > 0);
  assert.deepEqual(w.hexes, {});
  assert.ok(w.createdAt && w.updatedAt);
});

test("createWorld mints a seed when none is given", () => {
  const w = createWorld({ name: "Random" });
  assert.equal(typeof w.seed, "number");
});

test("createWorld applies defaults", () => {
  const w = createWorld();
  assert.equal(w.name, "Untitled World");
  assert.equal(w.hexScale, 6);
});

test("export -> import round-trips losslessly", () => {
  const w = createWorld({ name: "Roundtrip", seed: 7 });
  const restored = importWorld(exportWorld(w));
  assert.deepEqual(restored, w);
});

test("import rejects non-JSON", () => {
  assert.throws(() => importWorld("not json"), /valid JSON/);
});

test("import rejects a missing schemaVersion", () => {
  assert.throws(() => importWorld(JSON.stringify({ id: "x", name: "y" })), /schemaVersion/);
});

test("import rejects a newer schemaVersion", () => {
  const future = exportWorld({
    ...createWorld({ name: "Future", seed: 1 }),
    schemaVersion: SCHEMA_VERSION + 1,
  });
  assert.throws(() => importWorld(future), /newer/);
});
