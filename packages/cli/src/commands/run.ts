import {
  AcceptanceEngine,
  ArtifactStore,
  BackgroundOrchestrator,
  CacheRepo,
  CapabilityResolver,
  EchoWorker,
  EventBus,
  EventLog,
  ExecutorRegistry,
  Gatekeeper,
  GitManager,
  GitSafetyError,
  LlmWorker,
  ProjectManager,
  MetricsCollector,
  MetricsRepo,
  ModelResolver,
  PassThroughAcceptance,
  ProjectsRepo,
  readLatestEvidence,
  RunsRepo,
  TaskRouter,
  TasksRepo,
  allToExecutor,
  defaultDeterminismPolicy,
  loadEspecialidadesConfig,
  loadModelsConfig,
  loadPlatformConfig,
  registerDeterministicWorkers,
  systemClock,
  type AcceptanceGate,
  type RunOutcome,
} from "@pm/core";
import { ProjectMap } from "@pm/contracts";
import { openDatabase } from "@pm/core";
import { emit, mark, type OutputOptions } from "../output.js";

/**
 * pm run start <id> [--resume] — executa o DAG do run pelo Background
 * Orchestrator (Camada 2: worker.echo). --resume retoma após interrupção.
 */
export async function runStart(
  runId: string,
  flags: { resume: boolean; dryRun: boolean },
  opts: OutputOptions,
): Promise<number> {
  const db = openDatabase();
  try {
    const runsRepo = new RunsRepo(db);
    const run = runsRepo.get(runId);
    if (!run || !run.strategy || !run.projectSlug) {
      emit(
        { ok: false, error: `run inválido: ${runId}` },
        () => `${mark.fail} Run "${runId}" não existe ou não foi planejado.`,
        opts,
      );
      return 1;
    }
    // Estados terminais não podem ser reabertos (evita re-integrar um run já
    // aprovado ou reviver um rejeitado via --resume).
    if (run.state === "approved" || run.state === "rejected") {
      emit(
        { ok: false, error: `estado terminal: ${run.state}` },
        () =>
          `${mark.fail} Run "${runId}" já foi ${run.state === "approved" ? "aprovado" : "rejeitado"} — não pode ser reaberto.`,
        opts,
      );
      return 1;
    }
    const projects = new ProjectsRepo(db);
    const project = projects.get(run.projectSlug);
    if (!project) {
      emit(
        { ok: false, error: `projeto não registrado: ${run.projectSlug}` },
        () => `${mark.fail} Projeto "${run.projectSlug}" não está registrado.`,
        opts,
      );
      return 1;
    }

    const modelsConfig = loadModelsConfig();
    const especialidades = loadEspecialidadesConfig();
    const platform = loadPlatformConfig();
    const artifacts = new ArtifactStore(db);
    const projectMap = loadProjectMapArtifact(artifacts, runId);

    const bus = new EventBus();
    const metrics = new MetricsRepo(db);
    new EventLog(db).attachTo(bus);
    new MetricsCollector(metrics, bus).start();

    const registry = new ExecutorRegistry();
    const capabilityResolver = new CapabilityResolver(modelsConfig);
    let router: TaskRouter;
    let acceptanceGate: AcceptanceGate;
    let git: GitManager | undefined;

    if (flags.dryRun) {
      // Modo de teste: echo + PassThrough (o e2e da Camada 2), sem git.
      registry.register(new EchoWorker());
      router = new TaskRouter({
        especialidades,
        capabilityResolver,
        determinism: allToExecutor("worker.echo"),
        binding: { llmExecutorId: "worker.echo" },
      });
      acceptanceGate = new PassThroughAcceptance();
    } else {
      // Modo REAL: workers determinísticos + worker.llm; Acceptance roda testes reais.
      git = new GitManager(project.rootPath, project.defaultBranch);
      registerDeterministicWorkers(registry, { target: project, projectMap, git });
      registry.register(
        new LlmWorker({
          target: project,
          especialidades,
          capabilityResolver,
          gateway: new ModelResolver(modelsConfig),
          modelsConfig,
          artifacts,
          metrics,
          cache: new CacheRepo(db),
          clock: systemClock,
        }),
      );
      router = new TaskRouter({
        especialidades,
        capabilityResolver,
        determinism: defaultDeterminismPolicy(),
        binding: { llmExecutorId: "worker.llm" },
      });
      acceptanceGate = new AcceptanceEngine({ target: project, projectMap, artifacts });
    }

    const orchestrator = new BackgroundOrchestrator({
      runs: runsRepo,
      projects,
      tasks: new TasksRepo(db),
      artifacts,
      bus,
      registry,
      router,
      especialidades,
      platform,
      acceptanceGate,
    });

    // Ciclo de vida git (modo real, repo git).
    let branch: string | undefined;
    let originBranch: string | undefined;
    if (git && project.permissions.write && (await git.isGitRepo())) {
      try {
        if (flags.resume) {
          originBranch = readOrigin(artifacts, runId)?.originBranch;
          branch = await git.resumeRun(runId);
        } else {
          // Não iniciar (sem --resume) se o HEAD já está numa branch de run: seria
          // uma execução anterior interrompida. Capturar essa branch como origin
          // corromperia a base do approve e o alvo do reject.
          const current = await git.currentBranch();
          if (current.startsWith("pm/run-")) {
            throw new GitSafetyError(
              `O repositório está na branch de um run (${current}) — uma execução anterior não foi finalizada. Retome com --resume ou volte à branch principal antes de iniciar.`,
            );
          }
          await git.assertClean();
          originBranch = current;
          branch = await git.beginRun(runId);
          persistOrigin(artifacts, runId, originBranch, branch);
        }
      } catch (err) {
        if (err instanceof GitSafetyError) {
          emit({ ok: false, error: err.message }, () => `${mark.fail} ${err.message}`, opts);
          return 1;
        }
        throw err;
      }
    }

    const outcome = await orchestrator.start(runId, { resume: flags.resume });

    // Governança: execução done -> Gatekeeper -> evidências -> WIP commit -> awaiting-approval.
    let govVerdict: string | undefined;
    let awaiting = false;
    if (git && branch) {
      const tasksRepo = new TasksRepo(db);
      const changed = collectChangedFiles(tasksRepo, runId);
      if (outcome.state === "done") {
        const review = await new Gatekeeper({ tasks: tasksRepo, artifacts, target: project }).review(runId);
        govVerdict = review.verdict;
        bus.publish({
          name: "GatekeeperReviewed",
          ts: systemClock.now(),
          runId,
          producer: "governance.gatekeeper",
          data: { verdict: review.verdict, findings: review.findings.length },
        });
        new ProjectManager({ artifacts, runs: runsRepo, tasks: tasksRepo }).assembleEvidence(runId);
        await git.wipCommit(changed, runId);
        await git.checkoutOrigin(originBranch);
        runsRepo.setState(runId, "awaiting-approval");
        bus.publish({
          name: "RunAwaitingApproval",
          ts: systemClock.now(),
          runId,
          producer: "governance.project-manager",
          data: { verdict: review.verdict },
        });
        awaiting = true;
      } else {
        // paused/failed: preserva o parcial numa WIP e deixa a árvore limpa.
        await git.wipCommit(changed, runId);
        await git.checkoutOrigin(originBranch);
      }
    }

    emit(
      { runId, ...outcome, branch, awaiting, govVerdict, dryRun: flags.dryRun },
      () => renderStart(runId, outcome, { branch, awaiting, govVerdict }),
      opts,
    );
    return outcome.state === "failed" ? 1 : 0;
  } catch (err) {
    emit(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      () => `${mark.fail} Falha ao executar o run: ${err instanceof Error ? err.message : String(err)}`,
      opts,
    );
    return 1;
  } finally {
    db.close();
  }
}

/** Carrega o ProjectMap do artefato project-map do run. */
function loadProjectMapArtifact(artifacts: ArtifactStore, runId: string): ProjectMap {
  const arts = artifacts.listByRun(runId).filter((a) => a.kind === "project-map");
  const art = arts[arts.length - 1];
  if (!art) throw new Error(`Run ${runId} sem project-map — rode o planejamento primeiro.`);
  const content = artifacts.readContent(art.id);
  if (!content) throw new Error(`project-map sem conteúdo no run ${runId}.`);
  return ProjectMap.parse(JSON.parse(content));
}

/** União dos arquivos alterados por todas as tarefas do run (para o commit). */
function collectChangedFiles(tasks: TasksRepo, runId: string): string[] {
  const set = new Set<string>();
  for (const t of tasks.byRun(runId)) {
    for (const c of t.result?.changedFiles ?? []) set.add(c.path);
  }
  return [...set].sort();
}

function renderStart(
  runId: string,
  o: RunOutcome,
  gov: { branch?: string; awaiting: boolean; govVerdict?: string },
): string {
  if (gov.awaiting) {
    return [
      `${mark.ok} Execução concluída (${o.done} tarefa(s)).`,
      `  Revisão do Gatekeeper: ${gov.govVerdict}`,
      gov.branch ? `  Mudanças na branch: ${gov.branch}` : null,
      "  Aguardando sua decisão:",
      `    Ver evidências: pm run show ${runId}`,
      `    Aprovar:  pm approve ${runId}`,
      `    Rejeitar: pm reject ${runId}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const head =
    o.state === "paused"
      ? `${mark.warn} Run ${runId} pausado — precisa de decisão sua.`
      : o.state === "failed"
        ? `${mark.fail} Run ${runId} falhou.`
        : `${mark.ok} Run ${runId} concluído (modo teste).`;
  return [
    head,
    `  Tarefas concluídas: ${o.done}`,
    o.escalated > 0 ? `  Escaladas: ${o.escalated}` : null,
    o.blocked > 0 ? `  Bloqueadas: ${o.blocked}` : null,
    gov.branch ? `  Branch: ${gov.branch}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Persiste o ponto de origem git do run (para o boundary de processo do approve). */
export function persistOrigin(
  artifacts: ArtifactStore,
  runId: string,
  originBranch: string,
  runBranch: string,
): void {
  artifacts.storeJson({ runId, kind: "decision", name: "run-origin", data: { originBranch, runBranch } });
}

export function readOrigin(
  artifacts: ArtifactStore,
  runId: string,
): { originBranch: string; runBranch: string } | undefined {
  const art = artifacts
    .listByRun(runId)
    .filter((a) => a.kind === "decision" && a.path.endsWith("-run-origin.json"))
    .at(-1);
  if (!art) return undefined;
  const content = artifacts.readContent(art.id);
  if (!content) return undefined;
  try {
    return JSON.parse(content) as { originBranch: string; runBranch: string };
  } catch {
    return undefined;
  }
}

/** pm run show <id> — mostra o estado de um run e seus artefatos. */
export function runShow(runId: string, opts: OutputOptions): number {
  const db = openDatabase();
  try {
    const run = new RunsRepo(db).get(runId);
    if (!run) {
      emit(
        { ok: false, error: `run não encontrado: ${runId}` },
        () => `${mark.fail} Run "${runId}" não encontrado.`,
        opts,
      );
      return 1;
    }
    const store = new ArtifactStore(db);
    const artifacts = store.listByRun(runId);
    // Quando aguardando aprovação, mostra o resumo de evidências para a decisão.
    const evidence = run.state === "awaiting-approval" ? readLatestEvidence(store, runId) : undefined;
    emit(
      { run, artifacts, evidence },
      () =>
        [
          evidence ? evidence.trimEnd() + "\n" : null,
          `Run ${run.id}`,
          `  Projeto: ${run.projectSlug ?? "-"}  |  Tipo: ${run.workKind ?? "-"}  |  Estado: ${run.state}`,
          `  Estratégia: ${run.strategy?.profile ?? "-"}  |  Custo: US$ ${run.costUsd.toFixed(4)}`,
          `  Artefatos (${artifacts.length}):`,
          ...artifacts.map((a) => `    - [${a.kind}] ${a.path}`),
        ]
          .filter((x) => x !== null)
          .join("\n"),
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}

/** pm status [<id>] — progresso de um run (ou do mais recente). */
export function statusCommand(runId: string | undefined, opts: OutputOptions): number {
  const db = openDatabase();
  try {
    const runs = new RunsRepo(db);
    const id = runId ?? runs.list(1)[0]?.id;
    if (!id) {
      emit(
        { ok: false, error: "nenhum run" },
        () => 'Nenhum run ainda. Use: pm plan --projeto <slug> "<pedido>"',
        opts,
      );
      return 1;
    }
    const run = runs.get(id);
    if (!run) {
      emit(
        { ok: false, error: `run não encontrado: ${id}` },
        () => `${mark.fail} Run "${id}" não encontrado.`,
        opts,
      );
      return 1;
    }
    const tasks = new TasksRepo(db);
    const counts = tasks.countByState(id);
    const escalated = tasks.escalatedCount(id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    emit(
      { runId: id, runState: run.state, counts, escalated, total, costUsd: run.costUsd },
      () =>
        [
          `Run ${id} — estado: ${run.state}`,
          `  Projeto: ${run.projectSlug ?? "-"}  |  Tipo: ${run.workKind ?? "-"}`,
          `  Tarefas (${total}): ${formatCounts(counts)}`,
          escalated > 0 ? `  ${mark.warn} ${escalated} escalada(s) aguardando decisão sua.` : null,
          `  Custo acumulado: US$ ${run.costUsd.toFixed(4)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}

function formatCounts(counts: Record<string, number>): string {
  const order = ["done", "running", "validating", "ready", "pending", "retrying", "escalated", "blocked", "failed", "cancelled"];
  return order
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
}

/** pm run list — últimos runs. */
export function runList(opts: OutputOptions): number {
  const db = openDatabase();
  let runs;
  try {
    runs = new RunsRepo(db).list(20);
  } finally {
    db.close();
  }
  emit(
    { runs },
    () =>
      runs.length === 0
        ? "Nenhum run ainda. Use: pm plan --projeto <slug> \"<pedido>\""
        : runs
            .map(
              (r) =>
                `  ${r.id}  ${r.state.padEnd(9)}  ${r.projectSlug ?? "-"}  (${r.workKind ?? "-"})`,
            )
            .join("\n"),
    opts,
  );
  return 0;
}
