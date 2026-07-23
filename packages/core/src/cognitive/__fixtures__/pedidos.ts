import type { WorkKind } from "@pm/contracts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Caminho do projeto-fixture (um app Node/React com testes). */
export const SAMPLE_NODE_PATH = join(here, "sample-node");

export interface Pedido {
  name: string;
  rawPrompt: string;
  workKind: WorkKind;
  expect: { minTasks: number; minComplexity?: number; maxComplexity?: number };
}

/** Os 4 pedidos golden que exercitam as rotas de complexidade da Camada 1. */
export const PEDIDOS: Pedido[] = [
  {
    name: "bugfix-trivial",
    rawPrompt: "corrigir o texto do botão de enviar que está escrito errado",
    workKind: "bugfix",
    expect: { minTasks: 1, maxComplexity: 3 },
  },
  {
    name: "ui-adjustment",
    rawPrompt: "mudar a cor do cabeçalho da tela inicial para azul",
    workKind: "ui-adjustment",
    expect: { minTasks: 1, maxComplexity: 2 },
  },
  {
    name: "feature-media",
    rawPrompt:
      "adicionar um filtro por data na tela de relatórios, com um endpoint no backend para buscar os dados",
    workKind: "feature",
    expect: { minTasks: 2 },
  },
  {
    name: "greenfield",
    rawPrompt: "criar um app de lista de tarefas com backend, banco de dados e frontend",
    workKind: "new-project",
    expect: { minTasks: 2, minComplexity: 4 },
  },
];
