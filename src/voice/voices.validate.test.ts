import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_VOICES, DEFAULT_VOICE_POOL, parseVoiceMap } from "./voices.ts";

describe("parseVoiceMap", () => {
  it("akzeptiert gültige Stimmen", () => {
    const m = parseVoiceMap({ Bruno: { voice: "onyx", instructions: "tief" }, Erna: { voice: "nova" } });
    expect(m.Bruno!.voice).toBe("onyx");
  });

  it("enthält alle Standard-Stimmen", () => {
    for (const v of DEFAULT_VOICE_POOL) expect(ALLOWED_VOICES).toContain(v);
  });

  it("nennt bei ungültiger Stimme Figur, Wert und erlaubte Namen", () => {
    expect(() => parseVoiceMap({ Bruno: { voice: "bariton" } }, "v.json")).toThrow(
      /v\.json: Figur "Bruno" nutzt unbekannte Stimme "bariton" \(erlaubt: alloy, .*onyx/,
    );
  });

  it("lehnt falsche Struktur ab", () => {
    expect(() => parseVoiceMap([])).toThrow(/JSON-Objekt/);
    expect(() => parseVoiceMap({ Bruno: "onyx" })).toThrow(/Feld "voice"/);
    expect(() => parseVoiceMap({ Bruno: { voice: "onyx", instructions: 1 } })).toThrow(/instructions/);
  });

  it("CLI meldet ungültige Stimme vor jedem API-Aufruf", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "voices-"));
    const file = path.join(dir, "v.json");
    await writeFile(file, JSON.stringify({ Bruno: { voice: "bariton" } }));
    const script = path.join(dir, "s.json");
    await writeFile(script, "{}");
    const r = spawnSync(process.execPath, ["src/voice/cli.ts", script, "--voices", file], {
      encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "test-kein-echter-key" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unbekannte Stimme "bariton".*erlaubt/);
  });
});
