/**
 * Redação determinística de segredos.
 *
 * Princípio de segurança: segredos nunca entram em artefatos, prompts ou logs.
 * Aplicada pelo Artifact Store antes de persistir e, futuramente, pelo Context
 * Builder antes de enviar contexto a qualquer provedor.
 *
 * Padrões deliberadamente conservadores: preferimos redigir de menos a quebrar
 * conteúdo legítimo — o objetivo é pegar os formatos óbvios de credencial.
 */

const PATTERNS: RegExp[] = [
  // Chaves estilo OpenAI/Anthropic/Stripe (sk-..., sk-ant-..., rk_live_...)
  /\b(?:sk|rk)[-_](?:ant[-_])?(?:live[-_]|test[-_])?[A-Za-z0-9_-]{16,}\b/g,
  // AWS Access Key ID
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Tokens Bearer/Basic em headers
  /\b(?:[Bb]earer|[Bb]asic)\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  // GitHub tokens (ghp_, gho_, ghs_, github_pat_)
  /\b(?:ghp|gho|ghs)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Blocos de chave privada PEM
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// Atribuições do tipo API_KEY=..., senha: "...", token = '...', "password": "..."
// O ["']? antes do separador cobre chaves entre aspas em JSON ("password": "...").
const ASSIGNMENT =
  /((?:api[_-]?key|apikey|secret|token|senha|password|authorization|access[_-]?key)["']?\s*[=:]\s*["']?)([^\s"',]{8,})/gi;

// Credenciais embutidas em URL: scheme://usuario:senha@host
const URL_CREDENTIAL = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s:/@]{3,})@/gi;

export interface RedactionResult {
  text: string;
  /** Quantidade de trechos redigidos. */
  count: number;
}

export function redactSecrets(input: string): RedactionResult {
  let count = 0;
  let text = input;

  for (const pattern of PATTERNS) {
    text = text.replace(pattern, () => {
      count++;
      return "[REDIGIDO]";
    });
  }

  text = text.replace(ASSIGNMENT, (_m, prefix: string) => {
    count++;
    return `${prefix}[REDIGIDO]`;
  });

  text = text.replace(URL_CREDENTIAL, (_m, prefix: string) => {
    count++;
    return `${prefix}[REDIGIDO]@`;
  });

  return { text, count };
}
