import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isDemoMode } from "@/lib/motion";
import { Chip } from "./ui";

export function Shell({ children }: { children: ReactNode }) {
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
            {isDemoMode() && <Chip className="border-volt/40 text-volt">demo mode</Chip>}
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
