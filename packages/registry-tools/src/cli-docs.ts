import { relative } from "node:path";
import { findRepoRoot } from "./paths.js";
import { generateDocs } from "./gen-docs.js";

/** Executável direto: pnpm --filter @pm/registry-tools docs */
const root = findRepoRoot();
const out = generateDocs(root);

process.stderr.write(`Gerado: ${relative(root, out.manual)}\n`);
for (const d of out.diagrams) {
  process.stderr.write(`Gerado: ${relative(root, d)}\n`);
}
