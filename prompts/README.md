# Biblioteca de Prompts

Prompts versionados usados pelo **caminho LLM** das etapas cognitivas (quando há
chave de API). Cada etapa também tem um **fallback determinístico** em código
(offline) — estes prompts só entram quando o run roda em modo `llm`.

## Formato

Um arquivo por versão: `<etapa>/<nome>.v<N>.md`, com frontmatter + corpo.

```markdown
---
id: intake/traduzir
version: 1
capability: intake-translator
system: "Instrução de papel/sistema (uma linha)."
---
Corpo do template (mensagem do usuário) com {{placeholders}}.
```

- `id` — deve casar com o caminho (`<etapa>/<nome>`).
- `capability` — capacidade que o Capability Resolver usa para achar o modelo.
- `system` — a mensagem de sistema.
- Corpo — a mensagem do usuário; `{{chave}}` é substituído pelas variáveis da etapa.

**Melhorar um prompt = criar `v(N+1)`.** Versões antigas ficam para comparação de
métricas (o Evolution Engine). A biblioteca carrega a maior versão disponível.

O modelo deve responder **apenas com JSON** aderente ao schema da etapa; a saída
é validada por zod, com 1 tentativa de reparo.
