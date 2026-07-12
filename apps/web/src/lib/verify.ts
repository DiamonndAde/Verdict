import { PublicKey } from "@solana/web3.js";
import {
  buildV2Payload,
  computeBudgetIx,
  dailyScoresPdaFromTs,
  makeTxoracleProgram,
} from "@verdict/sdk/txoracle";
import type { StatValidationV2 } from "@verdict/sdk/types";
import type { StoredPredicate } from "@verdict/sdk/verdict";
import { connection, demoCreator } from "./solana";

/** One node in the Merkle path, shown as a hop in the verification cascade. */
export interface CascadeNode {
  id: string;
  label: string;
  sublabel: string;
  hashHex: string;
  /** Number of intermediate sibling hashes folded to reach the next node. */
  hops: number;
}

function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(value: string | number[]): string {
  let b: Uint8Array;
  if (typeof value === "string") {
    b = value.length === 64 && /^[0-9a-fA-F]+$/.test(value) ? hexToBytes(value) : b64ToBytes(value);
  } else {
    b = Uint8Array.from(value);
  }
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Extracts the leaf → daily-root path from a proof for the cascade. The animation is a
 * faithful visualisation of exactly what the on-chain `validate_stat_v2` folds: the stat
 * leaf, up through the event-stat root and the fixture sub-tree root, to the on-chain daily
 * scores root.
 */
export function buildCascade(proof: StatValidationV2, statLabel: string): CascadeNode[] {
  const statHops = proof.statProofs.reduce((n, p) => n + p.length, 0);
  // The leaf's on-wire preimage: each proven stat's {key, value, period} as LE i32s. Distinct
  // from the event-stat root it folds up into, and it's exactly what tampering a value alters.
  const leafBytes = proof.statsToProve.flatMap((s) =>
    [s.key, s.value, s.period].flatMap((n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]),
  );
  return [
    {
      id: "leaf",
      label: "Stat leaf",
      sublabel: statLabel,
      hashHex: toHex(leafBytes),
      hops: 0,
    },
    {
      id: "event",
      label: "Event-stat root",
      sublabel: `${statHops} sibling ${statHops === 1 ? "hash" : "hashes"} folded`,
      hashHex: toHex(proof.eventStatRoot),
      hops: statHops,
    },
    {
      id: "subtree",
      label: "Fixture sub-tree root",
      sublabel: `${proof.subTreeProof.length} hops`,
      hashHex: toHex(proof.summary.eventStatsSubTreeRoot),
      hops: proof.subTreeProof.length,
    },
    {
      id: "daily",
      label: "Daily scores root",
      sublabel: "on-chain · TxLINE oracle",
      hashHex: toHex(Array.from(dailyScoresPdaFromTs(proof.summary.updateStats.minTimestamp).toBytes())),
      hops: proof.mainTreeProof.length,
    },
  ];
}

/** The oracle strategy for a stored predicate — mirrors the program's `Predicate::to_strategy`. */
function strategyFromPredicate(p: StoredPredicate) {
  const predicate = { threshold: p.threshold, comparison: p.comparison };
  const discrete =
    p.stat2Key != null && p.op != null
      ? [{ binary: { indexA: 0, indexB: 1, op: p.op, predicate } }]
      : [{ single: { index: 0, predicate } }];
  return { geometricTargets: [], distancePredicate: null, discretePredicates: discrete };
}

export interface VerifyResult {
  ok: boolean;
  /** The oracle's boolean verdict (only meaningful when ok). */
  predicateHolds?: boolean;
  errorName?: string;
}

/**
 * Re-runs `validate_stat_v2` read-only against the live TxLINE oracle on devnet — the same
 * check the settle transaction performed, re-derivable by anyone. Returns `ok:false` with the
 * oracle's error name when the proof does not verify (the fraud path).
 */
export async function reVerifyOnChain(proof: StatValidationV2, predicate: StoredPredicate): Promise<VerifyResult> {
  // `.view()` simulates a transaction, which needs an existing, funded fee payer — a fresh
  // random keypair (0 lamports) makes the simulation fail before the oracle even runs. The
  // funded demo signer stands in as the read-only payer.
  const program = makeTxoracleProgram(connection, demoCreator);
  const pda = dailyScoresPdaFromTs(proof.summary.updateStats.minTimestamp);
  try {
    const holds = (await program.methods
      .validateStatV2(buildV2Payload(proof) as never, strategyFromPredicate(predicate) as never)
      .accounts({ dailyScoresMerkleRoots: pda as PublicKey })
      .preInstructions([computeBudgetIx()])
      .view()) as boolean;
    return { ok: true, predicateHolds: holds };
  } catch (err) {
    const m = /Error Code: (\w+)|custom program error: (0x\w+)/.exec(String(err));
    return { ok: false, errorName: m?.[1] ?? m?.[2] ?? "InvalidStatProof" };
  }
}

/** The exact tamper the demo/tests use: flip a proven stat value, breaking the leaf hash. */
export function tamperProof(proof: StatValidationV2): StatValidationV2 {
  const copy = JSON.parse(JSON.stringify(proof)) as StatValidationV2;
  copy.statsToProve[0].value += 3;
  return copy;
}
