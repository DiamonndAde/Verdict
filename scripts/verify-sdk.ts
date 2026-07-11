/**
 * Drives the verdict SDK layer against real recorded data:
 *   - predicate compiler: friendly conditions -> stored predicate + sentence
 *   - settle-tx builder: assembles the real settle tx and reports the measured wire size
 *     (condition #1: must throw at >= 1232 bytes)
 *   - shallowest-seq chooser: ranks candidate final seqs by proof depth
 *
 *   npx tsx scripts/verify-sdk.ts
 */
import * as fs from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TxLineAuth, loadKeypair } from "@verdict/sdk/auth";
import { TxLineClient } from "@verdict/sdk/api";
import { DEVNET } from "@verdict/sdk/config";
import {
  buildSettleTx,
  chooseFinalSeq,
  compilePredicate,
  describeCondition,
  makeVerdictProgram,
  marketPda,
  predicateStatKeys,
  proofDepth,
  vaultPda,
  type Condition,
  type FixtureSides,
  type MarketAccount,
} from "@verdict/sdk/verdict";

const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8"));
const demo = JSON.parse(fs.readFileSync("tests/fixtures/demo-fixture.json", "utf8"));
const mintInfo = JSON.parse(fs.readFileSync("tests/fixtures/dusdc-mint.json", "utf8"));

const sides: FixtureSides = {
  participant1: demo.participant1,
  participant2: demo.participant2,
  participant1IsHome: demo.participant1IsHome,
};

function checkPredicates() {
  console.log("=== PREDICATE COMPILER ===");
  const conditions: Condition[] = [
    { metric: "corners", scope: "total", comparator: "over", threshold: 9.5 },
    { metric: "goals", scope: "total", comparator: "under", threshold: 3.5 },
    { metric: "goals", scope: "home_margin", comparator: "over", threshold: 1.5 },
    { metric: "yellow_cards", scope: "total", comparator: "over", threshold: 4.5 },
    { metric: "goals", scope: "away", comparator: "exactly", threshold: 3 },
  ];
  for (const c of conditions) {
    const p = compilePredicate(c, sides);
    console.log(`  "${describeCondition(c, sides)}"  ->  keys ${predicateStatKeys(p).join("+")}, ` +
      `op ${p.op ? Object.keys(p.op)[0] : "none"}, ${Object.keys(p.comparison)[0]} ${p.threshold}`);
  }
}

async function checkSettleBuilder() {
  console.log("\n=== SETTLE-TX BUILDER (size guard) ===");
  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const program = makeVerdictProgram(connection);

  // A stand-in market for the demo fixture (only the fields the builder reads matter).
  const creator = loadKeypair(".keys/creator.json").publicKey;
  const taker = loadKeypair(".keys/taker.json").publicKey;
  const mint = new PublicKey(mintInfo.mint);
  const seed = new BN(1);
  const predicate = compilePredicate({ metric: "corners", scope: "total", comparator: "over", threshold: 9.5 }, sides);
  const market: MarketAccount = {
    creator, taker, mint,
    vault: vaultPda(marketPda(creator, seed), mint),
    seed, fixtureId: new BN(demo.fixtureId), stake: new BN(1_000_000),
    settleAfterMs: new BN(demo.startTime), expiryUnix: new BN(0),
    predicate, status: "active", outcome: null, bump: 0,
  };

  const built = await buildSettleTx({
    program,
    market,
    proof: proofs.v2CornersFinal,
    settler: taker,
    creatorTokenAccount: getAssociatedTokenAddressSync(mint, creator),
    takerTokenAccount: getAssociatedTokenAddressSync(mint, taker),
  });
  console.log(`  assembled settle tx: ${built.sizeBytes} bytes (cap 1232, headroom ${1232 - built.sizeBytes})`);
  console.log(`  proof depth (nodes): ${proofDepth(proofs.v2CornersFinal)}`);
  if (built.sizeBytes >= 1232) throw new Error("size guard should have thrown");
  console.log("  OK — fits single transaction");
}

async function checkSeqChooser() {
  console.log("\n=== SHALLOWEST-SEQ CHOOSER ===");
  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const auth = new TxLineAuth(connection, loadKeypair(".keys/deployer.json"));
  const client = new TxLineClient(auth);
  const predicate = compilePredicate({ metric: "corners", scope: "total", comparator: "over", threshold: 9.5 }, sides);
  // The final record is the only game_finalised seq; the chooser confirms it's provable and
  // reports its depth. (Exercises the real ranking path with the genuine candidate.)
  const choices = await chooseFinalSeq(client, demo.fixtureId, [demo.finalSeq], predicate);
  for (const ch of choices) console.log(`  seq ${ch.seq}: depth ${ch.depth} nodes -> ${ch.depth <= 20 ? "shallow" : "deep"}`);
  if (choices.length === 0) throw new Error("expected the final seq to be a valid choice");
  console.log(`  chosen seq: ${choices[0].seq} (shallowest of ${choices.length})`);
}

async function main() {
  checkPredicates();
  await checkSettleBuilder();
  await checkSeqChooser();
  console.log("\nSDK verify OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
