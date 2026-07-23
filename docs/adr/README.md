# Registros de Decisão Arquitetural (ADRs)

ADRs registram decisões importantes com contexto, alternativas e consequências.
São a memória formal do "porquê" — o Manual de Relações mostra o "o quê".

## Quando uma ADR é obrigatória

- mudança de camada ou fronteira entre componentes;
- novo provedor de modelo ou banco de dados;
- alteração incompatível de contrato;
- mudança de política de segurança;
- introdução de infraestrutura distribuída;
- promoção de componente experimental a núcleo;
- troca de modelo que afete comportamento ou custo de forma relevante;
- qualquer decisão arquitetural não prevista no plano.

Use o [template](template.md). Numere sequencialmente: `ADR-0001-titulo.md`.

## Teste dos sete portões

Antes de incorporar um componente ou funcionalidade relevante, responda:

1. **Necessidade** — resolve um problema real?
2. **Estrutura** — foi modelado antes de implementado?
3. **Determinismo** — pode ser resolvido sem LLM?
4. **Simplicidade** — reduz ou aumenta a carga cognitiva?
5. **Integração** — respeita os contratos e princípios?
6. **Sustentabilidade** — consegue evoluir com o projeto e os modelos?
7. **Valor** — o benefício supera o custo e a manutenção?

Se alguma resposta for "não", a mudança volta para discussão (e, se avançar
mesmo assim, a justificativa vira ADR).
