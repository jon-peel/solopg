import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoomRadialModel } from "../js/ui/radial-room-model.js";

const byId = (m, id) => m.filter((s) => s.id === id);
const SLOTS = ["toggle", "toggle", "toggle", "stairs", "focus"];

test("fixed slots in a fixed order, regardless of room state", () => {
  const a = buildRoomRadialModel({}).map((s) => s.id);
  const b = buildRoomRadialModel({ explored: true, cleared: true, looted: true, connections: [{ label: "x", toLevel: 1, toRoom: 2 }] }).map((s) => s.id);
  assert.deepEqual(a, SLOTS);
  assert.deepEqual(b, SLOTS);
});

test("the three toggles carry their field as value and reflect the on-state", () => {
  const m = buildRoomRadialModel({ explored: true, cleared: false, looted: true });
  const toggles = byId(m, "toggle");
  assert.deepEqual(toggles.map((t) => t.value), ["explored", "cleared", "looted"]);
  assert.deepEqual(toggles.map((t) => !!t.on), [true, false, true]);
});

test("Take stairs is disabled (with reason) when the room has no links", () => {
  const none = buildRoomRadialModel({ connections: [] }).find((s) => s.id === "stairs");
  assert.equal(none.enabled, false);
  assert.match(none.reason, /no stairs/i);
  assert.deepEqual(none.children, []);
});

test("Take stairs lists one child per connection, carrying the target level+room", () => {
  const conns = [
    { label: "Stairs down to L2 →", toLevel: 1, toRoom: 4 },
    { label: "Shaft up to L1 →", toLevel: 0, toRoom: 7 },
  ];
  const stairs = buildRoomRadialModel({ connections: conns }).find((s) => s.id === "stairs");
  assert.equal(stairs.enabled, true);
  assert.equal(stairs.children.length, 2);
  assert.equal(stairs.children[0].id, "goTo");
  assert.deepEqual(stairs.children[0].value, { level: 1, room: 4 });
  assert.equal(stairs.children[0].label, "L2");
  assert.equal(stairs.children[0].title, "Stairs down to L2 →");
});

test("Center is always an enabled leaf", () => {
  const focus = buildRoomRadialModel({}).find((s) => s.id === "focus");
  assert.equal(focus.kind, "leaf");
  assert.equal(focus.enabled, true);
});
