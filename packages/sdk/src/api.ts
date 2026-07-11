import type { TxLineAuth } from "./auth.js";
import { DEVNET, apiBase } from "./config.js";
import type {
  Fixture,
  OddsPayload,
  ScoreRecord,
  StatValidationLegacy,
  StatValidationV2,
  StatValidationV3,
} from "./types.js";

/**
 * Authenticated TxLINE data client. Injects `Authorization: Bearer <jwt>` and
 * `X-Api-Token` on every call and transparently refreshes the short-lived guest JWT
 * once on 401 before retrying, so long-running scripts (and the demo) never die mid-flow.
 */
export class TxLineClient {
  constructor(
    private readonly auth: TxLineAuth,
    private readonly origin: string = DEVNET.txlineOrigin,
  ) {}

  private async get<T>(pathname: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${apiBase(this.origin)}${pathname}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    let { jwt, apiToken } = await this.auth.getAuth();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
      });
      if (res.status === 401 && attempt === 0) {
        jwt = await this.auth.refreshJwt();
        continue;
      }
      if (!res.ok) {
        throw new Error(`GET ${url.pathname}${url.search} -> ${res.status}: ${await res.text()}`);
      }
      const text = await res.text();
      // /scores/historical answers with SSE-framed `data: {...}` lines despite the OpenAPI
      // declaring a JSON array (see FEEDBACK.md) — normalise both shapes here.
      if (text.trimStart().startsWith("data:")) {
        return text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5).trim())) as T;
      }
      return JSON.parse(text) as T;
    }
  }

  /** Fixtures starting at or within 30 days after startEpochDay (default: today). */
  fixturesSnapshot(startEpochDay?: number, competitionId?: number): Promise<Fixture[]> {
    return this.get<Fixture[]>("/fixtures/snapshot", { startEpochDay, competitionId });
  }

  /** Latest score state for a fixture, optionally as of a historical timestamp (ms). */
  async scoresSnapshot(fixtureId: number, asOfMs?: number): Promise<ScoreRecord[]> {
    const raw = await this.get<Record<string, unknown>[]>(`/scores/snapshot/${fixtureId}`, { asOf: asOfMs });
    return raw.map(normalizeScoreRecord);
  }

  /** Score updates in a 5-minute interval bucket. */
  async scoresUpdates(epochDay: number, hourOfDay: number, interval: number): Promise<ScoreRecord[]> {
    const raw = await this.get<Record<string, unknown>[]>(`/scores/updates/${epochDay}/${hourOfDay}/${interval}`);
    return raw.map(normalizeScoreRecord);
  }

  /**
   * Full score-update log for one fixture. Only serves fixtures whose start time is
   * between 6 hours and 2 weeks in the past (OpenAPI-documented window).
   */
  async scoresHistorical(fixtureId: number): Promise<ScoreRecord[]> {
    const raw = await this.get<Record<string, unknown>[]>(`/scores/historical/${fixtureId}`);
    return raw.map(normalizeScoreRecord);
  }

  /** Legacy proof payload for one or two stat keys -> on-chain `validateStat`. */
  statValidation(fixtureId: number, seq: number, statKey: number, statKey2?: number): Promise<StatValidationLegacy> {
    return this.get<StatValidationLegacy>("/scores/stat-validation", { fixtureId, seq, statKey, statKey2 });
  }

  /** V2 proof payload for N stat keys -> on-chain `validateStatV2`. Key order is part of the contract. */
  statValidationV2(fixtureId: number, seq: number, statKeys: number[]): Promise<StatValidationV2> {
    return this.get<StatValidationV2>("/scores/stat-validation", { fixtureId, seq, statKeys: statKeys.join(",") });
  }

  /** V3 multiproof payload (smallest) -> on-chain `validateStatV3`. Undocumented endpoint. */
  statValidationV3(fixtureId: number, seq: number, statKeys: number[]): Promise<StatValidationV3> {
    return this.get<StatValidationV3>("/scores/stat-validation-v3", { fixtureId, seq, statKeys: statKeys.join(",") });
  }

  /** Latest odds per market line, optionally as of a historical timestamp (ms). */
  oddsSnapshot(fixtureId: number, asOfMs?: number): Promise<OddsPayload[]> {
    return this.get<OddsPayload[]>(`/odds/snapshot/${fixtureId}`, { asOf: asOfMs });
  }
}

/**
 * Score records arrive camelCased from some endpoints and PascalCased from others
 * (e.g. /scores/historical SSE frames use `Action`/`Seq`/`Stats`). The docs acknowledge
 * this ("the payload field may appear as Seq or seq"); normalise to camelCase once here.
 */
export function normalizeScoreRecord(raw: Record<string, unknown>): ScoreRecord {
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k] as T;
    return undefined;
  };
  return {
    ...(raw as object),
    fixtureId: pick<number>("fixtureId", "FixtureId")!,
    gameState: pick<string>("gameState", "GameState") ?? "",
    startTime: pick<number>("startTime", "StartTime")!,
    competitionId: pick<number>("competitionId", "CompetitionId")!,
    participant1Id: pick<number>("participant1Id", "Participant1Id")!,
    participant2Id: pick<number>("participant2Id", "Participant2Id")!,
    participant1IsHome: pick<boolean>("participant1IsHome", "Participant1IsHome") ?? true,
    action: pick<string>("action", "Action") ?? "",
    ts: pick<number>("ts", "Ts")!,
    seq: pick<number>("seq", "Seq")!,
    statusId: pick<number | string>("statusId", "StatusId"),
    statusSoccerId: pick<number | string>("statusSoccerId", "StatusSoccerId"),
    period: pick<number>("period", "Period"),
    confirmed: pick<boolean>("confirmed", "Confirmed"),
    stats: pick<Record<string, number>>("stats", "Stats"),
  };
}
