import { randomUUID } from "node:crypto";

/**
 * Fábrica de ids injetável. Ids de RUN/artefato usam isto; ids de nós do PLANO
 * são posicionais (n1, n1.1) e portanto já determinísticos por construção.
 *
 * `sequentialIds` dá ids estáveis nos testes (run_1, run_2, ...).
 */
export interface IdFactory {
  next(prefix: string): string;
}

export const systemIds: IdFactory = {
  next: (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`,
};

export function sequentialIds(): IdFactory {
  const counters = new Map<string, number>();
  return {
    next(prefix) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${n}`;
    },
  };
}

/**
 * Hash estável FNV-1a de 32 bits em hex — útil para derivar um id determinístico
 * a partir de conteúdo (ex.: requestId a partir do prompt). Não é criptográfico.
 */
export function stableId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
