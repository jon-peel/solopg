// Keep display naming — the martial parallel to js/gen/monastery.js's
// MONASTERY_RANK. A keep bakes NO data object of its own (js/gen/hex.js only
// stamps `settlement.kind = "keep"`), so everything here is a PURE lookup off
// the settlement's effective size: no rng, no stored fields, nothing to migrate.

// A keep's size reads MARTIALLY, not as a plain settlement tier. The underlying
// size (Hamlet…City — still what drives the garrison and the map art) maps to a
// rank shown in the panel meta, the map hover and the radial placement menu, so
// a GM never sees "Town keep".
export const KEEP_RANK = {
  Hamlet: "Watchtower",
  Village: "Fort",
  Town: "Keep",
  City: "Citadel",
};

// Size -> the garrison the site can hold. Lives here rather than inline in the
// panel so it is pure and unit-testable alongside the rank it pairs with.
export const KEEP_GARRISON = {
  Hamlet: "a small watch",
  Village: "a standing garrison",
  Town: "a full garrison",
  City: "a war-garrison",
};
