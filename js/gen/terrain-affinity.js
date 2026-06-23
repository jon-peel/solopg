// Terrain adjacency affinity (pure data).
//
// TERRAIN_AFFINITY[neighbor][candidate] = bonus weight added to `candidate`'s
// terrain roll for each existing neighbor of type `neighbor`. Self-affinity is
// the largest (terrain clusters); compatible terrains get smaller bonuses;
// incompatible pairs are omitted (treated as 0). Used by weightedTerrainTable.

export const TERRAIN_AFFINITY = {
  Forest: { Forest: 3, Plains: 1, Hills: 1, Swamp: 1 },
  Plains: { Plains: 3, Forest: 1, Hills: 1, Desert: 1, Water: 1 },
  Hills: { Hills: 3, Mountains: 2, Plains: 1, Forest: 1 },
  Mountains: { Mountains: 3, Hills: 2 },
  Swamp: { Swamp: 3, Water: 1, Forest: 1 },
  Desert: { Desert: 3, Plains: 1, Hills: 1 },
  Water: { Water: 3, Swamp: 1, Plains: 1 },
};
