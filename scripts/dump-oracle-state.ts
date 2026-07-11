/**
 * Dumps the devnet TxLINE oracle state that the offline test suite replays against:
 *   - the txoracle program executable (tests/fixtures/txoracle.so)
 *   - every daily_scores_roots account referenced by the recorded proofs
 *     (tests/fixtures/roots/<pubkey>.json, as base64 account snapshots)
 *
 * With these cloned into LiteSVM, the recorded Merkle proofs verify identically offline, so
 * the exploit/defense suite is deterministic and needs no network.
 *
 *   npx tsx scripts/dump-oracle-state.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { DEVNET } from "@verdict/sdk/config";
import { dailyScoresPdaFromTs } from "@verdict/sdk/txoracle";
import type { StatValidationLegacy, StatValidationV2 } from "@verdict/sdk/types";

async function main() {
  const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8"));
  const rpc = process.env.RPC_URL ?? DEVNET.rpcUrl;
  const connection = new Connection(rpc, "confirmed");

  fs.mkdirSync("tests/fixtures/roots", { recursive: true });

  // Every distinct timestamp across recorded proofs -> its daily roots PDA.
  const timestamps = new Set<number>();
  for (const key of Object.keys(proofs)) {
    if (key === "meta") continue;
    const v = proofs[key] as StatValidationLegacy | StatValidationV2;
    if (v?.summary?.updateStats?.minTimestamp) timestamps.add(v.summary.updateStats.minTimestamp);
  }

  const pdas = new Map<string, number>();
  for (const ts of timestamps) {
    pdas.set(dailyScoresPdaFromTs(ts).toBase58(), ts);
  }

  console.log(`daily_scores_roots PDAs referenced: ${pdas.size}`);
  const manifest: Record<string, { epochDayTs: number; lamports: number; dataLen: number }> = {};
  for (const [pda, ts] of pdas) {
    const info = await connection.getAccountInfo(new (await import("@solana/web3.js")).PublicKey(pda));
    if (!info) {
      console.warn(`  ${pda}: NOT FOUND on ${rpc} (day ${Math.floor(ts / 86_400_000)})`);
      continue;
    }
    const snapshot = {
      pubkey: pda,
      account: {
        lamports: info.lamports,
        owner: info.owner.toBase58(),
        executable: info.executable,
        rentEpoch: info.rentEpoch ?? 0,
        data: [Buffer.from(info.data).toString("base64"), "base64"] as [string, string],
      },
    };
    fs.writeFileSync(`tests/fixtures/roots/${pda}.json`, JSON.stringify(snapshot, null, 2));
    manifest[pda] = { epochDayTs: ts, lamports: info.lamports, dataLen: info.data.length };
    console.log(`  ${pda}: owner ${info.owner.toBase58()} data ${info.data.length}B -> saved`);
  }
  fs.writeFileSync("tests/fixtures/roots/manifest.json", JSON.stringify(manifest, null, 2));

  // Dump the program executable via the Solana CLI (handles the programdata indirection).
  console.log(`\ndumping txoracle program ${DEVNET.txoracleProgramId} ...`);
  execFileSync(
    "solana",
    ["program", "dump", DEVNET.txoracleProgramId, "tests/fixtures/txoracle.so", "-u", rpc],
    { stdio: "inherit" },
  );
  const soSize = fs.statSync("tests/fixtures/txoracle.so").size;
  console.log(`saved tests/fixtures/txoracle.so (${soSize} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
