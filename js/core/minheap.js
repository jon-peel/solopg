// Minimal binary min-heap keyed by a numeric `d` field on each item.
//
// A tiny priority queue for the Dijkstra / A* passes over the hex grid
// (js/gen/rivers.js drainage flood, js/gen/roads.js least-cost routing). Items
// are plain objects carrying whatever payload the caller needs plus a numeric
// `d` (the key ordered on). Pure and dependency-free so it's unit-testable under
// `node --test`.
export class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].d <= a[i].d) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2; let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}
