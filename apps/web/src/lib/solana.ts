import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  acceptMarketIx,
  buildSettleTx,
  createMarketIx,
  fetchMarket as sdkFetchMarket,
  makeVerdictProgram,
  marketPda,
  vaultPda,
  type CreateMarketParams,
  type MarketAccount,
  type StoredPredicate,
} from "@verdict/sdk/verdict";
import type { StatValidationV2 } from "@verdict/sdk/types";
import demoSigners from "@/data/demo-signers.json";

export const RPC_URL = "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, "confirmed");
export const DUSDC_MINT = new PublicKey(demoSigners.mint);

export { marketPda, vaultPda };
export type { MarketAccount, StoredPredicate };

/** The two devnet-only demo signers embedded for a wallet-free create/accept/settle demo. */
export const demoCreator = Keypair.fromSecretKey(Uint8Array.from(demoSigners.creator.secretKey));
export const demoTaker = Keypair.fromSecretKey(Uint8Array.from(demoSigners.taker.secretKey));

export function readonlyProgram() {
  return makeVerdictProgram(connection);
}

export function ata(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(DUSDC_MINT, owner);
}

export async function fetchMarket(market: PublicKey): Promise<MarketAccount | null> {
  return sdkFetchMarket(readonlyProgram(), market);
}

async function sendWithSigner(ixs: (Transaction | Awaited<ReturnType<typeof createMarketIx>>)[], signer: Keypair): Promise<string> {
  const tx = new Transaction();
  for (const ix of ixs) tx.add(ix as never);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

export interface CreateArgs {
  seed: BN;
  fixtureId: number;
  stake: BN;
  predicate: StoredPredicate;
  settleAfterMs: number;
  expiryUnix: number;
}

export async function createMarket(creator: Keypair, args: CreateArgs): Promise<{ sig: string; market: PublicKey }> {
  const program = makeVerdictProgram(connection, creator);
  const params: CreateMarketParams = {
    creator: creator.publicKey,
    seed: args.seed,
    fixtureId: args.fixtureId,
    stake: args.stake,
    predicate: args.predicate,
    settleAfterMs: args.settleAfterMs,
    expiryUnix: args.expiryUnix,
    mint: DUSDC_MINT,
    creatorTokenAccount: ata(creator.publicKey),
  };
  const ix = await createMarketIx(program, params);
  const sig = await sendWithSigner([ix], creator);
  return { sig, market: marketPda(creator.publicKey, args.seed) };
}

export async function acceptMarket(taker: Keypair, market: PublicKey): Promise<string> {
  const program = makeVerdictProgram(connection, taker);
  const ix = await acceptMarketIx(program, { taker: taker.publicKey, market, mint: DUSDC_MINT, takerTokenAccount: ata(taker.publicKey) });
  return sendWithSigner([ix], taker);
}

/** Assembles and sends the settle tx with a demo signer. Returns the signature. */
export async function settleMarket(settler: Keypair, marketAcc: MarketAccount, proof: StatValidationV2): Promise<string> {
  const program = makeVerdictProgram(connection, settler);
  const built = await buildSettleTx({
    program,
    market: marketAcc,
    proof,
    settler: settler.publicKey,
    creatorTokenAccount: ata(marketAcc.creator),
    takerTokenAccount: ata(marketAcc.taker!),
  });
  built.transaction.message.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const tx = new VersionedTransaction(built.transaction.message);
  tx.sign([settler]);
  const sig = await connection.sendTransaction(tx);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

export { BN };
