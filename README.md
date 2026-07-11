# Verdict

**Challenge a friend. Settle by cryptographic proof.**

1v1 sports wagers on Solana, settled trustlessly against TxODDS/TxLINE Merkle-proven match
data — no bookie, no admin key, no "trust me". The settlement receipt shows the full proof
chain from the stat leaf to the on-chain daily root, and anyone can re-verify it.

> Built for the TxODDS/TxLINE "Prediction Markets and Settlement" track (World Cup 2026).

## Status

Work in progress — milestone build. This README will grow with the architecture diagram,
security model, finality model, and run instructions as the milestones land.

## Layout

```
programs/verdict    Anchor program: market lifecycle + trustless settlement (CPI → txoracle)
packages/sdk        TS SDK: TxLINE auth, data fetchers, predicate compiler, proof assembly
apps/web            React frontend: create/accept/settle + the settlement receipt
scripts/            find-fixture, wallet setup, measurement, end-to-end demo
idls/               Vendored TxLINE txoracle devnet IDL (v1.5.6)
docs/txline/        Pinned copies of the TxLINE reference material used
```
