import type { ModelsConfig, ModelTier } from "@pm/contracts";

/**
 * Capability Resolver — resolve uma **capacidade** nomeada (ex.: "planner",
 * "coder-backend") em um modelo do catálogo, considerando a complexidade e o
 * teto de tier da estratégia. Os componentes pedem capacidades; nunca modelos.
 *
 * Separado do Model Resolver de propósito: trocar a estratégia de seleção aqui
 * não mexe em como o modelo fala com o provedor.
 */

const TIER_ORDER: Record<ModelTier, number> = { cheap: 0, mid: 1, premium: 2 };

export interface CapabilityDecision {
  capability: string;
  model: string;
  /** Explica a escolha (vira artefato de decisão para auditoria). */
  reason: string;
}

export class UnknownCapabilityError extends Error {}

export class CapabilityResolver {
  constructor(private readonly config: ModelsConfig) {}

  /** Lista as capacidades disponíveis no catálogo. */
  list(): string[] {
    return Object.keys(this.config.capabilities);
  }

  has(capability: string): boolean {
    return capability in this.config.capabilities;
  }

  resolve(
    capability: string,
    opts: {
      complexity?: number;
      tierCeiling?: ModelTier;
      /**
       * Modelos a evitar — regra de diversidade: quem implementou uma mudança
       * não deve revisá-la. Se todos os candidatos estiverem excluídos, mantém
       * a escolha original e registra o conflito no reason.
       */
      exclude?: string[];
    } = {},
  ): CapabilityDecision {
    const rule = this.config.capabilities[capability];
    if (!rule) {
      throw new UnknownCapabilityError(
        `Capacidade "${capability}" não existe em models.yaml.`,
      );
    }

    // 1. Aplica a primeira condição de complexidade que casar; senão default.
    let model = rule.default;
    let reason = `default da capacidade ${capability}`;
    const complexity = opts.complexity;
    if (complexity !== undefined) {
      for (const [key, target] of Object.entries(rule)) {
        if (key === "default") continue;
        if (matchesComplexity(key, complexity)) {
          model = target;
          reason = `condição "${key}" (complexidade ${complexity})`;
          break;
        }
      }
    }
    if (!model) {
      throw new UnknownCapabilityError(
        `Capacidade "${capability}" sem modelo default em models.yaml.`,
      );
    }

    // 2. Respeita o teto de tier: se o modelo escolhido excede, tenta baixar.
    if (opts.tierCeiling) {
      const downgraded = this.applyCeiling(model, opts.tierCeiling);
      if (downgraded && downgraded !== model) {
        reason += `; rebaixado para respeitar teto ${opts.tierCeiling}`;
        model = downgraded;
      }
    }

    // 3. Diversidade: evita modelos excluídos (ex.: o autor da mudança) usando
    //    a cadeia de fallback. Se não houver alternativa, mantém e registra.
    if (opts.exclude?.length && opts.exclude.includes(model)) {
      const chain = this.config.fallbacks[model] ?? [];
      const alternative = chain.find((alt) => {
        if (opts.exclude!.includes(alt)) return false;
        if (!this.config.models[alt]) return false;
        if (opts.tierCeiling) {
          const entry = this.config.models[alt];
          if (entry && TIER_ORDER[entry.tier] > TIER_ORDER[opts.tierCeiling]) {
            return false;
          }
        }
        return true;
      });
      if (alternative) {
        reason += `; trocado de ${model} por diversidade (autor≠revisor)`;
        model = alternative;
      } else {
        reason += `; sem alternativa de diversidade para ${model} — mantido`;
      }
    }

    return { capability, model, reason };
  }

  /** Se o modelo excede o teto, procura na cadeia de fallback um dentro do teto. */
  private applyCeiling(model: string, ceiling: ModelTier): string {
    const entry = this.config.models[model];
    if (!entry) return model;
    if (TIER_ORDER[entry.tier] <= TIER_ORDER[ceiling]) return model;

    const chain = this.config.fallbacks[model] ?? [];
    for (const alt of chain) {
      const altEntry = this.config.models[alt];
      if (altEntry && TIER_ORDER[altEntry.tier] <= TIER_ORDER[ceiling]) {
        return alt;
      }
    }
    // Nenhuma alternativa dentro do teto — mantém (o chamador decide).
    return model;
  }
}

/** Avalia condições como "complexity>=4", "complexity<=2", "complexity==3". */
function matchesComplexity(key: string, complexity: number): boolean {
  const m = key.match(/^complexity\s*(>=|<=|==|>|<)\s*(\d+)$/);
  if (!m) return false;
  const op = m[1];
  const n = Number(m[2]);
  switch (op) {
    case ">=":
      return complexity >= n;
    case "<=":
      return complexity <= n;
    case ">":
      return complexity > n;
    case "<":
      return complexity < n;
    case "==":
      return complexity === n;
    default:
      return false;
  }
}
