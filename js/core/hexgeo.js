// Hex grid geometry — pointy-top, axial coordinates (q, r).
//
// Pure module (no DOM): coordinate math, cube rounding, corners, neighbors, and
// "q,r" key encoding. Unit-tested under node --test. `s` is the hex size
// (center-to-corner distance, in pixels).

// Axial neighbor direction deltas (orientation-independent), fixed order.
export const NEIGHBOR_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Encode axial coords as a map key. */
export function axialKey(q, r) {
  return `${q},${r}`;
}

/** Decode a "q,r" key back to integer coords. Throws on malformed input. */
export function parseKey(key) {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(key));
  if (!m) throw new Error(`Invalid axial key: "${key}"`);
  return { q: Number(m[1]), r: Number(m[2]) };
}

/** Axial -> pixel (pointy-top). */
export function axialToPixel(q, r, s) {
  return {
    x: s * Math.sqrt(3) * (q + r / 2),
    y: s * (3 / 2) * r,
  };
}

/** Pixel -> fractional axial (pointy-top). */
export function pixelToAxialFractional(x, y, s) {
  return {
    q: ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / s,
    r: ((2 / 3) * y) / s,
  };
}

/** Round fractional axial to the nearest hex via cube rounding. */
export function roundAxial(qf, rf) {
  const x = qf;
  const z = rf;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  // Normalize -0 to 0 so keys/comparisons stay canonical.
  return { q: rx === 0 ? 0 : rx, r: rz === 0 ? 0 : rz };
}

/** Pixel -> nearest axial cell. */
export function pixelToAxial(x, y, s) {
  const f = pixelToAxialFractional(x, y, s);
  return roundAxial(f.q, f.r);
}

/** The 6 corner points of a pointy-top hex centered at (cx, cy). */
export function hexCorners(cx, cy, s) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // -30deg start = pointy-top
    corners.push({ x: cx + s * Math.cos(angle), y: cy + s * Math.sin(angle) });
  }
  return corners;
}

/** The 6 axial neighbors of (q, r). */
export function neighbors(q, r) {
  return NEIGHBOR_DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

/** Hex distance (cube metric) between two axial cells — the number of steps. */
export function axialDistance(aq, ar, bq, br) {
  return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
}

/**
 * The straight hex line from (aq,ar) to (bq,br), inclusive of both ends. Axial is
 * a linear projection of cube, so we lerp the axial coords and cube-round each
 * step. Returns N+1 cells where N is the hex distance.
 */
export function axialLine(aq, ar, bq, br) {
  const N = axialDistance(aq, ar, bq, br);
  const out = [];
  for (let i = 0; i <= N; i++) {
    const t = N === 0 ? 0 : i / N;
    out.push(roundAxial(aq + (bq - aq) * t, ar + (br - ar) * t));
  }
  return out;
}
