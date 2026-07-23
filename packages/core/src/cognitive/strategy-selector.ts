import {
  ExecutionStrategy,
  type ComplexityScore,
  type ExecutionStrategy as ExecutionStrategyT,
  type StrategiesConfig,
} from "@pm/contracts";

/**
 * Strategy Selector — função PURA que mapeia a complexidade para a estratégia
 * de execução, via lookup em config/strategies.yaml. Sem tokens, sem IO.
 */
export function selectStrategyForScore(
  score: ComplexityScore,
  config: StrategiesConfig,
): ExecutionStrategyT {
  const profileName = config.scoreToProfile[String(score) as "1" | "2" | "3" | "4" | "5"];
  if (!profileName) {
    throw new Error(`Nenhum perfil mapeado para complexidade ${score}.`);
  }
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`Perfil "${profileName}" não existe em strategies.yaml.`);
  }
  // ExecutionStrategy.parse aplica defaults (concurrency, requiresHumanApproval)
  // e revalida a forma final.
  return ExecutionStrategy.parse({
    profile: profileName,
    planningDepth: profile.planningDepth,
    validationLevel: profile.validationLevel,
    modelTierCeiling: profile.modelTierCeiling,
    maxRetries: profile.maxRetries,
    budgetTokens: profile.budgetTokens,
    concurrency: profile.concurrency,
    requiresHumanApproval: profile.requiresHumanApproval,
  });
}

/** Conveniência: aceita uma ComplexityAssessment inteira. */
export function selectStrategy(
  assessment: { score: ComplexityScore },
  config: StrategiesConfig,
): ExecutionStrategyT {
  return selectStrategyForScore(assessment.score, config);
}
