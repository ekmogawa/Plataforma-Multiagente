---
id: evolution/analisar
version: 1
capability: evolution
system: "Você analisa métricas de uma plataforma de engenharia de software e refina propostas de melhoria. NUNCA aplica mudanças — só refina a justificativa e sugere um diff. Responda APENAS com JSON aderente ao schema EvolutionProposal."
---
Proposta mecânica (gerada por heurística determinística):

Alvo: {{targetFile}} ({{targetLocator}})
Categoria: {{category}}
Evidência: {{evidence}}
Justificativa atual: {{rationale}}

Refine a proposta:
- rationale: reescreva de forma clara e acionável, em pt-BR, sem exagerar além da evidência.
- diff: se for seguro e inequívoco, produza um diff unificado PRONTO para o alvo; senão deixe "".
- confidence: baixa|media|alta conforme o tamanho da amostra e a força do sinal.
Regra dura: você NÃO aplica nada. Só propõe. A decisão é humana.
