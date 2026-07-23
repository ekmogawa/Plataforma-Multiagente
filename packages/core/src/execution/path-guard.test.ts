import { describe, expect, it } from "vitest";
import { assertInside, isInside, PathEscapeError, resolveInside } from "./path-guard.js";

const ROOT = process.platform === "win32" ? "C:\\proj\\alvo" : "/proj/alvo";

describe("path-guard", () => {
  it("resolve caminhos relativos dentro do root", () => {
    expect(isInside(ROOT, "src/app.ts")).toBe(true);
    expect(resolveInside(ROOT, "src/app.ts")).toContain("app.ts");
  });

  it("rejeita '..' que escapa", () => {
    expect(() => assertInside(ROOT, "../fora.ts")).toThrow(PathEscapeError);
    expect(() => assertInside(ROOT, "src/../../fora.ts")).toThrow(PathEscapeError);
    expect(isInside(ROOT, "../x")).toBe(false);
  });

  it("rejeita caminho absoluto, drive e UNC", () => {
    expect(() => resolveInside(ROOT, "/etc/passwd")).toThrow(PathEscapeError);
    expect(() => resolveInside(ROOT, "C:\\Windows\\x")).toThrow(PathEscapeError);
    expect(() => resolveInside(ROOT, "\\\\server\\share")).toThrow(PathEscapeError);
  });

  it("rejeita NUL", () => {
    expect(() => resolveInside(ROOT, "a\0b")).toThrow(PathEscapeError);
  });
});
