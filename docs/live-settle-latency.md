# Live-match settle latency

Measured by `npm run watch-live` against the TxLINE free tier (60s delay) on devnet, across
two World Cup 2026 matches watched live.

## France vs Spain — the clean measurement

Fixture **18237038** (France 0–2 Spain), kickoff 2026-07-14T19:00:00Z. The watcher was
polling continuously through full time, so this is a fair measurement of feed latency.

| Stage | When | Latency |
| ----- | ---- | ------- |
| game_finalised record timestamp | 2026-07-14T21:04:14.751Z | — |
| (a) …visible on the free tier | 2026-07-14T21:06:09.267Z | 1.9 min after the record |
| (b) stat-validation returns proofs | 2026-07-14T21:06:09.704Z | 0.0 min after (a) |
| (c) validate_stat_v2().view() passes | 2026-07-14T21:06:10.989Z | 0.0 min after (a) |

**Settle-ready at 2026-07-14T21:06:10.989Z — 1.9 min after the final record's own
timestamp.** Final seq `1026`, total corners **8**.

## England vs Argentina — the on-camera match

Fixture **18241006** (England 1–2 Argentina), kickoff 2026-07-15T19:00:00Z.
Final seq `962`, goals **1–2**, total corners **7**.

| Stage | When | Latency |
| ----- | ---- | ------- |
| game_finalised record timestamp | 2026-07-15T21:14:24.772Z | — |
| (a) …visible to the watcher | 2026-07-15T21:24:11.381Z | 9.8 min after the record * |
| (b) stat-validation returns proofs | 2026-07-15T21:24:11.786Z | 0.0 min after (a) |
| (c) validate_stat_v2().view() passes | 2026-07-15T21:24:12.639Z | 0.0 min after (a) |

**Settle-ready at 2026-07-15T21:24:12.639Z.**

\* **This 9.8 min is an upper bound on our side, not a feed measurement.** The watcher was
started at ~21:17:40Z — three minutes *after* the record's own timestamp — and its first
poll then hung on a transport error (`fetch failed`, logged 21:23:06Z) before the next poll
succeeded at 21:24:11Z. The record may well have been visible the whole time. The
France–Spain run above, with the watcher running before full time, is the honest
feed-latency figure: **1.9 min**.

Both matches agree on the shape of the pipeline: once the `game_finalised` record is
visible, its Merkle proofs and the anchored on-chain daily root are available **the same
second** — feed visibility is the only latency term between the final whistle and a
settleable wager.

Proofs recorded to `apps/web/src/data/live-proofs.json`; rebuild + deploy and the
challenge settles.
