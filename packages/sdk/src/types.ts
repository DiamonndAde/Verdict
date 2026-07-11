/** Subset of the TxLINE OpenAPI schemas that Verdict consumes (docs/txline/openapi.yaml). */

export interface Fixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

/** One score update record. `stats` maps stat key (as string) to value. */
export interface ScoreRecord {
  fixtureId: number;
  gameState: string;
  startTime: number;
  competitionId: number;
  participant1Id: number;
  participant2Id: number;
  participant1IsHome: boolean;
  action: string;
  ts: number;
  seq: number;
  statusSoccerId?: number | string;
  statusId?: number | string;
  period?: number;
  confirmed?: boolean;
  scoreSoccer?: unknown;
  dataSoccer?: unknown;
  stats?: Record<string, number>;
  [k: string]: unknown;
}

/** A Merkle-proven stat leaf: (key, value, period) — all three are hash-bound. */
export interface ScoreStat {
  key: number;
  value: number;
  period: number;
}

export interface ApiProofNode {
  hash: string | number[];
  isRightSibling: boolean;
}

export interface ScoresBatchSummaryApi {
  fixtureId: number;
  updateStats: {
    updateCount: number;
    minTimestamp: number;
    maxTimestamp: number;
  };
  eventStatsSubTreeRoot: string | number[];
}

/** Response of /api/scores/stat-validation with statKey (+ optional statKey2). */
export interface StatValidationLegacy {
  ts: number;
  statToProve: ScoreStat;
  eventStatRoot: string | number[];
  summary: ScoresBatchSummaryApi;
  statProof: ApiProofNode[];
  subTreeProof: ApiProofNode[];
  mainTreeProof: ApiProofNode[];
  statToProve2?: ScoreStat;
  statProof2?: ApiProofNode[];
}

/** Response of /api/scores/stat-validation with statKeys=a,b,... */
export interface StatValidationV2 {
  ts: number;
  statsToProve: ScoreStat[];
  eventStatRoot: string | number[];
  summary: ScoresBatchSummaryApi;
  statProofs: ApiProofNode[][];
  subTreeProof: ApiProofNode[];
  mainTreeProof: ApiProofNode[];
}

/** Response of /api/scores/stat-validation-v3 (multiproof; undocumented, see FEEDBACK.md). */
export interface StatValidationV3 {
  ts: number;
  statsToProve: Array<{ stat: ScoreStat; statProof: ApiProofNode[] }>;
  eventStatRoot: string | number[];
  summary: ScoresBatchSummaryApi;
  subTreeProof: ApiProofNode[];
  mainTreeProof: ApiProofNode[];
  multiproof: { indices: number[]; hashes: ApiProofNode[] };
}

export interface OddsPayload {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  GameState?: string;
  InRunning: boolean;
  MarketParameters?: string;
  MarketPeriod?: string;
  PriceNames?: string[];
  Prices?: number[];
  /** Implied probabilities, strings with 3 decimals or "NA". */
  Pct?: string[];
}
