# TxLINE API Feedback Log

Running log of friction, bugs and delights hit while building **Verdict** against TxLINE
devnet — logged as we encountered them, not reconstructed afterwards.

## Summary for the TxLINE team

The three items we'd action first:

| # | Type | Finding |
| - | ---- | ------- |
| 1 | **Doc drift (high impact)** | Two period-prefix encodings circulate. An integrator using the stale one would prove **the wrong period's stats** and settle a bet incorrectly. Live data agrees with the current soccer-feed page; the older cheat-sheet does not. |
| 2 | **Spec mismatch** | `/api/token/activate` returns `text/plain` (a bare token), and `/api/scores/historical/{fixtureId}` returns **SSE framing**, though the OpenAPI spec declares JSON for both. Any client doing `res.json()` breaks. |
| 3 | **Security note for integrators** | Anchor's typed CPI (`declare_program!`) **discards the return-data producer id**. Anyone CPIing `validate_stat_*` for settlement through that helper is exposed to return-data spoofing. One line in the on-chain-validation guide would prevent a real vulnerability class. |

Also worth a look: `stat-validation-v3` is undocumented; the guide's `setComputeUnitLimit(1_400_000)`
over-reserves by ~7x (real cost is ~124K–200K CU); and it's worth stating explicitly that
`validate_stat_v2` **returns `false`** for a failing predicate rather than throwing — that
distinction is what lets a settlement contract pay the other side instead of reverting.

Biggest delight: the whole settlement path — CPI, Merkle verification, payout — **worked first
try on devnet** after being proven offline against cloned oracle state. See below.

---

## 2026-07-11 — Docs discovery

**Delight — `llms.txt` / `llms-full.txt` / per-page `.md` routes.** The docs site exposes
`https://txline-docs.txodds.com/llms.txt`, a full-text `llms-full.txt`, and raw markdown at
`{page-url}.md`. Made programmatic doc consumption trivial — no HTML scraping needed. More
API vendors should do this.

**Delight — runnable devnet examples.** `txodds/tx-on-chain` ships the devnet IDL
(`examples/devnet/idl/txoracle.json`), generated TS types, and end-to-end scripts including
the exact auth/subscribe/activate flow (`common/users.ts`). The `subscription_scores_v3c.ts`
script demos validation against a `game_finalised` record — precisely the settlement use case.

**Friction — `stat-validation-v3` endpoint is undocumented.** `/api/scores/stat-validation-v3`
(multiproof payload for `validate_stat_v3`) appears only in the `subscription_scores_v3c.ts`
example script — it is not in the OpenAPI spec (`docs.yaml`) nor on the docs site. Found it
only by reading the examples repo. Worth adding to the spec, since the multiproof payload is
the smallest of the three validation shapes (matters for transaction size budgets).

**Friction — `validate_stat_v3` missing from on-chain validation guide.** The docs page
`documentation/examples/onchain-validation` covers `validateStat` and `validateStatV2`, but the
devnet IDL (v1.5.6) also ships `validate_stat_v3`. The guide only hints at V3 via the script
index. A short "which validation method should I use" matrix (payload size / feature / status)
would save integrators time.

## 2026-07-11 — First live integration (devnet)

**Bug/doc mismatch — `/api/token/activate` returns `text/plain`, not JSON.** The response
body is the bare API token string. The docs' axios examples mask this (`response.data.token
|| response.data` happens to work on a string), but any client doing `res.json()` breaks.
Either return `{"token": "..."}` or document the plain-text response.

**Bug/doc mismatch — `/api/scores/historical/{fixtureId}` responds with SSE framing.** The
OpenAPI spec declares `application/json` array of `Scores`, but the body is Server-Sent-Events
style `data: {...}` lines. The official `historical_scores.ts` example never parses the body
(it only logs it), so the example doesn't catch it either. Clients must strip `data:` prefixes
line by line.

**Note — `/api/scores/historical/{fixtureId}` window.** Historical replay only works for
fixtures whose start time is between 6 hours and 2 weeks in the past. Fine for our demo, but
worth knowing before you pick a demo fixture: anything older silently falls out of the window.
The constraint is documented only in the OpenAPI description of the endpoint.

**Delight — World Cup 2026 knockout fixtures live on devnet free tier.** Completed knockout
matches (with full replay) are available — great for settlement demos while the tournament
is still running.

## 2026-07-11 — Program / CPI build

**Sharp edge — Anchor's typed CPI (`declare_program!`) discards the return-data producer.**
The generated `Return<T>::get()` is literally `let (_key, data) = get_return_data().unwrap();
T::try_from_slice(&data).unwrap()`. It throws away the producer program id and double-unwraps.
For an oracle whose boolean moves money, consuming that via the typed helper is the textbook
CPI return-data-spoofing setup. We deliberately hand-rolled the `validate_stat_v2` CPI and
verify `producer == txoracle` before reading the byte. Not TxLINE's bug, but integrators
CPIing the oracle for settlement should be warned off the typed-return convenience path — a
one-line note in the on-chain-validation guide would prevent a real vulnerability class.

**Delight — `validate_stat_v2` returns `false` for a failing predicate (does not throw).**
The IDL exposes error 6021 `PredicateFailed`, so it wasn't obvious whether a losing predicate
reverts or returns false. Confirmed on devnet it cleanly returns `false`, which lets a
settlement contract distinguish "predicate didn't hold, pay the other side" from "proof is
invalid, reject" without parsing error codes. Worth stating explicitly in the docs.

**Note — `validate_stat_v2` costs ~124K–200K CU, not the 1.4M the docs tell you to reserve.**
The on-chain-validation guide hardcodes `setComputeUnitLimit(1_400_000)`. Real measured
consumption for 1–2 stat proofs is 123K (single) / 200K (two-stat). Over-reserving CU inflates
priority-fee estimates and can crowd a wrapping transaction's budget. A realistic figure (or a
"measure, don't assume" note) would help. We set a measured limit with headroom instead.

**Doc-drift warning — two period-prefix encodings circulate; live data agrees with the
current soccer-feed page.** An older stat-key cheat-sheet (still circulating in hackathon
materials) maps periods as H1=+1000, H2=+2000, ET1=+3000, ET2=+4000, PE=+5000. Live World Cup
records and the current `documentation/scores/soccer-feed` page instead use:

| Prefix | 0     | 1000 | 2000 | 3000 | 4000 | 5000 | 6000 | 7000    |
| ------ | ----- | ---- | ---- | ---- | ---- | ---- | ---- | ------- |
| Period | Total | H1   | HT   | H2   | ET1  | ET2  | PE   | ETTotal |

Verified against fixture 18192996 (Mexico vs England): H1 record stats `1001/1002 = 1/2`
match the 1-2 halftime score; `2007 = 5` matches Participant1's HT corner count; `3001 = 1`
matches P1's second-half goal. Anyone settling on the stale mapping would prove the wrong
period's stats — worth an explicit "encoding changed" callout in the docs.

## 2026-07-12 — Live devnet settlement

**Delight — CPI settlement against the real oracle "just worked" first try on devnet.** After
proving the flow in LiteSVM against the cloned `txoracle` program + `daily_scores_roots`
account, the identical flow ran against the live devnet oracle on the first attempt: our
`settle` CPIs `validate_stat_v2`, reads the verified boolean, and pays out — 992-byte single
transaction. The cloned-state LiteSVM harness was a faithful stand-in for the live oracle, so
there were no surprises moving from tests to chain. Credit to the deterministic Merkle design.

**Delight — a tampered proof is rejected by the oracle with a clean, specific error.** Flipping
one stat value in the proof payload makes `validate_stat_v2` revert with `InvalidStatProof`
(6023) rather than silently returning a wrong answer — exactly the behaviour a settlement
integrator wants. Sent with preflight skipped, the forged settle lands on-chain as a *failed*
transaction whose log reads `AnchorError thrown in programs/txoracle/src/utils.rs:302` — the
oracle itself refusing the forgery. The escrow is untouched. That rejection is the most
convincing thing in our demo, and it's TxLINE doing the work.

**Minor — devnet faucet rate limits make multi-wallet demos fiddly.** Not TxLINE's remit, but
worth noting for the hackathon: standing up deployer + two demo wallets + program rent (~2.5
SOL) against a rate-limited faucet took manual funding. A hackathon-scoped faucet allowance or
a documented devnet-SOL path in the quickstart would smooth first-run onboarding.

## 2026-07-13 — Settlement semantics (worth documenting)

**Note — a mid-match proof is validly provable, and the oracle will verify it.** This is
correct behaviour, but it is a trap for settlement integrators: a halftime snapshot verifies
just as happily as the final one, so a losing party could settle early against a favourable
in-running state. We confirmed on devnet that the oracle returns `true` for an honest
mid-match proof of our demo fixture.

The defence is that `period` lives *inside* the hashed Merkle leaf, so it cannot be relabelled
— we require `period == 100` (`game_finalised`) on every proven leaf and reject anything else
before the CPI. We verified the field is hash-bound by tampering `period` 100 → 2 in a real
proof and watching the oracle reject it.

The docs do say to pick the record whose phase matches your condition, but a short, explicit
**"settling a final result? require `period == 100`"** callout in the on-chain-validation guide
would make the failure mode much harder to walk into. It's the single most important thing we
learned building a settlement product on TxLINE.
