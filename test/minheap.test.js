import { test } from "node:test";
import assert from "node:assert/strict";
import { MinHeap } from "../js/core/minheap.js";

test("MinHeap: pops items in ascending `d` order", () => {
  const h = new MinHeap();
  const ds = [5, 1, 9, 3, 3, 0, 7, 2, 8, 4];
  for (const d of ds) h.push({ d, tag: `t${d}` });
  assert.equal(h.size, ds.length);
  const out = [];
  while (h.size) out.push(h.pop().d);
  assert.deepEqual(out, [...ds].sort((a, b) => a - b));
});

test("MinHeap: interleaved push/pop keeps the min invariant", () => {
  const h = new MinHeap();
  h.push({ d: 4 }); h.push({ d: 2 });
  assert.equal(h.pop().d, 2);
  h.push({ d: 6 }); h.push({ d: 1 }); h.push({ d: 3 });
  assert.equal(h.pop().d, 1);
  assert.equal(h.pop().d, 3);
  h.push({ d: 0 });
  assert.equal(h.pop().d, 0);
  assert.equal(h.pop().d, 4);
  assert.equal(h.pop().d, 6);
  assert.equal(h.size, 0);
});

test("MinHeap: carries the item payload, not just the key", () => {
  const h = new MinHeap();
  h.push({ d: 2, q: 1, r: -1 });
  h.push({ d: 1, q: 0, r: 0 });
  const first = h.pop();
  assert.deepEqual({ q: first.q, r: first.r }, { q: 0, r: 0 });
});
