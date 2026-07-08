import { test } from "node:test";
import assert from "node:assert/strict";
import { roadRiverCrossings, coastalPorts } from "../js/gen/crossings.js";
import { axialKey } from "../js/core/hexgeo.js";

// A river running along the q-axis; a road crossing it along the r-axis at (0,0).
const riverEW = [{ path: [{ q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }] }];
const roadCrossing = (tier) => [{
  tier, path: [{ q: 0, r: -2 }, { q: 0, r: -1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 0, r: 2 }],
}];

test("a transverse road×river crossing is detected at the shared hex", () => {
  const cr = roadRiverCrossings(roadCrossing(2), riverEW);
  assert.equal(cr.length, 1);
  assert.equal(cr[0].q, 0);
  assert.equal(cr[0].r, 0);
});

test("bigger roads bridge (tier ≤ 2), tracks/spurs ford (tier 3)", () => {
  assert.equal(roadRiverCrossings(roadCrossing(1), riverEW)[0].kind, "bridge");
  assert.equal(roadRiverCrossings(roadCrossing(2), riverEW)[0].kind, "bridge");
  assert.equal(roadRiverCrossings(roadCrossing(3), riverEW)[0].kind, "ford");
});

test("a road running ALONGSIDE a river (same course) is not a crossing", () => {
  // Road overlaps the river's own hexes, travelling the same direction.
  const alongside = [{ tier: 1, path: [{ q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }] }];
  assert.deepEqual(roadRiverCrossings(alongside, riverEW), []);
});

test("no rivers, or a too-short road, yields no crossings", () => {
  assert.deepEqual(roadRiverCrossings(roadCrossing(1), []), []);
  assert.deepEqual(roadRiverCrossings([{ tier: 1, path: [{ q: 0, r: 0 }, { q: 0, r: 1 }] }], riverEW), []); // endpoints only
});

test("a hex crossed by several roads keeps the biggest (lowest tier)", () => {
  const roads = [...roadCrossing(3), ...roadCrossing(1)]; // a track and a highway on the same hex
  const cr = roadRiverCrossings(roads, riverEW);
  assert.equal(cr.length, 1);
  assert.equal(cr[0].tier, 1);
  assert.equal(cr[0].kind, "bridge");
});

test("coastalPorts: a Town/City touching the Sea is a port; inland or small is not", () => {
  const terrain = new Map([
    [axialKey(1, 0), "Sea"], // a Sea neighbour of (0,0)
    [axialKey(0, 0), "Plains"],
    [axialKey(5, 5), "Plains"],
    [axialKey(9, 0), "Plains"],
    [axialKey(10, 0), "Sea"],
  ]);
  const settlements = new Map([
    [axialKey(0, 0), "City"],   // coastal → port
    [axialKey(5, 5), "Town"],   // inland → no port
    [axialKey(9, 0), "Hamlet"], // coastal but too small → no port
  ]);
  const ports = coastalPorts(settlements, terrain);
  assert.equal(ports.length, 1);
  assert.deepEqual(ports[0], { q: 0, r: 0 });
});
