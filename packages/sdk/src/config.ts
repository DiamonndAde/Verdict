/**
 * TxLINE devnet integration values.
 * Verified 2026-07-11 against https://txline.txodds.com/documentation/programs/devnet
 * and the devnet IDL (txoracle v1.5.6) in txodds/tx-on-chain.
 */
export const DEVNET = {
  rpcUrl: "https://api.devnet.solana.com",
  txlineOrigin: "https://txline-dev.txodds.com",
  txoracleProgramId: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
  txlMint: "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
  /** Free bundle: World Cup + International Friendlies. */
  serviceLevelId: 1,
  /** Must be a multiple of 4 (program error 6041 InvalidWeeks otherwise). */
  subscriptionWeeks: 4,
} as const;

export const apiBase = (origin: string): string => `${origin}/api`;

/** Milliseconds in one epoch day; epochDay = floor(tsMs / DAY_MS). */
export const DAY_MS = 86_400_000;

/**
 * Soccer game phase IDs (docs: scores/soccer-feed).
 * F/FET/FPE are the finished phases; A/C/P never finish.
 */
export const PHASE = {
  NOT_STARTED: 1,
  H1: 2,
  HT: 3,
  H2: 4,
  FINISHED: 5,
  FINISHED_ET: 10,
  FINISHED_PENS: 13,
  ABANDONED: 15,
  CANCELLED: 16,
  POSTPONED: 19,
} as const;

/**
 * Score records with action="game_finalised" carry statusId=100 and period=100 and are
 * the canonical record for final-outcome settlement (regulation, ET, pens, abandonment).
 * The `period` field is part of the Merkle-proven ScoreStat leaf, which is what lets the
 * verdict program reject any proof taken from a non-final record.
 */
export const FINAL_PERIOD = 100;
export const GAME_FINALISED_ACTION = "game_finalised";

/**
 * Soccer stat base keys (full game). Periodised key = prefix + base, with prefixes:
 * 0=Total, 1000=H1, 2000=HT, 3000=H2, 4000=ET1, 5000=ET2, 6000=PE, 7000=ETTotal.
 */
export const STAT = {
  P1_GOALS: 1,
  P2_GOALS: 2,
  P1_YELLOWS: 3,
  P2_YELLOWS: 4,
  P1_REDS: 5,
  P2_REDS: 6,
  P1_CORNERS: 7,
  P2_CORNERS: 8,
} as const;

export const PERIOD_PREFIX = {
  TOTAL: 0,
  H1: 1000,
  HT: 2000,
  H2: 3000,
  ET1: 4000,
  ET2: 5000,
  PE: 6000,
  ET_TOTAL: 7000,
} as const;
