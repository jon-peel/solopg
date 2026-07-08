import { test } from "node:test";
import assert from "node:assert/strict";
import { coastalPorts } from "../js/gen/ports.js";
import { axialKey } from "../js/core/hexgeo.js";

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

test("coastalPorts: a Lake shore is NOT a port (Sea only)", () => {
  const terrain = new Map([[axialKey(1, 0), "Lake"], [axialKey(0, 0), "Plains"]]);
  const settlements = new Map([[axialKey(0, 0), "City"]]);
  assert.deepEqual(coastalPorts(settlements, terrain), []);
});
