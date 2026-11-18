import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Script } from "../script/schema.ts";
import { assignVoices, DEFAULT_LANGUAGE, type Language, type VoiceMap } from "./voices.ts";
import { wavDurationSeconds } from "./wav.ts";

/** Schmale Schnittstelle zum Sprachdienst, damit Tests ohne API-Aufruf laufen. */
export interface SpeechClient {
  synthesize(req: {
    model: string;
    voice: string;
    instructions: string;
    input: string;
  }): Promise<Buffer>;
  transcribe(req: {
    model: string;
    audio: Buffer;
    language: Language;
  }): Promise<{ words: { word: string; start: number; end: number }[] }>;
}

export const TTS_MODEL = "gpt-4o-mini-tts";
export const TRANSCRIBE_MODEL = "whisper-1";
export const DEFAULT_VOICE_DIR = "output/voices";
export const DEFAULT_MAX_COST_USD = 0.15; // Obergrenze laut docs/tech-stack.md

/** Preise in USD (Schätzung, Stand 2026-11-18, nicht live verifiziert). */
export interface VoicePricing {
  ttsInputPerMTok: number;
  ttsAudioPerMinute: number;
  transcribePerMinute: number;
}
export const DEFAULT_PRICING: VoicePricing = {
  ttsInputPerMTok: 0.6,
  ttsAudioPerMinute: 0.015,
  transcribePerMinute: 0.006,
};

export interface SceneAudio {
  sceneId: number;
  speaker: string;
  voice: string;
  text: string;
  /** Dateiname relativ zum Ausgabeordner. */
  file: string;
  durationSeconds: number;
  words: { word: string; start: number; end: number }[];
  costUsd: number;
  /** Hash aus Text, Stimme, Anweisung, Sprache: erkennt, ob neu erzeugt werden muss. */
  hash: string;
}

export interface VoiceMeta {
  version: 1;
  language: Language;
  scenes: SceneAudio[];
  totalDurationSeconds: number;
}

export interface VoiceUsage {
  /** Neu erzeugte Szenen in diesem Lauf. */
  generated: number;
  /** Aus vorhandenen Dateien übernommene Szenen (kostenlos). */
  reused: number;
  /** Kosten dieses Laufs (geschätzt). */
  costUsd: number;
}

export class VoiceError extends Error {
  readonly sceneId: number;
  readonly usage: VoiceUsage;

  constructor(message: string, sceneId: number, usage: VoiceUsage, cause?: unknown) {
    super(message, { cause });
    this.sceneId = sceneId;
    this.usage = usage;
    this.name = "VoiceError";
  }
}

export interface GenerateVoicesOptions {
  client: SpeechClient;
  script: Script;
  /** Zielordner für Audiodateien und `voices.json`. */
  dir: string;
  voices?: VoiceMap;
  language?: Language;
  pricing?: VoicePricing;
  maxCostUsd?: number;
}

export function sceneFileName(sceneId: number): string {
  return `scene-${String(sceneId).padStart(2, "0")}.wav`;
}

function hashOf(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(file: string): Promise<VoiceMeta | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as VoiceMeta;
  } catch {
    return undefined;
  }
}

async function writeMeta(file: string, meta: VoiceMeta): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(meta, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

/**
 * Erzeugt pro Szene eine Audiodatei (`scene-NN.wav`, NN = scenes[].id) und die
 * Metadatendatei `voices.json` mit gemessener Dauer und Wort-Zeitstempeln. Bereits
 * erzeugte, unveränderte Szenen werden übernommen. Die Metadaten werden nach jeder
 * Szene gespeichert, ein Fehler verliert also keine fertige Arbeit.
 */
export async function generateVoices(
  opts: GenerateVoicesOptions,
): Promise<{ meta: VoiceMeta; usage: VoiceUsage; metaFile: string }> {
  const { client, script, dir } = opts;
  const language = opts.language ?? DEFAULT_LANGUAGE;
  const pricing = opts.pricing ?? DEFAULT_PRICING;
  const maxCost = opts.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const voices = assignVoices(script.characters, opts.voices, language);
  await mkdir(dir, { recursive: true });
  const metaFile = path.join(dir, "voices.json");
  const previous = new Map(
    ((await readMeta(metaFile))?.scenes ?? []).map((s) => [s.sceneId, s] as const),
  );
  const usage: VoiceUsage = { generated: 0, reused: 0, costUsd: 0 };
  const done: SceneAudio[] = [];
  const snapshot = (): VoiceMeta => ({
    version: 1,
    language,
    scenes: [...done],
    totalDurationSeconds: done.reduce((s, x) => s + x.durationSeconds, 0),
  });

  for (const scene of script.scenes) {
    const v = voices.get(scene.speaker);
    if (!v) {
      throw new VoiceError(`Szene ${scene.id}: unbekannte Figur "${scene.speaker}"`, scene.id, usage);
    }
    const hash = hashOf([scene.text, v.voice, v.instructions, language, TTS_MODEL]);
    const file = sceneFileName(scene.id);
    const old = previous.get(scene.id);
    if (old && old.hash === hash && (await exists(path.join(dir, file)))) {
      done.push(old);
      usage.reused += 1;
      continue;
    }
    if (usage.costUsd >= maxCost) {
      await writeMeta(metaFile, snapshot());
      throw new VoiceError(
        `Kostenobergrenze ${maxCost} USD erreicht, Abbruch vor Szene ${scene.id}`,
        scene.id,
        usage,
      );
    }
    try {
      const audio = await client.synthesize({
        model: TTS_MODEL,
        voice: v.voice,
        instructions: v.instructions,
        input: scene.text,
      });
      const durationSeconds = wavDurationSeconds(audio);
      await writeFile(path.join(dir, file), audio);
      const ttsCost =
        ((scene.text.length / 4) * pricing.ttsInputPerMTok) / 1_000_000 +
        (durationSeconds / 60) * pricing.ttsAudioPerMinute;
      usage.costUsd += ttsCost;
      const { words } = await client.transcribe({ model: TRANSCRIBE_MODEL, audio, language });
      const transcribeCost = (durationSeconds / 60) * pricing.transcribePerMinute;
      usage.costUsd += transcribeCost;
      usage.generated += 1;
      done.push({
        sceneId: scene.id,
        speaker: scene.speaker,
        voice: v.voice,
        text: scene.text,
        file,
        durationSeconds,
        words,
        costUsd: ttsCost + transcribeCost,
        hash,
      });
    } catch (err) {
      await writeMeta(metaFile, snapshot());
      const reason = err instanceof Error ? err.message : String(err);
      throw new VoiceError(
        `Stimme für Szene ${scene.id} (${scene.speaker}) fehlgeschlagen: ${reason}. ` +
          `Bereits erzeugte Szenen bleiben erhalten; erneut starten setzt fort.`,
        scene.id,
        usage,
        err,
      );
    }
    await writeMeta(metaFile, snapshot());
  }
  const meta = snapshot();
  await writeMeta(metaFile, meta);
  return { meta, usage, metaFile };
}
