/**
 * Finds an UPCOMING fixture (the live-match demo path), as opposed to find-fixture.ts which
 * hunts for already-completed ones. Prints kickoff and the settlement windows.
 *
 *   npx tsx scripts/find-upcoming.ts            # today + tomorrow, all
 *   npx tsx scripts/find-upcoming.ts France     # filter by team name
 */
import * as fs from "node:fs";
import { Connection } from "@solana/web3.js";
import { TxLineAuth, loadKeypair } from "@verdict/sdk/auth";
import { TxLineClient } from "@verdict/sdk/api";
import { DEVNET } from "@verdict/sdk/config";
import { defaultExpiryUnix, defaultSettleAfterMs } from "@verdict/sdk/verdict";

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000", "");

async function main() {
  const filter = (process.argv[2] ?? "").toLowerCase();
  const connection = new Connection(DEVNET.rpcUrl, "confirmed");
  const auth = new TxLineAuth(connection, loadKeypair(".keys/deployer.json"));
  const client = new TxLineClient(auth);

  const now = Date.now();
  const today = Math.floor(now / DAY);

  const seen = new Map<number, any>();
  for (const day of [today, today + 1]) {
    const fixtures = await client.fixturesSnapshot(day);
    for (const f of fixtures) seen.set(f.FixtureId, f);
  }

  const upcoming = [...seen.values()]
    .filter((f) => f.StartTime > now - 3 * 3_600_000) // include just-started
    .filter((f) => !filter || `${f.Participant1} ${f.Participant2}`.toLowerCase().includes(filter))
    .sort((a, b) => a.StartTime - b.StartTime);

  console.log(`now ${iso(now)}  |  upcoming fixtures found: ${upcoming.length}\n`);
  for (const f of upcoming) {
    const kickoff = f.StartTime;
    const inMin = Math.round((kickoff - now) / 60_000);
    const settleAfterMs = defaultSettleAfterMs(kickoff);
    const expiryUnix = defaultExpiryUnix(kickoff, now);
    console.log(
      `fixtureId ${f.FixtureId}  ${f.Participant1} vs ${f.Participant2}\n` +
        `  competition : ${f.Competition} (${f.CompetitionId})\n` +
        `  kickoff     : ${iso(kickoff)}  (${inMin >= 0 ? `in ${inMin} min` : `${-inMin} min ago`})  ts=${kickoff}\n` +
        `  p1IsHome    : ${f.Participant1IsHome}\n` +
        `  settle_after: ${iso(settleAfterMs)}  ts=${settleAfterMs}   (kickoff + 105min — see defaultSettleAfterMs)\n` +
        `  expiry      : ${iso(expiryUnix * 1000)}  unix=${expiryUnix}   (max(kickoff, now) + 7d)\n`,
    );
  }

  if (upcoming.length) {
    const pick = upcoming[0];
    const out = {
      fixtureId: pick.FixtureId,
      participant1: pick.Participant1,
      participant2: pick.Participant2,
      participant1IsHome: pick.Participant1IsHome,
      competition: pick.Competition,
      startTime: pick.StartTime,
      settleAfterMs: defaultSettleAfterMs(pick.StartTime),
      knockout: true,
    };
    fs.writeFileSync("tests/fixtures/live-fixture.json", JSON.stringify(out, null, 2));
    console.log(`written tests/fixtures/live-fixture.json -> ${out.participant1} vs ${out.participant2} (${out.fixtureId})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
