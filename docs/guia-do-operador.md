# Guia do Operador

Este guia é para **você**, que usa a plataforma sem precisar programar. A
plataforma escreve o código; você conversa em português e aprova as etapas.

## Como você opera

Você abre o **Claude Code** na pasta desta plataforma e conversa. O Claude Code
assume o papel de gerente de projeto: entende seu pedido, aciona a plataforma e
te explica tudo em linguagem simples.

Você quase nunca digita comandos. Mas eles existem por baixo, e o Claude Code os
usa por você.

## O que já funciona hoje (Fase 0)

A base da plataforma está montada. Nesta fase dá para:

- **Conferir a saúde da plataforma:** peça "verifique se está tudo certo" e o
  Claude Code roda o diagnóstico (`pm doctor`).
- **Ver o mapa da plataforma:** abra [`manual-de-relacoes.md`](manual-de-relacoes.md)
  para ver todos os componentes e como se conectam. É gerado automaticamente.
- **Registrar uma ideia:** use `/nova-ideia` e descreva o que quer construir. A
  ideia é capturada; a geração automática do plano chega na próxima fase.

## O que chega nas próximas fases

A plataforma é construída por camadas. Cada camada é testada sozinha antes da
próxima:

1. **Cognitiva** — transforma sua ideia em um plano de engenharia.
2. **Orquestração** — coordena a execução das tarefas.
3. **Execução** — escreve o código de fato (scripts + agentes de IA).
4. **Governança** — valida, revisa e pede sua aprovação antes de integrar.
5. **Conhecimento** — guarda o aprendizado (Obsidian, grafo do código) e melhora
   a plataforma a cada projeto.

## Configurar as chaves de IA

Para usar os modelos de IA, copie `.env.example` para `.env` e preencha as
chaves que você tiver. Sem chaves, a plataforma roda em "modo offline" (útil
para testes, mas sem chamar os modelos de verdade).

A escolha de qual modelo usar em cada etapa está em `config/models.yaml` —
trocar um modelo é editar uma linha ali, sem mexer em código.

## Se algo der errado

Peça ao Claude Code: "roda o diagnóstico da plataforma". Ele executa
`pm doctor` e te diz, em português, o que está faltando.
