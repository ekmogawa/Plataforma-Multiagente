/**
 * Análise de texto determinística para a destilação offline (Camada 5).
 * Sem IA: tokenização, stopwords pt-BR, similaridade de Jaccard, resumo
 * extrativo e extração de tags por frequência. Tudo puro e testável.
 */

const STOPWORDS_PT = new Set([
  "a", "o", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "um", "uma", "uns", "umas", "que", "com", "por", "para", "se", "os", "as", "ao",
  "aos", "à", "às", "pelo", "pela", "ser", "ter", "foi", "são", "está", "este",
  "esta", "isso", "como", "mais", "mas", "ou", "já", "não", "sim", "sua", "seu",
  "suas", "seus", "the", "of", "to", "in", "and", "is", "for", "on", "with",
]);

/** Tokens de conteúdo: minúsculo, sem acento, >=3 chars, sem stopword. */
export function contentTokens(text: string): string[] {
  const raw = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .match(/[a-z0-9_]{3,}/g);
  if (!raw) return [];
  return raw.filter((t) => !STOPWORDS_PT.has(t));
}

/** Similaridade de Jaccard entre dois conjuntos de tokens: |∩| / |∪|. */
export function jaccard(aTokens: string[], bTokens: string[]): number {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Tags: os N tokens de conteúdo mais frequentes (desempate alfabético). */
export function topTags(text: string, n = 6): string[] {
  const freq = new Map<string, number>();
  for (const t of contentTokens(text)) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * Resumo extrativo: escolhe as `maxSentences` frases de maior pontuação (soma da
 * frequência dos seus tokens de conteúdo) e as devolve na ORDEM original.
 */
export function extractiveSummary(text: string, maxSentences = 3): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length <= maxSentences) return sentences.join(" ");

  const freq = new Map<string, number>();
  for (const t of contentTokens(text)) freq.set(t, (freq.get(t) ?? 0) + 1);

  const scored = sentences.map((s, i) => {
    const toks = contentTokens(s);
    const score = toks.reduce((acc, t) => acc + (freq.get(t) ?? 0), 0) / (toks.length || 1);
    return { i, s, score };
  });
  const chosen = new Set(
    [...scored].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, maxSentences).map((x) => x.i),
  );
  return sentences.filter((_, i) => chosen.has(i)).join(" ");
}
