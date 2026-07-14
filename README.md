# Verdict

[![tests](https://github.com/DiamonndAde/Verdict/actions/workflows/tests.yml/badge.svg)](https://github.com/DiamonndAde/Verdict/actions/workflows/tests.yml)

**Challenge a friend. Settle by cryptographic proof.**

Verdict is a 1v1 sports-wager app on Solana. You challenge a friend on a real fixture —
*"Total corners over 9.5"*, *"England to win by 2+"*, *"Under 3 goals"* — you both escrow
dUSDC, and when the match ends **anyone** can settle the bet by submitting a TxODDS/TxLINE
Merkle proof of what actually happened. Our program verifies that proof on-chain against
TxLINE's daily scores root and pays the winner.

No bookie. No admin key. No "trust me."

The hero feature is the **settlement receipt**: a shareable proof-of-outcome showing the exact
stats, the Merkle path from the stat leaf up to the on-chain daily root, and a one-tap
**re-verify** that re-runs the oracle's check live in your browser.

> TxODDS/TxLINE "Prediction Markets and Settlement" track, World Cup 2026. Devnet throughout.
> The demo settles a **real, already-completed** World Cup match via historical replay — no
> live game required.

## Try it in 2 minutes (no wallet needed)

**→ [verdict-self.vercel.app](https://verdict-self.vercel.app)**

1. Hit **"Watch a live settlement →"**. It creates a challenge, has an opponent accept it, and
   lands you on the fight card — **real transactions on devnet**, signed by embedded demo
   wallets so you need no wallet and no funds.
2. Press **"Settle by proof"** and watch the verification cascade fold the Merkle path into the
   on-chain daily root. The winner is paid the pot.
3. On the receipt, press **"Re-verify now"** — it re-runs TxLINE's `validate_stat_v2`
   read-only, from your browser, against the live devnet oracle.
4. Then press **"Forge the proof"**. It tampers a proven stat and submits it. Watch the chain
   **reject** it.

Prefer to skip straight to a finished receipt? Open the settled market from our last devnet
run, linked at the top of **[docs/devnet-run.md](docs/devnet-run.md)**.

## What actually happens on-chain

```text
 Creator                         Verdict program (Solana)                    TxLINE txoracle
 ───────                         ────────────────────────                    ───────────────
 create_market ── stake ───────▶ Market{predicate, fixture, stakes}
                                 vault = ATA owned by the market PDA
 Taker
 ─────
 accept_market ── stake ───────▶ status: Active,  pot = 2 × stake

 Anyone (permissionless)
 ──────────────────────
 settle(proof) ────────────────▶ 7 gates on the proof payload:
   argument = Merkle material      fixture · stat-keys · period==100
   ONLY — never the bet terms      time · roots-PDA · status · bounds
                                          │
                                          ├─ strategy built FROM STORED TERMS
                                          │
                                          └──CPI──▶ validate_stat_v2
                                             ◀─bool─ (Merkle-verified)
                                 verify return-data producer, then pay the winner
                                 record Outcome  ──▶  THE RECEIPT
```

The wager's terms are written at creation and are immutable. A settler supplies **only** proof
material — the summary, the Merkle paths, the stat leaves. The predicate (stat keys, operator,
threshold, comparison) is read from the market account and compiled into the oracle's
validation strategy **on-chain**.

**A settler proves facts; they never describe the bet.**

## Security

Full write-up: **[docs/SECURITY.md](docs/SECURITY.md)**. Headlines:

- **No admin key.** Only `settle` (verified proof), `cancel` (pre-accept refund) and
  `refund_expired` (50/50 after the deadline) can move vault funds. Nothing can pay itself.
- **Stored-predicate settlement.** The settler supplies proofs, never terms.
- **Pinned CPI target + return-data producer check.** The txoracle program id is a hardcoded
  constant, checked before `invoke`; the CPI's return-data **producer** is verified against
  that constant before the boolean is read. This closes CPI return-data spoofing — which
  Anchor's own typed `Return::get()` would have left open, because it discards the producer id
  (`let (_key, data) = get_return_data().unwrap()`). We hand-rolled the CPI for exactly this
  reason.
- **Early-settlement defense.** A halftime snapshot is *validly provable* and the oracle **will**
  verify it. So every proven stat leaf must carry `period == 100` (`game_finalised`). The period
  lives inside the hashed Merkle leaf, so it cannot be relabelled as final without breaking the
  proof. A time gate (`maxTimestamp >= settle_after`) backs it up.
- **Double-settle guard**, canonical-bump PDA vault signing, `overflow-checks` on.

Audited against the `solana-cpi-safety` checklist (all four sections) — no findings.

## Finality model

Settlement proves the **final** outcome, using score records with `action = game_finalised`
(`period 100`, `statusId 100`) — one path that covers regulation, extra-time, penalty and
abandonment endings. Mid-match proofs are refused on-chain.

`refund_expired` is the liveness valve: if a match never produces a provable final result
(abandoned, postponed, never finalised), either party can trigger a 50/50 refund after
`expiry_ts`. One deliberate tradeoff, stated plainly: after expiry, a party losing at full time
could call `refund_expired` to salvage 50% rather than settle and lose 100%. The winner's
defence is simply to settle before expiry — settlement is permissionless and the window opens
~2 hours after kickoff, days earlier. The alternative (no expiry) would trap both stakes
forever on an abandoned match.

## Proof it works

- **19 tests + 1 regression, all green in CI** — LiteSVM running the **real** txoracle program
  and its **real** daily-roots account, both cloned from devnet, so the recorded Merkle proofs
  verify offline and deterministically. Lifecycle, positive settlement (predicate TRUE pays the
  creator, FALSE pays the taker), and an exploit suite: tampered stat value, wrong fixture,
  **stale mid-match proof**, too-early time gate, double-settle, settle-before-accept,
  substituted oracle program, wrong daily-roots account — every one rejected.
- **Live on devnet.** `npm run demo` runs the whole spine and writes
  **[docs/devnet-run.md](docs/devnet-run.md)** with an Explorer link for every transaction —
  including the forged settle, which is sent with preflight skipped so it **lands on-chain as a
  failed transaction**. Its log reads
  `AnchorError thrown in programs/txoracle/src/utils.rs:302` — TxLINE's own oracle rejecting
  the forgery, not our code.
- **Measurement report** (`docs/measurement-report.txt`): the settle transaction is **992 bytes**
  (cap 1232), so settlement is a single transaction — no proof-buffer flow needed.
- **A live match is settle-ready ~2 minutes after the final whistle.** We watched France 0–2
  Spain (World Cup, 2026-07-14) end in real time: the `game_finalised` record became visible
  on the free tier 1.9 min after its own timestamp, its Merkle proofs and the on-chain daily
  root were available the same second, and `validate_stat_v2().view()` passed on the first
  try. Stage-by-stage numbers: **[docs/live-settle-latency.md](docs/live-settle-latency.md)**.

## TxLINE integration

- **Auth**: `POST /auth/guest/start` → guest JWT; on-chain `subscribe(1, 4)` (free tier);
  `POST /api/token/activate` → API token. Cached per wallet, transparently re-acquired on 401.
- **Data**: `/api/fixtures/snapshot`, `/api/scores/historical/{fixtureId}`,
  `/api/scores/snapshot/{fixtureId}`, `/api/scores/stat-validation` (v1/v2), `/api/odds/snapshot/{fixtureId}`.
- **On-chain**: CPI into `txoracle` `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`,
  instruction `validate_stat_v2`, daily-roots PDA `["daily_scores_roots", u16_LE(epochDay)]`.

Friction, bugs and delights logged as we hit them: **[FEEDBACK.md](FEEDBACK.md)**.

## Deployed

| | |
| --- | --- |
| App | <https://verdict-self.vercel.app> |
| verdict program (devnet) | [`GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e`](https://explorer.solana.com/address/GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e?cluster=devnet) |
| dUSDC escrow mint | [`7kRemGMhWL4Vuyw8w7gopG6HyJ3PQPDpog1HAv8QXpYV`](https://explorer.solana.com/address/7kRemGMhWL4Vuyw8w7gopG6HyJ3PQPDpog1HAv8QXpYV?cluster=devnet) |
| Demo fixture | Mexico 2–3 England (World Cup, fixture `18192996`) — 14 corners |

## Repository

```text
programs/verdict        Anchor program
  src/instructions/settle.rs   the seven settlement gates, the oracle CPI, the payout
  src/txoracle_cpi.rs          hand-rolled validate_stat_v2 CPI + return-data producer check
packages/sdk            TxLINE auth/data, the predicate compiler, the settle-tx builder
apps/web                React + Vite + Tailwind v4 + Motion — create/accept/settle + RECEIPT
tests/                  LiteSVM suite, recorded proofs, cloned oracle state
scripts/                find-fixture, setup-dusdc, record-proofs, demo, screenshots
docs/                   SECURITY.md, devnet-run.md, measurement-report.txt
```

## Run it

```bash
npm install                 # Node 24+ required (see dev notes)
anchor build

npm test                    # 20/20, offline, no Solana toolchain needed

# devnet (wallets need devnet SOL — fund .keys/*.json from faucet.solana.com)
npm run setup-wallets
npm run setup-dusdc         # create the dUSDC escrow mint, fund the demo wallets
npm run find-fixture        # pick a completed fixture with rich stats
npm run record-proofs       # record real proof payloads
npm run demo                # create → accept → settle → payout + fraud rejection, live

npm run dev --workspace web # the app, on http://localhost:5173
```

## Dev notes

- **Node 24+ is required.** `litesvm@0.8.0`'s native addon aborts with `std::bad_alloc`
  (SIGABRT) on the third BPF program execution under Node 20/22 — reproduced on both; Node 24
  runs clean. 0.8.0 is the last web3.js-compatible litesvm (1.x is a breaking `@solana/kit`
  rewrite), so the runtime is pinned in CI and in `engines`.
- `?demo=1` slows the hero animations ~20% and pre-warms data — the configuration used for
  recording. `prefers-reduced-motion` is respected everywhere and downgrades to plain fades.

## Stack

Anchor 0.32.1 · `@coral-xyz/anchor` · LiteSVM · React 19 + Vite + Tailwind v4 + Motion for
React · TxODDS/TxLINE txoracle.
