import { validateRegistry } from "./validate.js";

/** Executável direto: pnpm --filter @pm/registry-tools validate */
const result = validateRegistry();

const { stats } = result;
process.stderr.write(
  `Registro: ${stats.components} componentes (${stats.active} ativos, ${stats.planned} planejados), ` +
    `${stats.relations} relações, ${stats.pipelines} pipeline(s).\n`,
);

for (const w of result.warnings) process.stderr.write(`  [aviso] ${w}\n`);
for (const e of result.errors) process.stderr.write(`  [ERRO] ${e}\n`);

if (result.ok) {
  process.stderr.write("Registro válido.\n");
  process.exit(0);
} else {
  process.stderr.write(`Registro inválido: ${result.errors.length} erro(s).\n`);
  process.exit(1);
}
