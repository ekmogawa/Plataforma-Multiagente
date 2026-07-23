import type { ComponentSpec, Pipeline, Relation } from "@pm/contracts";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadRegistry } from "./loader.js";
import { findRepoRoot, registryPaths } from "./paths.js";

/**
 * Gera a documentação humana a partir do registro:
 *  - docs/manual-de-relacoes.md (pt-BR)
 *  - docs/diagramas/pipeline.mmd, camadas.mmd (Mermaid)
 * Os arquivos são GERADOS — não edite à mão.
 */

const LAYER_TITLES: Record<string, string> = {
  cognitive: "Camada Cognitiva",
  orchestration: "Camada de Orquestração",
  execution: "Camada de Execução",
  governance: "Camada de Governança",
  knowledge: "Camada de Conhecimento e Evolução",
  infrastructure: "Infraestrutura",
};

const LAYER_ORDER = [
  "cognitive",
  "orchestration",
  "execution",
  "governance",
  "knowledge",
  "infrastructure",
];

const STATUS_LABEL: Record<string, string> = {
  active: "✅ ativo",
  planned: "🕓 planejado",
  deprecated: "⚠️ obsoleto",
};

export function generateDocs(root?: string): { manual: string; diagrams: string[] } {
  const repoRoot = root ?? findRepoRoot();
  const paths = registryPaths(repoRoot);
  const registry = loadRegistry(repoRoot);

  const manual = renderManual(
    registry.components,
    registry.relations,
    registry.pipelines,
  );
  const pipelineMmd = renderPipelineMermaid(registry.pipelines);
  const layersMmd = renderLayersMermaid(registry.components, registry.relations);

  mkdirSync(paths.diagramas, { recursive: true });
  writeFileSync(paths.manual, manual, "utf8");
  const pipelineFile = `${paths.diagramas}/pipeline.mmd`;
  const layersFile = `${paths.diagramas}/camadas.mmd`;
  writeFileSync(pipelineFile, pipelineMmd, "utf8");
  writeFileSync(layersFile, layersMmd, "utf8");

  return { manual: paths.manual, diagrams: [pipelineFile, layersFile] };
}

function renderManual(
  components: ComponentSpec[],
  relations: Relation[],
  pipelines: Pipeline[],
): string {
  const byId = new Map(components.map((c) => [c.id, c]));
  const lines: string[] = [];

  lines.push("# Manual de Relações");
  lines.push("");
  lines.push(
    "> **Arquivo gerado** a partir de `registry/`. Não edite à mão — rode `pm registry docs`.",
  );
  lines.push("");
  lines.push(
    "Este é o mapa único da plataforma: cada componente, o que faz, quais contratos troca e como é substituível. É a fonte de verdade que humanos leem e a IA consulta.",
  );
  lines.push("");

  // Visão geral do pipeline.
  lines.push("## Pipeline principal");
  lines.push("");
  for (const p of pipelines) {
    if (p.description_ptbr) lines.push(`*${p.description_ptbr}*`);
    lines.push("");
    lines.push("```mermaid");
    lines.push(renderPipelineMermaid([p]).trim());
    lines.push("```");
    lines.push("");
  }

  // Componentes por camada.
  const layers = LAYER_ORDER.filter((l) =>
    components.some((c) => c.layer === l),
  );
  for (const layer of layers) {
    lines.push(`## ${LAYER_TITLES[layer] ?? layer}`);
    lines.push("");
    const inLayer = components
      .filter((c) => c.layer === layer)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const c of inLayer) {
      lines.push(`### ${c.name} \`${c.id}\``);
      lines.push("");
      lines.push(`- **Estado:** ${STATUS_LABEL[c.status] ?? c.status}`);
      lines.push(`- **Tipo:** ${c.kind}`);
      lines.push(`- **Propósito:** ${c.purpose_ptbr}`);
      if (c.contract.input || c.contract.output) {
        const io = [
          c.contract.input ? `entrada \`${c.contract.input}\`` : null,
          c.contract.output ? `saída \`${c.contract.output}\`` : null,
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(`- **Contratos:** ${io}`);
      }
      if (c.entrypoint) lines.push(`- **Código:** \`${c.entrypoint}\``);
      if (c.config_keys.length)
        lines.push(`- **Config:** ${c.config_keys.map((k) => `\`${k}\``).join(", ")}`);
      if (c.swappable_via) lines.push(`- **Como trocar:** ${c.swappable_via}`);

      // Relações que saem deste componente.
      const outgoing = relations.filter((r) => r.from === c.id);
      if (outgoing.length) {
        lines.push(`- **Conexões:**`);
        for (const r of outgoing) {
          const target = byId.get(r.to);
          const payload = r.payload ? ` (\`${r.payload}\`)` : "";
          const note = r.note_ptbr ? ` — ${r.note_ptbr}` : "";
          lines.push(
            `  - ${r.type} → ${target?.name ?? r.to}${payload}${note}`,
          );
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n") + "\n";
}

/** Sanitiza um id para nó Mermaid (sem pontos/hífens). */
function nodeId(id: string): string {
  return id.replace(/[.\-]/g, "_");
}

function renderPipelineMermaid(pipelines: Pipeline[]): string {
  const lines: string[] = ["flowchart TD"];
  for (const p of pipelines) {
    const steps = [...p.steps].sort((a, b) => a.order - b.order);
    for (const s of steps) {
      lines.push(`  ${nodeId(s.component)}["${s.component}"]`);
    }
    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i];
      const b = steps[i + 1];
      if (a && b) lines.push(`  ${nodeId(a.component)} --> ${nodeId(b.component)}`);
    }
  }
  return lines.join("\n") + "\n";
}

function renderLayersMermaid(
  components: ComponentSpec[],
  relations: Relation[],
): string {
  const lines: string[] = ["flowchart LR"];
  const layers = LAYER_ORDER.filter((l) => components.some((c) => c.layer === l));

  for (const layer of layers) {
    lines.push(`  subgraph ${nodeId(layer)}["${LAYER_TITLES[layer] ?? layer}"]`);
    for (const c of components.filter((c) => c.layer === layer)) {
      lines.push(`    ${nodeId(c.id)}["${c.name}"]`);
    }
    lines.push("  end");
  }

  // Só arestas entre camadas diferentes (para não poluir).
  const byId = new Map(components.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const r of relations) {
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    if (!from || !to || from.layer === to.layer) continue;
    const key = `${from.layer}->${to.layer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${nodeId(from.layer)} --> ${nodeId(to.layer)}`);
  }

  return lines.join("\n") + "\n";
}
