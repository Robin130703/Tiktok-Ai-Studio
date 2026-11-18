import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Script } from "../script/schema.ts";
import { createDummyProvider } from "./dummy.ts";
import { createFalProvider, IMAGE_HEIGHT, IMAGE_WIDTH, type FalClient } from "./fal.ts";
import { loadSceneDurations } from "./durations.ts";
import { generateMedia, MediaError } from "./generate.ts";
import { buildPrompt } from "./prompt.ts";
import { MediaModerationError, type MediaProvider } from "./provider.ts";
import { createMediaProvider } from "./registry.ts";

const script: Script = {
  version: 1,
  title: "Test",
  topic: "Test",
  characters: [
    { name: "Bruno", fruit: "Banane", personality: "dramatisch" },
    { name: "Erna", fruit: "Erdbeere", personality: "zickig" },
  ],
  scenes: [
    { id: 1, description: "Küche, Smoothie-Mixer", speaker: "Bruno", text: "a" },
    { id: 2, description: "Streit am Tisch", speaker: "Erna", text: "b" },
    { id: 3, description: "Finale", speaker: "Bruno", text: "c" },
  ],
};
const durations = new Map([
  [1, 4.5],
  [2, 6],
  [3, 3.2],
]);

function tmp(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "media-test-"));
}

function countingProvider(inner: MediaProvider, failOn?: number) {
  const p = {
    calls: 0,
    name: inner.name,
    type: inner.type,
    async generate(req: Parameters<MediaProvider["generate"]>[0]) {
      p.calls += 1;
      if (failOn === p.calls) throw new Error("503 Dienst nicht erreichbar");
      return inner.generate(req);
    },
  };
  return p;
}

describe("Dummy-Provider und Erzeugung", () => {
  it("erzeugt pro Szene ein PNG im 9:16-Format samt media.json", async () => {
    const dir = await tmp();
    const { meta, usage } = await generateMedia({
      provider: createDummyProvider(),
      script,
      durations,
      dir,
    });
    expect(meta.scenes.map((s) => s.sceneId)).toEqual([1, 2, 3]);
    expect(meta.scenes.map((s) => s.file)).toEqual(["scene-01.png", "scene-02.png", "scene-03.png"]);
    expect(meta.scenes.every((s) => s.type === "image")).toBe(true);
    expect(meta.scenes.map((s) => s.durationSeconds)).toEqual([4.5, 6, 3.2]);
    expect(usage).toEqual({ generated: 3, reused: 0, costUsd: 0 });
    const png = await readFile(path.join(dir, "scene-01.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    expect(w * 16).toBe(h * 9);
    const onDisk = JSON.parse(await readFile(path.join(dir, "media.json"), "utf8"));
    expect(onDisk.scenes).toHaveLength(3);
  });

  it("verwendet unveränderte Medien wieder und erzeugt geänderte neu", async () => {
    const dir = await tmp();
    const p1 = countingProvider(createDummyProvider());
    await generateMedia({ provider: p1, script, durations, dir });
    expect(p1.calls).toBe(3);

    const p2 = countingProvider(createDummyProvider());
    const again = await generateMedia({ provider: p2, script, durations, dir });
    expect(p2.calls).toBe(0);
    expect(again.usage.reused).toBe(3);

    const changed: Script = {
      ...script,
      scenes: script.scenes.map((s) => (s.id === 2 ? { ...s, description: "anders" } : s)),
    };
    const p3 = countingProvider(createDummyProvider());
    const third = await generateMedia({ provider: p3, script: changed, durations, dir });
    expect(p3.calls).toBe(1);
    expect(third.usage).toMatchObject({ generated: 1, reused: 2 });
  });

  it("bricht bei Dienstfehler ab, behält fertige Szenen und setzt fort", async () => {
    const dir = await tmp();
    const flaky = countingProvider(createDummyProvider(), 2);
    const err = await generateMedia({ provider: flaky, script, durations, dir }).catch((e) => e);
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).sceneId).toBe(2);
    expect((err as MediaError).message).toContain("erneut starten");
    const saved = JSON.parse(await readFile(path.join(dir, "media.json"), "utf8"));
    expect(saved.scenes).toHaveLength(1);

    const ok = countingProvider(createDummyProvider());
    const res = await generateMedia({ provider: ok, script, durations, dir });
    expect(ok.calls).toBe(2);
    expect(res.usage.reused).toBe(1);
  });

  it("bricht bei Erreichen der Kostenobergrenze ab", async () => {
    const dir = await tmp();
    const pricey: MediaProvider = {
      name: "teuer",
      type: "image",
      async generate() {
        return { data: Buffer.from("x"), type: "image", extension: "png", costUsd: 0.4 };
      },
    };
    const err = await generateMedia({ provider: pricey, script, durations, dir, maxCostUsd: 0.5 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).message).toContain("Kostenobergrenze");
    expect((err as MediaError).usage.generated).toBe(2);
  });

  it("prüft die Obergrenze vor der Erzeugung und überschreitet sie nicht um ein Bild", async () => {
    const dir = await tmp();
    let calls = 0;
    const pricey: MediaProvider = {
      name: "teuer",
      type: "image",
      estimatedCostUsd: 0.4,
      async generate() {
        calls += 1;
        return { data: Buffer.from("x"), type: "image", extension: "png", costUsd: 0.4 };
      },
    };
    const err = await generateMedia({ provider: pricey, script, durations, dir, maxCostUsd: 0.5 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).message).toContain("Kostenobergrenze");
    expect(calls).toBe(1);
    expect((err as MediaError).usage.costUsd).toBeLessThanOrEqual(0.5);
  });

  it("zählt Kosten früherer Läufe für die Obergrenze mit", async () => {
    const dir = await tmp();
    const make = (): MediaProvider & { calls: number } => {
      const p = {
        calls: 0,
        name: "teuer",
        type: "image" as const,
        estimatedCostUsd: 0.1,
        async generate() {
          p.calls += 1;
          return { data: Buffer.from("x"), type: "image" as const, extension: "png", costUsd: 0.1 };
        },
      };
      return p;
    };
    await generateMedia({ provider: make(), script, durations, dir, maxCostUsd: 0.6 }); // 0,30 USD
    const changed: Script = {
      ...script,
      scenes: script.scenes.map((s) => (s.id === 3 ? { ...s, description: "neu" } : s)),
    };
    const p2 = make();
    // 2 Szenen aus früherem Lauf (0,20) + 0,10 für die neue Szene wären 0,30 > 0,25
    const err = await generateMedia({ provider: p2, script: changed, durations, dir, maxCostUsd: 0.25 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(MediaError);
    expect(p2.calls).toBe(0); // 0,20 + 0,10 > 0,25: nichts wird bezahlt
    expect((err as MediaError).message).toContain("Kostenobergrenze");
  });

  it("behält bei Abbruch die Cache-Einträge späterer Szenen aus einem früheren Lauf", async () => {
    const dir = await tmp();
    await generateMedia({ provider: createDummyProvider(), script, durations, dir });
    const before = JSON.parse(await readFile(path.join(dir, "media.json"), "utf8"));
    const changed: Script = {
      ...script,
      scenes: script.scenes.map((s) => (s.id === 1 ? { ...s, description: "anders" } : s)),
    };
    const flaky = countingProvider(createDummyProvider(), 1);
    await expect(generateMedia({ provider: flaky, script: changed, durations, dir })).rejects.toBeInstanceOf(
      MediaError,
    );
    const saved = JSON.parse(await readFile(path.join(dir, "media.json"), "utf8"));
    expect(saved.scenes.map((s: { sceneId: number }) => s.sceneId)).toEqual([2, 3]);
    expect(saved.scenes).toEqual(before.scenes.slice(1));

    const ok = countingProvider(createDummyProvider());
    const res = await generateMedia({ provider: ok, script: changed, durations, dir });
    expect(ok.calls).toBe(1);
    expect(res.usage.reused).toBe(2);
  });
});

describe("fal-Provider mit gemocktem Client", () => {
  function mockFal(flagged: boolean) {
    const calls: Parameters<FalClient["generateImage"]>[0][] = [];
    const client: FalClient = {
      async generateImage(req) {
        calls.push(req);
        return { data: Buffer.from("img"), extension: "jpg", flaggedNsfw: flagged };
      },
    };
    return { client, calls };
  }

  it("fordert 9:16 an und zählt Kosten", async () => {
    const { client, calls } = mockFal(false);
    const dir = await tmp();
    const { usage, meta } = await generateMedia({
      provider: createFalProvider(client),
      script,
      durations,
      dir,
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.model).toBe("fal-ai/flux/schnell");
    expect(calls[0]!.width * 16).toBe(calls[0]!.height * 9);
    expect(IMAGE_WIDTH * 16).toBe(IMAGE_HEIGHT * 9);
    expect(usage.costUsd).toBeGreaterThan(0);
    expect(usage.costUsd).toBeLessThan(0.05);
    expect(meta.scenes[0]!.file).toBe("scene-01.jpg");
  });

  it("meldet Moderationsablehnung verständlich und bricht ab", async () => {
    const { client } = mockFal(true);
    const dir = await tmp();
    const err = await generateMedia({
      provider: createFalProvider(client),
      script,
      durations,
      dir,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).cause).toBeInstanceOf(MediaModerationError);
    expect((err as MediaError).message).toContain("Moderation");
    expect((err as MediaError).message).toContain("Szene 1");
  });
});

describe("Prompt und Figurenkonsistenz", () => {
  it("nutzt Sprecher, Szene und feste Figurenbeschreibung mit stabilem Seed", () => {
    const a = buildPrompt(script, script.scenes[0]!);
    const c = buildPrompt(script, script.scenes[2]!);
    expect(a.prompt).toContain("Banane");
    expect(a.prompt).toContain("Küche, Smoothie-Mixer");
    expect(a.prompt).toContain("Erdbeere");
    expect(a.seed).toBe(c.seed); // gleicher Sprecher, gleicher Seed
    expect(buildPrompt(script, script.scenes[1]!).seed).not.toBe(a.seed);
  });
});

describe("Dauer aus voices.json", () => {
  it("liest Dauer je sceneId", async () => {
    const dir = await tmp();
    const file = path.join(dir, "voices.json");
    await writeFile(
      file,
      JSON.stringify({
        scenes: [
          { sceneId: 1, durationSeconds: 4.5 },
          { sceneId: 2, durationSeconds: 6 },
          { sceneId: 3, durationSeconds: 3.2 },
        ],
      }),
    );
    expect(await loadSceneDurations(file, script)).toEqual(durations);
  });

  it("meldet fehlende Datei und fehlende Szene verständlich", async () => {
    const dir = await tmp();
    await expect(loadSceneDurations(path.join(dir, "fehlt.json"), script)).rejects.toThrow(
      /voices\.json nicht gefunden.*npm run voice/,
    );
    const file = path.join(dir, "voices.json");
    await writeFile(file, JSON.stringify({ scenes: [{ sceneId: 1, durationSeconds: 2 }] }));
    await expect(loadSceneDurations(file, script)).rejects.toThrow(/Szene\(n\) 2, 3/);
  });
});

describe("Auswahl per MEDIA_PROVIDER", () => {
  it("wählt dummy, lehnt Unbekanntes ab und verlangt FAL_KEY für fal", () => {
    expect(createMediaProvider({ MEDIA_PROVIDER: "dummy" }).name).toBe("dummy");
    expect(() => createMediaProvider({ MEDIA_PROVIDER: "xyz" })).toThrow(/Erlaubt: fal, dummy/);
    expect(() => createMediaProvider({})).toThrow("FAL_KEY ist nicht gesetzt");
    expect(() => createMediaProvider({ MEDIA_PROVIDER: "fal" })).toThrow("FAL_KEY ist nicht gesetzt");
  });
});

describe("CLI unter Node", () => {
  it("meldet fehlenden FAL_KEY klar, ohne Stacktrace", () => {
    const env = { ...process.env };
    delete env.FAL_KEY;
    delete env.MEDIA_PROVIDER;
    const r = spawnSync(process.execPath, ["src/media/cli.ts"], { encoding: "utf8", env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("FAL_KEY ist nicht gesetzt");
    expect(r.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});
