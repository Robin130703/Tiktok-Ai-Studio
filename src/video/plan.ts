import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { MediaMeta } from "../media/generate.ts";
import type { MediaType } from "../media/provider.ts";
import type { VoiceMeta } from "../voice/generate.ts";
import type { SubtitleWord } from "./ass.ts";

export const FPS = 30;

/** Eine Szene mit allem, was der Schnitt braucht. Zuordnung Sprache/Material nur über `sceneId`. */
export interface PlannedScene {
  sceneId: number;
  audioFile: string;
  mediaFile: string;
  mediaType: MediaType;
  text: string;
  words: SubtitleWord[];
  /** Gemessene Sprachdauer aus voices.json. */
  speechSeconds: number;
  /** Anzahl Videobilder dieser Szene (Grenzen aus kumulierter Dauer gerundet, kein Drift). */
  frames: number;
  /** Dauer der Szene im Video = frames / FPS. */
  durationSeconds: number;
  startSeconds: number;
}

export interface Plan {
  scenes: PlannedScene[];
  /** Gesamtlänge im Video; entspricht der Summe der Sprachdauern (auf ein Bild genau). */
  totalSeconds: number;
  totalFrames: number;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

interface RawVoiceScene {
  sceneId?: unknown;
  file?: unknown;
  durationSeconds?: unknown;
  text?: unknown;
  words?: unknown;
}
interface RawMediaScene {
  sceneId?: unknown;
  file?: unknown;
  type?: unknown;
}

async function readJson(file: string, label: string, hint: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new InputError(`${label} nicht gefunden: ${file}. ${hint}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new InputError(`${label} ist kein gültiges JSON: ${file}`);
  }
}

async function requireFile(file: string, what: string): Promise<void> {
  try {
    await access(file);
  } catch {
    throw new InputError(`${what} fehlt: ${file}`);
  }
}

function sceneList(json: unknown, label: string): Record<string, unknown>[] {
  const scenes = (json as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new InputError(`${label} enthält keine Szenen ("scenes" fehlt oder ist leer)`);
  }
  return scenes as Record<string, unknown>[];
}

function indexById<T extends { sceneId?: unknown }>(items: T[], label: string): Map<number, T> {
  const map = new Map<number, T>();
  for (const item of items) {
    if (typeof item.sceneId !== "number" || !Number.isInteger(item.sceneId)) {
      throw new InputError(`${label}: Eintrag ohne gültige sceneId`);
    }
    if (map.has(item.sceneId)) {
      throw new InputError(`${label}: sceneId ${item.sceneId} kommt mehrfach vor`);
    }
    map.set(item.sceneId, item);
  }
  return map;
}

/**
 * Verbindet `voices.json` und `media.json` ausschließlich über `sceneId` und berechnet die
 * Zeitachse. Pfade der Dateien sind relativ zum Ordner der jeweiligen JSON-Datei.
 * Fehlt zu einer sceneId Sprache oder Material, wird abgebrochen (nichts wird geraten).
 * Die Dateiexistenz prüft `loadPlan`; diese Funktion ist rein und gut testbar.
 */
export function buildPlan(
  voices: VoiceMeta,
  media: MediaMeta,
  dirs: { voicesDir: string; mediaDir: string },
): Plan {
  const voiceById = indexById(sceneList(voices, "voices.json") as RawVoiceScene[], "voices.json");
  const mediaById = indexById(sceneList(media, "media.json") as RawMediaScene[], "media.json");

  const missingMedia = [...voiceById.keys()].filter((id) => !mediaById.has(id)).sort((a, b) => a - b);
  const missingVoice = [...mediaById.keys()].filter((id) => !voiceById.has(id)).sort((a, b) => a - b);
  if (missingMedia.length > 0 || missingVoice.length > 0) {
    const parts: string[] = [];
    if (missingMedia.length > 0) {
      parts.push(`Bild/Clip fehlt für Szene(n) ${missingMedia.join(", ")} (in voices.json vorhanden, nicht in media.json)`);
    }
    if (missingVoice.length > 0) {
      parts.push(`Sprache fehlt für Szene(n) ${missingVoice.join(", ")} (in media.json vorhanden, nicht in voices.json)`);
    }
    throw new InputError(
      `voices.json und media.json passen nicht zusammen: ${parts.join("; ")}. ` +
        `Zuordnung erfolgt nur über sceneId; fehlende Teile mit npm run voice bzw. npm run media erzeugen.`,
    );
  }

  const ids = [...voiceById.keys()].sort((a, b) => a - b);
  const scenes: PlannedScene[] = [];
  let cumulative = 0;
  let prevBoundary = 0;
  for (const id of ids) {
    const v = voiceById.get(id)!;
    const m = mediaById.get(id)!;
    const speechSeconds = v.durationSeconds;
    if (typeof speechSeconds !== "number" || !Number.isFinite(speechSeconds) || speechSeconds <= 0) {
      throw new InputError(`voices.json: Szene ${id} hat keine gültige durationSeconds`);
    }
    if (typeof v.file !== "string" || v.file === "") {
      throw new InputError(`voices.json: Szene ${id} hat keine Audiodatei ("file")`);
    }
    if (typeof m.file !== "string" || m.file === "") {
      throw new InputError(`media.json: Szene ${id} hat keine Datei ("file")`);
    }
    if (m.type !== "image" && m.type !== "video") {
      throw new InputError(`media.json: Szene ${id} hat unbekannten Typ "${String(m.type)}" (erlaubt: image, video)`);
    }
    cumulative += speechSeconds;
    const boundary = Math.round(cumulative * FPS);
    const frames = boundary - prevBoundary;
    if (frames < 1) {
      throw new InputError(`Szene ${id} ist mit ${speechSeconds}s zu kurz für ein Videobild`);
    }
    const words = Array.isArray(v.words)
      ? (v.words as SubtitleWord[]).filter(
          (w) => typeof w?.word === "string" && Number.isFinite(w.start) && Number.isFinite(w.end),
        )
      : [];
    scenes.push({
      sceneId: id,
      audioFile: path.resolve(dirs.voicesDir, v.file),
      mediaFile: path.resolve(dirs.mediaDir, m.file),
      mediaType: m.type,
      text: typeof v.text === "string" ? v.text : "",
      words,
      speechSeconds,
      frames,
      durationSeconds: frames / FPS,
      startSeconds: prevBoundary / FPS,
    });
    prevBoundary = boundary;
  }
  return { scenes, totalSeconds: prevBoundary / FPS, totalFrames: prevBoundary };
}

/** Liest beide JSON-Dateien, prüft, dass alle Audio- und Mediendateien existieren, und plant. */
export async function loadPlan(voicesFile: string, mediaFile: string): Promise<Plan> {
  const voices = (await readJson(
    voicesFile,
    "voices.json",
    'Erst "npm run voice -- <skript.json>" ausführen oder den Pfad mit --voices angeben.',
  )) as VoiceMeta;
  const media = (await readJson(
    mediaFile,
    "media.json",
    'Erst "npm run media -- <skript.json>" ausführen oder den Pfad mit --media angeben.',
  )) as MediaMeta;
  const plan = buildPlan(voices, media, {
    voicesDir: path.dirname(voicesFile),
    mediaDir: path.dirname(mediaFile),
  });
  for (const s of plan.scenes) {
    await requireFile(s.audioFile, `Audiodatei für Szene ${s.sceneId}`);
    await requireFile(s.mediaFile, `${s.mediaType === "video" ? "Clip" : "Bild"} für Szene ${s.sceneId}`);
  }
  return plan;
}
