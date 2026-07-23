import {
  ArtifactStore,
  CacheRepo,
  CapabilityResolver,
  CognitivePipeline,
  EventBus,
  EventLog,
  loadModelsConfig,
  loadStrategiesConfig,
  MetricsCollector,
  MetricsRepo,
  ModelResolver,
  openDatabase,
  ProjectsRepo,
  RunsRepo,
  systemClock,
  systemIds,
  type ModePreference,
} from "@pm/core";
import { WorkKind } from "@pm/contracts";
import { readFileSync } from "node:fs";
import { emit, mark, type OutputOptions } from "../output.js";

export interface PlanArgs {
  projectSlug: string;
  prompt: string;
  workKind?: string;
  preference: ModePreference;
  showPlano: boolean;
}

/**
 * pm plan --projeto <slug> "<pedido>" — roda a Camada 1 e gera o plano.
 */
export async function planCommand(args: PlanArgs, opts: OutputOptions): Promise<number> {
  // Valida o tipo de trabalho (default: feature).
  const wk = WorkKind.safeParse(args.workKind ?? "feature");
  if (!wk.success) {
    emit(
      { ok: false, error: `work-kind inválido: ${args.workKind}` },
      () =>
        `${mark.fail} work-kind inválido. Use um de: feature, bugfix, refactor, optimization, ui-adjustment, analysis, new-project.`,
      opts,
    );
    return 2;
  }

  const db = openDatabase();
  try {
    const project = new ProjectsRepo(db).get(args.projectSlug);
    if (!project) {
      emit(
        { ok: false, error: `projeto não registrado: ${args.projectSlug}` },
        () =>
          `${mark.fail} Projeto "${args.projectSlug}" não está registrado. Use: pm projeto add <pasta> --nome ${args.projectSlug}`,
        opts,
      );
      return 1;
    }

    const modelsConfig = loadModelsConfig();
    const strategiesConfig = loadStrategiesConfig();
    const bus = new EventBus();
    const metrics = new MetricsRepo(db);
    new EventLog(db).attachTo(bus);
    new MetricsCollector(metrics, bus).start();

    const pipeline = new CognitivePipeline({
      runs: new RunsRepo(db),
      artifacts: new ArtifactStore(db),
      metrics,
      cache: new CacheRepo(db),
      bus,
      capabilityResolver: new CapabilityResolver(modelsConfig),
      gateway: new ModelResolver(modelsConfig),
      modelsConfig,
      strategiesConfig,
      clock: systemClock,
      ids: systemIds,
    });

    const result = await pipeline.plan({
      project,
      rawPrompt: args.prompt,
      workKind: wk.data,
      preference: args.preference,
    });

    const plano = args.showPlano ? readFileSync(result.planoPath, "utf8") : undefined;

    emit({ ...result, plano }, () => renderHuman(result, plano), opts);
    return 0;
  } catch (err) {
    emit(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      () => `${mark.fail} Falha ao gerar o plano: ${err instanceof Error ? err.message : String(err)}`,
      opts,
    );
    return 1;
  } finally {
    db.close();
  }
}

function renderHuman(
  r: Awaited<ReturnType<CognitivePipeline["plan"]>>,
  plano: string | undefined,
): string {
  if (plano) return plano.trimEnd();
  const modeNote = r.mode === "heuristic" ? " (modo offline, por regras)" : "";
  return [
    `${mark.ok} Plano gerado para "${r.projectSlug}"${modeNote}.`,
    `  Run: ${r.runId}`,
    `  Complexidade: ${r.complexity}/5 (${r.strategyProfile})`,
    `  Tarefas: ${r.taskCount}`,
    `  Plano legível: ${r.planoPath}`,
    r.requiresHumanApproval
      ? "  Aguardando sua aprovação antes de executar."
      : "  Trabalho trivial — pode seguir para execução.",
  ].join("\n");
}
