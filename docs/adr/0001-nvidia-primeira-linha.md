# ADR-0001: NVIDIA como primeira linha de execução de modelos

## Status

Aceita (2026-07-22)

## Contexto

A plataforma roteia todo modelo por capacidade (o componente pede `coder-backend`,
`planner`, etc.; só `config/models.yaml` conhece os nomes de modelo). Até aqui a
primeira linha era o gateway OmniRouter (DeepSeek/Qwen/GLM/Gemini) e a assinatura
Claude para planejamento/auditoria. O usuário descobriu que a NVIDIA (build.nvidia.com)
oferece modelos potentes com endpoints gratuitos, compatíveis com a API OpenAI, e
já criou sua chave. Referência: apêndice `APENDICE_INTEGRACAO_NVIDIA_PRIMEIRA_LINHA.md`.

## Problema

Tornar a NVIDIA a primeira linha de execução, mantendo o padrão de roteamento por
capacidade e um fallback confiável, sem espalhar nomes de modelo pelo código.

## Alternativas

- **Adaptador NVIDIA novo** — desnecessário: a API NVIDIA é compatível com OpenAI e
  o `OmniRouterAdapter` já faz chamadas OpenAI-compatíveis (HTTP real, com fallback).
- **NVIDIA via OmniRouter** — acoplaria a NVIDIA ao gateway atual; pior isolamento.
- **NVIDIA como provedor próprio (escolhida)** — provedor `nvidia` com `protocol: openai`
  e baseUrl pública; só a chave vai ao `.env`. Isolado, trocável por config.

## Decisão

- Adicionar os provedores `nvidia` (primeira linha) e `zenmux` (fallback do Kimi K3),
  ambos `protocol: openai`. A baseUrl da NVIDIA é fixa no yaml (pública); a do Zenmux
  vem de `${ZENMUX_BASE_URL}`. Chaves via `NVIDIA_API_KEY` / `ZENMUX_API_KEY`.
- Rotear as capacidades para modelos NVIDIA (GLM, Nemotron para alto risco/complexidade,
  Step Flash para tarefas rápidas, MiniMax para visão).
- Fallback de todas: **Kimi K3 (zenmux-kimi)** — reserva estratégica e executor de
  código complexo, conforme o apêndice. Vision cai no Gemini (Kimi não é de visão).
- Claude/Opus permanecem no catálogo, mas fora de qualquer capacidade ativa, até o
  adaptador `anthropic` existir (hoje ele lançaria "não implementado").

## Consequências

- A plataforma passa a chamar a NVIDIA de verdade assim que `NVIDIA_API_KEY` estiver
  no `.env` — é o primeiro provedor real executável (sai do modo só-offline).
- Custo cai (endpoints gratuitos). Qualidade depende do catálogo NVIDIA.
- Porta que se fecha por ora: planejamento/auditoria não usam mais Claude (o adaptador
  anthropic segue não implementado). Reabre quando esse adaptador for construído.

## Riscos e mitigação

- **model_id incorreto** (400 do provedor): o `nvidia-glm` está como PLACEHOLDER e os
  demais precisam de confirmação no catálogo. Mitigação: `pm doctor` + smoke antes de
  runs reais; erro do provedor é surfaced honestamente.
- **Structured outputs**: nem todo modelo NIM suporta `response_format: json_schema`.
  Se um retornar 400, é não-retriável (não cai no fallback). Verificar por capacidade.
- **Indisponibilidade da NVIDIA**: fallback automático para Kimi K3 em erro retriável.
  Circuit breaker e roteamento especial de `complex-code` ficam para uma próxima etapa
  (escopo desta mudança: só a troca de provedor).

## Evidências

`config/models.yaml` (providers nvidia/zenmux, capacidades → NVIDIA, fallbacks → kimi),
`.env.example` atualizado. Verificação: `pm doctor`.

## Referências

- `arquivos pessoais/APENDICE_INTEGRACAO_NVIDIA_PRIMEIRA_LINHA.md`
- https://build.nvidia.com/explore/discover
