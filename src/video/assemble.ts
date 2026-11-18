import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_DURATION_S, MIN_DURATION_S } from "../script/schema.ts";
import { buildAss } from "./ass.ts";
import { buildFfmpegArgs } from "./ffmpeg.ts";
import { DEFAULT_MUSIC_DIR, resolveMusic } from "./music.ts";
import { loadPlan, type Plan } from "./plan.ts";
import { ensureFfmpeg, type Runner } from "./runner.ts";

export const DEFAULT_VIDEO_DIR = "output/video";

export interface AssembleOptions {
  voicesFile: string;
  mediaFile: string;
  /** Zieldatei (.mp4); daneben liegt `subtitles.ass`. */
  outFile: string;
  /** Ausdrücklich gewählte Musikdatei; sonst erste Datei aus `musicDir`. */
  musicFile?: string;
  /** Musik komplett abschalten. */
  noMusic?: boolean;
  musicDir?: string;
  /** Injizierbarer FFmpeg-Aufruf (Tests: Attrappe). */
  runner: Runner;
}

export interface AssembleResult {
  outFile: string;
  assFile: string;
  plan: Plan;
  musicFile?: string;
  ffmpegVersion: string;
  /** Hinweise, die den Lauf nicht abbrechen (z. B. keine Musik, Länge außerhalb des Zielbereichs). */
  warnings: string[];
  args: string[];
}

/**
 * Schneidet Szenen zu einem 1080x1920-Video mit eingebrannten Untertiteln und Musik.
 * Reihenfolge: FFmpeg prüfen, Eingaben prüfen (bricht bei Unstimmigkeit ab), Musik wählen,
 * ASS schreiben, FFmpeg einmal aufrufen.
 */
export async function assembleVideo(opts: AssembleOptions): Promise<AssembleResult> {
  const ffmpegVersion = await ensureFfmpeg(opts.runner);
  const plan = await loadPlan(opts.voicesFile, opts.mediaFile);
  const warnings: string[] = [];

  let musicFile: string | undefined;
  if (!opts.noMusic) {
    musicFile = await resolveMusic(opts.musicFile, opts.musicDir ?? DEFAULT_MUSIC_DIR);
    if (!musicFile) {
      warnings.push(
        `Keine Musikdatei in ${opts.musicDir ?? DEFAULT_MUSIC_DIR} gefunden: Schnitt läuft ohne Hintergrundmusik (siehe assets/music/README.md).`,
      );
    }
  }
  if (plan.totalSeconds < MIN_DURATION_S || plan.totalSeconds > MAX_DURATION_S) {
    warnings.push(
      `Gesamtlänge ${plan.totalSeconds.toFixed(1)} s liegt außerhalb des Zielbereichs ${MIN_DURATION_S}-${MAX_DURATION_S} s.`,
    );
  }

  const outFile = path.resolve(opts.outFile);
  await mkdir(path.dirname(outFile), { recursive: true });
  const assFile = path.join(path.dirname(outFile), "subtitles.ass");
  await writeFile(
    assFile,
    buildAss(
      plan.scenes.map((s) => ({
        startSeconds: s.startSeconds,
        durationSeconds: s.durationSeconds,
        text: s.text,
        words: s.words,
      })),
    ),
    "utf8",
  );

  const args = buildFfmpegArgs({ plan, assFile, musicFile, outFile });
  await opts.runner(args);
  return { outFile, assFile, plan, musicFile, ffmpegVersion, warnings, args };
}
