# Verdict

**Challenge a friend. Settle by cryptographic proof.**

Verdict is a 1v1 sports-wager app on Solana. You challenge a friend on a real fixture —
"Total corners over 9.5", "England to win by 2+", "Under 3 goals" — you both escrow dUSDC,
and when the match ends **anyone** can settle the bet by submitting a TxODDS/TxLINE Merkle
proof of what actually happened. Our program verifies that proof on-chain against TxLINE's
daily scores root and pays the winner. No bookie, no admin key, no "trust me."

The hero feature is the **settlement receipt**: after a bet settles, you get a shareable
proof-of-outcome showing the exact stats, the Merkle path from the stat leaf to the on-chain
daily root, and a one-tap **re-verify** that re-runs the oracle check client-side.

> Built for the TxODDS/TxLINE "Prediction Markets and Settlement" track, World Cup 2026.
> Devnet throughout. Demo settles a real, already-completed World Cup knockout via historical
> replay — no live game required.

## Status

- **Live app**: <https://verdict-self.vercel.app> (devnet). Hit *Watch a live settlement* — it
  creates, accepts and settles a real challenge on devnet in front of you, then lets you try
  to forge the result.
- **Program**: deployed to devnet — `GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e`
- **End-to-end proven on-chain**: `npm run demo` runs create → accept → settle-by-proof →
  payout, then a forged-proof attempt that is **rejected on-chain** (`InvalidStatProof`).
  Transaction-by-transaction evidence in [docs/devnet-run.md](docs/devnet-run.md).
- **Tests**: 19/19 green (LiteSVM against the real, cloned txoracle program + daily-roots
  account) — lifecycle, positive settlement, and an exploit/defense suite. Runs in CI on every
  push, Node-only. **Requires Node 24+** (litesvm 0.8.0's native addon aborts on repeated BPF
  execution under Node 20/22).

## How it works

```text
 Creator                         Verdict program (Solana)                    TxLINE txoracle
 ───────                         ────────────────────────                    ───────────────
 create_market ── stake ───────▶ Market{predicate, fixture, stakes}
                                 vault (ATA owned by market PDA)
 Taker
 ─────
 accept_market ── stake ───────▶ status: Active,  pot = 2×stake

 Anyone (permissionless)
 ──────────────────────
 settle(proof) ────────────────▶ 7 gates on the proof payload:
   proof = Merkle path only        fixture, stat-keys, period==100,
   (never the bet terms)           time, roots-PDA, status ...
                                 build strategy FROM STORED TERMS ──CPI──▶ validate_stat_v2
                                 read return data, verify producer ◀──bool── (Merkle-verified)
                                 pay winner the full pot
                                 record Outcome  ──▶  THE RECEIPT
```

The wager's terms are written at creation and are immutable. A settler supplies **only** the
proof material — the summary, the Merkle paths, the stat leaves. The predicate (stat keys,
operator, threshold, comparison) is read from the market account and compiled into the
oracle's validation strategy on-chain. **A settler proves facts; they never describe the bet.**

## Repository layout

```text
programs/verdict     Anchor program: market lifecycle + trustless settle (CPI → txoracle)
  src/settle.rs        the seven settlement gates + the oracle CPI + payout
  src/txoracle_cpi.rs  hand-rolled validate_stat_v2 CPI with producer verification
packages/sdk         TS SDK: TxLINE auth + data, predicate compiler, settle-tx builder
apps/web             React + Vite + Tailwind frontend (create / accept / settle / RECEIPT)
scripts/             find-fixture, setup-wallets, setup-dusdc, record-proofs, demo, ...
tests/               LiteSVM suite + recorded proof fixtures + cloned oracle state
docs/                SECURITY.md, measurement-report.txt, pinned TxLINE reference
idls/                vendored TxLINE txoracle devnet IDL (v1.5.6)
```

## Security

Full write-up in [docs/SECURITY.md](docs/SECURITY.md). Headlines:

- **No admin key.** Only `settle` (verified proof), `cancel` (pre-accept refund), and
  `refund_expired` (50/50 after expiry) can move vault funds. No authority can pay itself.
- **Stored-predicate settlement.** The settler supplies proofs, never terms; terms come from
  the market account and are compiled into the strategy on-chain.
- **Pinned CPI target + return-data producer check.** The txoracle program id is a hardcoded
  constant, checked before `invoke`; the CPI's return-data producer is verified against that
  constant before the boolean is read (closing the CPI return-data spoofing class — which
  Anchor's typed `Return::get()` would have left open; see FEEDBACK.md).
- **Early-settlement defense.** Every proven stat leaf must carry `period == 100`
  (`game_finalised`). A halftime snapshot is validly provable and the oracle *will* verify it,
  but the period lives inside the hashed Merkle leaf, so it can't be relabelled as final. A
  time gate (`maxTimestamp >= settle_after`) backs this up.
- **Double-settle guard**, PDA-canonical vault signing, `overflow-checks` on.

Audited against the `solana-cpi-safety` checklist (all four sections) — no findings.

## Finality model

Settlement proves the **final** match outcome, using score records with
`action = game_finalised` (`period 100`, `statusId 100`), which cover regulation, extra-time,
penalty, and abandonment endings in a single path. Mid-match proofs are refused on-chain.

`refund_expired` is the liveness valve: if a match never produces a provable final result
(abandoned/postponed/never finalised by the feed), either party can trigger a 50/50 refund
after `expiry_ts` (default kickoff + 7 days). One deliberate tradeoff: after expiry, a party
losing at full-time could call `refund_expired` to salvage 50% instead of settling and losing
100% — the winner's defense is simply to settle before expiry (settlement is permissionless
and the window opens ~2 hours after kickoff, days before expiry). Documented in SECURITY.md.

## TxLINE endpoints used (devnet)

- Auth: `POST /auth/guest/start` → guest JWT; on-chain `subscribe(1, 4)` (free tier);
  `POST /api/token/activate` → API token. Cached per wallet, auto-refreshed on 401.
- Data: `GET /api/fixtures/snapshot`, `GET /api/scores/historical/{fixtureId}`,
  `GET /api/scores/snapshot/{fixtureId}`, `GET /api/scores/stat-validation` (v1/v2/v3),
  `GET /api/odds/snapshot/{fixtureId}`.
- On-chain CPI target: `txoracle` `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`,
  `validate_stat_v2`, daily-roots PDA `["daily_scores_roots", u16_LE(epochDay)]`.

Friction/bugs/delights logged live in [FEEDBACK.md](FEEDBACK.md).

## Run it

```bash
npm install
anchor build

# devnet setup (wallets need devnet SOL — see below)
npm run setup-wallets       # generate .keys/{deployer,creator,taker}.json
npm run setup-dusdc         # create the dUSDC escrow mint + fund the two demo wallets
npm run find-fixture        # pick a completed fixture with rich stats
npm run record-proofs       # record real proof payloads for the tests + demo
npm run dump-oracle-state   # clone the txoracle program + roots account for offline tests

# verify
npm test                    # 19/19 LiteSVM tests (offline)
npm run measure-settle      # the measurement report (view() + tx-size + adversarial probes)

# deploy + demo
solana program deploy target/deploy/verdict.so --program-id .keys/verdict-program.json -u devnet
npm run demo                # full create → accept → settle → payout + fraud rejection, live
```

Devnet SOL: the faucet is rate-limited from many IPs. Fund `.keys/deployer.json` (needs ~2.5
SOL for the program) and the creator/taker wallets from <https://faucet.solana.com> or
`solana airdrop 2 <pubkey> -u devnet`.

## Stack

Anchor 0.32.1 · `@coral-xyz/anchor` · LiteSVM (tests) · React + Vite + Tailwind v4 + Motion
for React (frontend) · TxODDS/TxLINE txoracle (settlement oracle).
