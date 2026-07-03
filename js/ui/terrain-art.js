// Pencil terrain tile art — coloured-pencil SVG motifs, 2+ variants per terrain.
// Drawn over the flat terrain colour by the map renderer; the variant is chosen
// deterministically per cell at render time (not stored). Falls back to the
// terrain emoji (terrain-style.js) when an image isn't loaded or is missing.

const DIR = "assets/terrain";

export const TERRAIN_ART = {
  Forest: [`${DIR}/forest-1.svg`, `${DIR}/forest-2.svg`],
  Plains: [`${DIR}/plains-1.svg`, `${DIR}/plains-2.svg`],
  Hills: [`${DIR}/hills-1.svg`, `${DIR}/hills-2.svg`],
  Mountains: [`${DIR}/mountains-1.svg`, `${DIR}/mountains-2.svg`],
  Swamp: [`${DIR}/swamp-1.svg`, `${DIR}/swamp-2.svg`],
  Desert: [`${DIR}/desert-1.svg`, `${DIR}/desert-2.svg`],
  // Lake/Sea (Phase 3R.4) share the old Water art as a placeholder — distinct
  // pencil art per art-review convention (visual changes reviewed as files
  // first) is a follow-up, not blocking this sub-phase.
  Lake: [`${DIR}/water-1.svg`, `${DIR}/water-2.svg`],
  Sea: [`${DIR}/water-1.svg`, `${DIR}/water-2.svg`],
};

/** Variant URLs for a terrain (empty array if none). */
export function artFor(terrain) {
  return TERRAIN_ART[terrain] || [];
}
