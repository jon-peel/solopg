// Settlement art — coloured-pencil sketch per size, plus a simple zoomed-out
// marker glyph. The map renderer shows the sketch when zoomed in and the marker
// when zoomed out (level-of-detail). Render-time only; size already lives on the
// hex.

const DIR = "assets/settlement";

export const SETTLEMENT_ART = {
  Thorp: `${DIR}/thorp.svg`,
  Hamlet: `${DIR}/hamlet.svg`,
  Village: `${DIR}/village.svg`,
  Town: `${DIR}/town.svg`,
  City: `${DIR}/city.svg`,
};

// Simple symbol shown when the hex is too small for the sketch.
export const SETTLEMENT_MARK = {
  Thorp: "·",
  Hamlet: "•",
  Village: "●",
  Town: "◆",
  City: "★",
};

export function settlementArt(size) {
  return SETTLEMENT_ART[size] || null;
}

export function settlementMark(size) {
  return SETTLEMENT_MARK[size] || "•";
}
