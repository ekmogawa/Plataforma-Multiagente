# Base de Conhecimento (Vault Obsidian)

Esta pasta **é** um vault do [Obsidian](https://obsidian.md). Abra-a no Obsidian
para navegar visualmente pela memória da plataforma.

A plataforma escreve markdown comum aqui — com frontmatter e wikilinks `[[...]]`.
Nenhum plugin é obrigatório: o Obsidian é apenas o visualizador. A IA lê os
mesmos arquivos através de um índice de busca (SQLite FTS5).

## Estrutura

- `projetos/<slug>/` — uma nota por projeto gerado: o que foi pedido, o que foi
  entregue, custo, links para decisões e lições.
- `decisoes/` — ADRs (registros de decisão arquitetural) acumulados entre projetos.
- `licoes/` — lições aprendidas (sucessos e falhas com causa). Alimentam o
  Evolution Engine.
- `grafos/<slug>/` — relatórios do Graphify: o grafo estrutural do código de cada
  projeto, navegável no Obsidian.

O vault é versionado em git — o histórico da memória fica preservado.
