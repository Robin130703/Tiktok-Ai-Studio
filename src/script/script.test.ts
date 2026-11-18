import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeCostUsd,
  generateScript,
  ScriptGenerationError,
  type LlmClient,
} from "./generator.ts";
import { estimateDurationSeconds, validateScript } from "./schema.ts";
import { loadScript, saveScript } from "./store.ts";

/** Baut ein gültiges Skript mit `words` Wörtern verteilt auf `sceneCount` Szenen. */
function makeScript(words = 150, sceneCount = 10): Record<string, unknown> {
  const per = Math.floor(words / sceneCount);
  const extra = words - per * sceneCount;
  return {
    version: 1,
    title: "Bananen-Drama",
    topic: "Streit um den letzten Smoothie",
    characters: [
      { name: "Bruno", fruit: "Banane", personality: "dramatisch" },
      { name: "Erna", fruit: "Erdbeere", personality: "zickig" },
    ],
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      id: i + 1,
      description: `Bild ${i + 1}: Banane und Erdbeere in der Küche`,
      speaker: i % 2 === 0 ? "Bruno" : "Erna",
      text: Array.from({ length: per + (i < extra ? 1 : 0) }, () => "wort").join(" "),
    })),
  };
}

function mockClient(texts: string[]): LlmClient & { calls: number } {
  const c = {
    calls: 0,
    async complete() {
      const text = texts[Math.min(c.calls, texts.length - 1)] as string;
      c.calls += 1;
      return { text, inputTokens: 1000, outputTokens: 500 };
    },
  };
  return c;
}

describe("validateScript", () => {
  it("akzeptiert ein gültiges Skript", () => {
    expect(validateScript(makeScript()).ok).toBe(true);
    expect(estimateDurationSeconds(makeScript() as never)).toBeCloseTo(60, 5);
  });

  it("lehnt unbekannten Sprecher ab", () => {
    const s = makeScript() as { scenes: { speaker: string }[] };
    s.scenes[0]!.speaker = "Unbekannt";
    expect(validateScript(s).ok).toBe(false);
  });

  it("lehnt fehlende Felder und falsche Typen ab", () => {
    expect(validateScript("kein objekt").ok).toBe(false);
    const s = makeScript() as { scenes: { text?: unknown }[] };
    delete s.scenes[2]!.text;
    expect(validateScript(s).ok).toBe(false);
  });

  it("lehnt doppelte Figurennamen ab", () => {
    const s = makeScript() as { characters: { name: string }[] };
    s.characters[1]!.name = "Bruno";
    expect(validateScript(s).ok).toBe(false);
  });

  it("prüft die Länge: zu kurz und zu lang werden abgelehnt, Grenzen passen", () => {
    expect(validateScript(makeScript(100)).ok).toBe(false); // 40 s
    expect(validateScript(makeScript(200)).ok).toBe(false); // 80 s
    expect(validateScript(makeScript(125)).ok).toBe(true); // 50 s
    expect(validateScript(makeScript(175)).ok).toBe(true); // 70 s
  });
});

describe("generateScript", () => {
  it("liefert Skript und zählt Token/Kosten (Markdown-Zaun wird toleriert)", async () => {
    const client = mockClient(["```json\n" + JSON.stringify(makeScript()) + "\n```"]);
    const { script, usage } = await generateScript({ client, topic: "Smoothie" });
    expect(script.scenes).toHaveLength(10);
    expect(usage.attempts).toBe(1);
    expect(usage.inputTokens).toBe(1000);
    expect(usage.costUsd).toBeCloseTo(computeCostUsd(1000, 500), 10);
  });

  it("wiederholt einmal bei ungültiger Ausgabe und summiert die Nutzung", async () => {
    const client = mockClient(["kein json", JSON.stringify(makeScript())]);
    const { usage } = await generateScript({ client });
    expect(client.calls).toBe(2);
    expect(usage.attempts).toBe(2);
    expect(usage.outputTokens).toBe(1000);
    expect(usage.costUsd).toBeLessThan(0.1);
  });

  it("wirft klaren Fehler nach erfolglosem Retry", async () => {
    const client = mockClient([JSON.stringify(makeScript(50))]);
    const err = await generateScript({ client }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScriptGenerationError);
    expect((err as ScriptGenerationError).usage.attempts).toBe(2);
    expect((err as Error).message).toContain("Sprechdauer");
  });
});

describe("store", () => {
  it("speichert und lädt ein Skript ohne LLM", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "script-"));
    const client = mockClient([JSON.stringify(makeScript())]);
    const { script, usage } = await generateScript({ client });
    const file = await saveScript(script, usage, dir, new Date("2026-11-18T10:00:00Z"));
    expect(path.basename(file)).toBe("2026-11-18T10-00-00-000Z-bananen-drama.json");
    expect(await loadScript(file)).toEqual(script);
    const u = JSON.parse(await readFile(file.replace(/\.json$/, ".usage.json"), "utf8"));
    expect(u.attempts).toBe(1);
  });
});
