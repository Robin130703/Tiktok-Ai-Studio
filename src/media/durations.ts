import { readFile } from "node:fs/promises";
import type { Script } from "../script/schema.ts";

/**
 * Liest die gemessene Dauer je Szene aus `voices.json` (Ausgabe von #7), Zuordnung über
 * `sceneId`. Fehlt Datei oder Szene, gibt es eine verständliche Meldung statt einer Schätzung.
 */
export async function loadSceneDurations(
  voicesFile: string,
  script: Pick<Script, "scenes">,
): Promise<Map<number, number>> {
  let raw: string;
  try {
    raw = await readFile(voicesFile, "utf8");
  } catch {
    throw new Error(
      `voices.json nicht gefunden: ${voicesFile}. Erst "npm run voice -- <skript.json>" ausführen ` +
        `oder den Pfad mit --voices angeben.`,
    );
  }
  let parsed: { scenes?: { sceneId?: unknown; durationSeconds?: unknown }[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`voices.json ist kein gültiges JSON: ${voicesFile}`);
  }
  const byId = new Map<number, number>();
  for (const s of parsed.scenes ?? []) {
    if (
      typeof s.sceneId === "number" &&
      typeof s.durationSeconds === "number" &&
      s.durationSeconds > 0
    ) {
      byId.set(s.sceneId, s.durationSeconds);
    }
  }
  const missing = script.scenes.filter((s) => !byId.has(s.id)).map((s) => s.id);
  if (missing.length > 0) {
    throw new Error(
      `In ${voicesFile} fehlt die Dauer für Szene(n) ${missing.join(", ")}. ` +
        `Stimmen für das Skript vollständig erzeugen (npm run voice).`,
    );
  }
  return byId;
}
