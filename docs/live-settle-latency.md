# Live-match settle latency — France vs Spain

Fixture **18237038** (France vs Spain), kickoff 2026-07-14T19:00:00Z.
Measured by `npm run watch-live` against the TxLINE free tier (60s delay) on devnet.

| Stage | When | Latency |
| ----- | ---- | ------- |
| game_finalised record timestamp | 2026-07-14T21:04:14.751Z | — |
| (a) …visible on the free tier | 2026-07-14T21:06:09.267Z | 1.9 min after the record |
| (b) stat-validation returns proofs | 2026-07-14T21:06:09.704Z | 0.0 min after (a) |
| (c) validate_stat_v2().view() passes | 2026-07-14T21:06:10.989Z | 0.0 min after (a) |

**Settle-ready at 2026-07-14T21:06:10.989Z** — 1.9 min after the final record's own timestamp.

Final seq `1026`, total corners **8**. Proofs recorded to
`apps/web/src/data/live-proofs.json`; rebuild + deploy and the challenge settles.
