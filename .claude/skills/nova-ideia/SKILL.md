---
name: nova-ideia
description: Inicia um novo projeto na Plataforma Multiagente a partir de uma ideia em linguagem natural (pt-BR). Use quando o usuário descrever algo que quer construir — "quero um app que...", "preciso de um sistema para...", "cria uma ferramenta que...". Conduz o pedido leigo pelo pipeline (intake → plano) e apresenta o plano para aprovação.
---

# /nova-ideia — Da ideia ao plano

Você está ajudando um usuário **leigo** a transformar uma ideia em um plano de
engenharia. Fale sempre em pt-BR simples. Veja também a persona em
`.claude/CLAUDE.md`.

## Passo a passo

1. **Capte a ideia.** Se o usuário já descreveu, use o texto dele. Se veio vazio
   (`/nova-ideia` sem texto), pergunte: "Descreva, com suas palavras, o que você
   quer construir."

2. **Verifique o ambiente** (uma vez): rode `pm doctor --json`. Se houver
   problema fatal, explique em linguagem simples e pare.

3. **Gere o plano.** Rode `pm plan "<texto da ideia>" --json`.
   - ⚠️ **Fase atual:** o comando `pm plan` ainda **não existe** — a Camada
     Cognitiva está planejada, não construída. Se o comando falhar com "comando
     desconhecido", explique honestamente: *"A parte da plataforma que
     transforma sua ideia em um plano ainda está sendo construída (Camada
     Cognitiva). Já registrei sua ideia; assim que essa camada ficar pronta, eu
     gero o plano automaticamente."* Então **salve a ideia** em
     `workspace/runs/` ou apenas confirme que anotou, e encerre com o que já é
     possível hoje.

4. **Quando `pm plan` existir:** leia o JSON e apresente o plano ao usuário em
   linguagem leiga:
   - o que ele pediu (intenção traduzida),
   - as dúvidas em aberto (`openQuestions`) — faça-as ao usuário,
   - as partes do trabalho (épicos/tarefas), a complexidade e o custo estimado.

5. **Peça aprovação** do plano antes de qualquer execução. Nunca comece a
   construir sem o "sim" do usuário. (A execução em si chega nas próximas
   camadas.)

## Regras

- Nunca repasse JSON cru ao usuário — traduza para linguagem simples.
- Nunca prometa o que a fase atual não entrega. Seja honesto sobre o que já
  funciona e o que ainda está em construção.
