import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Script } from "../script/schema.ts";
import {
  ASPECT_RATIO,
  MediaModerationError,
  type MediaProvider,
  type MediaType,
} from "./provider.ts";
import { buildPrompt } from "./prompt.ts";

export const DEFAULT_MEDIA_DIR = "output/media";
export const DEFAULT_MAX_COST_USD = 0.6; // Obergrenze laut docs/tech-stack.md

/** Eintrag je Szene in `media.json`; Zuordnung zu `scene-NN.wav` über `sceneId`. */
export interface SceneMedia {
  sceneId: number;
  /** Dateiname relativ zum Ausgabeordner. */
  file: string;
  type: MediaType;
  /** Dauer der Szene (aus voices.json), vom Aufrufer übergeben. */
  durationSeconds: number;
  /** Kosten der ursprünglichen Erzeugung (USD, geschätzt). */
  costUsd: number;
  provider: string;
  prompt: string;
  /** Hash der Eingaben: erkennt, ob neu erzeugt werden muss. */
  hash: string;
}

export interface MediaMeta {
  version: 1;
  provider: string;
  scenes: SceneMedia[];
}

export interface MediaUsage {
  generated: number;
  reused: number;
  /** Kosten dieses Laufs (geschätzt). Kosten früherer Läufe zählen nur für die Obergrenze. */
  costUsd: number;
}

export class MediaError extends Error {
  readonly sceneId: number;
  readonly usage: MediaUsage;

  constructor(message: string, sceneId: number, usage: MediaUsage, cause?: unknown) {
    super(message, { cause });
    this.sceneId = sceneId;
    this.usage = usage;
    this.name = "MediaError";
  }
}

export interface GenerateMediaOptions {
  provider: MediaProvider;
  script: Script;
  /** Dauer je Szene-Id (siehe `loadSceneDurations`). */
  durations: Map<number, number>;
  dir: string;
  maxCostUsd?: number;
}

export function mediaFileName(sceneId: number, extension: string): string {
  return `scene-${String(sceneId).padStart(2, "0")}.${extension}`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(file: string): Promise<MediaMeta | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as MediaMeta;
  } catch {
    return undefined;
  }
}

async function writeMeta(file: string, meta: MediaMeta): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(meta, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

/**
 * Beschafft pro Szene ein Medium (`scene-NN.<ext>`) und schreibt `media.json`. Unveränderte,
 * bereits vorhandene Medien werden wiederverwendet (kostenlos). Bei Fehler oder Moderation
 * wird abgebrochen; fertige Szenen und Metadaten bleiben erhalten, ein neuer Lauf setzt fort.
 */
export async function generateMedia(
  opts: GenerateMediaOptions,
): Promise<{ meta: MediaMeta; usage: MediaUsage; metaFile: string }> {
  const { provider, script, durations, dir } = opts;
  const maxCost = opts.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  await mkdir(dir, { recursive: true });
  const metaFile = path.join(dir, "media.json");
  const previous = new Map(
    ((await readMeta(metaFile))?.scenes ?? []).map((s) => [s.sceneId, s] as const),
  );
  const usage: MediaUsage = { generated: 0, reused: 0, costUsd: 0 };
  const done: SceneMedia[] = [];
  // Szenen, die in diesem Lauf noch nicht bearbeitet wurden, behalten ihren Eintrag aus dem
  // früheren Lauf: ein Abbruch darf teuer erzeugte spätere Szenen nicht aus media.json löschen.
  const processed = new Set<number>();
  const snapshot = (): MediaMeta => {
    const doneById = new Map(done.map((d) => [d.sceneId, d] as const));
    const scenes: SceneMedia[] = [];
    for (const sc of script.scenes) {
      const entry = processed.has(sc.id) ? doneById.get(sc.id) : previous.get(sc.id);
      if (entry) scenes.push(entry);
    }
    return { version: 1, provider: provider.name, scenes };
  };
  const hashFor = (scene: Script["scenes"][number], durationSeconds: number) => {
    const { prompt, seed } = buildPrompt(script, scene);
    // Bei Video hängt das Ergebnis von der Dauer ab, bei Bildern nicht.
    const hash = createHash("sha256")
      .update(
        [
          provider.name,
          provider.type,
          ASPECT_RATIO,
          String(seed),
          prompt,
          provider.type === "video" ? String(durationSeconds) : "",
        ].join("\u0000"),
      )
      .digest("hex")
      .slice(0, 16);
    return { hash, prompt, seed };
  };

  // Kosten früherer Läufe (gültige, wiederverwendbare Szenen) zählen für die Obergrenze mit.
  let carriedCost = 0;
  for (const scene of script.scenes) {
    const d = durations.get(scene.id);
    const old = previous.get(scene.id);
    if (d !== undefined && old && old.hash === hashFor(scene, d).hash) {
      if (await exists(path.join(dir, old.file))) carriedCost += old.costUsd;
    }
  }

  for (const scene of script.scenes) {
    const durationSeconds = durations.get(scene.id);
    if (durationSeconds === undefined) {
      throw new MediaError(`Szene ${scene.id}: keine Dauer übergeben`, scene.id, usage);
    }
    const { hash, prompt, seed } = hashFor(scene, durationSeconds);
    const old = previous.get(scene.id);
    processed.add(scene.id);
    if (old && old.hash === hash && (await exists(path.join(dir, old.file)))) {
      done.push({ ...old, durationSeconds });
      usage.reused += 1;
      continue;
    }
    // Prüfung vor der Erzeugung: auch das nächste Bild darf die Obergrenze nicht überschreiten.
    const estimate = provider.estimatedCostUsd ?? 0;
    const spent = carriedCost + usage.costUsd;
    if (spent >= maxCost || spent + estimate > maxCost) {
      await writeMeta(metaFile, snapshot());
      throw new MediaError(
        `Kostenobergrenze ${maxCost} USD (inkl. früherer Läufe) würde überschritten, Abbruch vor Szene ${scene.id}`,
        scene.id,
        usage,
      );
    }
    try {
      const res = await provider.generate({
        sceneId: scene.id,
        prompt,
        aspectRatio: ASPECT_RATIO,
        durationSeconds,
        seed,
      });
      const file = mediaFileName(scene.id, res.extension);
      await writeFile(path.join(dir, file), res.data);
      usage.costUsd += res.costUsd;
      usage.generated += 1;
      done.push({
        sceneId: scene.id,
        file,
        type: res.type,
        durationSeconds,
        costUsd: res.costUsd,
        provider: provider.name,
        prompt,
        hash,
      });
    } catch (err) {
      await writeMeta(metaFile, snapshot());
      const reason = err instanceof Error ? err.message : String(err);
      const hint =
        err instanceof MediaModerationError
          ? `abgelehnt (Moderation): ${reason}. Szenenbeschreibung im Skript entschärfen und erneut starten`
          : `Medium fehlgeschlagen: ${reason}`;
      throw new MediaError(
        `Szene ${scene.id} (${scene.speaker}) ${hint}. ` +
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
