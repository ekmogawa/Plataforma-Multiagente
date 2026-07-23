/**
 * Gera registry/schemas/<Nome>.schema.json a partir dos schemas zod.
 *
 * Código manda na forma; o registro (topologia) referencia estes nomes.
 * Rode com: pnpm --filter @pm/contracts gen:schemas
 */
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SCHEMA_REGISTRY } from "../src/schema-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "..", "..", "registry", "schemas");

mkdirSync(outDir, { recursive: true });

// Limpa .schema.json antigos para não deixar órfãos de schemas renomeados.
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".schema.json")) rmSync(join(outDir, f));
}

let count = 0;
for (const [name, schema] of Object.entries(SCHEMA_REGISTRY)) {
  const json = zodToJsonSchema(schema, { name, target: "jsonSchema7" });
  writeFileSync(
    join(outDir, `${name}.schema.json`),
    JSON.stringify(json, null, 2) + "\n",
    "utf8",
  );
  count++;
}

const index = {
  generated: "Gerado por @pm/contracts gen:schemas. Não edite à mão.",
  schemas: Object.keys(SCHEMA_REGISTRY).sort(),
};
writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify(index, null, 2) + "\n",
  "utf8",
);

console.log(`Gerados ${count} JSON Schemas em registry/schemas/`);
