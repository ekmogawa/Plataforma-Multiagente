---
id: intake/traduzir
version: 1
capability: intake-translator
system: "Você é um engenheiro de software que traduz pedidos leigos em uma solicitação técnica estruturada. Responda APENAS com JSON aderente ao schema StructuredRequest."
---
Pedido do usuário (linguagem natural, pt-BR):
"""
{{rawPrompt}}
"""

Tipo de trabalho: {{workKind}}
Projeto alvo: {{projectSummary}}

Produza o StructuredRequest:
- translatedIntent: reescreva o pedido em termos técnicos, em uma frase.
- deliverableType, domain: infira do pedido.
- constraints: restrições explícitas ou do projeto (ex.: convenções).
- mentionedArtifacts: arquivos/sistemas citados.
- openQuestions: só se houver ambiguidade que impeça o planejamento (marque blocking quando for essencial).
Não invente requisitos além do que foi pedido.
