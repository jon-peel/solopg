// Settlement art — coloured-pencil sketch per size, plus a simple zoomed-out
// marker glyph. The map renderer shows the sketch when zoomed in and the marker
// when zoomed out (level-of-detail). Render-time only; size already lives on the
// hex.
//
// A settlement can also carry a `kind` overlay, independent of size, that wins
// over the size art/mark so the site reads as itself at any size: `kind: "keep"`
// (3R.6) — a martial fortified tower; `kind: "monastery"` (Phase 15) — a
// religious house drawn as a chapel/steeple with a cross.

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

// Religious "monastery" overlay (any size). A chapel/steeple sketch and a cross
// glyph (reads as a religious house, distinct from the keep's martial tower).
export const MONASTERY_ART = `${DIR}/monastery.svg`;
export const MONASTERY_MARK = "✝";

export function settlementArt(size, kind) {
  if (kind === "keep") return KEEP_ART;
  if (kind === "monastery") return MONASTERY_ART;
  return SETTLEMENT_ART[size] || null;
}

export function settlementMark(size, kind) {
  if (kind === "keep") return KEEP_MARK;
  if (kind === "monastery") return MONASTERY_MARK;
  return SETTLEMENT_MARK[size] || "•";
}
