import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { InputError } from "./plan.ts";

export const DEFAULT_MUSIC_DIR = "assets/music";
const MUSIC_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]);

/**
 * Wählt die Hintergrundmusik. Ausdrücklich angegebene Datei muss existieren (sonst Fehler).
 * Ohne Angabe wird die alphabetisch erste Audiodatei in `assets/music/` genommen; gibt es
 * keine, läuft der Schnitt ohne Musik weiter (Ergebnis `undefined`).
 */
export async function resolveMusic(
  explicit: string | undefined,
  dir: string = DEFAULT_MUSIC_DIR,
): Promise<string | undefined> {
  if (explicit) {
    try {
      await access(explicit);
    } catch {
      throw new InputError(`Musikdatei nicht gefunden: ${explicit}`);
    }
    return path.resolve(explicit);
  }
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const first = names
    .filter((n) => MUSIC_EXTENSIONS.has(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))[0];
  return first ? path.resolve(dir, first) : undefined;
}
