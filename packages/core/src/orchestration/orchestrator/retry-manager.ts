import type { TaskRow } from "../../db/tasks-repo.js";
import { isoAdd, type Clock } from "../../shared/clock.js";
import type { RetryDecision } from "./types.js";

/**
 * Retry Manager — a escada de retry com LIMITE DURO. Dado o resultado de uma
 * falha, decide retry (com backoff) ou escalonamento. A tentativa 3+ marca
 * tierBump (subir de modelo) — informativo na Camada 2 (tudo é echo); a Camada 3
 * usa para re-rotear. maxRetries = nº TOTAL de tentativas; escala em attempt >= maxRetries.
 */
export interface RetryManagerConfig {
  backoffBaseMs: number;
  backoffFactor: number;
  backoffMaxMs: number;
}

export class RetryManager {
  constructor(private readonly cfg: RetryManagerConfig) {}

  backoffMs(attempt: number): number {
    return Math.min(
      this.cfg.backoffBaseMs * this.cfg.backoffFactor ** (attempt - 1),
      this.cfg.backoffMaxMs,
    );
  }

  onFailure(row: TaskRow, clock: Clock): RetryDecision {
    // row.attempt já é a tentativa executada (o claim incrementou).
    if (row.attempt >= row.spec.maxRetries) {
      return { kind: "escalate" };
    }
    const notBefore = isoAdd(clock.now(), this.backoffMs(row.attempt));
    return { kind: "retry", notBefore, tierBump: row.attempt >= 2 };
  }
}
