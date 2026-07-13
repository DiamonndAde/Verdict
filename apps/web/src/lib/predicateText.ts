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

/** Odd base keys belong to participant 1, even to participant 2 (TxLINE soccer encoding). */
function statTeam(base: number, sides: FixtureSides): string {
  return base % 2 === 1 ? sides.participant1 : sides.participant2;
}

export interface ProvenStat {
  key: number;
  value: number;
}

/**
 * Attributes proven stats to the teams that earned them: "Mexico 12 · England 2 corners".
 * A bare "corners 12 · corners 2" tells a viewer nothing about who did what — and the receipt
 * is the product, so the numbers have to read like a scoreboard. The metric is named once when
 * both stats share it, and per-stat otherwise.
 */
export function describeStats(stats: ProvenStat[], sides: FixtureSides): string {
  const parts = stats.map((s) => {
    const base = s.key % 1000;
    return { team: statTeam(base, sides), metric: METRIC_BY_BASE[base] ?? "stat", value: s.value };
  });
  const metrics = new Set(parts.map((p) => p.metric));
  if (metrics.size === 1) {
    return `${parts.map((p) => `${p.team} ${p.value}`).join(" · ")} ${[...metrics][0]}`;
  }
  return parts.map((p) => `${p.team} ${p.value} ${p.metric}`).join(" · ");
}

/**
 * The forged leaf's label, for the fraud cascade: "claims Mexico 15 corners — really 12".
 * Showing the original values there would hide the whole point of the demo; the viewer must
 * see the lie next to the truth at the exact node where the chain catches it.
 */
export function describeForgedStats(tampered: ProvenStat[], original: ProvenStat[], sides: FixtureSides): string {
  const i = tampered.findIndex((s, idx) => s.value !== original[idx]?.value);
  if (i === -1) return describeStats(tampered, sides);
  const base = tampered[i].key % 1000;
  const metric = METRIC_BY_BASE[base] ?? "stat";
  return `claims ${statTeam(base, sides)} ${tampered[i].value} ${metric} — really ${original[i].value}`;
}
