import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Script } from "../script/schema.ts";
import { generateVoices, VoiceError, type SpeechClient } from "./generate.ts";
import { assignVoices, parseLanguage } from "./voices.ts";
import { wavDurationSeconds } from "./wav.ts";

/** Erzeugt eine gültige Mono-WAV (16 kHz, 16 Bit) mit der gegebenen Dauer. */
function makeWav(seconds: number): Buffer {
  const byteRate = 32000;
  const dataLen = Math.round(seconds * byteRate);
  const b = Buffer.alloc(44 + dataLen);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + dataLen, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(byteRate, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(dataLen, 40);
  return b;
}

const script: Script = {
  version: 1,
  title: "Test",
  topic: "Test",
  characters: [
    { name: "Bruno", fruit: "Banane", personality: "dramatisch" },
    { name: "Erna", fruit: "Erdbeere", personality: "zickig" },
  ],
  scenes: [
    { id: 1, description: "a", speaker: "Bruno", text: "Das ist mein Smoothie!" },
    { id: 2, description: "b", speaker: "Erna", text: "Niemals, du Banane!" },
    { id: 3, description: "c", speaker: "Bruno", text: "Doch." },
  ],
};

function mockClient(opts: { failOnSynth?: number } = {}) {
  const c = {
    synthCalls: [] as { voice: string; input: string }[],
    transcribeCalls: 0,
    async synthesize(req: { voice: string; input: string }) {
      c.synthCalls.push({ voice: req.voice, input: req.input });
      if (opts.failOnSynth === c.synthCalls.length) throw new Error("503 Dienst nicht erreichbar");
      return makeWav(req.input.length / 10);
    },
    async transcribe() {
      c.transcribeCalls += 1;
      return { words: [{ word: "Test", start: 0, end: 0.5 }] };
    },
  };
  return c satisfies SpeechClient & Record<string, unknown>;
}

const tmp = () => mkdtemp(path.join(os.tmpdir(), "voice-"));

describe("Stimmzuordnung", () => {
  it("gibt verschiedenen Figuren verschiedene Standardstimmen, deterministisch", () => {
    const a = assignVoices(script.characters);
    expect(a.get("Bruno")!.voice).not.toBe(a.get("Erna")!.voice);
    expect([...assignVoices(script.characters).values()]).toEqual([...a.values()]);
  });

  it("nutzt konfigurierte Stimmen und vermeidet Dopplung im Standard", () => {
    const a = assignVoices(script.characters, { Erna: { voice: "onyx", instructions: "kreischig" } });
    expect(a.get("Erna")).toMatchObject({ voice: "onyx", instructions: "kreischig" });
    expect(a.get("Bruno")!.voice).not.toBe("onyx");
  });

  it("Sprache: Standard de, en erlaubt, sonst verständlicher Fehler", () => {
    expect(parseLanguage(undefined)).toBe("de");
    expect(parseLanguage("EN")).toBe("en");
    expect(() => parseLanguage("fr")).toThrow(/nicht unterstützt/);
  });
});

describe("wavDurationSeconds", () => {
  it("liest die Dauer aus dem Header", () => {
    expect(wavDurationSeconds(makeWav(1.5))).toBeCloseTo(1.5, 3);
  });
  it("lehnt Nicht-WAV ab", () => {
    expect(() => wavDurationSeconds(Buffer.alloc(100))).toThrow(/WAV/);
  });
});

describe("generateVoices", () => {
  it("erzeugt pro Szene Datei und Metadaten mit Dauer, Stimme und Kosten", async () => {
    const dir = await tmp();
    const client = mockClient();
    const { meta, usage } = await generateVoices({ client, script, dir });
    expect(meta.scenes.map((s) => s.file)).toEqual(["scene-01.wav", "scene-02.wav", "scene-03.wav"]);
    const s1 = meta.scenes[0]!;
    expect(s1.sceneId).toBe(1);
    expect(s1.durationSeconds).toBeCloseTo("Das ist mein Smoothie!".length / 10, 2);
    expect(s1.words).toHaveLength(1);
    expect(meta.scenes[0]!.voice).toBe(meta.scenes[2]!.voice); // Bruno bleibt Bruno
    expect(meta.scenes[0]!.voice).not.toBe(meta.scenes[1]!.voice);
    expect(meta.totalDurationSeconds).toBeCloseTo(
      meta.scenes.reduce((s, x) => s + x.durationSeconds, 0),
      6,
    );
    expect(usage.costUsd).toBeGreaterThan(0);
    const onDisk = JSON.parse(await readFile(path.join(dir, "voices.json"), "utf8"));
    expect(onDisk.scenes).toHaveLength(3);
  });

  it("erzeugt unveränderte Szenen beim zweiten Lauf nicht neu", async () => {
    const dir = await tmp();
    await generateVoices({ client: mockClient(), script, dir });
    const client = mockClient();
    const { usage } = await generateVoices({ client, script, dir });
    expect(client.synthCalls).toHaveLength(0);
    expect(usage).toEqual({ generated: 0, reused: 3, costUsd: 0 });
  });

  it("meldet Dienstfehler verständlich und setzt danach ohne Neuerzeugung fort", async () => {
    const dir = await tmp();
    const err = await generateVoices({ client: mockClient({ failOnSynth: 3 }), script, dir }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(VoiceError);
    expect((err as VoiceError).message).toMatch(/Szene 3.*503/);
    expect((err as VoiceError).usage.generated).toBe(2);
    const retry = mockClient();
    const { meta } = await generateVoices({ client: retry, script, dir });
    expect(retry.synthCalls).toHaveLength(1);
    expect(meta.scenes).toHaveLength(3);
  });

  it("bricht bei Überschreiten der Kostenobergrenze ab", async () => {
    const dir = await tmp();
    await expect(
      generateVoices({ client: mockClient(), script, dir, maxCostUsd: 0 }),
    ).rejects.toThrow(/Kostenobergrenze/);
  });
});

describe("CLI unter Node", () => {
  it("startet und meldet fehlenden API-Key klar", () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    const r = spawnSync(process.execPath, ["src/voice/cli.ts"], { encoding: "utf8", env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("OPENAI_API_KEY ist nicht gesetzt");
    expect(r.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });
});
