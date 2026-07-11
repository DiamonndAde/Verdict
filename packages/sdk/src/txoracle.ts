import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DAY_MS } from "./config.js";
import type {
  ApiProofNode,
  ScoresBatchSummaryApi,
  StatValidationLegacy,
  StatValidationV2,
  StatValidationV3,
} from "./types.js";
import type { Txoracle } from "./txline/txoracle.js";
import txoracleIdl from "./txline/txoracle.json" with { type: "json" };

export const TXORACLE_PROGRAM_ID = new PublicKey((txoracleIdl as { address: string }).address);

/** validateStat* needs a raised compute limit (docs: onchain-validation). */
export const VALIDATE_COMPUTE_UNITS = 1_400_000;

export const computeBudgetIx = () =>
  ComputeBudgetProgram.setComputeUnitLimit({ units: VALIDATE_COMPUTE_UNITS });

/** Anchor Program handle for the txoracle devnet IDL, bound to the given wallet. */
export function makeTxoracleProgram(connection: Connection, wallet: Keypair): Program<Txoracle> {
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    anchor.AnchorProvider.defaultOptions(),
  );
  return new Program<Txoracle>(txoracleIdl as unknown as Txoracle, provider);
}

/**
 * Epoch day must come from the proof's own timestamp (summary.updateStats.minTimestamp),
 * never Date.now() — the daily root PDA is keyed by the day the data belongs to.
 */
export function epochDayFromTs(tsMs: number): number {
  const epochDay = Math.floor(tsMs / DAY_MS);
  if (!Number.isSafeInteger(tsMs) || tsMs < 0 || epochDay > 0xffff) {
    throw new Error(`Timestamp out of range for u16 epoch day: ${tsMs}`);
  }
  return epochDay;
}

export function dailyScoresPdaFromTs(tsMs: number): PublicKey {
  const epochDay = epochDayFromTs(tsMs);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXORACLE_PROGRAM_ID,
  )[0];
}

/** Decode a hash that may arrive as hex (64 chars), base64, or a raw byte array. */
export function toBytes32(value: string | number[] | Uint8Array): number[] {
  let bytes: Uint8Array;
  if (typeof value === "string") {
    bytes = value.startsWith("0x")
      ? Buffer.from(value.slice(2), "hex")
      : value.length === 64 && /^[0-9a-fA-F]+$/.test(value)
        ? Buffer.from(value, "hex")
        : Buffer.from(value, "base64");
  } else {
    bytes = Uint8Array.from(value);
  }
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, got ${bytes.length}`);
  }
  return Array.from(bytes);
}

export interface ProofNode {
  hash: number[];
  isRightSibling: boolean;
}

export function mapProof(nodes: ApiProofNode[] | undefined): ProofNode[] {
  return (nodes ?? []).map((n) => ({
    hash: toBytes32(n.hash),
    isRightSibling: n.isRightSibling ?? false,
  }));
}

export interface FixtureSummaryArg {
  fixtureId: BN;
  updateStats: { updateCount: number; minTimestamp: BN; maxTimestamp: BN };
  eventsSubTreeRoot: number[];
}

export function mapSummary(summary: ScoresBatchSummaryApi): FixtureSummaryArg {
  return {
    fixtureId: new BN(summary.fixtureId),
    updateStats: {
      updateCount: summary.updateStats.updateCount,
      minTimestamp: new BN(summary.updateStats.minTimestamp),
      maxTimestamp: new BN(summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes32(summary.eventStatsSubTreeRoot),
  };
}

export interface TraderPredicate {
  threshold: number;
  comparison: { greaterThan: object } | { lessThan: object } | { equalTo: object };
}

export type BinaryOp = { add: object } | { subtract: object };

/** Arguments for legacy `validateStat`, minus the predicate/op (supplied by the caller). */
export function buildLegacyStatArgs(v: StatValidationLegacy) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: mapSummary(v.summary),
    fixtureProof: mapProof(v.subTreeProof),
    mainTreeProof: mapProof(v.mainTreeProof),
    statA: {
      statToProve: v.statToProve,
      eventStatRoot: toBytes32(v.eventStatRoot),
      statProof: mapProof(v.statProof),
    },
    statB: v.statToProve2
      ? {
          statToProve: v.statToProve2,
          eventStatRoot: toBytes32(v.eventStatRoot),
          statProof: mapProof(v.statProof2 ?? []),
        }
      : null,
  };
}

/** Payload for `validateStatV2` (strategy supplied by the caller). */
export function buildV2Payload(v: StatValidationV2) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: mapSummary(v.summary),
    fixtureProof: mapProof(v.subTreeProof),
    mainTreeProof: mapProof(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    stats: v.statsToProve.map((stat, i) => ({
      stat,
      statProof: mapProof(v.statProofs[i]),
    })),
  };
}

/** Payload for `validateStatV3` (multiproof; strategy supplied by the caller). */
export function buildV3Payload(v: StatValidationV3) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: mapSummary(v.summary),
    fixtureProof: mapProof(v.subTreeProof),
    mainTreeProof: mapProof(v.mainTreeProof),
    eventStatRoot: toBytes32(v.eventStatRoot),
    leaves: v.statsToProve.map((l) => ({
      stat: l.stat,
      statProof: mapProof(l.statProof),
    })),
    multiproofHashes: mapProof(v.multiproof.hashes),
    leafIndices: v.multiproof.indices,
  };
}
