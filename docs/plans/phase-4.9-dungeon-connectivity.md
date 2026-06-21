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

### 4.9.1 — Room-graph rewrite + loops  *(foundation)*
- Replace the spanning-tree corridor carver with a **graph generator**: spanning tree for guaranteed
  connectivity, then add extra edges → **loops / multiple pathways** (density by size).
- Edges carry a `type` field (all `open` for now); corridor cells derived from edges for rendering.
- Renderer draws rooms + edge corridors from the graph.
- **Tested:** fully connected; contains cycles when size warrants; deterministic; no overlaps.

### 4.9.2 — Doors, passages & secret doors
- Edge types: `open / door / locked / stuck / secret` (data-weighted). Render door markers on edges.
- **Secret doors** are hidden in the view until "revealed" (flagged in the model; renderer hides
  them); ensure no room is reachable **only** via a secret edge unless deliberately a hidden vault.
- **Tested:** every non-vault room reachable without secret edges; type distribution sane.

### 4.9.3 — Inter-level links, multiple entrances & exits
- **Stairs/shafts** linking levels at specific rooms; clicking one navigates between levels.
- **Multiple entrances**, count **size-scaled**; **exits** that may surface on **L2/L3** when the
  hosting terrain is Hills/Mountains (passed in as context from the POI's hex).
- **Tested:** every level reachable from some entrance; entrance/exit counts scale; stairs connect
  valid rooms across adjacent levels.

### 4.9.4 — Richer room contents
- Replace the bare `treasure: boolean` and unspecified `Special` with detail tables: **trap**
  (type/trigger/effect), **treasure** (coins/valuables/item, hidden vs guarded), **special**
  (altar/fountain/puzzle/prisoner…), **empty-room dressing**, and **monster number-appearing +
  status**. Panel shows full room detail.
- *(Optional fold-ins: theme hazards — flood/gas/dark/collapse; mild depth scaling.)*
- **Tested:** content/detail come from tables; determinism.

### 4.9.5 — Exploration state & GM notes  *(the record-keeping payoff)*
- Mark rooms **explored / cleared**, treasure taken, monsters defeated; **reveal secret doors** on
  discovery; **per-room notes** that persist. Optional reveal-as-you-go fog for solo play.
- Visual state on the map (cleared/looted/unexplored). Persisted in the world.
- **Tested (logic parts):** state transitions on a room; persistence round-trips.

### 4.9.6 — Dungeon View polish
- Draw **entrances/exits/stairs** clearly + a **room key/legend**; **reroll** a single level/room;
  **pan-zoom** for large maps; click a **monster** for detail; **enter a dungeon by clicking it on
  the hex map**.
- Manual browser checklist (UI step).

---

## Story / backstory (decide where it lands)
A dungeon's **why** (history, resident villain/patron, goal) and **hooks** overlap Phase 6 (Rumors).
Proposal: a light "dungeon backstory" line in **4.9.4**, full hook generation deferred to Phase 6.
Factions-inside ties to the deferred **Factions** phase — keep occupants as families/labels for now.

## Out of scope for 4.9 (backlog)
Dungeon art/tiles; restocking-over-time; full faction machinery inside dungeons; printable PDF export.

## Status
- 4.9.1 ◻  · 4.9.2 ◻  · 4.9.3 ◻  · 4.9.4 ◻  · 4.9.5 ◻  · 4.9.6 ◻  *(plan high-level; detail each
  step at build time)*
