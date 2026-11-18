import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Usage } from "./generator.ts";
import type { Script } from "./schema.ts";
import { validateScript } from "./schema.ts";

export const DEFAULT_SCRIPT_DIR = "output/scripts";

function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "skript";
}

/**
 * Legt das Skript als `<zeitstempel>-<slug>.json` ab, Nutzung/Kosten daneben als
 * `<...>.usage.json`. Gibt den Pfad der Skriptdatei zurück.
 */
export async function saveScript(
  script: Script,
  usage: Usage,
  dir: string = DEFAULT_SCRIPT_DIR,
  now: Date = new Date(),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const base = path.join(dir, `${stamp}-${slugify(script.title)}`);
  await writeFile(`${base}.json`, JSON.stringify(script, null, 2) + "\n", "utf8");
  await writeFile(`${base}.usage.json`, JSON.stringify(usage, null, 2) + "\n", "utf8");
  return `${base}.json`;
}

/** Lädt und validiert ein abgelegtes Skript, ohne LLM-Aufruf. */
export async function loadScript(file: string): Promise<Script> {
  const result = validateScript(JSON.parse(await readFile(file, "utf8")));
  if (!result.ok) {
    throw new Error(`Ungültiges Skript ${file}: ${result.errors.join("; ")}`);
  }
  return result.script;
}
