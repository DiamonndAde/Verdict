/**
 * End-to-end demo on the chosen completed fixture, live on devnet. This is the demo-video
 * spine: create -> accept -> settle by real TxLINE proof -> payout, then a fraud attempt
 * that fails on-chain.
 *
 *   npx tsx scripts/demo.ts
 *
 * Requires: verdict deployed, dUSDC minted (npm run setup-dusdc), proofs recorded
 * (npm run record-proofs), wallets funded (npm run setup-wallets).
 */
import * as fs from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { TxLineAuth, loadKeypair } from "@verdict/sdk/auth";
import { TxLineClient } from "@verdict/sdk/api";
import { DEVNET } from "@verdict/sdk/config";
import {
  acceptMarketIx,
  buildSettleTx,
  compilePredicate,
  createMarketIx,
  decodeMarket,
  describeCondition,
  defaultExpiryUnix,
  defaultSettleAfterMs,
  fetchMarket,
  makeVerdictProgram,
  marketPda,
  settleInputFromV2,
  vaultPda,
  type Condition,
  type FixtureSides,
} from "@verdict/sdk/verdict";
import { dailyScoresPdaFromTs, TXORACLE_PROGRAM_ID } from "@verdict/sdk/txoracle";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const log = (s = "") => console.log(s);
const step = (n: number, s: string) => console.log(`\n\x1b[1;32m[${n}]\x1b[0m ${s}`);
const dusdc = (raw: bigint | BN) => (Number(raw.toString()) / 1e6).toFixed(2);

async function main() {
  const demo = JSON.parse(fs.readFileSync("tests/fixtures/demo-fixture.json", "utf8"));
  const proofs = JSON.parse(fs.readFileSync("tests/fixtures/proofs.json", "utf8"));
  const mintInfo = JSON.parse(fs.readFileSync("tests/fixtures/dusdc-mint.json", "utf8"));
  const mint = new PublicKey(mintInfo.mint);

  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const creator = loadKeypair(".keys/creator.json");
  const taker = loadKeypair(".keys/taker.json");
  const program = makeVerdictProgram(connection, creator);

  const sides: FixtureSides = {
    participant1: demo.participant1,
    participant2: demo.participant2,
    participant1IsHome: demo.participant1IsHome,
  };
  const home = sides.participant1IsHome ? sides.participant1 : sides.participant2;
  const away = sides.participant1IsHome ? sides.participant2 : sides.participant1;

  log("\x1b[1m════════════════════════════════════════════════════════════\x1b[0m");
  log(`\x1b[1m  VERDICT — ${home} vs ${away}\x1b[0m  (fixture ${demo.fixtureId})`);
  log(`  final score ${demo.goals}, ${demo.corners} corners — settled by cryptographic proof`);
  log("\x1b[1m════════════════════════════════════════════════════════════\x1b[0m");

  // The challenge: creator bets total corners over 9.5 (they were 14 — creator should win).
  const condition: Condition = { metric: "corners", scope: "total", comparator: "over", threshold: 9.5 };
  const predicate = compilePredicate(condition, sides);
  const seed = new BN(Date.now());
  const stake = new BN(100_000_000); // 100 dUSDC
  const market = marketPda(creator.publicKey, seed);
  const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
  const takerAta = getAssociatedTokenAddressSync(mint, taker.publicKey);

  step(1, `${creator.publicKey.toBase58().slice(0, 8)}… creates a challenge`);
  log(`    "${describeCondition(condition, sides)}"  —  stake ${dusdc(stake)} dUSDC`);
  log(`    creator wins if TRUE; taker wins if FALSE. Terms are stored on-chain and immutable.`);
  {
    const ix = await createMarketIx(program, {
      creator: creator.publicKey, seed, fixtureId: demo.fixtureId, stake, predicate,
      settleAfterMs: defaultSettleAfterMs(demo.startTime), expiryUnix: defaultExpiryUnix(demo.startTime),
      mint, creatorTokenAccount: creatorAta,
    });
    await sendTx(connection, [ix], [creator]);
  }
  await printMarket(program, market);

  step(2, `${taker.publicKey.toBase58().slice(0, 8)}… accepts — escrows an equal stake`);
  {
    const ix = await acceptMarketIx(program, { taker: taker.publicKey, market, mint, takerTokenAccount: takerAta });
    await sendTx(connection, [ix], [taker]);
  }
  const vault = vaultPda(market, mint);
  log(`    pot is now ${dusdc((await getAccount(connection, vault)).amount)} dUSDC, held by the market PDA (no admin key)`);

  step(3, `Anyone settles with the TxLINE proof of the final result`);
  const proof = proofs.v2CornersFinal;
  const provenCorners = proof.statsToProve.reduce((s: number, x: any) => s + x.value, 0);
  log(`    proven: ${away === sides.participant2 ? sides.participant1 : sides.participant2} corners ` +
    `${proof.statsToProve.map((s: any) => s.value).join(" + ")} = ${provenCorners}, from the game_finalised record (period 100)`);
  const cBefore = (await getAccount(connection, creatorAta)).amount;
  {
    const marketAcc = await fetchMarket(program, market);
    if (!marketAcc) throw new Error("market vanished");
    const built = await buildSettleTx({
      program, market: marketAcc, proof, settler: taker.publicKey,
      creatorTokenAccount: creatorAta, takerTokenAccount: takerAta,
    });
    log(`    settle tx assembled: ${built.sizeBytes} bytes (single transaction, cap 1232)`);
    built.transaction.message.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const tx = new VersionedTransaction(built.transaction.message);
    tx.sign([taker]);
    const sig = await connection.sendTransaction(tx);
    await connection.confirmTransaction(sig, "confirmed");
    log(`    \x1b[32m✓ settled\x1b[0m  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }

  const settled = await fetchMarket(program, market);
  const cAfter = (await getAccount(connection, creatorAta)).amount;
  log(`    winner: ${settled!.outcome!.winner.equals(creator.publicKey) ? "CREATOR" : "TAKER"} ` +
    `(predicate ${settled!.outcome!.predicateResult ? "TRUE" : "FALSE"})`);
  log(`    creator received ${dusdc(cAfter - cBefore)} dUSDC — the full pot`);

  step(4, `Fraud attempt: settle a DIFFERENT market with a tampered proof`);
  await fraudDemo(connection, program, creator, taker, mint, demo, proofs, sides);

  log("\n\x1b[1;32mDemo complete.\x1b[0m The chain — not a bookie — decided the outcome.");
}

async function fraudDemo(
  connection: Connection, program: any, creator: Keypair, taker: Keypair,
  mint: PublicKey, demo: any, proofs: any, sides: FixtureSides,
) {
  const condition: Condition = { metric: "corners", scope: "total", comparator: "over", threshold: 9.5 };
  const predicate = compilePredicate(condition, sides);
  const seed = new BN(Date.now() + 1);
  const stake = new BN(50_000_000);
  const market = marketPda(creator.publicKey, seed);
  const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
  const takerAta = getAssociatedTokenAddressSync(mint, taker.publicKey);

  const create = await createMarketIx(program, {
    creator: creator.publicKey, seed, fixtureId: demo.fixtureId, stake, predicate,
    settleAfterMs: defaultSettleAfterMs(demo.startTime), expiryUnix: defaultExpiryUnix(demo.startTime),
    mint, creatorTokenAccount: creatorAta,
  });
  await sendTx(connection, [create], [creator]);
  const accept = await acceptMarketIx(program, { taker: taker.publicKey, market, mint, takerTokenAccount: takerAta });
  await sendTx(connection, [accept], [taker]);

  // Tamper: flip a proven corner value. The Merkle leaf hash no longer matches -> oracle rejects.
  const tampered = JSON.parse(JSON.stringify(proofs.v2CornersFinal));
  tampered.statsToProve[0].value += 3;
  log(`    forging: claim ${sides.participant1} had ${tampered.statsToProve[0].value} corners (really ${proofs.v2CornersFinal.statsToProve[0].value})`);

  const marketAcc = await fetchMarket(program, market);
  const built = await buildSettleTx({
    program, market: marketAcc!, proof: tampered, settler: taker.publicKey,
    creatorTokenAccount: creatorAta, takerTokenAccount: takerAta,
  });
  built.transaction.message.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const tx = new VersionedTransaction(built.transaction.message);
  tx.sign([taker]);
  try {
    const sig = await connection.sendTransaction(tx);
    await connection.confirmTransaction(sig, "confirmed");
    log(`    \x1b[31m✗ UNEXPECTED: forged settle succeeded (${sig}) — this should never happen\x1b[0m`);
  } catch (err) {
    const msg = String((err as any)?.transactionLogs?.join("\n") ?? err);
    const oracleErr = /Error Code: (\w+)|custom program error: (0x\w+)/.exec(msg);
    log(`    \x1b[32m✓ REJECTED ON-CHAIN\x1b[0m — the oracle's Merkle check failed ` +
      `(${oracleErr?.[1] ?? oracleErr?.[2] ?? "proof invalid"}). The pot is untouched.`);
  }
}

async function sendTx(connection: Connection, ixs: any[], signers: Keypair[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function printMarket(program: any, market: PublicKey) {
  const m = await fetchMarket(program, market);
  log(`    market ${market.toBase58().slice(0, 8)}… status=${m!.status}, fixture ${m!.fixtureId.toString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
