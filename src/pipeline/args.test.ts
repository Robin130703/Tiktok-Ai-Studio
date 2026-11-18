import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
  it("liest Thema und Optionen", () => {
    const a = parseArgs(["Streit", "um", "--name", "x", "--music", "m.mp3", "--no-music"], {});
    expect(a).toMatchObject({ topic: "Streit um", name: "x", music: "m.mp3", noMusic: true });
  });

  it.each(["--name", "--music"])("meldet %s ohne Wert am Zeilenende", (opt) => {
    expect(() => parseArgs(["Thema", opt], {})).toThrow(new RegExp(`${opt} braucht einen Wert`));
  });

  it("meldet fehlenden Wert, wenn direkt eine Option folgt", () => {
    expect(() => parseArgs(["--name", "--dummy"], {})).toThrow(/--name braucht einen Wert/);
  });

  it("CLI beendet sich mit Exit-Code 1 und klarer Meldung", () => {
    const r = spawnSync(process.execPath, ["src/pipeline/cli.ts", "--name"], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--name braucht einen Wert");
    expect(r.stderr).not.toContain("    at ");
  });
});
