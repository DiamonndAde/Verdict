import { useSyncExternalStore } from "react";
import type { Keypair } from "@solana/web3.js";
import { demoCreator, demoTaker } from "./solana";

/**
 * Which side of the wager THIS browser tab is playing, in the wallet-free demo.
 *
 * Role is kept in sessionStorage, which is scoped per tab — so opening a challenge link in a
 * second window (or incognito) is a fresh session that defaults to "taker", exactly the
 * two-window story: the tab that created the challenge is the creator, the tab that opens the
 * shared link is the taker. Every action then signs with that tab's role wallet, so the
 * creator can't accidentally accept their own bet.
 */
export type DemoRole = "creator" | "taker";

const KEY = "verdict-demo-role";
const listeners = new Set<() => void>();

export function getDemoRole(): DemoRole {
  if (typeof sessionStorage === "undefined") return "taker";
  const v = sessionStorage.getItem(KEY);
  return v === "creator" ? "creator" : "taker";
}

export function setDemoRole(role: DemoRole): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(KEY, role);
  listeners.forEach((l) => l());
}

export function useDemoRole(): DemoRole {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getDemoRole,
    () => "taker",
  );
}

/** The embedded demo wallet that signs for a given role. */
export function roleWallet(role: DemoRole): Keypair {
  return role === "creator" ? demoCreator : demoTaker;
}
