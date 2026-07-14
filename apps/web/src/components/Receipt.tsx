import NumberFlow from "@number-flow/react";
import { toPng } from "html-to-image";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import type { MarketAccount } from "@/lib/solana";
import type { StatValidationV2 } from "@verdict/sdk/types";
import { buildCascade, reVerifyOnChain } from "@/lib/verify";
import { fmtDusdc, short, explorerTx } from "@/lib/format";
import { isDemoMode, scaleDuration, usePrefersReducedMotion } from "@/lib/motion";
import { away, fixture, home, sides } from "@/lib/appData";
import { dash } from "@/lib/fixtureState";
import { describeConditionFromPredicate, describeStats } from "@/lib/predicateText";
import { Button, HashBadge } from "./ui";
import { VerificationCascade } from "./VerificationCascade";

interface Props {
  market: MarketAccount;
  marketKey: string;
  proof: StatValidationV2;
  settleSig?: string;
}

export function Receipt({ market, marketKey, proof, settleSig }: Props) {
  const reduced = usePrefersReducedMotion();
  const demo = isDemoMode();
  const ref = useRef<HTMLDivElement>(null);
  const [showCascade, setShowCascade] = useState(false);
  const [verifyKey, setVerifyKey] = useState(0);
  const [reverifyResult, setReverifyResult] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const outcome = market.outcome!;
  const creatorWon = outcome.winner.toBase58() === market.creator.toBase58();
  const winnerName = creatorWon ? "CREATOR" : "TAKER";
  const sentence = describeConditionFromPredicate(market.predicate, sides);
  const statLabel = describeStats(proof.statsToProve, sides);

  const reverify = async () => {
    setShowCascade(true);
    setReverifyResult(null);
    setVerifyKey((k) => k + 1);
    const res = await reVerifyOnChain(proof, market.predicate);
    setReverifyResult(res.ok ? `Oracle re-confirmed: predicate ${res.predicateHolds ? "TRUE" : "FALSE"}` : `Failed: ${res.errorName}`);
  };

  const exportPng = async () => {
    if (!ref.current) return;
    setExporting(true);
    try {
      const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: "#0a0f0b", cacheBust: true });
      const a = document.createElement("a");
      a.download = `verdict-receipt-${short(marketKey, 4, 4)}.png`;
      a.href = url;
      a.click();
    } finally {
      setExporting(false);
    }
  };

  const revealDur = scaleDuration(0.7, reduced, demo);

  return (
    <div className="mx-auto w-full max-w-md">
      {/* The ticket "prints" top-to-bottom. */}
      <motion.div
        initial={reduced ? { opacity: 0 } : { clipPath: "inset(0 0 100% 0)", opacity: 1 }}
        animate={reduced ? { opacity: 1 } : { clipPath: "inset(0 0 0% 0)" }}
        transition={{ duration: revealDur, ease: [0.22, 1, 0.36, 1] }}
      >
        <div ref={ref} className="overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-pitch-850 to-pitch-900">
          {/* Stub — fixture + final score */}
          <div className="relative px-6 pt-6 pb-5">
            <div className="flex items-center justify-between">
              <span className="display text-xs font-bold tracking-[0.3em] text-volt">VERDICT</span>
              <span className="mono text-[10px] text-chalk-faint">SETTLEMENT RECEIPT</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <TeamName name={home} align="left" />
              <div className="text-center">
                <div className="display text-3xl font-bold tabular-nums text-chalk">{dash(fixture.goals)}</div>
                <div className="text-[10px] uppercase tracking-widest text-chalk-faint">full time</div>
              </div>
              <TeamName name={away} align="right" />
            </div>
            <div className="mt-2 text-center text-[11px] text-chalk-dim">{dash(fixture.competition)}</div>
          </div>

          <Perforation />

          {/* Body — the bet, the winner, the proof */}
          <div className="space-y-4 px-6 py-5">
            <Field label="The bet">
              <span className="text-chalk">{sentence}</span>
            </Field>

            <div className="flex items-end justify-between gap-4">
              <Field label="Winner">
                <span className="display text-2xl font-bold text-volt">{winnerName}</span>
                <span className="ml-2 text-xs text-chalk-dim">predicate {outcome.predicateResult ? "TRUE" : "FALSE"}</span>
              </Field>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-chalk-faint">payout</div>
                <div className="display text-2xl font-bold text-chalk tabular-nums">
                  <NumberFlow value={fmtDusdcNumber(outcome.payout)} suffix=" dUSDC" />
                </div>
              </div>
            </div>

            <Field label="Proven from the game_finalised record">
              <span className="mono text-xs text-chalk">{statLabel}</span>
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <HashBadge label="market" value={marketKey} />
              {settleSig && <HashBadge label="settle tx" value={settleSig} />}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Interactions (not part of the exported PNG) */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reverify} variant="volt">
          Re-verify now
        </Button>
        <Button onClick={exportPng} variant="ghost" disabled={exporting}>
          {exporting ? "Exporting…" : "Export PNG"}
        </Button>
        {settleSig && (
          <a href={explorerTx(settleSig)} target="_blank" rel="noreferrer" className="text-xs text-chalk-dim underline decoration-line hover:text-volt">
            View on Solana Explorer ↗
          </a>
        )}
      </div>

      <AnimatePresence>
        {showCascade && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-6 rounded-2xl border border-line bg-pitch-900/60 p-5"
          >
            <div className="mb-4 text-center text-xs uppercase tracking-widest text-chalk-faint">
              Merkle path · leaf → on-chain daily root
            </div>
            <VerificationCascade key={verifyKey} nodes={buildCascade(proof, statLabel)} mode="verify" />
            {reverifyResult && <div className="mt-4 text-center text-sm text-volt">{reverifyResult}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function fmtDusdcNumber(raw: { toString(): string }): number {
  return Number(BigInt(raw.toString())) / 1e6;
}

function TeamName({ name, align }: { name: string; align: "left" | "right" }) {
  return (
    <div className={`flex-1 ${align === "right" ? "text-right" : "text-left"}`}>
      <div className="display text-lg font-bold leading-tight text-chalk">{name}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-chalk-faint">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Perforated ticket edge with notches. */
function Perforation() {
  return (
    <div className="relative h-5">
      <div className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-pitch-950" />
      <div className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-pitch-950" />
      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 border-t border-dashed border-line" />
    </div>
  );
}

// re-exported for type import
export { fmtDusdc };
