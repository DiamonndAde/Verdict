import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { BN, type MarketAccount } from "@/lib/solana";
import { away, fixture, home, sides } from "@/lib/appData";
import { describeConditionFromPredicate } from "@/lib/predicateText";
import { fmtDusdc, short } from "@/lib/format";
import { softSpring, spring } from "@/lib/motion";
import { dash, fixtureState, kickoffLabel } from "@/lib/fixtureState";
import { Chip, Identicon } from "./ui";

/** The challenge as a boxing "fight card": creator left, taker right, VS divider. */
export function FightCard({ market }: { market: MarketAccount }) {
  const state = fixtureState(fixture);
  const sentence = describeConditionFromPredicate(market.predicate, sides);
  const stake = fmtDusdc(market.stake.toString());
  const pot = market.taker ? fmtDusdc(market.stake.mul(new BN(2)).toString()) : stake;
  const hasTaker = !!market.taker;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line">
      <div className="pitch-lines absolute inset-0" aria-hidden />
      <div className="relative px-6 py-6">
        <div className="mb-1 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.3em] text-chalk-faint">
          {state === "live" && (
            <span className="size-1.5 animate-pulse rounded-full bg-volt shadow-[0_0_8px_2px_rgba(199,249,78,0.6)]" />
          )}
          <span>{dash(fixture.competition)}</span>
          <span className="text-chalk-faint/60">·</span>
          <span className={state === "live" ? "text-volt" : ""}>{state}</span>
        </div>
        <div className="mb-1 text-center display text-lg font-semibold text-chalk">
          {home} <span className="text-chalk-faint">vs</span> {away}
        </div>
        {/* Only a finished match has a full-time score; an upcoming one shows its kickoff. */}
        <div className="mb-5 text-center text-xs text-chalk-dim">
          {state === "completed" ? (
            <span className="tabular-nums">
              {dash(fixture.goals)} <span className="text-chalk-faint">full time</span>
            </span>
          ) : state === "live" ? (
            <span className="text-volt">In play</span>
          ) : (
            kickoffLabel(fixture.startTime)
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <Corner side="left" label="Creator" pubkey={market.creator.toBase58()} claim="says TRUE" delay={0} />

          <div className="flex flex-col items-center">
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={spring}
              className="display text-2xl font-bold text-volt"
            >
              VS
            </motion.div>
          </div>

          {hasTaker ? (
            <Corner side="right" label="Taker" pubkey={market.taker!.toBase58()} claim="says FALSE" delay={0.08} />
          ) : (
            <EmptyCorner />
          )}
        </div>

        <div className="mt-6 rounded-xl border border-line bg-pitch-900/70 px-4 py-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-chalk-faint">The call</div>
          <div className="display mt-1 text-xl font-semibold text-chalk">“{sentence}”</div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-6">
          <Stat label="Stake / side" value={`${stake} dUSDC`} />
          <div className="h-8 w-px bg-line" />
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-widest text-chalk-faint">Pot</div>
            <div className="display text-xl font-bold text-volt tabular-nums">
              <NumberFlow value={Number(pot.replace(/,/g, ""))} suffix=" dUSDC" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Corner({ side, label, pubkey, claim, delay }: { side: "left" | "right"; label: string; pubkey: string; claim: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === "left" ? -24 : 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...softSpring, delay }}
      className={`flex flex-col items-center gap-2 ${side === "right" ? "order-1" : ""}`}
    >
      <Identicon pubkey={pubkey} size={48} />
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-widest text-chalk-faint">{label}</div>
        <div className="mono text-xs text-chalk-dim">{short(pubkey, 4, 4)}</div>
        <Chip className="mt-1">{claim}</Chip>
      </div>
    </motion.div>
  );
}

function EmptyCorner() {
  return (
    <div className="order-1 flex flex-col items-center gap-2 opacity-60">
      <div className="flex size-12 items-center justify-center rounded-lg border border-dashed border-line text-chalk-faint">?</div>
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-widest text-chalk-faint">Taker</div>
        <div className="text-xs text-chalk-dim">open seat</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-widest text-chalk-faint">{label}</div>
      <div className="text-sm font-semibold text-chalk tabular-nums">{value}</div>
    </div>
  );
}
