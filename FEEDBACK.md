# TxLINE API Feedback Log

Running log of friction, bugs, and delights encountered while building Verdict against
TxLINE devnet. Newest entries at the bottom. Logged as encountered, per submission requirements.

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

**Note — `/api/scores/historical/{fixtureId}` window.** Historical replay only works for
fixtures whose start time is between 6 hours and 2 weeks in the past. Fine for our demo, but
worth knowing before you pick a demo fixture: anything older silently falls out of the window.
The constraint is documented only in the OpenAPI description of the endpoint.
