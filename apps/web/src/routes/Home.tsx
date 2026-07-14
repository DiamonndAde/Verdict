import { motion } from "motion/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { away, fixture, home, isDemoFixture } from "@/lib/appData";
import { compilePredicate, type Condition } from "@verdict/sdk/verdict";
import { sides } from "@/lib/appData";
import { BN, acceptMarket, createMarket, demoCreator, demoTaker } from "@/lib/solana";
import { setDemoRole } from "@/lib/demoRole";
import { defaultExpiryUnix, defaultSettleAfterMs } from "@verdict/sdk/verdict";
import { spring } from "@/lib/motion";
import { dash, fixtureState, kickoffLabel, stateLabel } from "@/lib/fixtureState";
import { Button, Card, VoltText } from "@/components/ui";

export function Home() {
  const navigate = useNavigate();
  const [launching, setLaunching] = useState<string | null>(null);

  // Spins up a fresh Active challenge on devnet with the two demo signers, then drops you on
  // the settle screen — the on-camera path to the hero moment.
  const playDemo = async () => {
    try {
      setLaunching("Creating a challenge on devnet…");
      const condition: Condition = { metric: "corners", scope: "total", comparator: "over", threshold: 9.5 };
      const predicate = compilePredicate(condition, sides);
      const seed = new BN(Date.now());
      const { market } = await createMarket(demoCreator, {
        seed,
        fixtureId: fixture.fixtureId,
        stake: new BN(100_000_000),
        predicate,
        settleAfterMs: defaultSettleAfterMs(fixture.startTime, fixture.knockout === true),
        expiryUnix: defaultExpiryUnix(fixture.startTime),
      });
      setLaunching("Opponent accepting…");
      await acceptMarket(demoTaker, market);
      // The one-tab "just watch" path plays both sides, then hands you the settle — which the
      // losing taker triggers, so land as the taker.
      setDemoRole("taker");
      navigate(`/c/${market.toBase58()}`);
    } catch (err) {
      setLaunching(null);
      alert(`Demo launch failed: ${String(err).slice(0, 200)}`);
    }
  };

  return (
    <div className="space-y-10">
      <section className="text-center">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="display text-5xl font-bold leading-[0.95] text-chalk sm:text-6xl"
        >
          Challenge a friend.
          <br />
          Settle by <VoltText>proof</VoltText>.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.06 }}
          className="mx-auto mt-5 max-w-xl text-chalk-dim"
        >
          1v1 sports wagers on Solana. Both sides escrow dUSDC. When the match ends, anyone
          settles the bet with a TxLINE Merkle proof — verified on-chain, paid to the winner.
          No bookie. No admin key.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.14 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Button onClick={() => navigate("/create")}>Create a challenge</Button>
          <Button variant="ghost" onClick={playDemo} disabled={!!launching}>
            {launching ?? "Watch a live settlement →"}
          </Button>
        </motion.div>
      </section>

      <FixtureCard />
    </div>
  );
}

/**
 * The hero fixture card, rendered for what the match ACTUALLY is. It used to assume every
 * fixture was a finished historical one, so an upcoming match showed "FULL TIME" and
 * "CORNERS undefined".
 */
function FixtureCard() {
  const state = fixtureState(fixture);
  const completed = state === "completed";

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        {state === "live" && (
          <span className="size-2 animate-pulse rounded-full bg-volt shadow-[0_0_8px_2px_rgba(199,249,78,0.6)]" />
        )}
        <div className="text-[11px] uppercase tracking-widest text-chalk-faint">
          {stateLabel(fixture, isDemoFixture, state)}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-4">
        <div className="display text-2xl font-semibold text-chalk">
          {home} <span className="text-chalk-faint">vs</span> {away}
        </div>
        <div className="text-right">
          {completed ? (
            <>
              <div className="display text-2xl font-bold text-volt tabular-nums">{dash(fixture.goals)}</div>
              <div className="text-[10px] uppercase tracking-widest text-chalk-faint">full time</div>
            </>
          ) : state === "live" ? (
            <div className="display text-lg font-bold text-volt">In play</div>
          ) : (
            <div className="display text-sm font-semibold text-chalk">{kickoffLabel(fixture.startTime)}</div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Metric label="Corners" value={completed ? dash(fixture.corners) : "—"} />
        <Metric label="Competition" value={dash(fixture.competition)} />
        <Metric label="Fixture" value={`#${dash(fixture.fixtureId)}`} />
      </div>

      <p className="mt-4 text-xs text-chalk-faint">
        {completed
          ? "Historical replay — the match is already finished, so settlement runs against its real final TxLINE record on camera. No live game required."
          : state === "live"
            ? "Settlement unlocks at the final whistle — no one can settle early."
            : "Live wager — create and share before kickoff. Settlement unlocks the moment the final record lands on-chain."}
      </p>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-pitch-900/60 px-3 py-3">
      <div className="text-[10px] uppercase tracking-widest text-chalk-faint">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-chalk">{value}</div>
    </div>
  );
}
