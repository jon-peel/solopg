// Settlement art — coloured-pencil sketch per size, plus a simple zoomed-out
// marker glyph. The map renderer shows the sketch when zoomed in and the marker
// when zoomed out (level-of-detail). Render-time only; size already lives on the
// hex.
//
// A settlement can also carry a martial `kind: "keep"` (3R.6) — a fortified
// site, independent of size. When present it overrides the size art/mark with a
// keep sketch/glyph, so a Keep reads as a Keep at any size.

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

// Martial "keep/fort" overlay (any size). A stone tower sketch and a rook glyph
// (reads as a fortification, distinct from the civilian settlement dots).
export const KEEP_ART = `${DIR}/keep.svg`;
export const KEEP_MARK = "♜";

export function settlementArt(size, kind) {
  if (kind === "keep") return KEEP_ART;
  return SETTLEMENT_ART[size] || null;
}

export function settlementMark(size, kind) {
  if (kind === "keep") return KEEP_MARK;
  return SETTLEMENT_MARK[size] || "•";
}
