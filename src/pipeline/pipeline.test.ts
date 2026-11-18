import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDummyProvider } from "../media/dummy.ts";
import type { MediaProvider } from "../media/provider.ts";
import type { LlmClient } from "../script/generator.ts";
import { ToolNotFoundError, type Runner } from "../video/runner.ts";
import type { SpeechClient } from "../voice/generate.ts";
import { createDummyLlmClient, createDummySpeechClient } from "./dummy.ts";
import {
  assertEnv,
  BudgetExceededError,
  missingEnv,
  PipelineError,
  resolveMaxCost,
} from "./env.ts";
import { runPipeline } from "./run.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pipeline-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Fixture {
  events: string[];
  llm: LlmClient;
  speech: SpeechClient;
  media: MediaProvider;
  runner: Runner;
  runnerArgs: string[][];
}

/** Dummy-Clients, die ihre Aufrufe in Reihenfolge protokollieren. */
function fixture(opts: { llmInputTokens?: number; mediaCostUsd?: number } = {}): Fixture {
  const events: string[] = [];
  const runnerArgs: string[][] = [];
  const baseLlm = createDummyLlmClient();
  const baseSpeech = createDummySpeechClient();
  const baseMedia = createDummyProvider();
  return {
    events,
    runnerArgs,
    llm: {
      async complete(req) {
        events.push("llm");
        const res = await baseLlm.complete(req);
        return { ...res, inputTokens: opts.llmInputTokens ?? 0 };
      },
    },
    speech: {
      async synthesize(req) {
        events.push("tts");
        return baseSpeech.synthesize(req);
      },
      transcribe: (req) => baseSpeech.transcribe(req),
    },
    media: {
      name: "dummy",
      type: "image",
      async generate(req) {
        events.push("media");
        return { ...(await baseMedia.generate(req)), costUsd: opts.mediaCostUsd ?? 0 };
      },
    },
    runner: async (args) => {
      events.push(args[0] === "-version" ? "ffmpeg-check" : "ffmpeg-run");
      runnerArgs.push(args);
      return { stdout: "ffmpeg version mock\n", stderr: "" };
    },
  };
}

function base(f: Fixture, extra: { maxCostUsd?: number; name?: string; topic?: string } = {}) {
  return {
    llm: f.llm,
    speech: f.speech,
    media: f.media,
    runner: f.runner,
    outputDir: dir,
    maxCostUsd: 1,
    env: {},
    noMusic: true,
    ...extra,
  };
}

describe("runPipeline (Ende-zu-Ende, Dummy, FFmpeg gemockt)", () => {
  it("führt die Schritte in Reihenfolge aus und legt die Ausgabestruktur an", async () => {
    const f = fixture();
    const logs: string[] = [];
    const res = await runPipeline({
      ...base(f, { name: "probe", topic: "Streit um den Smoothie" }),
      log: (m) => logs.push(m),
    });

    // Reihenfolge: FFmpeg-Check zuerst, dann Skript, Stimmen, Bilder, zuletzt Schnitt.
    const compact = f.events.filter((e, i) => e !== f.events[i - 1]);
    expect(compact).toEqual(["ffmpeg-check", "llm", "tts", "media", "ffmpeg-check", "ffmpeg-run"]);
    expect(f.events.filter((e) => e === "tts")).toHaveLength(10);
    expect(f.events.filter((e) => e === "media")).toHaveLength(10);

    // Pfade und Ausgabestruktur (Layout der Einzelmodule).
    expect(res.name).toBe("probe");
    expect(res.scriptFile).toBe(path.join(dir, "scripts", "probe.json"));
    expect(res.voicesFile).toBe(path.join(dir, "voices", "probe", "voices.json"));
    expect(res.mediaFile).toBe(path.join(dir, "media", "probe", "media.json"));
    expect(res.videoFile).toBe(path.resolve(dir, "video", "probe", "video.mp4"));
    expect((await readdir(path.join(dir, "scripts"))).sort()).toEqual([
      "probe.json",
      "probe.usage.json",
    ]);
    const voiceFiles = await readdir(path.join(dir, "voices", "probe"));
    expect(voiceFiles).toContain("scene-01.wav");
    expect(voiceFiles).toContain("scene-10.wav");
    expect(voiceFiles).toContain("voices.json");
    const mediaFiles = await readdir(path.join(dir, "media", "probe"));
    expect(mediaFiles).toContain("scene-01.png");
    expect(mediaFiles).toContain("media.json");
    expect(await readdir(path.join(dir, "video", "probe"))).toContain("subtitles.ass");

    // FFmpeg bekommt den Zielpfad und die Eingaben aus der Ausgabestruktur.
    const ffArgs = f.runnerArgs.at(-1)!;
    expect(ffArgs).toContain(res.videoFile);
    expect(ffArgs.filter((a) => a.endsWith(".png"))).toHaveLength(10);
    expect(ffArgs.filter((a) => a.endsWith(".wav"))).toHaveLength(10);
    expect(ffArgs.join(" ")).toContain("subtitles.ass");

    // Thema kommt im Skript an, Fortschritt nennt alle Schritte und den Videopfad.
    expect(JSON.parse(await readFile(res.scriptFile, "utf8")).topic).toBe("Streit um den Smoothie");
    for (const step of ["[1/4]", "[2/4]", "[3/4]", "[4/4]"]) {
      expect(logs.some((l) => l.startsWith(step))).toBe(true);
    }
    expect(logs.at(-1)).toContain(res.videoFile);
    expect(res.totalCostUsd).toBeLessThan(0.05);
  });

  it("nutzt ohne Namen den Skript-Dateinamen als <name>", async () => {
    const f = fixture();
    const res = await runPipeline(base(f));
    expect(path.basename(res.scriptFile, ".json")).toBe(res.name);
    expect(res.videoFile).toBe(path.resolve(dir, "video", res.name, "video.mp4"));
  });

  it("setzt einen Lauf mit gleichem Namen fort, ohne bezahlte Schritte zu wiederholen", async () => {
    const f1 = fixture();
    await runPipeline(base(f1, { name: "fortsetzung" }));
    const f2 = fixture();
    await runPipeline(base(f2, { name: "fortsetzung" }));
    expect(f2.events).not.toContain("llm");
    expect(f2.events).not.toContain("tts");
    expect(f2.events).not.toContain("media");
    expect(f2.events.at(-1)).toBe("ffmpeg-run");
  });

  it("lehnt unsichere Ausgabenamen ab", async () => {
    const f = fixture();
    await expect(runPipeline(base(f, { name: "../evil" }))).rejects.toThrow(PipelineError);
    expect(f.events).toEqual([]);
  });

  it("bricht ohne FFmpeg vor dem ersten kostenpflichtigen Schritt mit klarer Meldung ab", async () => {
    const f = fixture();
    const runner: Runner = async () => {
      throw new ToolNotFoundError("FFmpeg", "ffmpeg");
    };
    const err = await runPipeline({ ...base(f), runner }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolNotFoundError);
    expect((err as Error).message).toContain("FFmpeg wurde nicht gefunden");
    expect((err as Error).message).toContain("winget install");
    expect(f.events).toEqual([]);
  });
});

describe("Budget-Check (MAX_COST_PER_VIDEO_USD, gemockte Kosten)", () => {
  it("bricht nach dem Skript ab, wenn dessen Kosten die Obergrenze erreichen, vor Stimmen", async () => {
    // 100000 Eingabetoken * 1 USD/MTok = 0,10 USD (Standardpreis des Skript-Moduls).
    const f = fixture({ llmInputTokens: 100_000 });
    const err = await runPipeline(base(f, { maxCostUsd: 0.1, name: "teuer" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toContain("MAX_COST_PER_VIDEO_USD=0.1");
    expect((err as Error).message).toContain("Stimmen");
    expect(f.events).not.toContain("tts");
    expect(f.events).not.toContain("media");
    expect(f.events).not.toContain("ffmpeg-run");
  });

  it("bricht nach den Stimmen ab, wenn Skript plus Stimmen die Obergrenze erreichen, vor Bildern", async () => {
    // Skript 0,50 USD; Stimmen (Dummy, 60 s) ca. 0,021 USD; Obergrenze 0,52.
    const f = fixture({ llmInputTokens: 500_000 });
    const err = await runPipeline(base(f, { maxCostUsd: 0.52, name: "teuer2" })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toContain("Bilder");
    expect(f.events).toContain("tts");
    expect(f.events).not.toContain("media");
    expect(f.events).not.toContain("ffmpeg-run");
  });

  it("bricht bei zu teuren Bildern mitten im Schritt ab (Modul-Obergrenze folgt dem Restbudget)", async () => {
    // Bild je 0,30 USD, Restbudget für Bilder ca. 0,48: nach zwei Bildern Schluss.
    const f = fixture({ mediaCostUsd: 0.3 });
    await expect(runPipeline(base(f, { maxCostUsd: 0.5, name: "teuer3" }))).rejects.toThrow(
      /Kostenobergrenze/,
    );
    expect(f.events.filter((e) => e === "media")).toHaveLength(2);
    expect(f.events).not.toContain("ffmpeg-run");
  });
});

describe("Umgebung", () => {
  it("meldet fehlende Schlüssel namentlich, ohne Werte", () => {
    expect(missingEnv({}, { dummy: false })).toEqual([
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "FAL_KEY",
    ]);
    expect(() => assertEnv({ OPENAI_API_KEY: "geheim123" }, { dummy: false })).toThrow(
      /ANTHROPIC_API_KEY, FAL_KEY/,
    );
    try {
      assertEnv({ OPENAI_API_KEY: "geheim123" }, { dummy: false });
    } catch (e) {
      expect((e as Error).message).not.toContain("geheim123");
    }
  });

  it("verlangt FAL_KEY nur bei MEDIA_PROVIDER=fal und im Dummy-Modus gar keine Schlüssel", () => {
    expect(
      missingEnv(
        { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", MEDIA_PROVIDER: "dummy" },
        { dummy: false },
      ),
    ).toEqual([]);
    expect(missingEnv({}, { dummy: true })).toEqual([]);
  });

  it("liest MAX_COST_PER_VIDEO_USD mit Standard 1.00 und prüft ungültige Werte", () => {
    expect(resolveMaxCost({})).toBe(1);
    expect(resolveMaxCost({ MAX_COST_PER_VIDEO_USD: "0.25" })).toBe(0.25);
    expect(() => resolveMaxCost({ MAX_COST_PER_VIDEO_USD: "viel" })).toThrow(PipelineError);
    expect(() => resolveMaxCost({ MAX_COST_PER_VIDEO_USD: "0" })).toThrow(PipelineError);
  });
});
