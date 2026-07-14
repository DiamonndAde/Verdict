# CLAUDE.md — Verdict

## Mission

TxODDS World Cup 2026 hackathon ("Prediction Markets and Settlement" track). **Deadline
2026-07-19 23:59 UTC**, feature freeze end of 2026-07-18. Judging is demo-video-weighted:
the recorded demo matters more than feature count. Verdict = 1v1 sports wagers on Solana
devnet, escrowed in dUSDC, settled permissionlessly by TxLINE Merkle proof.

## Architecture

- **verdict program** (Anchor 0.32.1) at `GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e`
  (devnet). Market lifecycle: `create_market` → `accept_market` → `settle` (or `cancel` /
  `refund_expired`). No admin key.
- **Seven settle gates** (programs/verdict/src/instructions/settle.rs, locked in
  docs/measurement-report.txt — do not relitigate):
  1. pinned txoracle program id `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
  2. `summary.fixtureId == market.fixture_id`
  3. leaf stat keys == stored predicate keys, in order
  4. every leaf `period == 100` (game_finalised; hash-bound in the Merkle leaf)
  5. `summary.updateStats.maxTimestamp >= market.settle_after_ms` (defense-in-depth;
     compares against the PROOF's own timestamp, not the clock — a too-late
     `settle_after` bricks the market forever, see Working notes)
  6. CPI return-data producer verified == txoracle before reading the boolean
     (hand-rolled CPI in src/txoracle_cpi.rs; Anchor's typed Return discards producer)
  7. status guard Active → Settled
- **Settle = single tx** (992 B) CPIing TxLINE `validate_stat_v2`; strategy compiled
  on-chain from the STORED predicate — settler supplies only Merkle proof material.
- **Bundled fixture-scoped proofs**: apps/web/src/data/{proofs,live-proofs}.json keyed by
  fixture in appData.ts; wrong fixture's proof fails gate 2 on-chain.
- **Embedded demo wallets**: apps/web/src/data/demo-signers.json (devnet-only throwaways)
  sign real devnet txs so viewers need no wallet. Per-tab creator/taker roles for the
  two-window demo.
- **SDK** packages/sdk: TxLINE auth/data client, predicate compiler, settle-tx builder.
- **Web** apps/web: React 19 + Vite + Tailwind v4 + Motion. `?fixture=<id>` (sticky per
  session) switches to the live fixture; `?demo=1` slows hero animations for recording.

## Working rules

- **Wallets: `.keys/` only. NEVER read/use `~/.config/solana/id.json`.** If funds are
  needed, print the faucet request/address for the human.
- **Never request or store credentials** (tokens, seed phrases). Vercel deploys were done
  by the human; token was env-only and deleted.
- **The human pushes.** Never `git push`. No Claude attribution in commits or PRs.
- **Vercel auto-deploys on push** (project verdict → verdict-self.vercel.app).
- **Hard-stop at declared checkpoints** and await reviewer go before the next tier.
- **Log TxLINE friction/bugs/delights to FEEDBACK.md as encountered**, not retroactively.
- Node 24+ required (litesvm 0.8.0 SIGABRTs on Node 20/22). Tests: `npm test` (LiteSVM,
  offline, real cloned oracle state).

## Current state (2026-07-14)

- **Done through M8**: program with the 7 gates, 22/22 LiteSVM tests, CPI-safety audit
  clean, SDK, full live devnet e2e (`npm run demo` → docs/devnet-run.md), frontend with
  receipt, verification cascade and fraud panel — live at <https://verdict-self.vercel.app>.
- **Demo fixture (historical)**: Mexico 2–3 England, fixture `18192996`, finalSeq 1046,
  14 corners. Historical endpoint window = 6h–2wk after start; re-record if it ages out.
- **Live-match layer (2026-07-14)**: France 0–2 Spain, fixture `18237038`. `npm run
  watch-live` measured settle-readiness **1.9 min** after the game_finalised record
  (docs/live-settle-latency.md). 8 total corners, final seq 1026. Proofs + final score
  recorded (live-proofs.json, live-fixture.json — web + tests copies). The three on-chain
  France–Spain markets predate the gate-5 fix and are stuck; recover via refund_expired
  after 2026-07-21 if the dUSDC matters.
- **Gate-5 lesson (fixed 2026-07-14)**: the old `defaultSettleAfterMs` used kickoff+200min
  for knockouts. France–Spain finalised at kickoff+124min, so the proof's maxTimestamp
  could NEVER reach settle_after — the 10-dUSDC live market is permanently ProofTooEarly
  (only `refund_expired` recovers it). Default is now **kickoff+105min** (minimum
  regulation time); a real final record always lands after that, ET or not. Regression
  tests cover both directions.
- **Next fixture**: England vs Argentina, fixture `18241006`, kickoff 2026-07-15T19:00Z
  (20:00 WAT). Tomorrow repeats the live sequence with scenes recorded BEFORE kickoff.
  Switching fixtures = find-upcoming → copy live-fixture.json to apps/web/src/data/ →
  **reset live-proofs.json to `{}`** (stale France–Spain proofs keyed under Argentina's id
  would fail FixtureMismatch) → build + push.
- **Tier 2 (fixture picker) NOT started — awaiting reviewer go.**

## Key commands

```bash
npm test                    # LiteSVM suite, offline
npm run demo                # live devnet e2e, rewrites docs/devnet-run.md
npm run find-upcoming       # pick next upcoming WC fixture → live-fixture.json
npm run live-create-check   # preflight: create+accept a real market for the live fixture
npm run watch-live          # poll from ~full time; records proofs + latency report
npm run dev --workspace web # app on :5173
```

Update this file at every milestone.
