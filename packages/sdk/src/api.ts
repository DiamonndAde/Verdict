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
      return (await res.json()) as T;
    }
  }

  /** Fixtures starting at or within 30 days after startEpochDay (default: today). */
  fixturesSnapshot(startEpochDay?: number, competitionId?: number): Promise<Fixture[]> {
    return this.get<Fixture[]>("/fixtures/snapshot", { startEpochDay, competitionId });
  }

  /** Latest score state for a fixture, optionally as of a historical timestamp (ms). */
  scoresSnapshot(fixtureId: number, asOfMs?: number): Promise<ScoreRecord[]> {
    return this.get<ScoreRecord[]>(`/scores/snapshot/${fixtureId}`, { asOf: asOfMs });
  }

  /** Score updates in a 5-minute interval bucket. */
  scoresUpdates(epochDay: number, hourOfDay: number, interval: number): Promise<ScoreRecord[]> {
    return this.get<ScoreRecord[]>(`/scores/updates/${epochDay}/${hourOfDay}/${interval}`);
  }

  /**
   * Full score-update log for one fixture. Only serves fixtures whose start time is
   * between 6 hours and 2 weeks in the past (OpenAPI-documented window).
   */
  scoresHistorical(fixtureId: number): Promise<ScoreRecord[]> {
    return this.get<ScoreRecord[]>(`/scores/historical/${fixtureId}`);
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
