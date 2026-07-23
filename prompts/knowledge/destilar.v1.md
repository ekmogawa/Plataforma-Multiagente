---
id: knowledge/destilar
version: 1
capability: context-refiner
system: "Você destila notas de conhecimento em resumos úteis. Responda APENAS com JSON aderente ao schema DistilledNote. Não invente fatos além da nota."
---
Nota a destilar (tipo: {{kind}}):

Título: {{title}}

Corpo:
"""
{{body}}
"""

Produza o DistilledNote:
- summary: 2-3 frases que capturam o essencial, em pt-BR.
- tags: 3-6 termos-chave (minúsculos, sem acento).
- patterns: padrões/lições generalizáveis, se houver (senão lista vazia).
- links: deixe vazio (os wikilinks são resolvidos pela plataforma).
Não copie o corpo inteiro; resuma. Não invente nada que não esteja na nota.
