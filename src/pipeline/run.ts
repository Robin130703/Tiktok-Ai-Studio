import { access } from "node:fs/promises";
import path from "node:path";
import { loadSceneDurations } from "../media/durations.ts";
import { DEFAULT_MAX_COST_USD as MAX_MEDIA, generateMedia } from "../media/generate.ts";
import type { MediaProvider } from "../media/provider.ts";
import {
  DEFAULT_MAX_COST_USD as MAX_SCRIPT,
  generateScript,
  type LlmClient,
} from "../script/generator.ts";
import { loadScript, saveScript } from "../script/store.ts";
import { assembleVideo, type AssembleResult } from "../video/assemble.ts";
import { ensureFfmpeg, type Runner } from "../video/runner.ts";
import {
  DEFAULT_MAX_COST_USD as MAX_VOICE,
  generateVoices,
  type SpeechClient,
} from "../voice/generate.ts";
import { parseLanguage } from "../voice/voices.ts";
import { BudgetExceededError, PipelineError } from "./env.ts";

export interface PipelineOptions {
  llm: LlmClient;
  speech: SpeechClient;
  media: MediaProvider;
  /** FFmpeg-Aufrufer (Tests: Attrappe). */
  runner: Runner;
  topic?: string;
  /** Ausgabename `<name>`; ohne Angabe: Dateiname des neuen Skripts (Zeitstempel-Titel). */
  name?: string;
  /** Wurzel der Ausgaben, Standard `output`. */
  outputDir?: string;
  /** Obergrenze pro Video in USD. */
  maxCostUsd: number;
  /** Quelle für VOICE_LANGUAGE, Standard `process.env`. */
  env?: NodeJS.ProcessEnv;
  musicFile?: string;
  noMusic?: boolean;
  musicDir?: string;
  /** Fortschrittsausgabe, Standard: nichts. */
  log?: (message: string) => void;
}

export interface PipelineResult {
  name: string;
  scriptFile: string;
  voicesFile: string;
  mediaFile: string;
  videoFile: string;
  subtitlesFile: string;
  totalCostUsd: number;
  costs: { script: number; voices: number; media: number };
  assembly: AssembleResult;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Skript -> Stimmen -> Bilder -> Schnitt. Vor jedem kostenpflichtigen Schritt wird die
 * Summe der bisherigen Kosten gegen `maxCostUsd` geprüft. Vorhandene Zwischenergebnisse
 * werden wiederverwendet (ein Skript nur, wenn ein Ausgabename angegeben ist).
 */
export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const log = opts.log ?? (() => {});
  const root = opts.outputDir ?? "output";
  const env = opts.env ?? process.env;
  if (opts.name !== undefined && !NAME_PATTERN.test(opts.name)) {
    throw new PipelineError(
      `Ungültiger Ausgabename "${opts.name}": erlaubt sind Buchstaben, Ziffern, ".", "_" und "-".`,
    );
  }
  const language = parseLanguage(env.VOICE_LANGUAGE);
  const costs = { script: 0, voices: 0, media: 0 };
  const spent = (): number => costs.script + costs.voices + costs.media;
  const guard = (step: string): void => {
    if (spent() >= opts.maxCostUsd) throw new BudgetExceededError(step, spent(), opts.maxCostUsd);
  };
  const remaining = (moduleMax: number): number =>
    Math.min(moduleMax, Math.max(0, opts.maxCostUsd - spent()));

  log("[0/4] Prüfe FFmpeg ...");
  await ensureFfmpeg(opts.runner);

  // 1. Skript
  const scriptDir = path.join(root, "scripts");
  let scriptFile: string;
  let name: string;
  if (opts.name && (await exists(path.join(scriptDir, `${opts.name}.json`)))) {
    scriptFile = path.join(scriptDir, `${opts.name}.json`);
    name = opts.name;
    log(`[1/4] Skript: vorhandenes Skript wiederverwendet (${scriptFile})`);
  } else {
    guard("Skript");
    log("[1/4] Skript wird erzeugt ...");
    const { script, usage } = await generateScript({
      client: opts.llm,
      topic: opts.topic,
      maxCostUsd: remaining(MAX_SCRIPT),
    });
    costs.script = usage.costUsd;
    scriptFile = await saveScript(script, usage, scriptDir, new Date(), opts.name);
    name = path.basename(scriptFile, ".json");
    log(`[1/4] Skript: ${scriptFile} (ca. ${usage.costUsd.toFixed(4)} USD)`);
  }
  const script = await loadScript(scriptFile);

  // 2. Stimmen
  guard("Stimmen");
  log("[2/4] Stimmen werden erzeugt ...");
  const voiceRes = await generateVoices({
    client: opts.speech,
    script,
    dir: path.join(root, "voices", name),
    language,
    maxCostUsd: remaining(MAX_VOICE),
  });
  costs.voices = voiceRes.usage.costUsd;
  log(
    `[2/4] Stimmen: ${voiceRes.metaFile} (neu ${voiceRes.usage.generated}, wiederverwendet ${voiceRes.usage.reused}, ca. ${costs.voices.toFixed(4)} USD)`,
  );

  // 3. Bilder
  guard("Bilder");
  log("[3/4] Bilder werden beschafft ...");
  const durations = await loadSceneDurations(voiceRes.metaFile, script);
  const mediaRes = await generateMedia({
    provider: opts.media,
    script,
    durations,
    dir: path.join(root, "media", name),
    maxCostUsd: remaining(MAX_MEDIA),
  });
  costs.media = mediaRes.usage.costUsd;
  log(
    `[3/4] Bilder: ${mediaRes.metaFile} (neu ${mediaRes.usage.generated}, wiederverwendet ${mediaRes.usage.reused}, ca. ${costs.media.toFixed(4)} USD)`,
  );

  // 4. Schnitt (kostenlos)
  log("[4/4] Video wird geschnitten ...");
  const assembly = await assembleVideo({
    voicesFile: voiceRes.metaFile,
    mediaFile: mediaRes.metaFile,
    outFile: path.join(root, "video", name, "video.mp4"),
    musicFile: opts.musicFile,
    noMusic: opts.noMusic,
    musicDir: opts.musicDir,
    runner: opts.runner,
  });
  for (const w of assembly.warnings) log(`Hinweis: ${w}`);
  log(`[4/4] Video: ${assembly.outFile}`);

  return {
    name,
    scriptFile,
    voicesFile: voiceRes.metaFile,
    mediaFile: mediaRes.metaFile,
    videoFile: assembly.outFile,
    subtitlesFile: assembly.assFile,
    totalCostUsd: spent(),
    costs,
    assembly,
  };
}
