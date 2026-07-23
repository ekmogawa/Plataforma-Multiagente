import { ProjectTarget, type CodeFileChange } from "@pm/contracts";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyChangeSet, PermissionDeniedError } from "./apply-changeset.js";
import { PathEscapeError } from "./path-guard.js";

/** Symlinks no Windows exigem privilégio; pula o teste se não der. */
function canSymlink(): boolean {
  const d = mkdtempSync(join(tmpdir(), "pm-sym-"));
  try {
    writeFileSync(join(d, "real"), "x");
    symlinkSync(join(d, "real"), join(d, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

function target(root: string, write = true): ProjectTarget {
  return ProjectTarget.parse({
    slug: "t",
    rootPath: root,
    kind: "registered",
    permissions: { read: true, write, deploy: false },
  });
}

describe("applyChangeSet", () => {
  it("cria, modifica e deleta arquivos dentro do projeto", () => {
    const root = mkdtempSync(join(tmpdir(), "pm-apply-"));
    writeFileSync(join(root, "velho.txt"), "x");
    const files: CodeFileChange[] = [
      { path: "src/novo.ts", action: "created", content: "export const a=1;" },
      { path: "velho.txt", action: "deleted" },
    ];
    const changed = applyChangeSet(files, target(root));
    expect(readFileSync(join(root, "src/novo.ts"), "utf8")).toContain("a=1");
    expect(existsSync(join(root, "velho.txt"))).toBe(false);
    expect(changed).toContainEqual({ path: "src/novo.ts", action: "created" });
    expect(changed).toContainEqual({ path: "velho.txt", action: "deleted" });
  });

  it("reconcilia action com o disco (created vira modified se já existe)", () => {
    const root = mkdtempSync(join(tmpdir(), "pm-apply-"));
    writeFileSync(join(root, "a.ts"), "old");
    const changed = applyChangeSet([{ path: "a.ts", action: "created", content: "new" }], target(root));
    expect(changed[0]?.action).toBe("modified");
  });

  it("aborta SEM escrever nada se algum path escapa (2 fases atômicas)", () => {
    const root = mkdtempSync(join(tmpdir(), "pm-apply-"));
    const files: CodeFileChange[] = [
      { path: "ok.ts", action: "created", content: "1" },
      { path: "../fora.ts", action: "created", content: "2" },
    ];
    expect(() => applyChangeSet(files, target(root))).toThrow(PathEscapeError);
    // Fase 1 falhou → nada foi escrito, nem o ok.ts.
    expect(existsSync(join(root, "ok.ts"))).toBe(false);
  });

  it("recusa quando permissions.write é false", () => {
    const root = mkdtempSync(join(tmpdir(), "pm-apply-"));
    expect(() =>
      applyChangeSet([{ path: "a.ts", action: "created", content: "1" }], target(root, false)),
    ).toThrow(PermissionDeniedError);
  });

  it.runIf(canSymlink())("recusa escrever sobre symlink-folha (escape via link)", () => {
    const root = mkdtempSync(join(tmpdir(), "pm-apply-"));
    const outside = mkdtempSync(join(tmpdir(), "pm-fora-"));
    writeFileSync(join(outside, "vitima.txt"), "original");
    // Um symlink DENTRO do root apontando para fora.
    symlinkSync(join(outside, "vitima.txt"), join(root, "config.env"));
    expect(() =>
      applyChangeSet([{ path: "config.env", action: "modified", content: "hackeado" }], target(root)),
    ).toThrow(PathEscapeError);
    // A vítima fora do projeto permanece intacta.
    expect(readFileSync(join(outside, "vitima.txt"), "utf8")).toBe("original");
  });
});
