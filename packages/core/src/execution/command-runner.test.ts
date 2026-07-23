import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { CommandRunError, filterEnv, runCommand, tokenizeCommand } from "./command-runner.js";

describe("command-runner", () => {
  it("roda um comando e captura saída + código", async () => {
    const r = await runCommand("node", ["-e", "process.stdout.write('oi')"], {
      cwd: tmpdir(),
      timeoutMs: 10000,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("oi");
    expect(r.timedOut).toBe(false);
  });

  it("reporta código != 0 em falha", async () => {
    const r = await runCommand("node", ["-e", "process.exit(3)"], { cwd: tmpdir(), timeoutMs: 10000 });
    expect(r.code).toBe(3);
  });

  it("mata no timeout", async () => {
    const r = await runCommand("node", ["-e", "setTimeout(()=>{}, 60000)"], {
      cwd: tmpdir(),
      timeoutMs: 300,
    });
    expect(r.timedOut).toBe(true);
  });

  it("tokenizeCommand recusa metacaracteres de shell", () => {
    expect(tokenizeCommand("npm test")).toEqual(["npm", "test"]);
    expect(() => tokenizeCommand("rm -rf / && echo x")).toThrow(CommandRunError);
    expect(() => tokenizeCommand("cat x | sh")).toThrow(CommandRunError);
  });

  it("filterEnv remove segredos e força CI", () => {
    const env = filterEnv({ PATH: "/x", OPENAI_API_KEY: "sk-x", MY_TOKEN: "t", NORMAL: "1" });
    expect(env.PATH).toBe("/x");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.MY_TOKEN).toBeUndefined();
    expect(env.CI).toBe("1");
  });
});
