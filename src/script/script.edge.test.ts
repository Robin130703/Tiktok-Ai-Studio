import { describe, expect, it } from "vitest";
import { generateScript, type LlmClient } from "./generator.js";
import { createAnthropicClient } from "./anthropic-client.js";
import { validateScript } from "./schema.js";

function base(sceneCount = 10, words = 150): Record<string, unknown> {
  const per = words / sceneCount;
  return {
    version: 1,
    title: "T",
    topic: "X",
    characters: [
      { name: "A", fruit: "Apfel", personality: "laut" },
      { name: "B", fruit: "Birne", personality: "leise" },
    ],
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      id: i + 1,
      description: "Bild",
      speaker: i % 2 ? "A" : "B",
      text: Array.from({ length: per }, () => "w").join(" "),
    })),
  };
}

describe("Randfälle Schema", () => {
  it("lehnt zu wenige und zu viele Szenen ab (Dauer passt jeweils)", () => {
    expect(validateScript(base(5, 150)).ok).toBe(false);
    expect(validateScript(base(15, 150)).ok).toBe(false);
    expect(validateScript(base(6, 150)).ok).toBe(true);
    expect(validateScript(base(14, 154)).ok).toBe(true);
  });

  it("lehnt zu wenige und zu viele Figuren ab", () => {
    const one = base() as { characters: unknown[] };
    one.characters.pop();
    expect(validateScript(one).ok).toBe(false);
    const five = base() as { characters: Record<string, string>[] };
    for (const n of ["C", "D", "E"]) {
      five.characters.push({ name: n, fruit: "f", personality: "p" });
    }
    expect(validateScript(five).ok).toBe(false);
  });

  it("lehnt falsche Szenen-IDs und falsche Version ab", () => {
    const s = base() as { scenes: { id: number }[] };
    s.scenes[3]!.id = 9;
    expect(validateScript(s).ok).toBe(false);
    expect(validateScript({ ...base(), version: 2 }).ok).toBe(false);
  });
});

describe("Randfälle Generator", () => {
  it("meldet Validierungsfehler im Retry an das LLM zurück; ohne Thema Zufallsprompt", async () => {
    const seen: { role: string; content: string }[][] = [];
    let n = 0;
    const client: LlmClient = {
      async complete(req) {
        seen.push(req.messages.map((m) => ({ ...m })));
        n += 1;
        return {
          text: n === 1 ? "{}" : JSON.stringify(base()),
          inputTokens: 10,
          outputTokens: 10,
        };
      },
    };
    await generateScript({ client });
    expect(seen[0]![0]!.content).toContain("zufällig");
    expect(seen[1]!.at(-1)!.content).toContain("version muss 1 sein");
  });

  it("stoppt den Retry bei erreichter Kostenobergrenze", async () => {
    let n = 0;
    const client: LlmClient = {
      async complete() {
        n += 1;
        return { text: "kaputt", inputTokens: 1_000_000, outputTokens: 0 };
      },
    };
    await expect(generateScript({ client, maxCostUsd: 0.5 })).rejects.toThrow();
    expect(n).toBe(1);
  });
});

describe("API-Zugang", () => {
  it("verlangt ANTHROPIC_API_KEY aus der Umgebung", () => {
    expect(() => createAnthropicClient({})).toThrow(/ANTHROPIC_API_KEY/);
  });
});
