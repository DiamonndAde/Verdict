import type { FixtureSides, StoredPredicate } from "@verdict/sdk/verdict";

const METRIC_BY_BASE: Record<number, string> = {
  1: "goals",
  2: "goals",
  7: "corners",
  8: "corners",
  3: "yellow cards",
  4: "yellow cards",
  5: "red cards",
  6: "red cards",
};

function comparatorWord(p: StoredPredicate): { word: string; line: number } {
  if ("greaterThan" in p.comparison) return { word: "over", line: p.threshold + 0.5 };
  if ("lessThan" in p.comparison) return { word: "under", line: p.threshold - 0.5 };
  return { word: "exactly", line: p.threshold };
}

/**
 * Reverses a stored on-chain predicate into the fan sentence — the inverse of the SDK
 * predicate compiler — so the receipt and challenge card read the same words the creator saw.
 */
export function describeConditionFromPredicate(p: StoredPredicate, sides: FixtureSides): string {
  const base = p.stat1Key % 1000;
  const metric = METRIC_BY_BASE[base] ?? "stat";
  const { word, line } = comparatorWord(p);
  const n = Number.isInteger(line) ? line : line.toFixed(1);

  if (p.stat2Key != null && p.op != null) {
    if ("add" in p.op) return `Total ${metric} ${word} ${n}`;
    // subtract => margin; the leading side is stat1
    const leadIsP1 = p.stat1Key < 1000 ? true : true;
    const side = sides.participant1IsHome === leadIsP1 ? homeName(sides) : awayName(sides);
    return `${side} ${metric} margin ${word} ${n}`;
  }
  // single stat — which participant?
  const isP1 = [1, 3, 5, 7].includes(base);
  const who = isP1 ? sides.participant1 : sides.participant2;
  return `${who} ${metric} ${word} ${n}`;
}

function homeName(s: FixtureSides): string {
  return s.participant1IsHome ? s.participant1 : s.participant2;
}
function awayName(s: FixtureSides): string {
  return s.participant1IsHome ? s.participant2 : s.participant1;
}
