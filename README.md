# Plataforma Multiagente

Plataforma de engenharia de software assistida por IA. Transforma um pedido em
linguagem leiga em software de qualidade profissional, através de um pipeline
estruturado: entendimento → planejamento → orquestração → execução (scripts
determinísticos + agentes de IA) → validação com correção → aprovação → git →
memória persistente → auto-evolução.

O código da plataforma é escrito pela IA. O operador conversa em português via
Claude Code; a plataforma cuida da engenharia.

## Como está organizado

Monorepo pnpm com 4 pacotes:

| Pacote | Papel |
| --- | --- |
| `@pm/contracts` | Schemas zod — as formas de dados que fluem pelo pipeline. Zero dependências internas. |
| `@pm/core` | Tudo que executa: camadas cognitiva, orquestração, execução, governança, conhecimento; adaptadores de modelo; SQLite. |
| `@pm/cli` | O comando `pm` — a interface que o Claude Code aciona. Toda saída tem `--json`. |
| `@pm/registry-tools` | Valida o registro (Manual de Relações) e gera a documentação humana. |

Diretórios de configuração e conhecimento:

| Pasta | Papel |
| --- | --- |
| `registry/` | **Manual de Relações** — fonte única de verdade dos componentes e suas relações. |
| `config/` | `models.yaml` (catálogo + roteamento de modelos), `strategies.yaml`, `platform.yaml`. |
| `prompts/` | Biblioteca de prompts versionada. |
| `docs/` | Documentação **gerada** (manual de relações, diagramas) + ADRs manuais. |
| `knowledge/` | Vault Obsidian com a memória acumulada (projetos, decisões, lições). |
| `workspace/` | Runtime: projetos gerados, logs de execução, banco SQLite. Não versionado. |

## Pré-requisitos

- Node.js ≥ 20 (testado no Node 24)
- pnpm 11+
- Git

## Primeiros passos

```bash
pnpm install
pnpm build
cp .env.example .env   # preencha as chaves de API
pnpm pm doctor         # verifica ambiente, banco e registro
```

## Estado atual

Fase 0 (espinha mínima) em construção. Veja o roadmap camada por camada no
plano de implementação e o estado dos componentes em
[`docs/manual-de-relacoes.md`](docs/manual-de-relacoes.md).
