# Domain knowledge

The analysis engine is only as good as what it knows. This directory holds the
Google Ads expertise the model reasons with, kept separate from the prompt that
tells it *how* to write so each can change without disturbing the other.

Structure:

- `mechanics.ts`  — how the machinery actually behaves: bidding, auction, PMax.
  Mechanisms and thresholds, not advice.
- `diagnostics.ts` — "if you see X, suspect Y". The heuristics that turn a
  metric pattern into a hypothesis about a cause.
- `benchmarks.ts` — what a number means, by vertical and channel. Every entry
  carries its source and a confidence, because a benchmark stated without
  provenance is just an opinion with a decimal point.
- `tagmanager.ts`, `analytics.ts`, `searchconsole.ts`, `website.ts`,
  `keywords.ts` — the other products, each fact-checked against Google's own
  documentation on 2026-09-17; same rules, same "if you see X, suspect Y" tables.
- `context.ts`    — the operating context these particular accounts live in:
  small local service businesses, modest budgets, low conversion volume, a
  market where Google's automation has less data to work with.

Rules for what goes in here:

1. A mechanism, a number, or a detection pattern. Never a platitude.
   "Check your negative keywords" is worthless. "Below roughly 30 conversions a
   month a target CPA cannot converge, so it behaves like Maximise Conversions
   with extra latency" is knowledge.
2. Cite where it came from and how confident it is. The model is told to weight
   accordingly and to say when guidance is contested.
3. Prefer the load-bearing few over the comprehensive many. Everything here is
   sent on every analysis, so a fact that never changes a conclusion is costing
   money for nothing.
