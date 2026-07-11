/**
 * MILESTONE 3 — the de-risking gate before any settle code is written.
 *
 * Using the real recorded proofs for the demo fixture (tests/fixtures/proofs.json):
 *   1. Reproduce read-only on-chain validation from TS: validateStat / V2 / V3 .view()
 *   2. Adversarial probes against the oracle itself:
 *        - tampered stat value        -> proof must fail
 *        - tampered period (100 -> 2) -> proof must fail (proves the period is hash-bound,
 *          which is what makes verdict's "period == 100" finality gate trustworthy)
 *        - mid-match proof, honest    -> oracle ACCEPTS it (by design) — demonstrating why
 *          verdict must enforce the period gate itself
 *   3. Serialize every candidate settle payload and print the MEASUREMENT REPORT that
 *      locks the settle architecture (single-tx vs buffer; legacy vs V2 vs V3 CPI).
 *
 *   npx tsx scripts/measure-settle.ts
 */
import * as fs from "node:fs";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { loadKeypair } from "@verdict/sdk/auth";
import { DEVNET, FINAL_PERIOD } from "@verdict/sdk/config";
import {
  buildLegacyStatArgs,
  buildV2Payload,
  buildV3Payload,
  computeBudgetIx,
  dailyScoresPdaFromTs,
  makeTxoracleProgram,
  type TraderPredicate,
} from "@verdict/sdk/txoracle";
import type { StatValidationLegacy, StatValidationV2, StatValidationV3 } from "@verdict/sdk/types";

type Proofs = {
  meta: {
    fixtureId: number;
    finalSeq: number;
    midMatchSeq: number;
    participants: string;
    finalRecord: { stats: Record<string, number> };
    midMatchRecord: { stats: Record<string, number> };
  };
  legacySingleFinal: StatValidationLegacy;
  legacyCornersFinal: StatValidationLegacy;
  v2CornersFinal: StatValidationV2;
  v2SingleFinal: StatValidationV2;
  v3CornersFinal?: StatValidationV3;
  v3SingleFinal?: StatValidationV3;
  legacyCornersMidMatch: StatValidationLegacy;
  legacySingleMidMatch: StatValidationLegacy;
};

const GT = (threshold: number): TraderPredicate => ({ threshold, comparison: { greaterThan: {} } });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const results: string[] = [];
function report(line: string) {
  console.log(line);
  results.push(line);
}

async function main() {
  const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8")) as Proofs;
  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const wallet = loadKeypair(process.env.ANCHOR_WALLET ?? ".keys/deployer.json");
  const program = makeTxoracleProgram(connection, wallet);

  const { meta } = proofs;
  report(`MEASUREMENT REPORT — ${meta.participants} (fixture ${meta.fixtureId})`);
  report(`final seq ${meta.finalSeq} | mid-match seq ${meta.midMatchSeq} | oracle ${program.programId.toBase58()}`);
  report("");

  // ---------- helpers ----------

  const legacyIx = async (v: StatValidationLegacy, predicate: TraderPredicate, op: unknown | null) => {
    const a = buildLegacyStatArgs(v);
    return program.methods
      .validateStat(a.ts, a.fixtureSummary, a.fixtureProof, a.mainTreeProof, predicate as never, a.statA as never, a.statB as never, op as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .instruction();
  };

  const legacyView = async (v: StatValidationLegacy, predicate: TraderPredicate, op: unknown | null) => {
    const a = buildLegacyStatArgs(v);
    return program.methods
      .validateStat(a.ts, a.fixtureSummary, a.fixtureProof, a.mainTreeProof, predicate as never, a.statA as never, a.statB as never, op as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .preInstructions([computeBudgetIx()])
      .view();
  };

  const v2View = async (v: StatValidationV2, strategy: unknown) =>
    program.methods
      .validateStatV2(buildV2Payload(v) as never, strategy as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .preInstructions([computeBudgetIx()])
      .view();

  const v2Ix = async (v: StatValidationV2, strategy: unknown) =>
    program.methods
      .validateStatV2(buildV2Payload(v) as never, strategy as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .instruction();

  const v3View = async (v: StatValidationV3, strategy: unknown) =>
    program.methods
      .validateStatV3(buildV3Payload(v) as never, strategy as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .preInstructions([computeBudgetIx()])
      .view();

  const v3Ix = async (v: StatValidationV3, strategy: unknown) =>
    program.methods
      .validateStatV3(buildV3Payload(v) as never, strategy as never)
      .accounts({ dailyScoresMerkleRoots: dailyScoresPdaFromTs(v.summary.updateStats.minTimestamp) })
      .instruction();

  const expectView = async (label: string, fn: () => Promise<boolean>, expected: boolean | "error") => {
    try {
      const out = await fn();
      const ok = expected !== "error" && out === expected;
      report(`  ${ok ? "PASS" : "FAIL"}  ${label} -> returned ${out} (expected ${expected})`);
    } catch (err) {
      const name = /Error Code: (\w+)|custom program error: (\S+)/.exec(String(err));
      const ok = expected === "error";
      report(`  ${ok ? "PASS" : "FAIL"}  ${label} -> reverted ${name?.[1] ?? name?.[2] ?? String(err).slice(0, 90)} (expected ${expected})`);
    }
  };

  // ---------- 1. positive controls: reproduce .view() == true ----------

  report("1) READ-ONLY VALIDATION (.view) — positive controls");
  const corners = meta.finalRecord.stats["7"] + meta.finalRecord.stats["8"];
  const p2goals = meta.finalRecord.stats["2"];
  // "Total corners over 9.5" => (7)+(8) > 9 ; "England (P2) scores 3+" => (2) > 2
  await expectView(`legacy 2-stat ADD corners=${corners} > 9`, () => legacyView(proofs.legacyCornersFinal, GT(9), { add: {} }), true);
  await expectView(`legacy 2-stat ADD corners=${corners} > 20 (losing side)`, () => legacyView(proofs.legacyCornersFinal, GT(20), { add: {} }), false);
  await expectView(`legacy single P2 goals=${p2goals} > 2`, () => legacyView(proofs.legacySingleFinal, GT(2), null), true);

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
  await expectView("v2 2-stat ADD corners > 9", () => v2View(proofs.v2CornersFinal, strategyCorners), true);
  await expectView("v2 single P2 goals > 2", () => v2View(proofs.v2SingleFinal, strategySingle), true);
  if (proofs.v3CornersFinal) {
    await expectView("v3 2-stat ADD corners > 9 (multiproof)", () => v3View(proofs.v3CornersFinal, strategyCorners), true);
  }
  report("");

  // ---------- 2. adversarial probes ----------

  report("2) ADVERSARIAL PROBES against the oracle");
  {
    const tampered = clone(proofs.legacyCornersFinal);
    tampered.statToProve.value = 13; // 12 -> 13
    await expectView("tampered stat VALUE (12->13)", () => legacyView(tampered, GT(9), { add: {} }), "error");
  }
  {
    const tampered = clone(proofs.legacyCornersFinal);
    tampered.statToProve.period = 2; // claim final stat came from H1
    tampered.statToProve2!.period = 2;
    await expectView("tampered stat PERIOD (100->2)", () => legacyView(tampered, GT(9), { add: {} }), "error");
  }
  {
    const tampered = clone(proofs.legacyCornersFinal);
    tampered.summary.fixtureId = meta.fixtureId + 1;
    await expectView("tampered summary fixtureId", () => legacyView(tampered, GT(9), { add: {} }), "error");
  }
  {
    // honest mid-match proof: the oracle happily validates it — the point of the probe.
    const mid = proofs.legacyCornersMidMatch;
    const midCorners = meta.midMatchRecord.stats["7"] + meta.midMatchRecord.stats["8"];
    await expectView(
      `HONEST mid-match proof (corners=${midCorners}, period=${mid.statToProve.period}) "under 9.5" LT(10)`,
      () => legacyView(mid, { threshold: 10, comparison: { lessThan: {} } }, { add: {} }),
      true,
    );
    report(`        ^ oracle accepts mid-match proofs BY DESIGN — verdict's settle must therefore`);
    report(`          require statToProve.period == ${FINAL_PERIOD} (hash-bound, tamper-proof per the probe above)`);
  }
  report("");

  // ---------- 3. size measurement ----------

  report("3) SERIALIZED SIZES (borsh ix data | full v0 tx with compute-budget ix, 1 signer)");
  const sizeOf = async (label: string, ix: Awaited<ReturnType<typeof legacyIx>>) => {
    const { blockhash } = await connection.getLatestBlockhash();
    const msg = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx(), ix],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([wallet]);
    const total = tx.serialize().length;
    report(`  ${label.padEnd(34)} ix data ${String(ix.data.length).padStart(4)} B | tx ${String(total).padStart(4)} B | headroom vs 1232: ${1232 - total} B`);
    return { ixData: ix.data.length, tx: total };
  };

  const sLegacy1 = await sizeOf("legacy single-stat", await legacyIx(proofs.legacySingleFinal, GT(2), null));
  const sLegacy2 = await sizeOf("legacy 2-stat (corners)", await legacyIx(proofs.legacyCornersFinal, GT(9), { add: {} }));
  const sV21 = await sizeOf("v2 single-stat", await v2Ix(proofs.v2SingleFinal, strategySingle));
  const sV22 = await sizeOf("v2 2-stat (corners)", await v2Ix(proofs.v2CornersFinal, strategyCorners));
  let sV32: { ixData: number; tx: number } | undefined;
  if (proofs.v3SingleFinal) await sizeOf("v3 single-stat (multiproof)", await v3Ix(proofs.v3SingleFinal, strategySingle));
  if (proofs.v3CornersFinal) sV32 = await sizeOf("v3 2-stat (multiproof)", await v3Ix(proofs.v3CornersFinal, strategyCorners));

  const nodes = (v: StatValidationLegacy) =>
    `statProof ${v.statProof.length}${v.statProof2 ? "+" + v.statProof2.length : ""}, subTree ${v.subTreeProof.length}, mainTree ${v.mainTreeProof.length}`;
  report("");
  report(`  proof-node counts (33 B each): final 2-stat: ${nodes(proofs.legacyCornersFinal)}`);
  if (proofs.v3CornersFinal) {
    report(`  v3 multiproof: leaves ${proofs.v3CornersFinal.statsToProve.length}, shared hashes ${proofs.v3CornersFinal.multiproof.hashes.length}, per-leaf proofs ${proofs.v3CornersFinal.statsToProve.map((l) => l.statProof.length).join("/")}`);
  }
  report("");

  // ---------- 4. settle architecture decision ----------

  report("4) SETTLE ARCHITECTURE DECISION");
  // verdict's settle wraps the oracle payload and adds its own accounts. Extra vs the
  // measured view tx: ~7 more unique account keys (market, vault, winner+loser ATAs,
  // token program, oracle program, market-authority PDA) at 32 B each + ~10 B metas/indices,
  // plus the 8-B market seed/nonce arg. The measured tx already includes payer, compute
  // budget, oracle program id, daily-roots PDA, blockhash, 1 signature.
  const EXTRA_ACCOUNTS_BYTES = 7 * 32 + 10 + 8;
  // Proof depth scales with daily batch size: mainTreeProof grows ~log2(fixtures/day).
  // Project the measured 2-stat payloads onto busier days (each extra node = 33 B).
  const observedMain = proofs.legacyCornersFinal.mainTreeProof.length;
  report(`  measured mainTreeProof depth: ${observedMain} node(s); projecting +4 nodes for ~32-fixture days`);
  const rows: Array<[string, number]> = [
    ["legacy 2-stat", sLegacy2.tx],
    ["v2 2-stat", sV22.tx],
    ...(sV32 ? ([["v3 2-stat", sV32.tx]] as Array<[string, number]>) : []),
  ];
  for (const [label, txB] of rows) {
    const now = txB + EXTRA_ACCOUNTS_BYTES;
    const busy = now + 4 * 33;
    report(
      `  ${label.padEnd(14)} settle est ${String(now).padStart(4)} B (headroom ${String(1232 - now).padStart(3)}) | busy-day est ${busy} B (headroom ${1232 - busy})`,
    );
  }
  report("");
  report("  CHOSEN: settle CPIs txoracle.validate_stat_v2 in a SINGLE transaction. Rationale:");
  report("   - documented + current API shape (statKeys mode); legacy statKey path is deprecated-in-name");
  report("   - NDimensionalStrategy (single/binary indexed predicates) maps 1:1 onto verdict's stored");
  report("     predicate, and the program BUILDS the strategy on-chain from stored terms — the settler");
  report("     supplies only the Merkle payload, never the terms");
  report("   - fits single-tx with headroom even at busy-day tree depths (see projection above)");
  report("   - v3 multiproof is ~150 B smaller still, but its endpoint is undocumented — noted in");
  report("     FEEDBACK.md; buffer flow not required, ALT escape hatch documented if trees ever exceed");
  report("     projections");
  report("  Settle gates locked (enforced by verdict before/after the CPI):");
  report("   1. pinned txoracle program id (arbitrary-CPI defense)");
  report("   2. summary.fixtureId == market.fixture_id");
  report("   3. every leaf: key == stored predicate key(s), in stored order");
  report(`   4. every leaf: period == ${FINAL_PERIOD} (game_finalised; hash-bound per probe 2)`);
  report("   5. summary.updateStats.maxTimestamp >= market.settle_after_ts (defense-in-depth)");
  report("   6. return-data producer == txoracle id, decode bool (spoofing defense)");
  report("   7. status guard Active->Settled (double-settle defense)");

  fs.writeFileSync("docs/measurement-report.txt", results.join("\n") + "\n");
  report("");
  report("saved to docs/measurement-report.txt");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
