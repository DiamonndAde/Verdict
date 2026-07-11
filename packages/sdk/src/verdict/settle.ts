import { BN, Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TxLineClient } from "../api.js";
import type { StatValidationV2 } from "../types.js";
import { buildV2Payload, dailyScoresPdaFromTs, TXORACLE_PROGRAM_ID } from "../txoracle.js";
import { marketPda, vaultPda, type MarketAccount } from "./client.js";
import { predicateStatKeys, type StoredPredicate } from "./predicate.js";

/** Solana's hard transaction-size cap. */
export const MAX_TX_BYTES = 1232;

/** Measured on devnet: the oracle CPI needs ~200K CU; the wrapper adds a little. */
export const SETTLE_COMPUTE_UNITS = 400_000;

/**
 * The verdict program's StatValidationInput is structurally identical to the oracle's V2
 * payload, so we reuse the same mapper. The settler supplies ONLY this — never the terms.
 */
export function settleInputFromV2(v: StatValidationV2) {
  return buildV2Payload(v);
}

export interface BuildSettleParams {
  program: Program;
  market: MarketAccount;
  /** V2 stat-validation payload for the game_finalised record. */
  proof: StatValidationV2;
  settler: PublicKey;
  /** Token accounts owned by the two parties (ATAs of market.mint). */
  creatorTokenAccount: PublicKey;
  takerTokenAccount: PublicKey;
  /** Optional priority fee (micro-lamports per CU). */
  priorityFeeMicroLamports?: number;
}

export interface BuiltSettleTx {
  transaction: VersionedTransaction;
  message: TransactionMessage;
  sizeBytes: number;
  instructions: TransactionInstruction[];
}

/**
 * Assembles the settle transaction, measures the FULLY assembled size, and throws a clear
 * error if it would not fit in a single transaction. We chose a single-tx architecture after
 * measuring real proofs (docs/measurement-report.txt); this guard makes that assumption
 * self-enforcing rather than a silent failure at send time.
 */
export async function buildSettleTx(params: BuildSettleParams): Promise<BuiltSettleTx> {
  const { program, market, proof, settler } = params;
  const creator = market.creator;
  const seed = market.seed;
  const marketKey = marketPda(creator, seed);

  const minTs = proof.summary.updateStats.minTimestamp;
  const dailyRoots = dailyScoresPdaFromTs(minTs);

  const settleIx = await program.methods
    .settle(settleInputFromV2(proof))
    .accounts({
      settler,
      market: marketKey,
      vault: vaultPda(marketKey, market.mint),
      creatorTokenAccount: params.creatorTokenAccount,
      takerTokenAccount: params.takerTokenAccount,
      txoracleProgram: TXORACLE_PROGRAM_ID,
      dailyScoresRoots: dailyRoots,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLE_COMPUTE_UNITS }),
  ];
  if (params.priorityFeeMicroLamports) {
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: params.priorityFeeMicroLamports }));
  }
  instructions.push(settleIx);

  const { blockhash } = await program.provider.connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: settler, recentBlockhash: blockhash, instructions });
  const compiled = message.compileToV0Message();
  const transaction = new VersionedTransaction(compiled);

  // Serialized size of the fully assembled tx, including the (empty) signature slots that a
  // real send will fill. `serialize()` on an unsigned VersionedTransaction reserves the
  // signature bytes, so this is the true wire size.
  const sizeBytes = transaction.serialize().length;
  if (sizeBytes >= MAX_TX_BYTES) {
    throw new Error(
      `Assembled settle transaction is ${sizeBytes} bytes, at or over the ${MAX_TX_BYTES}-byte ` +
        `cap. This fixture's Merkle proof is deeper than the single-tx budget allows — the ` +
        `proof-buffer flow (init_proof_buffer/write_chunk/settle) would be required. Pick a ` +
        `shallower seq if one exists (see chooseFinalSeq), or split the proof.`,
    );
  }

  return { transaction, message, sizeBytes, instructions };
}

/** Total Merkle-node count in a proof — the driver of transaction size. */
export function proofDepth(v: StatValidationV2): number {
  const stat = v.statProofs.reduce((sum, p) => sum + p.length, 0);
  return stat + v.subTreeProof.length + v.mainTreeProof.length;
}

export interface FinalSeqChoice {
  seq: number;
  proof: StatValidationV2;
  depth: number;
}

/**
 * When more than one score record can serve as the final outcome (e.g. a game_finalised
 * record plus later corrections that also carry period 100), prefer the one whose Merkle
 * proof is shallowest — it produces the smallest, safest settle transaction.
 *
 * Fetches the V2 proof for each candidate seq, keeps only those whose leaves are all from
 * the final record (period 100), and returns them sorted shallowest-first.
 */
export async function chooseFinalSeq(
  client: TxLineClient,
  fixtureId: number,
  candidateSeqs: number[],
  predicate: StoredPredicate,
): Promise<FinalSeqChoice[]> {
  const statKeys = predicateStatKeys(predicate);
  const choices: FinalSeqChoice[] = [];
  for (const seq of candidateSeqs) {
    let proof: StatValidationV2;
    try {
      proof = await client.statValidationV2(fixtureId, seq, statKeys);
    } catch {
      continue; // seq not provable for these keys
    }
    const allFinal = proof.statsToProve.every((s) => s.period === 100);
    if (!allFinal) continue;
    choices.push({ seq, proof, depth: proofDepth(proof) });
  }
  choices.sort((a, b) => a.depth - b.depth);
  return choices;
}

export function marketKeyFor(market: MarketAccount): PublicKey {
  return marketPda(market.creator, new BN(market.seed));
}
