import type { GateFinding, GateVerdict } from "@pm/contracts";

/**
 * Verdict determinístico a partir dos findings (NUNCA vem do LLM):
 * - qualquer critical, OU qualquer high de segurança -> escalate
 * - qualquer high (não-segurança) OU qualquer warn -> revise
 * - só info / vazio -> approve
 */
export function decideVerdict(findings: GateFinding[]): GateVerdict {
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasHighSecurity = findings.some((f) => f.severity === "high" && f.category === "security");
  if (hasCritical || hasHighSecurity) return "escalate";

  const hasHigh = findings.some((f) => f.severity === "high");
  const hasWarn = findings.some((f) => f.severity === "warn");
  if (hasHigh || hasWarn) return "revise";

  return "approve";
}
