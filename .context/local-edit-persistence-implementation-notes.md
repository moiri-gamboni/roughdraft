# Local Edit Persistence — Implementation Notes (unit: app-persistence, Tasks 3–8)

Running record of where reality diverged from `plans/local-edit-persistence.md`, and of decisions the plan left open. Tasks 0/1/2/9/10 belong to sibling workers and are not covered here.

## Task 4 — `setItem` latency probe (settles trim T3: write-through vs throttle)

Measured in real Chromium (Playwright, headless), not jsdom: 50 sequential `JSON.stringify` + `localStorage.setItem` cycles of the actual record shape (content + a full `baseContent` copy), content varied each iteration so the browser cannot short-circuit an identical write.

| Document content | Serialized record | median | p95 |
|---|---|---|---|
| 10 KiB | 20 KB | 0.2 ms | 0.5 ms |
| 50 KiB | 100 KB | 0.6 ms | 0.9 ms |
| 200 KiB | 410 KB | 2.2 ms | 6.1 ms |
| 500 KiB | 1.0 MB | 14.8 ms | 18.1 ms |

**Decision: write through synchronously, no throttle, no `flushToStorage`, no `pagehide` flush** — the plan's default stands.

The plan's re-add trigger ("measured `setItem` latency on a large doc exceeds a few ms") does fire at the 500 KiB probe size the plan named. Not reinstating the throttle anyway, deliberately:

- At the sizes Roughdraft actually reviews (a plan or spec, 5–50 KiB) the write costs ≤0.6 ms. 500 KiB of markdown is ~80k words — a book, not a review artifact.
- At 500 KiB the per-keystroke CriticMarkup serialization the editor *already* runs dominates this 15 ms; a throttle on the store would not fix typing feel, it would only reintroduce a loss window (the exact thing outcome 1 exists to close) plus R23's flush-ordering trap.

Re-add trigger, narrowed: a user reports typing lag on a document above ~200 KiB. Then throttle the store write and add the `pagehide` flush *before* the `beforeunload` guard's early return.

## Task 4 — record shape and schema handling

- `baseContent: null` at the call site is how "base unknown" is expressed; the record stores `baseContent: ""` plus `baseKnown: false`. This keeps R16's empty-base sentinel from ever being mistaken for a known-empty base.
- Unknown `schema` is kept, not deleted (R13), and surfaces with `baseKnown: false` — which routes it through `resolveRestore`'s existing "ask" branch instead of needing a fourth decision value.
- Unparseable JSON returns `null` (nothing restorable) but still does not delete the item.
- Quota ladder evicts exactly **one** other record per write. Looping until the write fits would empty the shelf of other documents' unsent work to make room for this one.
