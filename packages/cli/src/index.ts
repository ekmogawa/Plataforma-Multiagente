#!/usr/bin/env node
import { loadEnv } from "@pm/core";
import { doctor } from "./commands/doctor.js";
import { registryDocs, registryValidate } from "./commands/registry.js";
import { smoke } from "./commands/smoke.js";
import { projetoAdd, projetoList } from "./commands/projeto.js";
import { planCommand } from "./commands/plan.js";
import { runList, runShow, runStart, statusCommand } from "./commands/run.js";
import { approveCommand, rejectCommand } from "./commands/approve.js";
import { evolveReport } from "./commands/evolve.js";
import { conhecimentoBuscar, conhecimentoProcessar, graphifyCommand } from "./commands/conhecimento.js";

/**
 * pm — a interface de linha de comando da plataforma.
 * O Claude Code aciona estes comandos e narra a saída (--json) ao usuário.
 *
 * Na Fase 0: doctor, smoke, registry validate|docs.
 * As camadas seguintes adicionam: intake, plan, run, status, approve, evolve...
 */

const VERSION = "0.1.0";

interface Parsed {
  command: string;
  sub: string | undefined;
  /** Posicionais após comando e subcomando (ex.: caminho da pasta). */
  args: string[];
  flags: Map<string, string | true>;
}

/** Flags booleanas: não consomem o próximo token (evita engolir o pedido). */
const BOOLEAN_FLAGS = new Set(["json", "offline", "llm", "plano", "resume", "dry-run", "no-pr"]);

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      // Fim das flags: tudo depois é posicional (ex.: pedido começando com --).
      for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]!);
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        // Flag com valor: --key value (se não for booleana e o próximo não for flag).
        if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
          flags.set(key, next);
          i++;
        } else {
          flags.set(key, true);
        }
      }
    } else {
      positional.push(a);
    }
  }
  return {
    command: positional[0] ?? "help",
    sub: positional[1],
    args: positional.slice(2),
    flags,
  };
}

const HELP = `pm — Plataforma Multiagente (v${VERSION})

Uso: pm <comando> [opções]

Comandos:
  doctor              Verifica ambiente, config, banco e registro.
  smoke               Hello-world pelo adaptador de modelo; grava métrica.
  projeto add <pasta> [--nome <slug>]   Registra um projeto existente.
  projeto list        Lista os projetos registrados.
  plan --projeto <slug> "<pedido>"      Gera um plano de engenharia (Camada 1).
  run start <id> [--resume] [--dry-run] Executa o DAG do run (real; --dry-run = echo).
  run show <id>       Mostra um run e seus artefatos.
  run list            Lista os runs recentes.
  status [<id>]       Progresso de um run (ou do mais recente).
  approve <id> [--no-pr]        Integra o run após revisão (commit + PR).
  reject <id> [--reason <txt>]  Descarta as mudanças do run.
  conhecimento processar        Destila o conhecimento do vault (Camada 5).
  conhecimento buscar "<texto>" [--projeto <slug>]   Busca na memória (FTS5).
  graphify <slug>     Desenha o grafo do código do projeto no vault.
  evolve report       Sugestões de auto-evolução a partir das métricas.
  registry validate   Valida o Manual de Relações (registry/).
  registry docs       Gera docs/manual-de-relacoes.md e diagramas.
  version             Mostra a versão.
  help                Esta ajuda.

Opções do plan:
  --projeto <slug>    Projeto alvo (obrigatório).
  --work-kind <tipo>  feature|bugfix|refactor|optimization|ui-adjustment|analysis|new-project.
  --offline           Força o modo por regras (sem IA).
  --llm               Força o modo por IA (exige chaves configuradas).
  --plano             Imprime o plano.md legível.

Opções globais:
  --json              Saída em JSON (para consumo pelo Claude Code).
`;

async function main(): Promise<number> {
  loadEnv();
  const { command, sub, args, flags } = parseArgs(process.argv.slice(2));
  const opts = { json: flags.get("json") === true };

  switch (command) {
    case "doctor":
      return doctor(opts);
    case "smoke":
      return smoke(opts);
    case "projeto":
      if (sub === "add") {
        const pasta = args[0];
        if (!pasta) {
          process.stderr.write("Uso: pm projeto add <pasta> [--nome <slug>]\n");
          return 2;
        }
        const nome = flags.get("nome");
        return projetoAdd(pasta, typeof nome === "string" ? nome : undefined, opts);
      }
      if (sub === "list") return projetoList(opts);
      process.stderr.write(`Subcomando de projeto desconhecido: ${sub ?? "(nenhum)"}\n`);
      process.stderr.write("Use: pm projeto add <pasta> | pm projeto list\n");
      return 2;
    case "plan": {
      const projeto = flags.get("projeto");
      if (typeof projeto !== "string") {
        process.stderr.write('Uso: pm plan --projeto <slug> "<pedido>"\n');
        return 2;
      }
      // Tudo após "plan" (menos as flags) é o pedido.
      const promptText = [sub, ...args]
        .filter((x): x is string => typeof x === "string")
        .join(" ")
        .trim();
      if (!promptText) {
        process.stderr.write('Uso: pm plan --projeto <slug> "<pedido>"\n');
        return 2;
      }
      const wk = flags.get("work-kind");
      const preference = flags.get("offline") === true
        ? "heuristic"
        : flags.get("llm") === true
          ? "llm"
          : "auto";
      return planCommand(
        {
          projectSlug: projeto,
          prompt: promptText,
          workKind: typeof wk === "string" ? wk : undefined,
          preference,
          showPlano: flags.get("plano") === true,
        },
        opts,
      );
    }
    case "run":
      if (sub === "start") {
        const id = args[0];
        if (!id) {
          process.stderr.write("Uso: pm run start <id> [--resume] [--dry-run]\n");
          return 2;
        }
        return runStart(
          id,
          { resume: flags.get("resume") === true, dryRun: flags.get("dry-run") === true },
          opts,
        );
      }
      if (sub === "show") {
        const id = args[0];
        if (!id) {
          process.stderr.write("Uso: pm run show <id>\n");
          return 2;
        }
        return runShow(id, opts);
      }
      if (sub === "list") return runList(opts);
      process.stderr.write(`Subcomando de run desconhecido: ${sub ?? "(nenhum)"}\n`);
      process.stderr.write("Use: pm run start <id> | pm run show <id> | pm run list\n");
      return 2;
    case "status":
      return statusCommand(sub, opts);
    case "approve": {
      if (!sub) {
        process.stderr.write("Uso: pm approve <id> [--no-pr]\n");
        return 2;
      }
      return approveCommand(sub, { noPr: flags.get("no-pr") === true }, opts);
    }
    case "reject": {
      if (!sub) {
        process.stderr.write("Uso: pm reject <id> [--reason <motivo>]\n");
        return 2;
      }
      const reason = flags.get("reason");
      return rejectCommand(sub, { reason: typeof reason === "string" ? reason : undefined }, opts);
    }
    case "conhecimento":
      if (sub === "processar") return conhecimentoProcessar(opts);
      if (sub === "buscar") {
        const text = [args[0], ...args.slice(1)].filter((x): x is string => typeof x === "string").join(" ").trim();
        if (!text) {
          process.stderr.write('Uso: pm conhecimento buscar "<texto>" [--projeto <slug>]\n');
          return 2;
        }
        const proj = flags.get("projeto");
        return conhecimentoBuscar(text, typeof proj === "string" ? proj : undefined, opts);
      }
      process.stderr.write(`Subcomando de conhecimento desconhecido: ${sub ?? "(nenhum)"}\n`);
      process.stderr.write('Use: pm conhecimento processar | pm conhecimento buscar "<texto>"\n');
      return 2;
    case "graphify":
      if (!sub) {
        process.stderr.write("Uso: pm graphify <slug>\n");
        return 2;
      }
      return graphifyCommand(sub, opts);
    case "evolve":
      if (sub === "report") return evolveReport(opts);
      process.stderr.write(`Subcomando de evolve desconhecido: ${sub ?? "(nenhum)"}\n`);
      process.stderr.write("Use: pm evolve report\n");
      return 2;
    case "registry":
      if (sub === "validate") return registryValidate(opts);
      if (sub === "docs") return registryDocs(opts);
      process.stderr.write(`Subcomando de registry desconhecido: ${sub ?? "(nenhum)"}\n`);
      process.stderr.write("Use: pm registry validate | pm registry docs\n");
      return 2;
    case "version":
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case "help":
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`Comando desconhecido: ${command}\n\n`);
      process.stderr.write(HELP);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Erro inesperado: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
