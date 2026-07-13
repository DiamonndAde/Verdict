import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { PublicKey } from "@solana/web3.js";
import { predicateStatKeys } from "@verdict/sdk/verdict";
import { FightCard } from "@/components/FightCard";
import { Receipt } from "@/components/Receipt";
import { VerificationCascade } from "@/components/VerificationCascade";
import { Button, Card, Divider } from "@/components/ui";
import { proofForStatKeys, sides } from "@/lib/appData";
import { describeForgedStats, describeStats } from "@/lib/predicateText";
import { buildCascade, reVerifyOnChain, tamperProof } from "@/lib/verify";
import { acceptMarket, demoTaker, settleMarket } from "@/lib/solana";
import { useMarket } from "@/lib/useMarket";
import { isDemoMode, usePrefersReducedMotion } from "@/lib/motion";
import { roleWallet, useDemoRole } from "@/lib/demoRole";

type Phase = "idle" | "settling" | "fraud";

export function Challenge() {
  const { market: marketKey } = useParams();
  const { market, loading, refresh } = useMarket(marketKey ?? null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [settleSig, setSettleSig] = useState<string | undefined>();
  const [txConfirmed, setTxConfirmed] = useState(false);
  const [cascadeDone, setCascadeDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fraudError, setFraudError] = useState<string>("InvalidStatProof");
  const reduced = usePrefersReducedMotion();
  const demo = isDemoMode();
  const role = useDemoRole();
  // Let the VERIFIED stamp + pulse breathe before the receipt takes over. onDone fires the
  // instant the stamp mounts, so without a dwell the swap happens in the same commit and the
  // hero moment is never seen. Reduced motion skips the dwell.
  const revealDwellMs = reduced ? 0 : demo ? 1600 : 1100;

  if (!marketKey) return <Empty text="No challenge specified." />;
  if (loading && !market) return <Skeleton />;
  if (!market) return <Empty text="Challenge not found on devnet." />;

  const proof = proofForStatKeys(predicateStatKeys(market.predicate));
  const statLabel = describeStats(proof.statsToProve, sides);
  // The forged proof and its label are derived together, so the leaf the cascade breaks on
  // shows the lie next to the truth ("claims Mexico 15 corners — really 12").
  const forgedProof = tamperProof(proof);
  const forgedLabel = describeForgedStats(forgedProof.statsToProve, proof.statsToProve, sides);
  const isSettled = market.status === "settled" && market.outcome;

  const onAccept = async () => {
    setBusy(true);
    try {
      await acceptMarket(demoTaker, new PublicKey(marketKey));
      await refresh();
    } catch (err) {
      alert(`Accept failed: ${String(err).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  };

  const onSettle = async () => {
    setPhase("settling");
    setTxConfirmed(false);
    setCascadeDone(false);
    try {
      // Whoever is settling signs — permissionless. In the scripted demo the losing taker
      // settles, which is the point: the proof, not the settler, decides the winner.
      const sig = await settleMarket(roleWallet(role), market, proof);
      setSettleSig(sig);
      setTxConfirmed(true);
      await refresh();
    } catch (err) {
      alert(`Settle failed: ${String(err).slice(0, 240)}`);
      setPhase("idle");
    }
  };

  const onFraud = async () => {
    setPhase("fraud");
    const res = await reVerifyOnChain(forgedProof, market.predicate);
    setFraudError(res.errorName ?? "InvalidStatProof");
  };

  return (
    <div className="space-y-6">
      <FightCard market={market} />

      <AnimatePresence mode="wait">
        {/* Hold on the settle cascade until it has BOTH finished animating and confirmed
            on-chain — otherwise a fast devnet confirmation swaps in the receipt mid-animation
            and the "VERIFIED ON SOLANA" stamp never lands (the hero moment on video). A cold
            load of an already-settled market skips this and shows the receipt directly. */}
        {phase === "settling" && !(cascadeDone && isSettled) ? (
          <motion.div key="settling" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="p-6">
              <div className="mb-4 text-center text-xs uppercase tracking-widest text-chalk-faint">
                Verifying against the on-chain daily root…
              </div>
              <VerificationCascade nodes={buildCascade(proof, statLabel)} mode="verify" onDone={() => setTimeout(() => setCascadeDone(true), revealDwellMs)} />
              {!txConfirmed && <div className="mt-4 text-center text-xs text-chalk-dim">settling on devnet…</div>}
            </Card>
          </motion.div>
        ) : isSettled ? (
          <motion.div key="receipt" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <Receipt market={market} marketKey={marketKey} proof={proof} settleSig={settleSig} />
            <Divider className="my-8" />
            <FraudPanel phase={phase} onFraud={onFraud} forgedProof={forgedProof} forgedLabel={forgedLabel} fraudError={fraudError} />
          </motion.div>
        ) : (
          <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* An open market shows different actions per side: the taker takes the bet; the
                creator can't take their own, so they get the shareable link instead. */}
            {market.status === "open" && role === "taker" && (
              <Card className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
                <div>
                  <div className="display text-lg font-semibold text-chalk">Take the other side</div>
                  <div className="text-sm text-chalk-dim">Match the stake to lock in the bet.</div>
                </div>
                <Button onClick={onAccept} disabled={busy} className="w-full shrink-0 whitespace-nowrap sm:w-auto">
                  {busy ? "Accepting…" : "Accept challenge"}
                </Button>
              </Card>
            )}
            {market.status === "open" && role === "creator" && (
              <Card className="p-6">
                <div className="flex items-center gap-2">
                  <span className="size-2 shrink-0 animate-pulse rounded-full bg-volt" />
                  <div className="display text-lg font-semibold text-chalk">Waiting for an opponent</div>
                </div>
                <div className="mt-1 text-sm text-chalk-dim">
                  Your stake is escrowed. Send this link to whoever wants the other side.
                </div>
                <ShareLink />
              </Card>
            )}
            {market.status === "active" && (
              <Card className="flex flex-col items-center gap-4 p-6 text-center">
                <div>
                  <div className="display text-xl font-semibold text-chalk">Match is final. Settle it.</div>
                  <div className="mt-1 text-sm text-chalk-dim">
                    Anyone can settle — the proof decides the winner, not the settler.
                  </div>
                </div>
                <Button onClick={onSettle}>Settle by proof</Button>
              </Card>
            )}
            {(market.status === "cancelled" || market.status === "refunded") && (
              <Empty text={`This challenge was ${market.status}.`} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FraudPanel({
  phase,
  onFraud,
  forgedProof,
  forgedLabel,
  fraudError,
}: {
  phase: Phase;
  onFraud: () => void;
  forgedProof: ReturnType<typeof proofForStatKeys>;
  forgedLabel: string;
  fraudError: string;
}) {
  return (
    <Card className="border-flag-red/20 p-6">
      {/* Stacks on narrow screens — side by side, the button squeezed to three lines. */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="display text-lg font-semibold text-chalk">Try to forge this result</div>
          <div className="text-sm text-chalk-dim">
            Tamper a proven stat and submit it. Watch the chain reject the forgery.
          </div>
        </div>
        {phase !== "fraud" && (
          <Button variant="danger" onClick={onFraud} className="w-full shrink-0 whitespace-nowrap sm:w-auto">
            Forge the proof
          </Button>
        )}
      </div>
      <AnimatePresence>
        {phase === "fraud" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
            <VerificationCascade nodes={buildCascade(forgedProof, forgedLabel)} mode="fraud" breakAt={1} errorName={fraudError} />
            <p className="mt-4 text-center text-xs text-chalk-dim">
              The tampered value breaks the Merkle leaf hash, so the TxLINE oracle rejects it
              inside the settle CPI. The escrow is never touched.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** Copy the challenge URL. Carries ?demo=1 in a demo session so the opener lands in demo mode
 *  too — otherwise their fresh window would miss the role chip and the paced animations. */
function ShareLink() {
  const [copied, setCopied] = useState(false);
  let url = "";
  if (typeof window !== "undefined") {
    const u = new URL(window.location.href);
    if (isDemoMode()) u.searchParams.set("demo", "1");
    url = u.toString();
  }
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button
      onClick={copy}
      title={url}
      className="group mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-pitch-950/60 px-3 py-2.5 text-left mono text-xs text-chalk-dim hover:border-volt/40"
    >
      <span className="truncate">{url}</span>
      <span className={`shrink-0 text-[11px] font-semibold ${copied ? "text-volt" : "text-chalk-faint group-hover:text-volt/80"}`}>
        {copied ? "copied ✓" : "copy link"}
      </span>
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card className="p-10 text-center text-chalk-dim">
      <div className="text-sm">{text}</div>
    </Card>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-64 animate-pulse rounded-2xl border border-line bg-pitch-850" />
      <div className="h-24 animate-pulse rounded-2xl border border-line bg-pitch-850" />
    </div>
  );
}
