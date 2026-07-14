import type { DemoFixture } from "./appData";

export type FixtureState = "upcoming" | "live" | "completed";

/**
 * A fixture is COMPLETED once we hold its final record (score/finalisedTs recorded alongside
 * its proofs), LIVE once kickoff has passed but no final record exists yet, and UPCOMING
 * before kickoff. Deriving it from data — rather than assuming every fixture is a finished
 * historical one — is what stops an upcoming match rendering "FULL TIME · CORNERS undefined".
 */
export function fixtureState(f: DemoFixture, now: number = Date.now()): FixtureState {
  if (f.finalisedTs != null || f.goals != null) return "completed";
  return now < f.startTime ? "upcoming" : "live";
}

/** Never show "undefined"/"null"/NaN to a user — an absent value is an em dash. */
export function dash(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number" && !Number.isFinite(value)) return "—";
  const s = String(value);
  return s === "" || s === "undefined" || s === "null" || s === "NaN" ? "—" : s;
}

/** "Kicks off 20:00 · today" — in the VIEWER's timezone, not ours. */
export function kickoffLabel(startTime: number, now: number = Date.now()): string {
  const d = new Date(startTime);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (ms: number) => {
    const x = new Date(ms);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const days = Math.round((startOfDay(startTime) - startOfDay(now)) / 86_400_000);
  const when =
    days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `Kicks off ${time} · ${when}`;
}

export function stateLabel(f: DemoFixture, isDemoFixture: boolean, state: FixtureState): string {
  // "Demo fixture" is only honest for the bundled historical match; a real fixture gets its
  // own competition name.
  const head = isDemoFixture ? "Demo fixture" : dash(f.competition);
  return `${head} · ${state}`;
}
