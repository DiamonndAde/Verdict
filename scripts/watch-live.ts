/**
 * Live-match settle watcher. Run it from around full time; it polls until the match is
 * settle-ready and reports EXACTLY how long each stage took:
 *
 *   (a) the game_finalised record (period/statusId 100) appears on the free tier
 *   (b) /api/scores/stat-validation returns proofs for that seq
 *   (c) the day's on-chain root is anchored such that validate_stat_v2().view() PASSES
 *
 * When all three land it records the proofs into tests/fixtures/live-proofs.json AND
 * apps/web/src/data/live-proofs.json (so the app can settle the market), and writes
 * docs/live-settle-latency.md.
 *
 *   npx tsx scripts/watch-live.ts            # watches the fixture in live-fixture.json
 */
import * as fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { TxLineAuth, loadKeypair } from "@verdict/sdk/auth";
import { TxLineClient } from "@verdict/sdk/api";
import { DEVNET } from "@verdict/sdk/config";
import {
  buildV2Payload,
  computeBudgetIx,
  dailyScoresPdaFromTs,
  makeTxoracleProgram,
} from "@verdict/sdk/txoracle";
import type { StatValidationV2 } from "@verdict/sdk/types";

const POLL_MS = 60_000;
const FINAL_PERIOD = 100;
/** Corners (7,8) and the two goal keys (1,2) — the predicates the demo offers. */
const KEYSETS: Record<string, number[]> = { v2CornersFinal: [7, 8], v2SingleFinal: [2] };

const iso = (ms: number) => new Date(ms).toISOString().replace(".000", "");
const mins = (ms: number) => (ms / 60_000).toFixed(1);

async function main() {
  const live = JSON.parse(fs.readFileSync("tests/fixtures/live-fixture.json", "utf8"));
  const fixtureId: number = live.fixtureId;
  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const wallet = loadKeypair(".keys/deployer.json");
  const auth = new TxLineAuth(connection, wallet);
  const client = new TxLineClient(auth);
  const oracle = makeTxoracleProgram(connection, wallet);

  console.log(`watching ${live.participant1} vs ${live.participant2} (fixture ${fixtureId})`);
  console.log(`kickoff ${iso(live.startTime)} — polling every ${POLL_MS / 1000}s\n`);

  // ---- (a) wait for the game_finalised record -------------------------------------------
  let finalSeq = 0;
  let finalRecordTs = 0;
  let tFinalSeen = 0;
  for (;;) {
    try {
      const records = await client.scoresSnapshot(fixtureId);
      // Match ONLY on action === "game_finalised". Verified against the completed demo fixture:
      // snapshot records come back unsorted and several carry statusId 100 (e.g. a later
      // "disconnected" record), so a statusId/period heuristic picks the wrong seq — and its
      // stat leaves are not period 100, so settle would revert with NotFinalRecord. Exactly one
      // record has this action (seq 1046 for Mexico–England, which is the seq we validated).
      const fin = records.find((r) => r.action === "game_finalised");
      // Records are unsorted, so "latest" for logging = highest seq.
      const latest = records.reduce((a, b) => (b.seq > (a?.seq ?? -1) ? b : a), records[0]);
      if (fin) {
        finalSeq = fin.seq;
        finalRecordTs = fin.ts;
        tFinalSeen = Date.now();
        console.log(`\n(a) game_finalised SEEN  seq=${finalSeq}  recordTs=${iso(finalRecordTs)}  observedAt=${iso(tFinalSeen)}`);
        console.log(`    feed latency (record -> visible): ${mins(tFinalSeen - finalRecordTs)} min`);
        break;
      }
      console.log(`[${iso(Date.now())}] not final yet — highest seq ${latest?.seq ?? "?"} action=${latest?.action ?? "?"}`);
    } catch (err) {
      console.log(`[${iso(Date.now())}] poll error: ${String(err).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // ---- (b) wait for stat-validation proofs, then (c) for the root to verify --------------
  const proofs: Record<string, StatValidationV2> = {};
  let tProofs = 0;
  let tViewPass = 0;

  for (;;) {
    try {
      for (const [name, keys] of Object.entries(KEYSETS)) {
        if (!proofs[name]) proofs[name] = await client.statValidationV2(fixtureId, finalSeq, keys);
      }
      if (!tProofs) {
        tProofs = Date.now();
        console.log(`\n(b) stat-validation RETURNS PROOFS  at ${iso(tProofs)}`);
        console.log(`    ${mins(tProofs - tFinalSeen)} min after the final record was visible`);
        for (const [n, p] of Object.entries(proofs)) {
          console.log(`    ${n}: ${p.statsToProve.map((s) => `${s.key}=${s.value}(p${s.period})`).join(" ")}`);
        }
      }

      // (c) the day's root must be anchored such that the oracle verifies the proof.
      const p = proofs.v2CornersFinal;
      const pda = dailyScoresPdaFromTs(p.summary.updateStats.minTimestamp);
      const holds = (await oracle.methods
        .validateStatV2(buildV2Payload(p) as never, {
          geometricTargets: [],
          distancePredicate: null,
          discretePredicates: [
            { binary: { indexA: 0, indexB: 1, op: { add: {} }, predicate: { threshold: 0, comparison: { greaterThan: {} } } } },
          ],
        } as never)
        .accounts({ dailyScoresMerkleRoots: pda })
        .preInstructions([computeBudgetIx()])
        .view()) as boolean;

      tViewPass = Date.now();
      console.log(`\n(c) validate_stat_v2().view() PASSES  at ${iso(tViewPass)}  (returned ${holds})`);
      console.log(`    daily root PDA ${pda.toBase58()} anchored & includes the final record`);
      console.log(`    ${mins(tViewPass - tFinalSeen)} min after the final record was visible`);
      break;
    } catch (err) {
      const msg = String(err);
      const code = /Error Code: (\w+)/.exec(msg)?.[1] ?? msg.slice(0, 90);
      console.log(`[${iso(Date.now())}] not verifiable yet (${code}) — root likely not anchored for this batch`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  // ---- record the proofs so the app can settle -------------------------------------------
  fs.writeFileSync("tests/fixtures/live-proofs.json", JSON.stringify(proofs, null, 2));
  fs.writeFileSync("apps/web/src/data/live-proofs.json", JSON.stringify(proofs, null, 2));

  const corners = proofs.v2CornersFinal.statsToProve.reduce((s, x) => s + x.value, 0);
  const report = [
    "# Live-match settle latency — France vs Spain",
    "",
    `Fixture **${fixtureId}** (${live.participant1} vs ${live.participant2}), kickoff ${iso(live.startTime)}.`,
    "Measured by `npm run watch-live` against the TxLINE free tier (60s delay) on devnet.",
    "",
    "| Stage | When | Latency |",
    "| ----- | ---- | ------- |",
    `| game_finalised record timestamp | ${iso(finalRecordTs)} | — |`,
    `| (a) …visible on the free tier | ${iso(tFinalSeen)} | ${mins(tFinalSeen - finalRecordTs)} min after the record |`,
    `| (b) stat-validation returns proofs | ${iso(tProofs)} | ${mins(tProofs - tFinalSeen)} min after (a) |`,
    `| (c) validate_stat_v2().view() passes | ${iso(tViewPass)} | ${mins(tViewPass - tFinalSeen)} min after (a) |`,
    "",
    `**Settle-ready at ${iso(tViewPass)}** — ${mins(tViewPass - finalRecordTs)} min after the final record's own timestamp.`,
    "",
    `Final seq \`${finalSeq}\`, total corners **${corners}**. Proofs recorded to`,
    "`apps/web/src/data/live-proofs.json`; rebuild + deploy and the challenge settles.",
    "",
  ].join("\n");
  fs.writeFileSync("docs/live-settle-latency.md", report);
  console.log(`\nwrote docs/live-settle-latency.md`);
  console.log(`recorded proofs -> apps/web/src/data/live-proofs.json (rebuild + push to enable settling)`);
  console.log(`\nSETTLE-READY. Earliest safe recording time: ${iso(tViewPass)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
