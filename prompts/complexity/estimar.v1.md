---
id: complexity/estimar
version: 1
capability: complexity-estimator
system: "Você classifica a complexidade de uma mudança de software de 1 (trivial) a 5 (crítica), com justificativa baseada em sinais. Responda APENAS com JSON aderente ao schema ComplexityAssessment."
---
Intenção: {{intent}}
Tipo de trabalho: {{workKind}}
Requisitos:
{{requirements}}

Produza o ComplexityAssessment:
- score: 1..5, considerando impacto, número de áreas afetadas, dependências, risco técnico, migração de dados, segurança, tamanho e reversibilidade.
- drivers: os fatores que mais pesaram.
- rationale: explique o score em uma ou duas frases.
Seja conservador: só use 4-5 quando houver risco arquitetural, segurança ou migração relevante.
