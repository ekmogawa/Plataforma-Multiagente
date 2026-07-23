import {
  ArtifactStore,
  EventBus,
  EventLog,
  GitDelivery,
  GitManager,
  GitSafetyError,
  KnowledgeManager,
  MetricsCollector,
  MetricsRepo,
  ProjectsRepo,
  RunsRepo,
  evidenceRefsFor,
  knowledgeStack,
  openDatabase,
  persistApprovalRecord,
  readLatestEvidence,
  systemClock,
} from "@pm/core";
import { ApprovalRecord } from "@pm/contracts";
import { emit, mark, type OutputOptions } from "../output.js";
import { readOrigin } from "./run.js";

/** pm approve <id> — integra o run após revisão humana (commit final + PR oportunístico). */
export async function approveCommand(
  runId: string,
  flags: { noPr: boolean },
  opts: OutputOptions,
): Promise<number> {
  const db = openDatabase();
  try {
    const runs = new RunsRepo(db);
    const run = runs.get(runId);
    if (!run) {
      emit({ ok: false, error: `run não encontrado: ${runId}` }, () => `${mark.fail} Run "${runId}" não encontrado.`, opts);
      return 1;
    }
    if (run.state !== "awaiting-approval") {
      emit(
        { ok: false, error: `estado inválido: ${run.state}` },
        () => `${mark.fail} Run "${runId}" não está aguardando aprovação (estado: ${run.state}).`,
        opts,
      );
      return 1;
    }
    const project = new ProjectsRepo(db).get(run.projectSlug!);
    if (!project) {
      emit({ ok: false, error: "projeto ausente" }, () => `${mark.fail} Projeto do run não está registrado.`, opts);
      return 1;
    }

    const artifacts = new ArtifactStore(db);
    const bus = new EventBus();
    new EventLog(db).attachTo(bus);
    new MetricsCollector(new MetricsRepo(db), bus).start();
    // Camada 5: ao publicar RunApproved (abaixo), o Knowledge Manager registra o
    // conhecimento no vault. Best-effort — o EventBus engole a exceção do assinante.
    const kn = knowledgeStack(db, systemClock);
    new KnowledgeManager({
      bus,
      runs,
      projects: new ProjectsRepo(db),
      artifacts,
      store: kn.store,
      writer: kn.writer,
      processor: kn.processor,
      graphify: kn.graphify,
      clock: systemClock,
    }).start();
    const origin = readOrigin(artifacts, runId);
    const git = new GitManager(project.rootPath, project.defaultBranch);

    let deliveryNote: string | undefined;
    let prUrl: string | undefined;
    try {
      await git.assertClean();
      await git.resumeRun(runId);
      const finalMsg = `pm: ${run.workKind ?? "run"} — ${runId}`;
      await git.finalizeApproved(finalMsg);
      if (!flags.noPr) {
        const gd = new GitDelivery(project.rootPath);
        const result = await gd.deliver(origin?.runBranch ?? `pm/run-${runId}`, {
          base: origin?.originBranch ?? project.defaultBranch,
          title: finalMsg,
          body: readLatestEvidence(artifacts, runId) ?? finalMsg,
        });
        prUrl = result.prUrl;
        deliveryNote = result.note;
      }
      await git.checkoutOrigin(origin?.originBranch);
    } catch (err) {
      if (err instanceof GitSafetyError) {
        emit({ ok: false, error: err.message }, () => `${mark.fail} ${err.message}`, opts);
        return 1;
      }
      throw err;
    }

    persistApprovalRecord(
      artifacts,
      ApprovalRecord.parse({
        runId,
        approvedBy: "human",
        evidenceRefs: evidenceRefsFor(artifacts, runId),
        summaryPtBr: readLatestEvidence(artifacts, runId) ?? "",
        decision: "approved",
      }),
    );
    runs.setState(runId, "approved");
    bus.publish({ name: "RunApproved", ts: systemClock.now(), runId, producer: "governance.project-manager", data: {} });
    bus.publish({ name: "CommitCreated", ts: systemClock.now(), runId, producer: "governance.git-manager", data: { branch: origin?.runBranch } });
    if (prUrl) bus.publish({ name: "PullRequestCreated", ts: systemClock.now(), runId, producer: "governance.git-manager", data: { url: prUrl } });

    emit(
      { runId, decision: "approved", prUrl, note: deliveryNote },
      () =>
        [
          `${mark.ok} Run ${runId} aprovado e integrado na branch ${origin?.runBranch ?? "pm/run-" + runId}.`,
          prUrl ? `  PR: ${prUrl}` : null,
          deliveryNote ? `  ${deliveryNote}` : null,
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

/** pm reject <id> — descarta as mudanças do run (apaga a branch). */
export async function rejectCommand(
  runId: string,
  flags: { reason?: string },
  opts: OutputOptions,
): Promise<number> {
  const db = openDatabase();
  try {
    const runs = new RunsRepo(db);
    const run = runs.get(runId);
    if (!run) {
      emit({ ok: false, error: `run não encontrado: ${runId}` }, () => `${mark.fail} Run "${runId}" não encontrado.`, opts);
      return 1;
    }
    if (run.state !== "awaiting-approval") {
      emit(
        { ok: false, error: `estado inválido: ${run.state}` },
        () => `${mark.fail} Run "${runId}" não está aguardando aprovação (estado: ${run.state}).`,
        opts,
      );
      return 1;
    }
    const project = new ProjectsRepo(db).get(run.projectSlug!);
    if (!project) {
      emit({ ok: false, error: "projeto ausente" }, () => `${mark.fail} Projeto do run não está registrado.`, opts);
      return 1;
    }

    const artifacts = new ArtifactStore(db);
    const bus = new EventBus();
    new EventLog(db).attachTo(bus);
    new MetricsCollector(new MetricsRepo(db), bus).start();
    const origin = readOrigin(artifacts, runId);
    const git = new GitManager(project.rootPath, project.defaultBranch);

    let branchRemoved = true;
    let removalNote: string | undefined;
    if (await git.isGitRepo()) {
      try {
        await git.abortRun(runId, origin?.originBranch);
      } catch (err) {
        if (!(err instanceof GitSafetyError)) throw err;
        // Não conseguiu remover a branch — segue com a rejeição lógica, mas
        // reporta com honestidade (nada de "branch removida" falso).
        branchRemoved = false;
        removalNote = err.message;
      }
    }

    persistApprovalRecord(
      artifacts,
      ApprovalRecord.parse({
        runId,
        approvedBy: "human",
        evidenceRefs: evidenceRefsFor(artifacts, runId),
        summaryPtBr: flags.reason ?? "rejeitado pelo usuário",
        decision: "rejected",
      }),
    );
    runs.setState(runId, "rejected");
    bus.publish({ name: "RunRejected", ts: systemClock.now(), runId, producer: "governance.project-manager", data: { reason: flags.reason } });

    emit(
      { runId, decision: "rejected", branchRemoved, note: removalNote },
      () =>
        branchRemoved
          ? `${mark.ok} Run ${runId} rejeitado — as mudanças foram descartadas (branch removida).`
          : `${mark.warn} Run ${runId} rejeitado (estado atualizado), mas não consegui remover a branch pm/run-${runId} automaticamente${removalNote ? `: ${removalNote}` : ""}.\n  Remova manualmente com: git branch -D pm/run-${runId}`,
      opts,
    );
    return 0;
  } finally {
    db.close();
  }
}
