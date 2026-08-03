// Settlement art — coloured-pencil sketch per size, plus a simple zoomed-out
// marker glyph. The map renderer shows the sketch when zoomed in and the marker
// when zoomed out (level-of-detail). Render-time only; size already lives on the
// hex.
//
// A settlement can also carry a `kind` overlay that wins over the plain size
// art/mark so the site reads as itself: `kind: "keep"` (3R.6) — a martial
// fortification; `kind: "monastery"` (Phase 15) — a religious house. Both ladder
// their SKETCH by size the way plain settlements do, while keeping a single
// zoomed-out glyph.

const DIR = "assets/settlement";

export const SETTLEMENT_ART = {
  Hamlet: `${DIR}/hamlet.svg`,
  Village: `${DIR}/village.svg`,
  Town: `${DIR}/town.svg`,
  City: `${DIR}/city.svg`,
};

// Simple symbol shown when the hex is too small for the sketch.
export const SETTLEMENT_MARK = {
  Hamlet: "•",
  Village: "●",
  Town: "◆",
  City: "★",
};

// Martial "keep/fort" overlay. The SKETCH ladders by size so the site reads as
// its own rank (js/gen/keep.js KEEP_RANK): a lone watchtower, a walled fort, a
// battlemented keep, a curtain-walled citadel. The zoomed-out MARK stays one
// rook at every size — at that scale the hex only needs "a fortification here".
export const KEEP_ART = {
  Hamlet: `${DIR}/watchtower.svg`,
  Village: `${DIR}/fort.svg`,
  Town: `${DIR}/keep.svg`,
  City: `${DIR}/citadel.svg`,
};
export const KEEP_MARK = "♜";

// Religious "monastery" overlay. Same deal: the sketch ladders by MONASTERY_RANK
// (hermit's cell, chapel, steepled abbey, spired great abbey), the cross glyph
// does not.
export const MONASTERY_ART = {
  Hamlet: `${DIR}/hermitage.svg`,
  Village: `${DIR}/priory.svg`,
  Town: `${DIR}/abbey.svg`,
  City: `${DIR}/great-abbey.svg`,
};
export const MONASTERY_MARK = "✝";

export function settlementArt(size, kind) {
  // An unknown size falls back to the middle of the ladder rather than to null:
  // a keep with no art would silently draw as its terrain motif.
  if (kind === "keep") return KEEP_ART[size] || KEEP_ART.Town;
  if (kind === "monastery") return MONASTERY_ART[size] || MONASTERY_ART.Town;
  return SETTLEMENT_ART[size] || null;
}

export function settlementMark(size, kind) {
  if (kind === "keep") return KEEP_MARK;
  if (kind === "monastery") return MONASTERY_MARK;
  return SETTLEMENT_MARK[size] || "•";
}
