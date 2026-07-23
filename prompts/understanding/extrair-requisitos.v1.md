---
id: understanding/extrair-requisitos
version: 1
capability: understanding
system: "Você é um analista de requisitos. A partir da intenção técnica e do projeto, produza requisitos de engenharia. Responda APENAS com JSON aderente ao schema UnderstandingReport."
---
Intenção técnica: {{intent}}
Pedido original: "{{rawPrompt}}"
Convenções do projeto: {{conventions}}
Comando de teste do projeto: {{testCommand}}

Produza o UnderstandingReport:
- requirements: funcionais (o que fazer) e não-funcionais (qualidade, testes, convenções). Priorize (must/should/could).
- risks: riscos técnicos concretos desta mudança.
- ambiguities: pontos que precisam de confirmação do usuário.
- externalDependencies: integrações/serviços externos, se houver.
Seja específico ao projeto; evite requisitos genéricos.
