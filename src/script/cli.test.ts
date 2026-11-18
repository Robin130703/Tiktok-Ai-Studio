import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("CLI unter Node", () => {
  it("startet (Modulauflösung ok) und meldet fehlenden API-Key klar", () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync(process.execPath, ["src/script/cli.ts"], { encoding: "utf8", env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("ANTHROPIC_API_KEY ist nicht gesetzt");
    expect(r.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
