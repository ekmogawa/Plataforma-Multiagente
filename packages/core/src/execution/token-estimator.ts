/**
 * Estimativa barata de tokens (~4 chars/token). Determinística; usada pelo
 * Context Builder para respeitar o orçamento sem chamar tokenizador de modelo.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
