/**
 * ARCHITECTURE-CRITICAL PROBE.
 *
 * verdict's settle treats a `false` predicate result as a valid outcome (the taker wins)
 * and a *revert* as a rejected proof. That only works if validate_stat_v2 RETURNS false
 * for a failing predicate rather than throwing (the IDL exposes error 6021 PredicateFailed,
 * which would collapse the two cases into one).
 *
 *   npx tsx scripts/probe-v2-false.ts
 */
import * as fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { loadKeypair } from "@verdict/sdk/auth";
import { DEVNET } from "@verdict/sdk/config";
import { buildV2Payload, computeBudgetIx, dailyScoresPdaFromTs, makeTxoracleProgram } from "@verdict/sdk/txoracle";
import type { StatValidationV2 } from "@verdict/sdk/types";

async function main() {
  const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8"));
  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const program = makeTxoracleProgram(connection, loadKeypair(".keys/deployer.json"));
  const v = proofs.v2CornersFinal as StatValidationV2;
  const pda = dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp);
  const trueCorners = 14;

  const run = async (label: string, threshold: number, cmp: object) => {
    const strategy = {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [{ binary: { indexA: 0, indexB: 1, op: { add: {} }, predicate: { threshold, comparison: cmp } } }],
    };
    try {
      const out = await program.methods
        .validateStatV2(buildV2Payload(v) as never, strategy as never)
        .accounts({ dailyScoresMerkleRoots: pda })
        .preInstructions([computeBudgetIx()])
        .view();
      console.log(`${label}: RETURNED ${out}`);
    } catch (err) {
      const m = /Error Code: (\w+)/.exec(String(err));
      console.log(`${label}: THREW ${m?.[1] ?? String(err).slice(0, 120)}`);
    }
  };

  console.log(`actual corners = ${trueCorners}`);
  await run("predicate TRUE  (corners > 9) ", 9, { greaterThan: {} });
  await run("predicate FALSE (corners > 20)", 20, { greaterThan: {} });
  await run("predicate FALSE (corners < 5) ", 5, { lessThan: {} });
  await run("predicate FALSE (corners == 3)", 3, { equalTo: {} });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
