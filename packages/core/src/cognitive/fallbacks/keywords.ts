/**
 * Tabelas de sinais (keyword -> rótulo) usadas pelas heurísticas determinísticas.
 * Externalizar aqui deixa o comportamento ajustável sem tocar na lógica; o
 * Evolution Engine pode propor mudanças nestas tabelas com base em métricas.
 */

/** Sinais que empurram a complexidade para CIMA (peso alto). */
export const HIGH_COMPLEXITY_KEYWORDS = [
  "autentica",
  "auth",
  "oauth",
  "login",
  "senha",
  "migra",
  "migration",
  "seguran",
  "security",
  "criptografia",
  "pagamento",
  "payment",
  "arquitetura",
  "architecture",
  "integra",
  "concorrên",
  "performance",
  "escalabil",
  "banco de dados",
  "schema",
];

/** Sinais de complexidade média. */
export const MEDIUM_COMPLEXITY_KEYWORDS = [
  "funcionalidade",
  "feature",
  "endpoint",
  "api",
  "componente",
  "tela",
  "relatório",
  "filtro",
  "formulário",
  "refator",
  "refactor",
  "validação",
];

/** deliverableType por palavra-chave (primeiro que casar vence). */
export const DELIVERABLE_HINTS: { needle: string; type: string }[] = [
  { needle: "cli", type: "script" },
  { needle: "linha de comando", type: "script" },
  { needle: "script", type: "script" },
  { needle: "biblioteca", type: "library" },
  { needle: "library", type: "library" },
  { needle: "automa", type: "automation" },
  { needle: "api", type: "api" },
  { needle: "endpoint", type: "api" },
  { needle: "app", type: "webapp" },
  { needle: "aplicativo", type: "webapp" },
  { needle: "site", type: "webapp" },
  { needle: "tela", type: "webapp" },
  { needle: "página", type: "webapp" },
];

/** Domínio de negócio por palavra-chave. */
export const DOMAIN_HINTS: { needle: string; domain: string }[] = [
  { needle: "laudo", domain: "saúde" },
  { needle: "paciente", domain: "saúde" },
  { needle: "médic", domain: "saúde" },
  { needle: "exame", domain: "saúde" },
  { needle: "financ", domain: "financeiro" },
  { needle: "pagamento", domain: "financeiro" },
  { needle: "aluno", domain: "educação" },
  { needle: "curso", domain: "educação" },
  { needle: "venda", domain: "comércio" },
  { needle: "produto", domain: "comércio" },
];
