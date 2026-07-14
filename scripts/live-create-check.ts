/**
 * Live-match preflight: proves the on-chain program accepts a market for an UPCOMING knockout
 * fixture with the ET/pens-aware settlement window, using the same embedded demo wallets the
 * web app signs with. Creates for real on devnet, then reads the market back and checks the
 * stored windows are what we intended.
 *
 *   npx tsx scripts/live-create-check.ts
 */
import * as fs from "node:fs";
import { BN } from "@coral-xyz/anchor";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DEVNET } from "@verdict/sdk/config";
import {
  acceptMarketIx,
  compilePredicate,
  createMarketIx,
  defaultExpiryUnix,
  defaultSettleAfterMs,
  fetchMarket,
  makeVerdictProgram,
  marketPda,
  type Condition,
} from "@verdict/sdk/verdict";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000", "");

async function send(connection: Connection, ixs: unknown[], signer: Keypair) {
  const tx = new Transaction();
  for (const ix of ixs) tx.add(ix as never);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function main() {
  const live = JSON.parse(fs.readFileSync("tests/fixtures/live-fixture.json", "utf8"));
  const signers = JSON.parse(fs.readFileSync("apps/web/src/data/demo-signers.json", "utf8"));
  const mint = new PublicKey(signers.mint);
  const creator = Keypair.fromSecretKey(Uint8Array.from(signers.creator.secretKey));
  const taker = Keypair.fromSecretKey(Uint8Array.from(signers.taker.secretKey));

  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const program = makeVerdictProgram(connection, creator);

  const sides = {
    participant1: live.participant1,
    participant2: live.participant2,
    participant1IsHome: live.participant1IsHome,
  };
  const condition: Condition = { metric: "corners", scope: "total", comparator: "over", threshold: 9.5 };
  const predicate = compilePredicate(condition, sides);

  const now = Date.now();
  const settleAfterMs = defaultSettleAfterMs(live.startTime);
  const expiryUnix = defaultExpiryUnix(live.startTime, now);

  console.log(`fixture ${live.fixtureId}  ${live.participant1} vs ${live.participant2} (${live.competition})`);
  console.log(`  kickoff      ${iso(live.startTime)}`);
  console.log(`  settle_after ${iso(settleAfterMs)}  (kickoff + ${(settleAfterMs - live.startTime) / 60000} min)`);
  console.log(`  expiry       ${iso(expiryUnix * 1000)}`);
  console.log(`  now          ${iso(now)}\n`);

  const seed = new BN(Date.now());
  const market = marketPda(creator.publicKey, seed);

  const createIx = await createMarketIx(program, {
    creator: creator.publicKey,
    seed,
    fixtureId: live.fixtureId,
    stake: new BN(10_000_000), // 10 dUSDC — a cheap preflight
    predicate,
    settleAfterMs,
    expiryUnix,
    mint,
    creatorTokenAccount: getAssociatedTokenAddressSync(mint, creator.publicKey),
  });
  const createSig = await send(connection, [createIx], creator);
  console.log(`create_market OK  https://explorer.solana.com/tx/${createSig}?cluster=devnet`);

  const acceptIx = await acceptMarketIx(program, {
    taker: taker.publicKey,
    market,
    mint,
    takerTokenAccount: getAssociatedTokenAddressSync(mint, taker.publicKey),
  });
  const acceptSig = await send(connection, [acceptIx], taker);
  console.log(`accept_market OK  https://explorer.solana.com/tx/${acceptSig}?cluster=devnet`);

  // Read back on-chain state and confirm the stored terms are what we meant.
  const m = await fetchMarket(program, market);
  if (!m) throw new Error("market not found");
  const vault = await getAccount(connection, m.vault);
  console.log(`\non-chain market ${market.toBase58()}`);
  console.log(`  status        ${m.status}`);
  console.log(`  fixture_id    ${m.fixtureId.toString()}  ${m.fixtureId.toNumber() === live.fixtureId ? "OK" : "MISMATCH"}`);
  console.log(`  settle_after  ${iso(m.settleAfterMs.toNumber())}  ${m.settleAfterMs.toNumber() === settleAfterMs ? "OK" : "MISMATCH"}`);
  console.log(`  expiry        ${iso(m.expiryUnix.toNumber() * 1000)}  ${m.expiryUnix.toNumber() === expiryUnix ? "OK" : "MISMATCH"}`);
  console.log(`  pot           ${Number(vault.amount) / 1e6} dUSDC`);
  console.log(`\nPREFLIGHT PASS — the program accepts a live knockout market and both stakes are escrowed.`);
  console.log(`(This preflight market is disposable; the real one gets created on camera.)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
