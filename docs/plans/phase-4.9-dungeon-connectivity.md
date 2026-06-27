# Sub-plan: Phase 4.9 — Dungeon Depth & Connectivity (sub-project)

Turns the current "stack of independent single-floor maps" into a **connected, multi-path,
multi-level dungeon** you can actually explore: linked levels, doors & secret doors, multiple
entrances/exits, and loops rather than dead-straight paths. Builds on the Phase 4 arc (themes,
families, per-level rooms+corridors, Dungeon View).

> **Ground rule for this sub-project: NO backward compatibility.** We're pre-v1. We will redesign
> the persisted dungeon shape freely. The dungeon interior is versioned by `DUNGEON_BUILD`
> (`js/gen/dungeon.js`); bumping it makes existing saves **self-heal** (regenerate on open), so we
> never write migrations for dungeon internals. World-level schema may also change without migration
> support where convenient.

Conventions still hold: no build/deps; serve over HTTP; **layout/graph logic is pure & node-tested**,
the renderer stays dumb; seeded determinism via `subRng`; data-driven tables + JS-const rules; one
coherent step per commit to PR #1; each UI step ends with a manual checklist.

## Working method (how we run this sub-project)
- **One sub-plan file per step** (`docs/plans/phase-4.9.N-*.md`), written just before we build that
  step — keeps each context small for both of us. This file stays the durable overview.
- **Every step is testable by the user**, not just node tests: each ends with a short manual browser
  checklist run via `./run-local.sh`. Steps are sized so there's always something visible to poke.
- **Each manual checklist is headed with the step's title** (e.g. "4.9.2 — Room-graph rewrite +
  loops") so it's always clear what's under test.

---

## The keystone: a room **graph** (replaces tree-carved corridors)

Today `js/gen/dungeon-layout.js` connects each new room to its nearest neighbour — a spanning **tree**
(one path between any two rooms, no loops). Everything below rests on replacing that with an explicit
**graph**:

- **Rooms = nodes** (with grid position/size); **connections = edges** with a `type`
  (open / door / locked / stuck / **secret**).
- A guaranteed-connected base (spanning tree) **plus extra edges** to create **loops & multiple
  routes**. Loop density scales with dungeon size.
- **Inter-level links** (stairs/shafts) are edges between levels; **entrances/exits** are edges to
  the surface, possibly on deeper levels for hill/mountain sites.

New/!reshaped schema (illustrative — finalized in 4.9.1):
```js
dungeon = {
  build, size, theme,
  levels: [ { depth, theme, family, encounters,
              rooms:[{ n, pos:{x,y,w,h}, content, ... }],
              edges:[{ a, b, type }]        // intra-level connections
          } ],
  links: [ { fromLevel, fromRoom, toLevel, toRoom, kind } ], // stairs/shafts between levels
  entrances: [ { level, room, kind } ],     // surface access (>=1, size-scaled)
  exits:     [ { level, room, kind } ],      // may be on L2/L3 (terrain-aware)
}
```

---

## Sub-steps (each a vertical slice, one commit; build order = dependency order)

### 4.9.1 — Dungeon creation UI: randomize or choose size
- When adding a dungeon (Add POI ▾ → Dungeon), let the user **randomize** the size or **pick** one
  (Cramped → Sprawling). Size is **locked on the POI at creation** (a `sizeHint`), since it drives
  level count, entrance count, and loop density downstream. `generateDungeon` accepts a forced size.
- Quick, visible, independently testable win that establishes "size is a creation-time input."
- **Tested:** node — forced size is honored & in range; manual — picking a size yields a dungeon of
  that size; "Random" varies.

### 4.9.2 — Room-graph rewrite + loops  *(foundation)*
- Replace the spanning-tree corridor carver with a **graph generator**: spanning tree for guaranteed
  connectivity, then add extra edges → **loops / multiple pathways** (density by size).
- **Loop tuning (user steer):** default toward *more* loops than a minimal tree; density scales with
  **room count** so large levels are noticeably loopy (multiple cycles), while small levels
  **occasionally stay fully linear** for variety.
- Edges carry a `type` field (all `open` for now); corridor cells derived from edges for rendering.
- Renderer draws rooms + edge corridors from the graph.
- **Tested:** node — fully connected, contains cycles when size warrants, deterministic, no overlaps;
  manual — bigger dungeons visibly show loops/branches, not one snaking path.

### 4.9.3 — Doors, passages & secret doors
- Edge types: `open / door / locked / stuck / secret` (data-weighted). Render door markers on edges.
- **Secret doors** are hidden in the view until "revealed" (flagged in the model; renderer hides
  them); ensure no room is reachable **only** via a secret edge unless deliberately a hidden vault.
- **Tested:** node — every non-vault room reachable without secret edges, type distribution sane;
  manual — doors/locked/stuck render, secret doors are invisible until revealed.

### 4.9.4 — Inter-level links, multiple entrances & exits
- **Stairs/shafts** linking levels at specific rooms; clicking one navigates between levels.
- **Multiple entrances**, count **size-scaled**; **exits** that may surface on **L2/L3** when the
  hosting terrain is Hills/Mountains (passed in as context from the POI's hex).
- **Tested:** node — every level reachable from some entrance, counts scale, stairs connect valid
  rooms across adjacent levels; manual — click stairs to move between levels; entrances/exits shown.

### 4.9.5 — Richer room contents
- Replace the bare `treasure: boolean` and unspecified `Special` with detail tables: **trap**
  (type/trigger/effect), **treasure** (coins/valuables/item, hidden vs guarded), **special**
  (altar/fountain/puzzle/prisoner…), **empty-room dressing**, and **monster number-appearing +
  status**. Panel shows full room detail.
- *(Optional fold-ins: theme hazards — flood/gas/dark/collapse; mild depth scaling.)*
- **Tested:** node — content/detail come from tables, determinism; manual — clicking a room shows
  the richer detail.

### 4.9.6 — Exploration state & GM notes  *(the record-keeping payoff)*
- Mark rooms **explored / cleared**, treasure taken, monsters defeated; **reveal secret doors** on
  discovery; **per-room notes** that persist. Optional reveal-as-you-go fog for solo play.
- Visual state on the map (cleared/looted/unexplored). Persisted in the world.
- **Tested:** node — state transitions & persistence round-trip; manual — toggle room state + add a
  note, reload, state persists.

### 4.9.7 — Dungeon View polish
- Draw **entrances/exits/stairs** clearly + a **room key/legend**; **reroll** a single level/room;
  **pan-zoom** for large maps; click a **monster** for detail; **enter a dungeon by clicking it on
  the hex map**.
- Manual browser checklist (UI step).

---

## Story / backstory — DEFERRED to Phase 6 (Rumors)
A dungeon's **why** (history, resident villain/patron, goal) and **hooks** belong with rumors.
**Confirmed:** keep all of this for Phase 6; 4.9 does structure + contents + record-keeping only.
Factions-inside ties to the deferred **Factions** phase — keep occupants as families/labels for now.

## Out of scope for 4.9 (backlog)
Dungeon art/tiles; restocking-over-time; full faction machinery inside dungeons; printable PDF export.

## Status
- 4.9.1 ✅ · 4.9.2 ✅ · 4.9.3 ✅ · 4.9.4 ✅ · 4.9.5 ✅ · 4.9.6 ✅ · 4.9.7 ✅ · 4.9.8 ✅
  *(each step has its own `phase-4.9.N-*.md` sub-plan)*
- **Planned follow-ups:**
  - **4.9.9 — Cave doors + "Vast" size:** theme-aware door weights (caves lean to open passages,
    few crafted doors; a stuck door in a cave reads as a cave-in); add a rare **Vast** size (5–6
    levels) — very low roll-weight, always pickable from the Add-dungeon menu.
  - **4.9.10 — Lighting (Tier A):** per-room `light`, almost always dark; small chance lit with a
    theme-biased source + reason (candle, embers, torches, magical glow).
  - **4.9.11 — Lighting (Tier B, occupied frontier):** a chance the dungeon is occupied — first few
    rooms from an entrance are held + lit, a locked/secret door seals the dark monster-filled depths.
  - **4.9.14 — Named-den signature bias ✅:** eponymous dens (Goblin warren, Kobold tunnels,
    Ghoul warren, Ogre lair, Spider nest, Troglodyte caves) carry a `signature` member that gets a
    depth-decaying weight boost (×4 level 1, ×2 level 2, ×1 deeper), so a named den opens with its
    namesake while deeper levels keep the emergent spread + escalation. Generic dens (Ruin, tombs,
    caves…) are untouched.
- **Deferred:** monster stat detail (out of scope — system-agnostic).
