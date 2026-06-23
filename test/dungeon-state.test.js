import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stateKey,
  getRoomState,
  withRoomState,
  hasRoomState,
} from "../js/world/dungeon-state.js";

test("getRoomState returns a default for unknown rooms", () => {
  assert.deepEqual(getRoomState(undefined, 0, 1), {
    explored: false,
    cleared: false,
    looted: false,
    note: "",
  });
  assert.equal(hasRoomState(undefined, 0, 1), false);
});

test("withRoomState sets a room immutably without touching others", () => {
  const s0 = withRoomState(undefined, 0, 3, { cleared: true });
  assert.equal(getRoomState(s0, 0, 3).cleared, true);
  assert.equal(getRoomState(s0, 0, 4).cleared, false); // unrelated room untouched

  const s1 = withRoomState(s0, 0, 4, { note: "trapped chest" });
  assert.equal(getRoomState(s1, 0, 4).note, "trapped chest");
  assert.equal(getRoomState(s1, 0, 3).cleared, true); // earlier room preserved
  // original object not mutated
  assert.equal(getRoomState(s0, 0, 4).note, "");
});

test("merges patches rather than replacing room state", () => {
  let s = withRoomState(undefined, 1, 2, { explored: true });
  s = withRoomState(s, 1, 2, { looted: true });
  const r = getRoomState(s, 1, 2);
  assert.equal(r.explored, true);
  assert.equal(r.looted, true);
});

test("stateKey is level:room and state JSON round-trips", () => {
  assert.equal(stateKey(2, 5), "2:5");
  const s = withRoomState(undefined, 2, 5, { cleared: true, note: "boss" });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(hasRoomState(s, 2, 5), true);
});
