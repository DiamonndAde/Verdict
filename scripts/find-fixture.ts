/**
 * Lists recently completed fixtures (with full historical replay available) and picks a
 * demo candidate rich in stats: goals + corners + yellow cards, plus the seq of its
 * `game_finalised` record — the record every settlement proof must come from.
 *
 * Writes tests/fixtures/completed-fixtures.json (all candidates) and
 * tests/fixtures/demo-fixture.json (the pick).
 *
 *   npm run find-fixture
 */
import * as fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { TxLineAuth, loadKeypair } from "@verdict/sdk/auth";
import { TxLineClient } from "@verdict/sdk/api";
import { DAY_MS, DEVNET, FINAL_PERIOD, GAME_FINALISED_ACTION, STAT } from "@verdict/sdk/config";
import type { Fixture, ScoreRecord } from "@verdict/sdk/types";

const HISTORICAL_MIN_AGE_MS = 7 * 3600_000; // endpoint window: start > 6h ago (7h margin)
const HISTORICAL_MAX_AGE_MS = 13 * DAY_MS; //  ... and < 2 weeks ago (13d margin)

interface Candidate {
  fixtureId: number;
  competition: string;
  participant1: string;
  participant2: string;
  participant1IsHome: boolean;
  startTime: number;
  finalSeq: number;
  finalisedTs: number;
  updateCount: number;
  stats: Record<string, number>;
  goals: string;
  corners: number;
  yellows: number;
}

async function main() {
  const connection = new Connection(process.env.RPC_URL ?? DEVNET.rpcUrl, "confirmed");
  const wallet = loadKeypair(process.env.ANCHOR_WALLET ?? ".keys/deployer.json");
  const auth = new TxLineAuth(connection, wallet);
  console.log(`wallet: ${wallet.publicKey.toBase58()}`);
  console.log("authenticating with TxLINE (guest jwt -> subscribe -> activate)...");
  await auth.getAuth();
  console.log("authenticated.");

  const client = new TxLineClient(auth);
  const now = Date.now();
  const startEpochDay = Math.floor((now - HISTORICAL_MAX_AGE_MS) / DAY_MS);

  const fixtures = await client.fixturesSnapshot(startEpochDay);
  const windowed = fixtures.filter((f) => {
    const age = now - f.StartTime;
    return age > HISTORICAL_MIN_AGE_MS && age < HISTORICAL_MAX_AGE_MS;
  });
  console.log(`fixtures listed: ${fixtures.length}, within historical-replay window: ${windowed.length}`);

  const candidates: Candidate[] = [];
  for (const f of windowed) {
    const found = await inspectFixture(client, f);
    if (found) {
      candidates.push(found);
      console.log(
        `  ✔ ${found.fixtureId} ${found.participant1} vs ${found.participant2} — ` +
          `${found.goals}, corners ${found.corners}, yellows ${found.yellows}, finalSeq ${found.finalSeq}`,
      );
    }
  }

  if (candidates.length === 0) {
    console.error("No completed fixtures with a game_finalised record found in the window.");
    process.exit(1);
  }

  // Rich stats demo better: must have corners+yellows data; prefer more total events.
  const scored = [...candidates].sort((a, b) => score(b) - score(a));
  const pick = scored[0];

  fs.mkdirSync("tests/fixtures", { recursive: true });
  fs.writeFileSync("tests/fixtures/completed-fixtures.json", JSON.stringify(scored, null, 2));
  fs.writeFileSync("tests/fixtures/demo-fixture.json", JSON.stringify(pick, null, 2));

  console.log("\n=== DEMO FIXTURE PICK ===");
  console.log(`${pick.participant1} vs ${pick.participant2} (${pick.competition})`);
  console.log(`fixtureId=${pick.fixtureId} finalSeq=${pick.finalSeq}`);
  console.log(`kickoff ${new Date(pick.startTime).toISOString()}  finalised ${new Date(pick.finalisedTs).toISOString()}`);
  console.log(`score ${pick.goals}, corners ${pick.corners}, yellows ${pick.yellows}, updates ${pick.updateCount}`);
  console.log("\nwritten to tests/fixtures/demo-fixture.json");
}

function score(c: Candidate): number {
  const [g1, g2] = c.goals.split("-").map(Number);
  const hasAll = c.corners > 0 && c.yellows > 0 && g1 + g2 > 0 ? 1000 : 0;
  return hasAll + c.corners + c.yellows + (g1 + g2) * 3;
}

async function inspectFixture(client: TxLineClient, f: Fixture): Promise<Candidate | null> {
  let records: ScoreRecord[];
  try {
    records = await client.scoresHistorical(f.FixtureId);
  } catch {
    return null; // outside window or no coverage
  }
  const finalRecord = records.find((r) => r.action === GAME_FINALISED_ACTION);
  if (!finalRecord?.stats) return null;
  if (finalRecord.period !== undefined && finalRecord.period !== FINAL_PERIOD) {
    console.warn(`  fixture ${f.FixtureId}: game_finalised with unexpected period ${finalRecord.period}`);
  }

  const stat = (k: number) => finalRecord.stats?.[String(k)] ?? 0;
  return {
    fixtureId: f.FixtureId,
    competition: f.Competition,
    participant1: f.Participant1,
    participant2: f.Participant2,
    participant1IsHome: f.Participant1IsHome,
    startTime: f.StartTime,
    finalSeq: finalRecord.seq,
    finalisedTs: finalRecord.ts,
    updateCount: records.length,
    stats: finalRecord.stats,
    goals: `${stat(STAT.P1_GOALS)}-${stat(STAT.P2_GOALS)}`,
    corners: stat(STAT.P1_CORNERS) + stat(STAT.P2_CORNERS),
    yellows: stat(STAT.P1_YELLOWS) + stat(STAT.P2_YELLOWS),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
