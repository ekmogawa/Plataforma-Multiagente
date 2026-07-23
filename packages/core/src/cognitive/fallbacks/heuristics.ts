/**
 * Helpers determinísticos e puros compartilhados pelas heurísticas das etapas.
 * Nada de Date/random aqui — só transformação de texto.
 */

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Normaliza (minúsculas, sem acento) para casar palavras-chave. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Quebra o texto normalizado em palavras (tokens alfanuméricos). */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Casa uma keyword com FRONTEIRA DE PALAVRA (evita "senha" dentro de "desenha"
 * ou "tela" dentro de "prateleira"). Needles longos (>=4) são tratados como
 * radical (prefixo de palavra: "migra" casa "migração"); needles curtos exigem
 * palavra exata ("api", "cli", "app"). Needles com espaço são casados como frase.
 */
export function wordMatch(text: string, needle: string): boolean {
  const n = normalize(needle);
  if (n.includes(" ")) return normalize(text).includes(n); // frase multi-palavra
  const tokens = tokenize(text);
  if (n.length >= 4) return tokens.some((t) => t.startsWith(n));
  return tokens.some((t) => t === n);
}

/**
 * Conta SINAIS distintos: quantas palavras diferentes do texto casam alguma
 * keyword (+ frases que casam). Contar tokens distintos evita inflar quando
 * dois sinônimos (ex.: "migra"/"migration") casariam a MESMA palavra.
 */
export function countMatches(text: string, keywords: string[]): number {
  const tokens = tokenize(text);
  const normText = normalize(text);
  const matchedTokens = new Set<string>();
  const matchedPhrases = new Set<string>();
  for (const k of keywords) {
    const n = normalize(k);
    if (n.includes(" ")) {
      if (normText.includes(n)) matchedPhrases.add(n);
    } else if (n.length >= 4) {
      for (const t of tokens) if (t.startsWith(n)) matchedTokens.add(t);
    } else {
      for (const t of tokens) if (t === n) matchedTokens.add(t);
    }
  }
  return matchedTokens.size + matchedPhrases.size;
}

/** True se qualquer keyword casar (por palavra). */
export function anyMatch(text: string, keywords: string[]): boolean {
  return keywords.some((k) => wordMatch(text, k));
}

/** Primeiro rótulo cujo `needle` casa (por palavra), ou o default. */
export function firstHint<T extends { needle: string }>(
  text: string,
  hints: T[],
  pick: (h: T) => string,
  fallback: string,
): string {
  for (const h of hints) {
    if (wordMatch(text, h.needle)) return pick(h);
  }
  return fallback;
}

/**
 * Extrai artefatos citados: caminhos/arquivos plausíveis (com extensão de arquivo
 * iniciada por letra). Ex.: "src/app.ts", "Login.tsx", "config/models.yaml".
 * Exige um ponto seguido de letra para não capturar datas ("21/07/2026"),
 * versões ("3.24") nem pares como "cliente/servidor".
 */
export function extractMentionedArtifacts(text: string): string[] {
  const found = new Set<string>();
  const re = /\b[\w-]+(?:\/[\w-]+)*\.[a-z][a-z0-9]{0,4}\b/gi;
  for (const m of text.matchAll(re)) {
    found.add(m[0]);
  }
  return [...found].sort();
}
