import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isDemoMode } from "@/lib/motion";
import { setDemoRole, useDemoRole } from "@/lib/demoRole";
import { Chip } from "./ui";

/**
 * Under ?demo=1, shows which side this tab is playing and lets you flip it. Role lives in
 * per-tab sessionStorage, so a second window opening a shared link is already "taker" — the
 * switcher is mainly a legible on-screen label for the demo video, plus an escape hatch to
 * play both sides from one tab.
 */
function RoleSwitcher() {
  const role = useDemoRole();
  const other = role === "creator" ? "taker" : "creator";
  return (
    <button
      type="button"
      onClick={() => setDemoRole(other)}
      title={`Acting as ${role} — click to act as ${other}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-volt/40 bg-pitch-800 px-3 py-1 text-xs font-medium text-volt transition-colors hover:bg-pitch-700"
    >
      <span className="size-1.5 rounded-full bg-volt" />
      acting as {role}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const demo = isDemoMode();
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-pitch-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <Link to="/" className="group flex items-center gap-2">
            <span className="display text-lg font-bold tracking-[0.2em] text-chalk transition-colors group-hover:text-volt">
              VERDICT
            </span>
            <span className="size-1.5 rounded-full bg-volt shadow-[0_0_10px_2px_rgba(199,249,78,0.7)]" />
          </Link>
          <div className="flex items-center gap-2">
            {demo && <RoleSwitcher />}
            {demo && <Chip className="border-volt/40 text-volt">demo mode</Chip>}
            <Chip>devnet</Chip>
          </div>
        </div>
      </header>
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mx-auto max-w-3xl px-5 py-8"
      >
        {children}
      </motion.main>
      <footer className="mx-auto max-w-3xl px-5 py-10 text-center text-xs text-chalk-faint">
        Settled by the chain, not by a bookie. · TxLINE proofs on Solana devnet.
      </footer>
    </div>
  );
}
