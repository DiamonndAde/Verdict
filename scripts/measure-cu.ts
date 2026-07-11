/**
 * Measures actual compute-unit consumption of txoracle.validate_stat_v2 via a real
 * (non-view) simulateTransaction. This decides whether verdict's settle can CPI the
 * oracle AND pay out atomically inside the 1.4M CU per-transaction cap.
 *
 *   npx tsx scripts/measure-cu.ts
 */
import * as fs from "node:fs";
import { ComputeBudgetProgram, Connection, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { loadKeypair } from "@verdict/sdk/auth";
import { DEVNET } from "@verdict/sdk/config";
import { buildV2Payload, dailyScoresPdaFromTs, makeTxoracleProgram, type TraderPredicate } from "@verdict/sdk/txoracle";
import type { StatValidationV2 } from "@verdict/sdk/types";

const GT = (t: number): TraderPredicate => ({ threshold: t, comparison: { greaterThan: {} } });

async function main() {
  const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8"));
  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const wallet = loadKeypair(".keys/deployer.json");
  const program = makeTxoracleProgram(connection, wallet);

  const strategyCorners = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: [{ binary: { indexA: 0, indexB: 1, op: { add: {} }, predicate: GT(9) } }],
  };
  const strategySingle = {
    geometricTargets: [],
    distancePredicate: null,
    discretePredicates: [{ single: { index: 0, predicate: GT(2) } }],
  };

  for (const [label, v, strategy] of [
    ["v2 single-stat", proofs.v2SingleFinal as StatValidationV2, strategySingle],
    ["v2 2-stat (corners)", proofs.v2CornersFinal as StatValidationV2, strategyCorners],
  ] as const) {
    const ix = await program.methods
      .validateStatV2(buildV2Payload(v) as never, strategy as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .instruction();

    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([wallet]);

    const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    console.log(`${label}: unitsConsumed=${sim.value.unitsConsumed}  err=${JSON.stringify(sim.value.err)}`);
    if (sim.value.err) console.log("  logs tail:", (sim.value.logs ?? []).slice(-4).join("\n           "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
