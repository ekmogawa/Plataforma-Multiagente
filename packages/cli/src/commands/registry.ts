import { generateDocs, validateRegistry } from "@pm/registry-tools";
import { relative } from "node:path";
import { emit, mark, type OutputOptions } from "../output.js";

/** pm registry validate — valida o Manual de Relações. */
export function registryValidate(opts: OutputOptions): number {
  const result = validateRegistry();
  emit(
    result,
    () => {
      const lines: string[] = [
        "",
        `Registro: ${result.stats.components} componentes ` +
          `(${result.stats.active} ativos, ${result.stats.planned} planejados), ` +
          `${result.stats.relations} relações.`,
      ];
      for (const w of result.warnings) lines.push(`  ${mark.warn} ${w}`);
      for (const e of result.errors) lines.push(`  ${mark.fail} ${e}`);
      lines.push(result.ok ? `  ${mark.ok} Registro válido.` : "  Registro inválido.");
      return lines.join("\n");
    },
    opts,
  );
  return result.ok ? 0 : 1;
}

/** pm registry docs — gera manual-de-relacoes.md e diagramas. */
export function registryDocs(opts: OutputOptions): number {
  const out = generateDocs();
  const data = {
    manual: relative(process.cwd(), out.manual),
    diagrams: out.diagrams.map((d) => relative(process.cwd(), d)),
  };
  emit(
    data,
    () =>
      [`Gerado: ${data.manual}`, ...data.diagrams.map((d) => `Gerado: ${d}`)].join(
        "\n",
      ),
    opts,
  );
  return 0;
}
