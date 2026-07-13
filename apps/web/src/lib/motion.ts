import { useEffect, useState } from "react";

/** True when the user asked for reduced motion — hero animations downgrade to simple fades. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * `?demo=1` slows the hero animations ~20% so they read clearly on video. Once seen, it is
 * remembered for the session, so SPA navigations that drop the query param (e.g. create →
 * challenge) stay in demo mode. Sharing a challenge from a demo session carries the param on
 * the link (see ShareLink), so the opener's fresh session picks it up here.
 */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("demo") === "1") {
    try {
      sessionStorage.setItem("verdict-demo", "1");
    } catch {
      /* ignore */
    }
    return true;
  }
  try {
    return sessionStorage.getItem("verdict-demo") === "1";
  } catch {
    return false;
  }
}

/** Scale a duration by demo mode (slower) / reduced motion (near-instant). */
export function scaleDuration(seconds: number, reduced: boolean, demo: boolean): number {
  if (reduced) return 0.001;
  return demo ? seconds * 1.2 : seconds;
}

export const spring = { type: "spring" as const, stiffness: 320, damping: 26 };
export const softSpring = { type: "spring" as const, stiffness: 180, damping: 22 };
export const stampSpring = { type: "spring" as const, stiffness: 260, damping: 14 };
