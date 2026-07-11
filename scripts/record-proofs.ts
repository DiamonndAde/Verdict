/**
 * Records real TxLINE stat-validation payloads for the demo fixture into
 * tests/fixtures/*.json so program tests and the measurement report run
 * deterministically offline.
 *
 * Recorded per shape (legacy / v2 / v3):
 *   - final record proofs (game_finalised seq): single-stat and two-stat (total corners)
 *   - a mid-match record proof (for the stale/early-settlement exploit test)
 *
 *   npx tsx scripts/record-proofs.ts
 */
import * as fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { TxLineAuth, loadKeypair } from "@verdict/sdk/auth";
import { TxLineClient } from "@verdict/sdk/api";
import { DEVNET, GAME_FINALISED_ACTION, STAT } from "@verdict/sdk/config";

async function main() {
  const demo = JSON.parse(fs.readFileSync("tests/fixtures/demo-fixture.json", "utf8")) as {
    fixtureId: number;
    finalSeq: number;
    participant1: string;
    participant2: string;
  };
  const { fixtureId, finalSeq } = demo;
  console.log(`recording proofs for ${demo.participant1} vs ${demo.participant2} (${fixtureId}), finalSeq=${finalSeq}`);

  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const wallet = loadKeypair(process.env.ANCHOR_WALLET ?? ".keys/deployer.json");
  const auth = new TxLineAuth(connection, wallet);
  const client = new TxLineClient(auth);
  await auth.getAuth();

  // Locate a mid-match record for the exploit test: latest record still in the first half.
  const records = await client.scoresHistorical(fixtureId);
  const finalRecord = records.find((r) => r.action === GAME_FINALISED_ACTION);
  const h1 = records.filter((r) => Number(r.statusId) === 2 && r.stats && r.seq < finalSeq);
  const midMatch = h1[h1.length - 1];
  if (!midMatch) throw new Error("no in-play H1 record found for the exploit fixture");
  console.log(`mid-match record: seq=${midMatch.seq} statusSoccerId=${midMatch.statusSoccerId} stats1/2=${midMatch.stats?.["1"]}-${midMatch.stats?.["2"]} corners=${(midMatch.stats?.["7"] ?? 0) + (midMatch.stats?.["8"] ?? 0)}`);

  const out: Record<string, unknown> = {
    meta: {
      recordedAt: new Date().toISOString(),
      fixtureId,
      finalSeq,
      midMatchSeq: midMatch.seq,
      participants: `${demo.participant1} vs ${demo.participant2}`,
      finalRecord: { seq: finalRecord?.seq, ts: finalRecord?.ts, statusId: finalRecord?.statusId, period: finalRecord?.period, stats: finalRecord?.stats },
      midMatchRecord: { seq: midMatch.seq, ts: midMatch.ts, statusId: midMatch.statusId, statusSoccerId: midMatch.statusSoccerId, period: midMatch.period, stats: midMatch.stats },
    },
  };

  // Final-record proofs (what settlement uses).
  out.legacySingleFinal = await client.statValidation(fixtureId, finalSeq, STAT.P2_GOALS);
  out.legacyCornersFinal = await client.statValidation(fixtureId, finalSeq, STAT.P1_CORNERS, STAT.P2_CORNERS);
  out.v2CornersFinal = await client.statValidationV2(fixtureId, finalSeq, [STAT.P1_CORNERS, STAT.P2_CORNERS]);
  out.v2SingleFinal = await client.statValidationV2(fixtureId, finalSeq, [STAT.P2_GOALS]);
  try {
    out.v3CornersFinal = await client.statValidationV3(fixtureId, finalSeq, [STAT.P1_CORNERS, STAT.P2_CORNERS]);
    out.v3SingleFinal = await client.statValidationV3(fixtureId, finalSeq, [STAT.P2_GOALS]);
  } catch (err) {
    console.warn("v3 endpoint failed (undocumented — tolerated):", String(err).slice(0, 200));
  }

  // Mid-match proofs (must be REJECTED by verdict's period gate).
  out.legacyCornersMidMatch = await client.statValidation(fixtureId, midMatch.seq, STAT.P1_CORNERS, STAT.P2_CORNERS);
  out.legacySingleMidMatch = await client.statValidation(fixtureId, midMatch.seq, STAT.P2_GOALS);

  fs.writeFileSync("tests/fixtures/proofs.json", JSON.stringify(out, null, 2));
  const summary = Object.entries(out)
    .filter(([k]) => k !== "meta")
    .map(([k, v]) => `${k}: ${JSON.stringify(v).length}B json`)
    .join("\n  ");
  console.log(`\nwritten tests/fixtures/proofs.json\n  ${summary}`);

  // Show the proven stat leaves — confirms the period field values.
  const leg = out.legacyCornersFinal as { statToProve: unknown; statToProve2?: unknown };
  console.log("\nfinal statToProve:", JSON.stringify(leg.statToProve), JSON.stringify(leg.statToProve2));
  const mid = out.legacyCornersMidMatch as { statToProve: unknown; statToProve2?: unknown };
  console.log("mid-match statToProve:", JSON.stringify(mid.statToProve), JSON.stringify(mid.statToProve2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
