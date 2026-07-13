/**
 * Verdict program test suite (LiteSVM, real oracle state).
 *
 * Structure mirrors the security thesis:
 *   LIFECYCLE  — create / accept / cancel / refund happy + guard paths
 *   POSITIVE   — real proof settles: predicate TRUE pays creator, FALSE pays taker
 *   EXPLOIT    — tampered value, wrong fixture, stale mid-match proof, double-settle,
 *                settle-before-accept, substituted oracle program — all rejected
 *
 * Run: npx tsx --test tests/verdict.test.ts
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { Transaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { defaultExpiryUnix } from "@verdict/sdk/verdict";
import {
  acceptMarketIx,
  computeIx,
  createMarketIx,
  DUSDC,
  Env,
  fetchMarket,
  freshEnv,
  legacyToSettleInput,
  marketPda,
  send,
  sendFail,
  sendOk,
  settleIx,
  tokenBalance,
  v2ToSettleInput,
  vaultAta,
} from "./harness.ts";

const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8"));
const demo = JSON.parse(fs.readFileSync("tests/fixtures/demo-fixture.json", "utf8"));

const FIXTURE_ID: number = demo.fixtureId;
const KICKOFF_MS: number = demo.startTime;
const FINAL_MIN_TS: number = proofs.v2CornersFinal.summary.updateStats.minTimestamp;
const FINAL_MAX_TS: number = proofs.v2CornersFinal.summary.updateStats.maxTimestamp;
const MID_MIN_TS: number = proofs.legacyCornersMidMatch.summary.updateStats.minTimestamp;

const STAKE = DUSDC(100);
const EXPIRY = Math.floor(KICKOFF_MS / 1000) + 30 * 86_400;

// Corners: key 7 + key 8, total 14 in the final record. "Over 9.5" => threshold 9, GT.
const CORNERS_OVER_9 = { stat1Key: 7, stat2Key: 8, op: { add: {} }, threshold: 9, comparison: { greaterThan: {} } };
// Same proof, unreachable threshold => predicate FALSE (taker wins).
const CORNERS_OVER_20 = { stat1Key: 7, stat2Key: 8, op: { add: {} }, threshold: 20, comparison: { greaterThan: {} } };
// Single stat: England (participant 2) scored 3. "3+ goals" => key 2 > 2.
const P2_GOALS_OVER_2 = { stat1Key: 2, stat2Key: null, op: null, threshold: 2, comparison: { greaterThan: {} } };

const baseCreate = (seed: number, predicate: object, settleAfterMs = KICKOFF_MS) => ({
  seed: new BN(seed),
  fixtureId: FIXTURE_ID,
  stake: STAKE,
  predicate: predicate as never,
  settleAfterMs,
  expiryUnix: EXPIRY,
});

async function openAndAccept(env: Env, seed: number, predicate: object, settleAfterMs = KICKOFF_MS) {
  const create = new Transaction().add(await createMarketIx(env, baseCreate(seed, predicate, settleAfterMs)));
  sendOk(env.svm, create, [env.creator]);
  const accept = new Transaction().add(await acceptMarketIx(env, new BN(seed)));
  sendOk(env.svm, accept, [env.taker]);
}

async function settle(env: Env, seed: number, payload: unknown, minTs: number, overrides = {}) {
  const ix = await settleIx(env, payload, { settler: env.stranger, seed: new BN(seed), minTimestampMs: minTs, ...overrides });
  return send(env.svm, new Transaction().add(computeIx(), ix), [env.stranger]);
}

describe("verdict", () => {
  describe("LIFECYCLE", () => {
    it("the SDK's default expiry still creates a market long after a historical kickoff", async () => {
      // Regression: defaultExpiryUnix used to be kickoff + 7 days. Our demo fixture kicked off
      // on 2026-07-06, so from 2026-07-13 that deadline was already in the past and every new
      // challenge died with InvalidExpiry — a time bomb that broke the live site on a clock,
      // with no code change. The rest of the suite runs at unixTimestamp 0, so it could never
      // catch this; here we advance the VM clock to a realistic "now" well past kickoff.
      const env = freshEnv();
      const nowMs = KICKOFF_MS + 45 * 86_400_000; // 45 days after the match
      const clock = env.svm.getClock();
      clock.unixTimestamp = BigInt(Math.floor(nowMs / 1000));
      env.svm.setClock(clock);

      const expiryUnix = defaultExpiryUnix(KICKOFF_MS, nowMs);
      assert.ok(expiryUnix > Math.floor(nowMs / 1000), "default expiry must be in the future");

      sendOk(
        env.svm,
        new Transaction().add(
          await createMarketIx(env, { ...baseCreate(90, CORNERS_OVER_9), expiryUnix }),
        ),
        [env.creator],
      );
      assert.equal(fetchMarket(env, new BN(90)).status.open !== undefined, true);
    });

    it("create escrows the creator's stake and opens the market", async () => {
      const env = freshEnv();
      const before = tokenBalance(env.svm, env.creatorAta);
      sendOk(env.svm, new Transaction().add(await createMarketIx(env, baseCreate(1, CORNERS_OVER_9))), [env.creator]);

      const market = fetchMarket(env, new BN(1));
      assert.equal(market.status.open !== undefined, true, "status should be Open");
      assert.equal(market.creator.toBase58(), env.creator.publicKey.toBase58());
      assert.equal(market.taker, null);
      assert.equal(market.fixtureId.toString(), String(FIXTURE_ID));
      assert.equal(before - tokenBalance(env.svm, env.creatorAta), BigInt(STAKE.toString()));
      assert.equal(tokenBalance(env.svm, vaultAta(marketPda(env.creator.publicKey, new BN(1)), env.mint)), BigInt(STAKE.toString()));
    });

    it("accept matches the stake and activates the market", async () => {
      const env = freshEnv();
      await openAndAccept(env, 2, CORNERS_OVER_9);
      const market = fetchMarket(env, new BN(2));
      assert.equal(market.status.active !== undefined, true, "status should be Active");
      assert.equal(market.taker.toBase58(), env.taker.publicKey.toBase58());
      assert.equal(tokenBalance(env.svm, vaultAta(marketPda(env.creator.publicKey, new BN(2)), env.mint)), BigInt(STAKE.mul(new BN(2)).toString()));
    });

    it("rejects the creator accepting their own challenge", async () => {
      const env = freshEnv();
      sendOk(env.svm, new Transaction().add(await createMarketIx(env, baseCreate(3, CORNERS_OVER_9))), [env.creator]);
      // Build an accept where the taker IS the creator.
      const market = marketPda(env.creator.publicKey, new BN(3));
      const ix = await env.program.methods
        .acceptMarket()
        .accounts({
          taker: env.creator.publicKey,
          market,
          vault: vaultAta(market, env.mint),
          takerTokenAccount: env.creatorAta,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .instruction();
      sendFail(env.svm, new Transaction().add(ix), [env.creator], { error: "SelfAccept" });
    });

    it("cancel before acceptance refunds the creator", async () => {
      const env = freshEnv();
      const before = tokenBalance(env.svm, env.creatorAta);
      sendOk(env.svm, new Transaction().add(await createMarketIx(env, baseCreate(4, CORNERS_OVER_9))), [env.creator]);
      const market = marketPda(env.creator.publicKey, new BN(4));
      const ix = await env.program.methods
        .cancelMarket()
        .accounts({
          creator: env.creator.publicKey,
          market,
          vault: vaultAta(market, env.mint),
          creatorTokenAccount: env.creatorAta,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .instruction();
      sendOk(env.svm, new Transaction().add(ix), [env.creator]);
      assert.equal(tokenBalance(env.svm, env.creatorAta), before, "creator fully refunded");
      assert.equal(fetchMarket(env, new BN(4)).status.cancelled !== undefined, true);
    });

    it("cannot cancel once a taker has accepted", async () => {
      const env = freshEnv();
      await openAndAccept(env, 5, CORNERS_OVER_9);
      const market = marketPda(env.creator.publicKey, new BN(5));
      const ix = await env.program.methods
        .cancelMarket()
        .accounts({
          creator: env.creator.publicKey,
          market,
          vault: vaultAta(market, env.mint),
          creatorTokenAccount: env.creatorAta,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .instruction();
      sendFail(env.svm, new Transaction().add(ix), [env.creator], { error: "MarketNotOpen" });
    });

    it("refund_expired splits the pot 50/50 after expiry", async () => {
      const env = freshEnv();
      await openAndAccept(env, 6, CORNERS_OVER_9);
      const cBefore = tokenBalance(env.svm, env.creatorAta);
      const tBefore = tokenBalance(env.svm, env.takerAta);

      // Warp past expiry.
      const clock = env.svm.getClock();
      clock.unixTimestamp = BigInt(EXPIRY + 1);
      env.svm.setClock(clock);

      const market = marketPda(env.creator.publicKey, new BN(6));
      const ix = await env.program.methods
        .refundExpired()
        .accounts({
          caller: env.stranger.publicKey,
          market,
          vault: vaultAta(market, env.mint),
          creatorTokenAccount: env.creatorAta,
          takerTokenAccount: env.takerAta,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .instruction();
      sendOk(env.svm, new Transaction().add(ix), [env.stranger]);

      assert.equal(tokenBalance(env.svm, env.creatorAta) - cBefore, BigInt(STAKE.toString()));
      assert.equal(tokenBalance(env.svm, env.takerAta) - tBefore, BigInt(STAKE.toString()));
      assert.equal(fetchMarket(env, new BN(6)).status.refunded !== undefined, true);
    });

    it("refund_expired is rejected before expiry", async () => {
      const env = freshEnv();
      await openAndAccept(env, 7, CORNERS_OVER_9);
      const market = marketPda(env.creator.publicKey, new BN(7));
      const ix = await env.program.methods
        .refundExpired()
        .accounts({
          caller: env.stranger.publicKey,
          market,
          vault: vaultAta(market, env.mint),
          creatorTokenAccount: env.creatorAta,
          takerTokenAccount: env.takerAta,
          tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        })
        .instruction();
      sendFail(env.svm, new Transaction().add(ix), [env.stranger], { error: "NotExpired" });
    });
  });

  describe("POSITIVE settlement (real Merkle proofs)", () => {
    it("predicate TRUE (corners 14 > 9) pays the creator the full pot", async () => {
      const env = freshEnv();
      await openAndAccept(env, 10, CORNERS_OVER_9);
      const cBefore = tokenBalance(env.svm, env.creatorAta);
      const tBefore = tokenBalance(env.svm, env.takerAta);

      const res = await settle(env, 10, v2ToSettleInput(proofs.v2CornersFinal), FINAL_MIN_TS);
      assert.equal("logs" in res, true, `settle should succeed:\n${(res as any).meta?.().logs?.().join("\n")}`);

      assert.equal(tokenBalance(env.svm, env.creatorAta) - cBefore, BigInt(STAKE.mul(new BN(2)).toString()), "creator wins the pot");
      assert.equal(tokenBalance(env.svm, env.takerAta), tBefore, "taker unchanged");

      const market = fetchMarket(env, new BN(10));
      assert.equal(market.status.settled !== undefined, true);
      assert.equal(market.outcome.winner.toBase58(), env.creator.publicKey.toBase58());
      assert.equal(market.outcome.predicateResult, true);
      assert.equal(market.outcome.stat1Value, 12); // participant-1 corners
      assert.equal(market.outcome.stat2Value, 2); //  participant-2 corners
      assert.equal(market.outcome.payout.toString(), STAKE.mul(new BN(2)).toString());
    });

    it("predicate FALSE (corners 14 > 20) pays the taker the full pot", async () => {
      const env = freshEnv();
      await openAndAccept(env, 11, CORNERS_OVER_20);
      const cBefore = tokenBalance(env.svm, env.creatorAta);
      const tBefore = tokenBalance(env.svm, env.takerAta);

      const res = await settle(env, 11, v2ToSettleInput(proofs.v2CornersFinal), FINAL_MIN_TS);
      assert.equal("logs" in res, true, "settle should succeed");

      assert.equal(tokenBalance(env.svm, env.takerAta) - tBefore, BigInt(STAKE.mul(new BN(2)).toString()), "taker wins the pot");
      assert.equal(tokenBalance(env.svm, env.creatorAta), cBefore, "creator unchanged");
      const market = fetchMarket(env, new BN(11));
      assert.equal(market.outcome.winner.toBase58(), env.taker.publicKey.toBase58());
      assert.equal(market.outcome.predicateResult, false);
    });

    it("single-stat predicate TRUE (England scored 3 > 2) pays the creator", async () => {
      const env = freshEnv();
      await openAndAccept(env, 12, P2_GOALS_OVER_2);
      const res = await settle(env, 12, v2ToSettleInput(proofs.v2SingleFinal), FINAL_MIN_TS);
      assert.equal("logs" in res, true, "settle should succeed");
      const market = fetchMarket(env, new BN(12));
      assert.equal(market.outcome.predicateResult, true);
      assert.equal(market.outcome.stat1Value, 3);
      assert.equal(market.outcome.winner.toBase58(), env.creator.publicKey.toBase58());
    });
  });

  describe("EXPLOIT -> REJECTED", () => {
    it("tampered stat value in the proof is rejected by the oracle Merkle check", async () => {
      const env = freshEnv();
      await openAndAccept(env, 20, CORNERS_OVER_9);
      const tampered = v2ToSettleInput(proofs.v2CornersFinal);
      tampered.stats[0].stat = { ...tampered.stats[0].stat, value: 13 }; // 12 -> 13
      const res = await settle(env, 20, tampered, FINAL_MIN_TS);
      assert.equal("err" in res, true, "tampered value must revert");
      assert.equal(fetchMarket(env, new BN(20)).status.active !== undefined, true, "market stays Active");
    });

    it("proof from a different fixture is rejected by the fixture gate", async () => {
      const env = freshEnv();
      // Market is about a DIFFERENT fixture than the (honest) proof.
      const create = baseCreate(21, CORNERS_OVER_9);
      create.fixtureId = FIXTURE_ID + 1;
      sendOk(env.svm, new Transaction().add(await createMarketIx(env, create)), [env.creator]);
      sendOk(env.svm, new Transaction().add(await acceptMarketIx(env, new BN(21))), [env.taker]);
      sendFail(
        env.svm,
        new Transaction().add(computeIx(), await settleIx(env, v2ToSettleInput(proofs.v2CornersFinal), { settler: env.stranger, seed: new BN(21), minTimestampMs: FINAL_MIN_TS })),
        [env.stranger],
        { error: "FixtureMismatch" },
      );
    });

    it("STALE mid-match proof is rejected even though the oracle itself accepts it", async () => {
      // The exact scenario from the build brief: a halftime snapshot is validly provable,
      // and the oracle WILL verify it (proven in the M3 measurement report). Verdict must
      // still refuse it, because settlement is only defined against the final record.
      const env = freshEnv();
      await openAndAccept(env, 22, CORNERS_OVER_9, KICKOFF_MS);
      // Recorded legacy mid-match proof (period=2), reshaped into its equivalent v2 payload.
      const stalePayload = legacyToSettleInput(proofs.legacyCornersMidMatch);
      // The mid-match summary post-dates kickoff, so the TIME gate passes — proving the
      // PERIOD gate is what does the rejecting.
      assert.ok(proofs.legacyCornersMidMatch.summary.updateStats.maxTimestamp >= KICKOFF_MS);
      sendFail(
        env.svm,
        new Transaction().add(computeIx(), await settleIx(env, stalePayload, { settler: env.stranger, seed: new BN(22), minTimestampMs: MID_MIN_TS })),
        [env.stranger],
        { error: "NotFinalRecord" },
      );
      assert.equal(fetchMarket(env, new BN(22)).status.active !== undefined, true, "market stays Active — no early settlement");
    });

    it("single-stat stale mid-match proof is likewise rejected", async () => {
      const env = freshEnv();
      await openAndAccept(env, 23, P2_GOALS_OVER_2, KICKOFF_MS);
      const stalePayload = legacyToSettleInput(proofs.legacySingleMidMatch);
      sendFail(
        env.svm,
        new Transaction().add(computeIx(), await settleIx(env, stalePayload, { settler: env.stranger, seed: new BN(23), minTimestampMs: MID_MIN_TS })),
        [env.stranger],
        { error: "NotFinalRecord" },
      );
    });

    it("proof predating the settlement window is rejected by the time gate", async () => {
      const env = freshEnv();
      // settle_after_ms is AFTER the final proof's data — even the real final proof is too early.
      await openAndAccept(env, 24, CORNERS_OVER_9, FINAL_MAX_TS + 60_000);
      sendFail(
        env.svm,
        new Transaction().add(computeIx(), await settleIx(env, v2ToSettleInput(proofs.v2CornersFinal), { settler: env.stranger, seed: new BN(24), minTimestampMs: FINAL_MIN_TS })),
        [env.stranger],
        { error: "ProofTooEarly" },
      );
    });

    it("double-settle on an already-settled market is rejected", async () => {
      const env = freshEnv();
      await openAndAccept(env, 25, CORNERS_OVER_9);
      const first = await settle(env, 25, v2ToSettleInput(proofs.v2CornersFinal), FINAL_MIN_TS);
      assert.equal("logs" in first, true, "first settle succeeds");
      sendFail(
        env.svm,
        new Transaction().add(computeIx(), await settleIx(env, v2ToSettleInput(proofs.v2CornersFinal), { settler: env.stranger, seed: new BN(25), minTimestampMs: FINAL_MIN_TS })),
        [env.stranger],
        { error: "MarketNotActive" },
      );
    });

    it("settle before acceptance is rejected", async () => {
      const env = freshEnv();
      sendOk(env.svm, new Transaction().add(await createMarketIx(env, baseCreate(26, CORNERS_OVER_9))), [env.creator]);
      sendFail(
        env.svm,
        new Transaction().add(computeIx(), await settleIx(env, v2ToSettleInput(proofs.v2CornersFinal), { settler: env.stranger, seed: new BN(26), minTimestampMs: FINAL_MIN_TS })),
        [env.stranger],
        { error: "MarketNotActive" },
      );
    });

    it("substituted (non-oracle) txoracle program is rejected before any CPI", async () => {
      const env = freshEnv();
      await openAndAccept(env, 27, CORNERS_OVER_9);
      // Pass the verdict program itself in the txoracle slot.
      sendFail(
        env.svm,
        new Transaction().add(
          computeIx(),
          await settleIx(env, v2ToSettleInput(proofs.v2CornersFinal), {
            settler: env.stranger,
            seed: new BN(27),
            minTimestampMs: FINAL_MIN_TS,
            txoracleOverride: new PublicKey("GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e"),
          }),
        ),
        [env.stranger],
        { error: "UntrustedOracleProgram" },
      );
    });

    it("settler-supplied wrong daily-roots account is rejected", async () => {
      const env = freshEnv();
      await openAndAccept(env, 28, CORNERS_OVER_9);
      // A syntactically valid but wrong PDA (different epoch day).
      const wrong = new PublicKey("11111111111111111111111111111111");
      sendFail(
        env.svm,
        new Transaction().add(
          computeIx(),
          await settleIx(env, v2ToSettleInput(proofs.v2CornersFinal), {
            settler: env.stranger,
            seed: new BN(28),
            minTimestampMs: FINAL_MIN_TS,
            dailyRootsOverride: wrong,
          }),
        ),
        [env.stranger],
        { error: "WrongRootsAccount" },
      );
    });
  });
});
