import { BN } from "@coral-xyz/anchor";
import { PERIOD_PREFIX, STAT } from "../config.js";

/**
 * The predicate compiler: turns a friendly, UI-buildable condition into (a) the on-chain
 * stored `Predicate` and (b) a human sentence. This is the single place where fan language
 * ("Total corners over 9.5") becomes stat keys, an operator, a comparison and a threshold —
 * so the UI, the stored predicate, and the settlement strategy can never drift apart.
 *
 * Everything is full-game (period 0 = Total). Settlement additionally requires the proven
 * leaf to come from the game_finalised record (period 100) — enforced on-chain.
 */

export type Metric = "corners" | "goals" | "yellow_cards" | "red_cards";

/**
 * How the metric is scoped:
 *  - total:       home + away combined
 *  - home / away: one team's tally
 *  - home_margin: home minus away (can be negative)
 *  - away_margin: away minus home
 */
export type Scope = "total" | "home" | "away" | "home_margin" | "away_margin";

export type Comparator = "over" | "under" | "exactly";

export interface Condition {
  metric: Metric;
  scope: Scope;
  comparator: Comparator;
  /** For over/under, a half-line (e.g. 9.5) reads best; integers are accepted too. */
  threshold: number;
}

export type OnchainComparison = { greaterThan: {} } | { lessThan: {} } | { equalTo: {} };
export type OnchainOp = { add: {} } | { subtract: {} };

/** Matches the on-chain `Predicate` account shape (camelCased for Anchor). */
export interface StoredPredicate {
  stat1Key: number;
  stat2Key: number | null;
  op: OnchainOp | null;
  threshold: number;
  comparison: OnchainComparison;
}

/** Base (full-game) stat keys per metric, [participant1, participant2]. */
const METRIC_KEYS: Record<Metric, [number, number]> = {
  goals: [STAT.P1_GOALS, STAT.P2_GOALS],
  corners: [STAT.P1_CORNERS, STAT.P2_CORNERS],
  yellow_cards: [STAT.P1_YELLOWS, STAT.P2_YELLOWS],
  red_cards: [STAT.P1_REDS, STAT.P2_REDS],
};

const METRIC_LABEL: Record<Metric, { total: string; one: string }> = {
  goals: { total: "goals", one: "goals" },
  corners: { total: "corners", one: "corners" },
  yellow_cards: { total: "yellow cards", one: "yellow cards" },
  red_cards: { total: "red cards", one: "red cards" },
};

export interface FixtureSides {
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
}

function keysForScope(metric: Metric, scope: Scope, sides: FixtureSides) {
  const keys = METRIC_KEYS[metric];
  if (!keys) throw new Error(`Unknown metric: ${metric}`);
  const [p1, p2] = keys;
  const homeKey = sides.participant1IsHome ? p1 : p2;
  const awayKey = sides.participant1IsHome ? p2 : p1;
  switch (scope) {
    case "total":
      return { stat1: p1 + PERIOD_PREFIX.TOTAL, stat2: p2 + PERIOD_PREFIX.TOTAL, op: { add: {} } as OnchainOp };
    case "home":
      return { stat1: homeKey, stat2: null, op: null };
    case "away":
      return { stat1: awayKey, stat2: null, op: null };
    case "home_margin":
      return { stat1: homeKey, stat2: awayKey, op: { subtract: {} } as OnchainOp };
    case "away_margin":
      return { stat1: awayKey, stat2: homeKey, op: { subtract: {} } as OnchainOp };
  }
}

/**
 * Convert a comparator + a possibly-fractional threshold into an integer threshold and an
 * on-chain comparison. Half-lines are the friendly path: "over 9.5" => GreaterThan(9),
 * "under 3.5" => LessThan(4), which avoids exact-tie ambiguity entirely.
 */
function compileComparison(comparator: Comparator, threshold: number): { comparison: OnchainComparison; threshold: number } {
  switch (comparator) {
    case "over":
      return { comparison: { greaterThan: {} }, threshold: Math.floor(threshold) };
    case "under":
      return { comparison: { lessThan: {} }, threshold: Math.ceil(threshold) };
    case "exactly":
      if (!Number.isInteger(threshold)) throw new Error("'exactly' requires an integer threshold");
      return { comparison: { equalTo: {} }, threshold };
  }
}

export function compilePredicate(condition: Condition, sides: FixtureSides): StoredPredicate {
  const { stat1, stat2, op } = keysForScope(condition.metric, condition.scope, sides);
  const { comparison, threshold } = compileComparison(condition.comparator, condition.threshold);
  return { stat1Key: stat1, stat2Key: stat2, op, threshold, comparison };
}

/** The stat keys a settlement proof must request for this condition, in strategy order. */
export function predicateStatKeys(predicate: StoredPredicate): number[] {
  return predicate.stat2Key != null ? [predicate.stat1Key, predicate.stat2Key] : [predicate.stat1Key];
}

/** Human sentence for the challenge card, e.g. "Total corners over 9.5". */
export function describeCondition(condition: Condition, sides: FixtureSides): string {
  const label = METRIC_LABEL[condition.metric];
  const home = sides.participant1IsHome ? sides.participant1 : sides.participant2;
  const away = sides.participant1IsHome ? sides.participant2 : sides.participant1;
  const n = condition.threshold;
  const cmp = condition.comparator;
  switch (condition.scope) {
    case "total":
      return `Total ${label.total} ${cmp} ${n}`;
    case "home":
      return `${home} ${label.one} ${cmp} ${n}`;
    case "away":
      return `${away} ${label.one} ${cmp} ${n}`;
    case "home_margin":
      return `${home} ${label.total} margin ${cmp} ${n}`;
    case "away_margin":
      return `${away} ${label.total} margin ${cmp} ${n}`;
  }
}

/** Convenience: the settle_after_ms default (kickoff + regulation buffer, or +ET/pens). */
export function defaultSettleAfterMs(kickoffMs: number, extraTimePossible = false): number {
  const minutes = extraTimePossible ? 200 : 130;
  return kickoffMs + minutes * 60_000;
}

/**
 * Default refund deadline, as unix seconds: 7 days of head-room to get a proof in.
 *
 * Anchored to whichever is LATER, kickoff or now. Anchoring purely to kickoff is a time bomb
 * for historical replay: our demo fixture kicked off on 2026-07-06, so from 2026-07-13 the
 * "kickoff + 7 days" deadline is already in the past and `create_market` correctly rejects the
 * market with `InvalidExpiry` — every new challenge would fail, on a clock, with no code
 * change. The market is created *now*, so the deadline has to be measured from now.
 */
export function defaultExpiryUnix(kickoffMs: number, nowMs: number = Date.now()): number {
  const kickoffSec = Math.floor(kickoffMs / 1000);
  const nowSec = Math.floor(nowMs / 1000);
  return Math.max(kickoffSec, nowSec) + 7 * 86_400;
}

export function toBN(n: number): BN {
  return new BN(n);
}
