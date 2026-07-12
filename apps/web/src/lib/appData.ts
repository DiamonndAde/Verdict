import type { FixtureSides } from "@verdict/sdk/verdict";
import type { StatValidationV2 } from "@verdict/sdk/types";
import demoFixture from "@/data/demo-fixture.json";
import proofsJson from "@/data/proofs.json";

export interface DemoFixture {
  fixtureId: number;
  competition: string;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  startTime: number;
  finalSeq: number;
  finalisedTs: number;
  goals: string;
  corners: number;
  yellows?: string;
}

export const fixture = demoFixture as unknown as DemoFixture;

export const sides: FixtureSides = {
  participant1: fixture.participant1,
  participant2: fixture.participant2,
  participant1IsHome: fixture.participant1IsHome,
};

export const home = fixture.participant1IsHome ? fixture.participant1 : fixture.participant2;
export const away = fixture.participant1IsHome ? fixture.participant2 : fixture.participant1;

/** Bundled real TxLINE proofs (pre-warmed for the demo — same data settle would fetch). */
export const proofs = proofsJson as unknown as {
  v2CornersFinal: StatValidationV2;
  v2SingleFinal: StatValidationV2;
};

/** Maps a predicate's stat keys to the right recorded proof. Demo covers corners + goals. */
export function proofForStatKeys(statKeys: number[]): StatValidationV2 {
  const base = (statKeys[0] ?? 0) % 1000;
  // 7/8 = corners, 1/2 = goals.
  if (base === 7 || base === 8) return proofs.v2CornersFinal;
  return proofs.v2SingleFinal;
}
