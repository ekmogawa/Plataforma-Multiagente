/**
 * Formato de nota do vault: frontmatter YAML (ordem estável) + corpo markdown.
 * Determinístico — mesma entrada, mesmo bytes (idempotência via hash). Não usa a
 * lib `yaml` para escrever: o subconjunto aqui é simples e controlado (evita
 * variações de serialização entre versões).
 */

export type FrontmatterValue = string | number | boolean | string[];

/** Escapa uma string escalar para YAML (aspas duplas quando necessário). */
function yamlScalar(v: string): string {
  if (v === "") return '""';
  // Cita quando há caractere que confundiria o parser YAML.
  if (/^[\w./-]+$/.test(v) && !/^(true|false|null|yes|no|on|off)$/i.test(v)) return v;
  // Escapa \, ", e quebras de linha — um valor com \n (ex.: texto de finding do
  // revisor LLM) romperia o escalar YAML de linha única do frontmatter.
  return `"${v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function yamlLine(key: string, value: FrontmatterValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}: [${value.map((x) => yamlScalar(String(x))).join(", ")}]`;
  }
  if (typeof value === "boolean" || typeof value === "number") return `${key}: ${value}`;
  return `${key}: ${yamlScalar(value)}`;
}

/**
 * Compõe o markdown final. `frontmatter` é gravado na ORDEM das entradas.
 * `wikilinks` viram uma seção "Relacionado" no fim do corpo (Obsidian navega).
 */
export function composeMarkdown(input: {
  frontmatter: [string, FrontmatterValue][];
  body: string;
  wikilinks?: string[];
}): string {
  const fm = input.frontmatter.map(([k, v]) => yamlLine(k, v)).join("\n");
  let body = input.body.trimEnd();
  const links = (input.wikilinks ?? []).filter(Boolean);
  if (links.length > 0) {
    const uniq = [...new Set(links)];
    body += "\n\n## Relacionado\n" + uniq.map((l) => `- [[${l}]]`).join("\n");
  }
  // LF sempre (Windows-safe: markdown de git com fim de linha estável).
  return `---\n${fm}\n---\n\n${body}\n`;
}
