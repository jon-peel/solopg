# solopg

A browser-based **World Oracle** for OSR solo and small-group play — a procedural
generation + record-keeping tool for hex-crawl worlds.

See **[PLAN.md](./PLAN.md)** for the master plan: architecture, phased build order, the data
model, and the per-step sub-plans in [`docs/plans/`](./docs/plans).

**Status:** Phases 0–6 complete — seeded hex map with terrain/settlements/POIs, multi-level
**dungeons** (+ towers), terrain-aware **shrine/camp/landmark** detail, and **adventure hooks**
(known/distant/treasure-map/breadcrumb-chain/opportunity/event/escort/return). **Phase 7 (QoL & UX) in
progress:** **7.1 right-click radial menu** — right-click a tile for a fixed-slot ring of its actions,
with inapplicable options greyed-out rather than hidden.

## Running

Vanilla ES modules, **no build step**, but it must be served over HTTP — it cannot run from
`file://` (ES modules, `fetch` of `/data/*.json`, and IndexedDB all need a real origin).

```sh
./run-local.sh                # fetches the branch, runs node --test, serves on :8000
# or, to just serve the working tree:
python3 -m http.server 8000   # or: npm run serve  → open http://localhost:8000
```

From the app: **New World**, then **right-click any tile** for a radial menu of its actions
(place terrain / generate, add settlements & POIs, hooks, regenerate, delete) — or use the side panel.
Left-click selects, left-drag pans. Open a **dungeon/tower** to explore its mapped interior, and
**Generate hook** / **Read map** / **Follow a trail** at a town to spin up adventure hooks
(shown in the always-visible Hooks list). **Export/Import** is JSON backup; reload confirms the
world persists in IndexedDB.

## Tests

Pure engine code (RNG, dice, tables, world model, import/export) is unit-tested with Node's
built-in runner — no dependencies:

```sh
npm test   # or: node --test
```

