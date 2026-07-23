import {
  PlannedTask,
  WorkflowDAG,
  type ExecutionStrategy,
} from "@pm/contracts";
import { z } from "zod";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { SeedEntry, TasksRepo } from "../db/tasks-repo.js";
import type { RoutedTask, TaskRouter } from "./task-router.js";

/**
 * Carrega o DAG e as PlannedTasks (artefatos da Camada 1), roteia cada uma para
 * TaskSpec, valida a invariante id-a-id (todo nó do DAG tem tarefa e vice-versa)
 * e faz o SEED transacional de tasks/task_edges. A Camada 1 permanece pura.
 */

export class RunLoadError extends Error {}

export interface LoadRunDeps {
  artifacts: ArtifactStore;
  tasks: TasksRepo;
  router: TaskRouter;
}

export interface LoadedRun {
  dag: WorkflowDAG;
  routed: RoutedTask[];
}

function readArtifactJson(artifacts: ArtifactStore, id: string): unknown {
  const content = artifacts.readContent(id);
  if (content === undefined) throw new RunLoadError(`Artefato sem conteúdo: ${id}`);
  return JSON.parse(content);
}

export function loadRunTasks(
  deps: LoadRunDeps,
  runId: string,
  strategy: ExecutionStrategy,
  now: string,
): LoadedRun {
  const all = deps.artifacts.listByRun(runId);

  const dagArts = all.filter((a) => a.kind === "dag");
  const dagArt = dagArts[dagArts.length - 1];
  if (!dagArt) throw new RunLoadError(`Run ${runId} não tem artefato de DAG (planeje primeiro).`);

  const plannedArts = all.filter((a) => a.kind === "planned-tasks");
  const plannedArt = plannedArts[plannedArts.length - 1];
  if (!plannedArt) throw new RunLoadError(`Run ${runId} não tem artefato de planned-tasks.`);

  const dag = WorkflowDAG.parse(readArtifactJson(deps.artifacts, dagArt.id));
  const planned = z.array(PlannedTask).parse(readArtifactJson(deps.artifacts, plannedArt.id));

  // Invariante id-a-id: nós do DAG <-> PlannedTasks.
  const nodeIds = new Set(dag.nodes.map((n) => n.taskId));
  const taskIds = new Set(planned.map((t) => t.id));
  for (const id of nodeIds) {
    if (!taskIds.has(id)) throw new RunLoadError(`Nó ${id} do DAG sem PlannedTask correspondente.`);
  }
  for (const id of taskIds) {
    if (!nodeIds.has(id)) throw new RunLoadError(`PlannedTask ${id} sem nó no DAG.`);
  }

  const routed = deps.router.routeAll(planned, strategy);
  const routedById = new Map(routed.map((r) => [r.spec.id, r] as const));

  const entries: SeedEntry[] = dag.nodes.map((node) => {
    const r = routedById.get(node.taskId)!;
    return {
      spec: r.spec,
      dependsRemaining: node.dependsRemaining,
      initialState: node.state === "ready" ? "ready" : "pending",
    };
  });

  deps.tasks.seed(runId, entries, dag.edges, now);

  // Decisões de roteamento viram artefatos (auditoria).
  for (const r of routed) {
    deps.artifacts.storeJson({
      runId,
      taskId: r.spec.id,
      kind: "decision",
      name: `routing-${r.spec.id}`,
      data: r.decision,
    });
  }

  return { dag, routed };
}
