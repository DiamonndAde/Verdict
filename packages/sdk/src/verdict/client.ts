import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { StoredPredicate } from "./predicate.js";
import verdictIdl from "./verdict.json" with { type: "json" };

export const VERDICT_PROGRAM_ID = new PublicKey((verdictIdl as { address: string }).address);
export const MARKET_SEED = Buffer.from("market");

export type MarketStatus = "open" | "active" | "settled" | "cancelled" | "refunded";

export interface MarketAccount {
  creator: PublicKey;
  taker: PublicKey | null;
  mint: PublicKey;
  vault: PublicKey;
  seed: BN;
  fixtureId: BN;
  stake: BN;
  settleAfterMs: BN;
  expiryUnix: BN;
  predicate: StoredPredicate;
  status: MarketStatus;
  outcome: MarketOutcome | null;
  bump: number;
}

export interface MarketOutcome {
  winner: PublicKey;
  predicateResult: boolean;
  stat1Value: number;
  stat2Value: number | null;
  proofMaxTs: BN;
  settledAtUnix: BN;
  payout: BN;
}

/** Anchor Program for verdict. Pass a real provider to send; a read-only one to just build. */
export function makeVerdictProgram(connection: Connection, wallet?: Keypair): Program {
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet ?? Keypair.generate()),
    anchor.AnchorProvider.defaultOptions(),
  );
  return new Program(verdictIdl as anchor.Idl, provider);
}

export function marketPda(creator: PublicKey, seed: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, creator.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    VERDICT_PROGRAM_ID,
  )[0];
}

export function vaultPda(market: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, market, true);
}

/** Normalises Anchor's `{ open: {} }` enum decoding to a plain string. */
function statusName(raw: Record<string, unknown>): MarketStatus {
  return Object.keys(raw)[0] as MarketStatus;
}

export function decodeMarket(program: Program, data: Buffer): MarketAccount {
  const m = program.coder.accounts.decode("market", data) as Record<string, any>;
  return {
    creator: m.creator,
    taker: m.taker ?? null,
    mint: m.mint,
    vault: m.vault,
    seed: m.seed,
    fixtureId: m.fixtureId,
    stake: m.stake,
    settleAfterMs: m.settleAfterMs,
    expiryUnix: m.expiryUnix,
    predicate: {
      stat1Key: m.predicate.stat1Key,
      stat2Key: m.predicate.stat2Key ?? null,
      op: m.predicate.op ?? null,
      threshold: m.predicate.threshold,
      comparison: m.predicate.comparison,
    },
    status: statusName(m.status),
    outcome: m.outcome
      ? {
          winner: m.outcome.winner,
          predicateResult: m.outcome.predicateResult,
          stat1Value: m.outcome.stat1Value,
          stat2Value: m.outcome.stat2Value ?? null,
          proofMaxTs: m.outcome.proofMaxTs,
          settledAtUnix: m.outcome.settledAtUnix,
          payout: m.outcome.payout,
        }
      : null,
    bump: m.bump,
  };
}

export async function fetchMarket(program: Program, market: PublicKey): Promise<MarketAccount | null> {
  const info = await program.provider.connection.getAccountInfo(market);
  if (!info) return null;
  return decodeMarket(program, info.data);
}

export interface CreateMarketParams {
  creator: PublicKey;
  seed: BN;
  fixtureId: number | BN;
  stake: BN;
  predicate: StoredPredicate;
  settleAfterMs: number | BN;
  expiryUnix: number | BN;
  mint: PublicKey;
  creatorTokenAccount: PublicKey;
}

export function createMarketIx(program: Program, p: CreateMarketParams) {
  const market = marketPda(p.creator, p.seed);
  return program.methods
    .createMarket(p.seed, new BN(p.fixtureId), p.stake, p.predicate, new BN(p.settleAfterMs), new BN(p.expiryUnix))
    .accounts({
      creator: p.creator,
      market,
      mint: p.mint,
      vault: vaultPda(market, p.mint),
      creatorTokenAccount: p.creatorTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export function acceptMarketIx(program: Program, args: { taker: PublicKey; market: PublicKey; mint: PublicKey; takerTokenAccount: PublicKey }) {
  return program.methods
    .acceptMarket()
    .accounts({
      taker: args.taker,
      market: args.market,
      vault: vaultPda(args.market, args.mint),
      takerTokenAccount: args.takerTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export function cancelMarketIx(program: Program, args: { creator: PublicKey; market: PublicKey; mint: PublicKey; creatorTokenAccount: PublicKey }) {
  return program.methods
    .cancelMarket()
    .accounts({
      creator: args.creator,
      market: args.market,
      vault: vaultPda(args.market, args.mint),
      creatorTokenAccount: args.creatorTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export function refundExpiredIx(
  program: Program,
  args: { caller: PublicKey; market: PublicKey; mint: PublicKey; creatorTokenAccount: PublicKey; takerTokenAccount: PublicKey },
) {
  return program.methods
    .refundExpired()
    .accounts({
      caller: args.caller,
      market: args.market,
      vault: vaultPda(args.market, args.mint),
      creatorTokenAccount: args.creatorTokenAccount,
      takerTokenAccount: args.takerTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}
