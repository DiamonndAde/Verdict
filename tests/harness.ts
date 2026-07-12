/**
 * Shared LiteSVM test harness for the verdict program.
 *
 * Each `freshEnv()` boots an isolated in-process VM with:
 *   - the verdict program (built .so)
 *   - the REAL TxLINE txoracle program (dumped from devnet)
 *   - the REAL daily_scores_roots account(s) (dumped from devnet)
 *   - a fresh dUSDC mint and funded creator/taker token accounts
 *
 * so the recorded Merkle proofs verify against genuine oracle state, entirely offline.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import type { StatValidationLegacy, StatValidationV2 } from "@verdict/sdk/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const fx = (p: string) => path.join(ROOT, "tests/fixtures", p);

/** Prefer a fresh local build; fall back to the committed fixture so CI needs no Anchor. */
function firstExisting(...candidates: string[]): string {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`none of these paths exist:\n  ${candidates.join("\n  ")}`);
}
const VERDICT_SO = firstExisting(path.join(ROOT, "target/deploy/verdict.so"), fx("verdict.so"));
const VERDICT_IDL_PATH = firstExisting(path.join(ROOT, "target/idl/verdict.json"), fx("verdict-idl.json"));

export const VERDICT_PROGRAM_ID = new PublicKey("GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e");
export const TXORACLE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
export const MARKET_SEED = Buffer.from("market");
export const DAILY_SCORES_ROOTS_SEED = Buffer.from("daily_scores_roots");
export const DECIMALS = 6;
export const DUSDC = (n: number) => new BN(n).mul(new BN(10).pow(new BN(DECIMALS)));

const verdictIdl = JSON.parse(fs.readFileSync(VERDICT_IDL_PATH, "utf8"));

/** Anchor Program used purely as an instruction builder (never touches the network). */
export function verdictProgram(): Program {
  const provider = new AnchorProvider(
    new Connection("http://127.0.0.1:8899"),
    new Wallet(Keypair.generate()),
    { commitment: "processed" },
  );
  return new Program(verdictIdl, provider);
}

export interface Env {
  svm: LiteSVM;
  program: Program;
  payer: Keypair;
  creator: Keypair;
  taker: Keypair;
  stranger: Keypair;
  mint: PublicKey;
  creatorAta: PublicKey;
  takerAta: PublicKey;
}

function fundedKeypair(svm: LiteSVM): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(100 * 1e9));
  return kp;
}

/** Boots a fresh, isolated VM with programs, oracle state, mint and funded parties. */
export function freshEnv(): Env {
  const svm = new LiteSVM();
  svm.addProgramFromFile(VERDICT_PROGRAM_ID, VERDICT_SO);
  svm.addProgramFromFile(TXORACLE_PROGRAM_ID, fx("txoracle.so"));

  // Load every dumped daily_scores_roots account.
  const rootsDir = fx("roots");
  for (const file of fs.readdirSync(rootsDir)) {
    if (!file.endsWith(".json") || file === "manifest.json") continue;
    const snap = JSON.parse(fs.readFileSync(path.join(rootsDir, file), "utf8"));
    svm.setAccount(new PublicKey(snap.pubkey), {
      lamports: Number(snap.account.lamports),
      data: Buffer.from(snap.account.data[0], "base64"),
      owner: new PublicKey(snap.account.owner),
      executable: snap.account.executable,
      // Dumped accounts carry rentEpoch = u64::MAX, which overflows LiteSVM's u64 bridge and
      // is irrelevant to Merkle verification — reset it.
      rentEpoch: 0,
    });
  }

  const payer = fundedKeypair(svm);
  const creator = fundedKeypair(svm);
  const taker = fundedKeypair(svm);
  const stranger = fundedKeypair(svm);

  // Create the dUSDC mint via the real token program.
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint,
      lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint, DECIMALS, payer.publicKey, null),
  );
  sendOk(svm, createMintTx, [payer, mintKp]);

  const creatorAta = getAssociatedTokenAddressSync(mint, creator.publicKey);
  const takerAta = getAssociatedTokenAddressSync(mint, taker.publicKey);
  const fundTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, creatorAta, creator.publicKey, mint),
    createAssociatedTokenAccountInstruction(payer.publicKey, takerAta, taker.publicKey, mint),
    createMintToInstruction(mint, creatorAta, payer.publicKey, BigInt(DUSDC(10_000).toString())),
    createMintToInstruction(mint, takerAta, payer.publicKey, BigInt(DUSDC(10_000).toString())),
  );
  sendOk(svm, fundTx, [payer]);

  return { svm, program: verdictProgram(), payer, creator, taker, stranger, mint, creatorAta, takerAta };
}

// ---------------------------------------------------------------------------
// send helpers
// ---------------------------------------------------------------------------

export function send(svm: LiteSVM, tx: Transaction, signers: Keypair[]): TransactionMetadata | FailedTransactionMetadata {
  // Advance the blockhash so back-to-back transactions with identical instructions still
  // get distinct signatures (otherwise LiteSVM rejects the second as already-processed,
  // with no logs — which masks the real per-tx result the tests assert on).
  svm.expireBlockhash();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  return svm.sendTransaction(tx);
}

export function sendOk(svm: LiteSVM, tx: Transaction, signers: Keypair[]): TransactionMetadata {
  const res = send(svm, tx, signers);
  if (res instanceof FailedTransactionMetadata) {
    throw new Error(`expected success, tx failed: ${res.err()}\n${res.meta().logs().join("\n")}`);
  }
  return res;
}

export interface FailAssertion {
  /** Substring expected in the program logs (usually the Anchor error name). */
  error?: string;
}

/** Sends a tx expected to fail; asserts it failed and (optionally) names the error. */
export function sendFail(svm: LiteSVM, tx: Transaction, signers: Keypair[], expect: FailAssertion = {}): FailedTransactionMetadata {
  const res = send(svm, tx, signers);
  if (!(res instanceof FailedTransactionMetadata)) {
    throw new Error(`expected failure, but tx succeeded:\n${res.logs().join("\n")}`);
  }
  if (expect.error) {
    const logs = res.meta().logs().join("\n");
    if (!logs.includes(expect.error)) {
      throw new Error(`expected error "${expect.error}" in logs, got:\n${logs}`);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// PDA + instruction helpers
// ---------------------------------------------------------------------------

export function marketPda(creator: PublicKey, seed: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, creator.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    VERDICT_PROGRAM_ID,
  )[0];
}

export function vaultAta(market: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, market, true);
}

export function dailyScoresPda(minTimestampMs: number): PublicKey {
  const epochDay = Math.floor(minTimestampMs / 86_400_000);
  return PublicKey.findProgramAddressSync(
    [DAILY_SCORES_ROOTS_SEED, new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    TXORACLE_PROGRAM_ID,
  )[0];
}

export interface PredicateArg {
  stat1Key: number;
  stat2Key: number | null;
  op: { add: {} } | { subtract: {} } | null;
  threshold: number;
  comparison: { greaterThan: {} } | { lessThan: {} } | { equalTo: {} };
}

export interface CreateArgs {
  seed: BN;
  fixtureId: number;
  stake: BN;
  predicate: PredicateArg;
  settleAfterMs: number;
  expiryUnix: number;
}

export async function createMarketIx(env: Env, args: CreateArgs): Promise<TransactionInstruction> {
  const market = marketPda(env.creator.publicKey, args.seed);
  const vault = vaultAta(market, env.mint);
  return env.program.methods
    .createMarket(args.seed, new BN(args.fixtureId), args.stake, args.predicate, new BN(args.settleAfterMs), new BN(args.expiryUnix))
    .accounts({
      creator: env.creator.publicKey,
      market,
      mint: env.mint,
      vault,
      creatorTokenAccount: env.creatorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function acceptMarketIx(env: Env, seed: BN): Promise<TransactionInstruction> {
  const market = marketPda(env.creator.publicKey, seed);
  return env.program.methods
    .acceptMarket()
    .accounts({
      taker: env.taker.publicKey,
      market,
      vault: vaultAta(market, env.mint),
      takerTokenAccount: env.takerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** Maps a v2 stat-validation payload into the program's StatValidationInput shape. */
export function v2ToSettleInput(v: StatValidationV2) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: summaryArg(v),
    fixtureProof: mapProof(v.subTreeProof),
    mainTreeProof: mapProof(v.mainTreeProof),
    eventStatRoot: bytes32(v.eventStatRoot),
    stats: v.statsToProve.map((stat, i) => ({ stat, statProof: mapProof(v.statProofs[i]) })),
  };
}

/**
 * Maps a LEGACY payload (statToProve[/2] + statProof[/2]) into the same StatValidationInput.
 * Used for the stale-proof test, which reuses the recorded legacy mid-match fixtures as their
 * equivalent v2 payloads (same Merkle nodes, restructured into per-leaf stats).
 */
export function legacyToSettleInput(v: StatValidationLegacy) {
  const stats = [{ stat: v.statToProve, statProof: mapProof(v.statProof) }];
  if (v.statToProve2) {
    stats.push({ stat: v.statToProve2, statProof: mapProof(v.statProof2 ?? []) });
  }
  return {
    ts: new BN(v.summary.updateStats.minTimestamp),
    fixtureSummary: summaryArg(v),
    fixtureProof: mapProof(v.subTreeProof),
    mainTreeProof: mapProof(v.mainTreeProof),
    eventStatRoot: bytes32(v.eventStatRoot),
    stats,
  };
}

function summaryArg(v: StatValidationLegacy | StatValidationV2) {
  return {
    fixtureId: new BN(v.summary.fixtureId),
    updateStats: {
      updateCount: v.summary.updateStats.updateCount,
      minTimestamp: new BN(v.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(v.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: bytes32(v.summary.eventStatsSubTreeRoot),
  };
}

export function bytes32(value: string | number[]): number[] {
  let b: Buffer;
  if (typeof value === "string") {
    b = value.length === 64 && /^[0-9a-fA-F]+$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  } else {
    b = Buffer.from(value);
  }
  if (b.length !== 32) throw new Error(`expected 32 bytes, got ${b.length}`);
  return Array.from(b);
}

export function mapProof(nodes: { hash: string | number[]; isRightSibling: boolean }[] | undefined) {
  return (nodes ?? []).map((n) => ({ hash: bytes32(n.hash), isRightSibling: n.isRightSibling ?? false }));
}

export interface SettleAccounts {
  settler: Keypair;
  seed: BN;
  minTimestampMs: number;
  dailyRootsOverride?: PublicKey;
  txoracleOverride?: PublicKey;
}

export async function settleIx(env: Env, payload: unknown, acc: SettleAccounts): Promise<TransactionInstruction> {
  const market = marketPda(env.creator.publicKey, acc.seed);
  return env.program.methods
    .settle(payload)
    .accounts({
      settler: acc.settler.publicKey,
      market,
      vault: vaultAta(market, env.mint),
      creatorTokenAccount: env.creatorAta,
      takerTokenAccount: env.takerAta,
      txoracleProgram: acc.txoracleOverride ?? TXORACLE_PROGRAM_ID,
      dailyScoresRoots: acc.dailyRootsOverride ?? dailyScoresPda(acc.minTimestampMs),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export const computeIx = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

export function tokenBalance(svm: LiteSVM, ata: PublicKey): bigint {
  const acc = svm.getAccount(ata);
  if (!acc) return 0n;
  // SPL token account: amount is a u64 LE at offset 64.
  return Buffer.from(acc.data).readBigUInt64LE(64);
}

export function fetchMarket(env: Env, seed: BN) {
  const acc = env.svm.getAccount(marketPda(env.creator.publicKey, seed));
  if (!acc) throw new Error("market account not found");
  return env.program.coder.accounts.decode("market", Buffer.from(acc.data));
}

export const anchorBN = BN;
export { anchor };
