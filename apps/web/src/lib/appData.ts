import type { FixtureSides } from "@verdict/sdk/verdict";
import type { StatValidationV2 } from "@verdict/sdk/types";
import demoFixture from "@/data/demo-fixture.json";
import liveFixture from "@/data/live-fixture.json";
import franceSpainFixture from "@/data/france-spain-fixture.json";
import proofsJson from "@/data/proofs.json";
import liveProofsJson from "@/data/live-proofs.json";
import franceSpainProofsJson from "@/data/france-spain-proofs.json";

export interface DemoFixture {
  fixtureId: number;
  competition: string;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  startTime: number;
  /** Knockout ties can run to extra time and penalties (display only — the settlement
   *  window no longer depends on it; see defaultSettleAfterMs). */
  knockout?: boolean;
  /** Present only once the match has finished and its proofs are recorded. */
  finalSeq?: number;
  finalisedTs?: number;
  goals?: string;
  corners?: number;
  yellows?: string;
}

interface FixtureProofs {
  v2CornersFinal?: StatValidationV2;
  v2SingleFinal?: StatValidationV2;
}

const DEMO = demoFixture as unknown as DemoFixture;
const LIVE = liveFixture as unknown as DemoFixture;
// France 0–2 Spain — our first live-settled match, kept as a permanent, addressable
// COMPLETED fixture (?fixture=18237038) so it survives as fallback evidence when LIVE rolls
// over to the next upcoming match. Its own proofs stay scoped to its own id; LIVE's proofs
// are reset to {} on every rollover so a new fixture never inherits a prior match's proofs.
const FRANCE_SPAIN = franceSpainFixture as unknown as DemoFixture;

/** Every fixture the app can render, by id. The historical demo fixture is the default. */
const FIXTURES: Record<number, DemoFixture> = {
  [DEMO.fixtureId]: DEMO,
  [FRANCE_SPAIN.fixtureId]: FRANCE_SPAIN,
  [LIVE.fixtureId]: LIVE,
};

/**
 * Recorded TxLINE proofs, scoped BY FIXTURE. This scoping is load-bearing: `settle` asserts
 * `summary.fixtureId == market.fixture_id`, so handing a market the wrong match's proof is
 * rejected on-chain (FixtureMismatch). A live fixture has no proofs until its game_finalised
 * record exists, so its entry is empty until we record it after full time.
 */
const PROOFS: Record<number, FixtureProofs> = {
  [DEMO.fixtureId]: proofsJson as unknown as FixtureProofs,
  [FRANCE_SPAIN.fixtureId]: franceSpainProofsJson as unknown as FixtureProofs,
  [LIVE.fixtureId]: liveProofsJson as unknown as FixtureProofs,
};

/**
 * `?fixture=<id>` (demo only) points the create flow at another known fixture — used for the
 * live-match demo. Sticky for the session, because SPA navigation drops query params. With no
 * override, everything resolves to the historical demo fixture exactly as before.
 */
function resolveFixtureId(): number {
  if (typeof window === "undefined") return DEMO.fixtureId;
  const KEY = "verdict-fixture";
  let raw: string | null = new URLSearchParams(window.location.search).get("fixture");
  try {
    if (raw) sessionStorage.setItem(KEY, raw);
    else raw = sessionStorage.getItem(KEY);
  } catch {
    /* ignore */
  }
  const id = Number(raw);
  return raw && FIXTURES[id] ? id : DEMO.fixtureId;
}

export const fixture: DemoFixture = FIXTURES[resolveFixtureId()] ?? DEMO;

/** Whether the current selection is something other than the default historical fixture. */
export const isLiveFixture = fixture.fixtureId !== DEMO.fixtureId;
/** Only the bundled Mexico–England match may call itself the "demo fixture". */
export const isDemoFixture = fixture.fixtureId === DEMO.fixtureId;

export const sides: FixtureSides = {
  participant1: fixture.participant1,
  participant2: fixture.participant2,
  participant1IsHome: fixture.participant1IsHome,
};

export const home = fixture.participant1IsHome ? fixture.participant1 : fixture.participant2;
export const away = fixture.participant1IsHome ? fixture.participant2 : fixture.participant1;

export function fixtureById(id: number): DemoFixture | undefined {
  return FIXTURES[id];
}

/**
 * The recorded proof for a predicate's stats, for a given fixture. Returns null when the match
 * has not been proven yet (no game_finalised record recorded), so the UI can say so honestly
 * rather than submit a settle that the chain would reject.
 */
export function proofForStatKeys(fixtureId: number, statKeys: number[]): StatValidationV2 | null {
  const byFixture = PROOFS[fixtureId];
  if (!byFixture) return null;
  const base = (statKeys[0] ?? 0) % 1000;
  // 7/8 = corners, everything else falls back to the single-stat (goals) proof.
  const proof = base === 7 || base === 8 ? byFixture.v2CornersFinal : byFixture.v2SingleFinal;
  return proof ?? null;
}
