import confetti from "canvas-confetti";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { CascadeNode } from "@/lib/verify";
import { isDemoMode, scaleDuration, stampSpring, usePrefersReducedMotion } from "@/lib/motion";

export type CascadeMode = "verify" | "fraud";

interface Props {
  nodes: CascadeNode[];
  mode: CascadeMode;
  /** Index at which a fraud proof breaks (the tampered leaf → first fold). Default 1. */
  breakAt?: number;
  /** Oracle error name shown under the REJECTED stamp. */
  errorName?: string;
  autoStart?: boolean;
  onDone?: () => void;
}

type Phase = "idle" | "running" | "verified" | "rejected";

export function VerificationCascade({ nodes, mode, breakAt = 1, errorName = "InvalidStatProof", autoStart = true, onDone }: Props) {
  const reduced = usePrefersReducedMotion();
  const demo = isDemoMode();
  const [step, setStep] = useState(-1);
  const [phase, setPhase] = useState<Phase>("idle");
  const shellRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  const hop = scaleDuration(0.42, reduced, demo) * 1000;

  useEffect(() => {
    if (!autoStart) return;
    setStep(-1);
    setPhase("running");
    doneRef.current = false;
    let i = -1;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const advance = () => {
      i += 1;
      setStep(i);
      const rejectingHere = mode === "fraud" && i === breakAt;
      if (rejectingHere) {
        timers.push(setTimeout(() => finish("rejected"), hop));
        return;
      }
      if (i >= nodes.length - 1) {
        timers.push(setTimeout(() => finish("verified"), hop));
        return;
      }
      timers.push(setTimeout(advance, hop));
    };
    timers.push(setTimeout(advance, reduced ? 0 : 250));
    function finish(p: Phase) {
      if (doneRef.current) return;
      doneRef.current = true;
      setPhase(p);
      if (p === "verified" && !reduced) {
        confetti({
          particleCount: 44,
          spread: 62,
          startVelocity: 34,
          origin: { y: 0.5 },
          colors: ["#c7f94e", "#dcff7a", "#ffffff"],
          scalar: 0.9,
        });
      }
      onDone?.();
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, mode, breakAt, nodes.length]);

  const broke = phase === "rejected";

  return (
    <motion.div
      ref={shellRef}
      animate={broke && !reduced ? { x: [0, -9, 8, -6, 4, 0] } : {}}
      transition={{ duration: 0.42 }}
      className="relative mx-auto flex max-w-md flex-col"
    >
      {nodes.map((node, i) => {
        const state = nodeState(i, step, phase, mode, breakAt);
        const isBreak = mode === "fraud" && i === breakAt;
        return (
          <div key={node.id} className="flex flex-col items-stretch">
            {i > 0 && <Connector filled={step >= i && !(broke && isBreak)} broken={broke && isBreak} hop={hop} reduced={reduced} count={node.hops} />}
            <CascadeRow node={node} state={state} />
          </div>
        );
      })}

      <AnimatePresence>
        {phase === "verified" && <VerifiedStamp reduced={reduced} />}
        {phase === "rejected" && <RejectedStamp errorName={errorName} reduced={reduced} />}
      </AnimatePresence>

      {/* Full-screen volt pulse on success. */}
      <AnimatePresence>
        {phase === "verified" && !reduced && (
          <motion.div
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(199,249,78,0.18),transparent_60%)]"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type NodeStatus = "pending" | "active" | "done" | "rejected";

function nodeState(i: number, step: number, phase: Phase, mode: CascadeMode, breakAt: number): NodeStatus {
  if (mode === "fraud" && phase === "rejected" && i === breakAt) return "rejected";
  if (i < step) return "done";
  if (i === step) return phase === "rejected" && i === breakAt ? "rejected" : "done";
  return i === step + 1 && step >= 0 ? "active" : "pending";
}

function CascadeRow({ node, state }: { node: CascadeNode; state: NodeStatus }) {
  const done = state === "done";
  const rejected = state === "rejected";
  return (
    <motion.div
      initial={{ opacity: 0.35, scale: 0.98 }}
      animate={{
        opacity: state === "pending" ? 0.4 : 1,
        scale: 1,
        borderColor: rejected ? "var(--color-flag-red)" : done ? "var(--color-volt)" : "var(--color-line)",
      }}
      transition={{ duration: 0.28 }}
      className="relative z-10 flex items-center gap-3 rounded-xl border bg-pitch-850 px-4 py-3"
    >
      <StatusDot done={done} rejected={rejected} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="display text-sm font-semibold text-chalk">{node.label}</span>
          <span className="text-[11px] text-chalk-faint">{node.sublabel}</span>
        </div>
        <div className="mono mt-0.5 truncate text-[11px] text-chalk-dim">{node.hashHex.slice(0, 32)}…</div>
      </div>
    </motion.div>
  );
}

function StatusDot({ done, rejected }: { done: boolean; rejected: boolean }) {
  return (
    <div
      className="flex size-7 shrink-0 items-center justify-center rounded-full border"
      style={{
        borderColor: rejected ? "var(--color-flag-red)" : done ? "var(--color-volt)" : "var(--color-line)",
        background: rejected ? "rgba(255,77,77,0.15)" : done ? "rgba(199,249,78,0.15)" : "transparent",
      }}
    >
      <AnimatePresence mode="wait">
        {rejected ? (
          <motion.span key="x" initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-flag-red">
            ✕
          </motion.span>
        ) : done ? (
          <motion.svg key="c" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={stampSpring} width="14" height="14" viewBox="0 0 14 14" className="text-volt">
            <path d="M2 7.5l3 3 7-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        ) : (
          <motion.span key="d" className="size-1.5 rounded-full bg-chalk-faint" />
        )}
      </AnimatePresence>
    </div>
  );
}

function Connector({ filled, broken, hop, reduced, count }: { filled: boolean; broken: boolean; hop: number; reduced: boolean; count: number }) {
  return (
    <div className="relative ml-[26px] h-7 w-0.5">
      <div className="absolute inset-0 rounded bg-line" />
      <motion.div
        className="absolute inset-x-0 top-0 origin-top rounded"
        style={{ background: broken ? "var(--color-flag-red)" : "var(--color-volt)" }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: filled || broken ? (broken ? 0.5 : 1) : 0 }}
        transition={{ duration: reduced ? 0 : hop / 1000, ease: "easeInOut" }}
      />
      {broken && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute left-1/2 top-1/2 h-2 w-4 -translate-x-1/2 -translate-y-1/2 rotate-6 bg-pitch-850"
        />
      )}
      {count > 0 && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-chalk-faint">
          {count} sibling {count === 1 ? "hash" : "hashes"}
        </span>
      )}
    </div>
  );
}

function VerifiedStamp({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.4, rotate: -8 }}
      animate={{ opacity: 1, scale: 1, rotate: -6 }}
      transition={reduced ? { duration: 0.2 } : stampSpring}
      className="mx-auto mt-6 w-fit select-none rounded-lg border-[3px] border-volt px-5 py-2 text-center"
      style={{ boxShadow: "0 0 30px -8px rgba(199,249,78,0.7)" }}
    >
      <div className="display text-xl font-bold tracking-widest text-volt">VERIFIED ON SOLANA</div>
    </motion.div>
  );
}

function RejectedStamp({ errorName, reduced }: { errorName: string; reduced: boolean }) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.5, rotate: 6 }}
      animate={{ opacity: 1, scale: 1, rotate: 4 }}
      transition={reduced ? { duration: 0.2 } : { type: "spring", stiffness: 300, damping: 12 }}
      className="mx-auto mt-6 w-fit select-none rounded-lg border-[3px] border-flag-red px-5 py-2 text-center"
      style={{ boxShadow: "0 0 30px -8px rgba(255,77,77,0.7)" }}
    >
      <div className="display text-xl font-bold tracking-widest text-flag-red">REJECTED ON-CHAIN</div>
      <div className="mono mt-1 text-xs text-flag-red/80">{errorName}</div>
    </motion.div>
  );
}
