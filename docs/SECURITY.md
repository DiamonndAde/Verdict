# Security

Verdict moves escrowed funds based on a boolean returned by a cross-program invocation into
the TxLINE `txoracle`. The judges are that oracle's engineers, so the settlement path is
built defensively and audited against the CPI-safety checklist. This document records the
threat model, the defenses, and the audit result.

## Trust model in one paragraph

The only privileged actor is *the proof*. There is no admin key: nothing in the program can
move vault funds except `settle` (against a verified TxLINE proof), `cancel` (pre-acceptance
refund to the creator), and `refund_expired` (50/50 after the deadline). `settle` is
permissionless — anyone can submit it — but its only argument is Merkle proof material. The
wager's terms (stat keys, operator, threshold, comparison) are read from the market account
written at creation and compiled into the oracle's strategy on-chain. A settler proves facts;
they never describe the bet.

## Settlement defenses (the seven gates)

Each gate is enforced against the *same* `payload` struct that is then serialized into the
oracle CPI, so the fields gated here are exactly the fields the oracle Merkle-verifies. There
is no parallel, unverified copy of the data.

| # | Defense | Where | Class it closes |
|---|---------|-------|-----------------|
| 1 | Pinned CPI target — `program_id` is a hardcoded constant and the passed account is `require_keys_eq!`'d to it before `invoke` | `txoracle_cpi.rs` | Arbitrary CPI / program substitution |
| 2 | Fixture binding — `summary.fixture_id == market.fixture_id` | `settle.rs` | Cross-fixture proof reuse |
| 3 | Stat-key binding — each proven leaf's `key` equals the stored predicate's key, in strategy-index order | `settle.rs` | Settler proving a different stat than the bet |
| 4 | Final-record gate — each proven leaf's `period == 100` (`game_finalised`) | `settle.rs` | **Early / stale settlement** (see below) |
| 5 | Time gate — `summary.updateStats.maxTimestamp >= market.settle_after_ms` | `settle.rs` | Defense-in-depth behind gate 4 |
| 6 | Return-data producer check — `get_return_data()` producer is `require_keys_eq!`'d to the oracle before the bool is read | `txoracle_cpi.rs` | CPI return-data spoofing |
| 7 | Status guard — market must be `Active`; settlement sets it `Settled` | `settle.rs` | Double-settle, settle-before-accept |

Additional bindings: the `daily_scores_roots` account is checked for oracle ownership *and*
its key is re-derived from the proof's own timestamp and pinned; token-account owners are
bound to the two parties in the handler (after the status guard); the vault authority is the
market PDA signing with its canonical bump; `overflow-checks` is on in the release profile.

## The early-settlement attack (gate 4, our headline defense)

A halftime snapshot is a **validly provable state**. The oracle will happily Merkle-verify a
proof taken mid-match — we confirmed this on devnet (see `docs/measurement-report.txt`, the
"HONEST mid-match proof" probe, which the oracle returns `true` for). Without a defense, a
party losing at full-time but winning at halftime could settle early against the favourable
snapshot.

The proven stat leaf is `{key, value, period}`, and all three fields are inside the hashed
Merkle leaf. `game_finalised` records carry `period == 100`. Gate 4 requires that period, so
a settler cannot relabel a halftime stat as final without breaking the Merkle proof — which
the oracle then rejects. We verified the period field is hash-bound by tampering it (100 → 2)
in a real proof and observing the oracle revert (measurement report, probe 2). The test
`STALE mid-match proof is rejected even though the oracle itself accepts it` locks this in:
it feeds the recorded mid-match proof (period 2), lets the time gate pass, and asserts the
program rejects with `NotFinalRecord`.

## Why we hand-rolled the oracle CPI

Anchor's typed-CPI helper (`declare_program!`) generates
`Return<T>::get() { let (_key, data) = get_return_data().unwrap(); T::try_from_slice(&data).unwrap() }`.
It **discards the producer program id** and double-`unwrap()`s. For an oracle whose boolean
moves money, consuming return data through that helper is textbook CPI return-data spoofing.
We build the `validate_stat_v2` instruction by hand and verify `producer == txoracle` before
reading the byte (gate 6). Logged upstream in `FEEDBACK.md`.

## CPI-safety audit result

Audited against `solana-cpi-safety/cpi-checklist.md`, all four sections, at every trigger
site (`invoke`, `CpiContext`, `get_return_data`, `find_program_address`).

- **Section 1 — Return-data trust.** `get_return_data()` in `txoracle_cpi.rs`: producer
  compared to the pinned constant before any byte is parsed; `None` handled with
  `OracleReturnedNothing`; 1-byte borsh bool length-checked. The oracle CPI is a leaf call and
  its return slot is read immediately, before the later token transfer, so no stale-slot
  (Variant B) exposure. **Pass.**
- **Section 2 — Arbitrary CPI.** Oracle callee pinned to a constant and key-checked before
  `invoke`. All token CPIs use Anchor's typed `Program<'info, Token>` (pins `spl_token::ID`);
  token/mint accounts are `Account<'info, TokenAccount>` / `Account<'info, Mint>` (owner
  enforced, fake-SPL closed); the one `UncheckedAccount` roots account is owner-checked and
  PDA-pinned. **Pass.**
- **Section 3 — Account reload after CPI.** The vault is `reload()`ed before its balance is
  read post-CPI; no other deserialized account is read across a CPI boundary without a
  reload. **Pass.**
- **Section 4 — PDA invoke_signed.** Every `invoke_signed` (vault payouts/refunds) signs with
  seeds whose bump is the canonical `ctx.bumps.market` stored at initialization under the
  `seeds`/`bump` constraint. The one `find_program_address` derives the expected roots PDA and
  is used only for an equality check, never for signing. **Pass.**

No findings.

## Known, documented tradeoff (finality model)

After `expiry_unix`, `refund_expired` (50/50) becomes callable even for a match that *did*
finish and is provable. A party losing at full-time could wait for expiry and call
`refund_expired` to salvage 50% instead of settling and losing 100%. The winner's defense is
simply to `settle` before expiry — the settlement window (`settle_after_ms`) opens long
before `expiry_unix` (recommended kickoff + 7 days), and settlement is permissionless so the
winner never depends on the loser's cooperation. This is a deliberate liveness/fairness
tradeoff, not a bug: the alternative (no expiry) would trap both stakes forever if a match is
abandoned and never finalised. Documented so it is a choice, not a surprise.
