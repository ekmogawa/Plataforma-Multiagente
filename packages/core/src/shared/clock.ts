/**
 * Relógio injetável. O miolo cognitivo NUNCA chama `new Date()` diretamente —
 * recebe um Clock. Assim os golden tests são 100% determinísticos (fixedClock)
 * e a produção usa o relógio do sistema.
 */
export interface Clock {
  /** Timestamp ISO-8601 atual. */
  now(): string;
  /** Relógio monotônico em ms — para medir durações (latência de chamadas). */
  monotonicMs(): number;
  /**
   * Espera `ms` COERENTE com o relógio: o relógio de parede dorme de verdade; o
   * manual AVANÇA o tempo. Assim o orquestrador nunca gira sem progresso.
   */
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  monotonicMs: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Relógio fixo para testes — sempre devolve o mesmo instante e duração 0. */
export function fixedClock(iso = "2026-01-01T00:00:00.000Z"): Clock {
  return { now: () => iso, monotonicMs: () => 0, sleep: () => Promise.resolve() };
}

/**
 * Relógio manual para testes do orquestrador: começa em `startIso` e avança
 * quando o teste chama advance/set. Governa lease_expires e not_before, então o
 * teste exercita timeout/backoff sem tempo de parede.
 */
export interface ManualClock extends Clock {
  advance(ms: number): void;
  set(iso: string): void;
}

export function manualClock(startIso = "2026-01-01T00:00:00.000Z"): ManualClock {
  let current = new Date(startIso).getTime();
  let mono = 0;
  const advance = (ms: number) => {
    current += ms;
    mono += ms;
  };
  return {
    now: () => new Date(current).toISOString(),
    monotonicMs: () => mono,
    // sleep AVANÇA o tempo (nada de espera real): o loop progride de forma determinística.
    sleep: (ms: number) => {
      advance(ms);
      return Promise.resolve();
    },
    advance,
    set(iso: string) {
      current = new Date(iso).getTime();
    },
  };
}

/**
 * Soma `deltaMs` a um timestamp ISO e devolve ISO — o MESMO formato de
 * `toISOString()`, para comparação lexicográfica correta em SQL (lease/backoff).
 */
export function isoAdd(nowIso: string, deltaMs: number): string {
  return new Date(new Date(nowIso).getTime() + deltaMs).toISOString();
}
