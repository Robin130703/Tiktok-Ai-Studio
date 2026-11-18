/**
 * Skript-Schema (Version 1) und Validierung. Format siehe docs/script-generator.md.
 * Bewusst ohne Schema-Bibliothek: kleine, abhängigkeitsfreie Handvalidierung.
 */

export interface Character {
  /** Fester Name der Figur, eindeutig im Skript (Schlüssel für die Stimmzuordnung). */
  name: string;
  /** Die Frucht, z. B. "Banane". */
  fruit: string;
  /** Charakter/Stimmung in einem Satz. */
  personality: string;
}

export interface Scene {
  /** Laufende Nummer ab 1. */
  id: number;
  /** Szenenbeschreibung als Eingabe für die Bildquelle. */
  description: string;
  /** Name einer Figur aus `characters`. */
  speaker: string;
  /** Gesprochener Dialogtext. */
  text: string;
}

export interface Script {
  version: 1;
  title: string;
  topic: string;
  characters: Character[];
  scenes: Scene[];
}

/** Sprechgeschwindigkeit für die Dauer-Schätzung (150 Wörter ca. 60 s). */
export const WORDS_PER_SECOND = 2.5;
export const MIN_DURATION_S = 50;
export const MAX_DURATION_S = 70;
export const MIN_CHARACTERS = 2;
export const MAX_CHARACTERS = 4;
export const MIN_SCENES = 6;
export const MAX_SCENES = 14;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Geschätzte Sprechdauer des gesamten Skripts in Sekunden. */
export function estimateDurationSeconds(script: Pick<Script, "scenes">): number {
  const words = script.scenes.reduce((sum, s) => sum + countWords(s.text), 0);
  return words / WORDS_PER_SECOND;
}

export type ValidationResult =
  | { ok: true; script: Script }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Prüft unbekannte Daten gegen das Schema inkl. Längenprüfung (Dauer). */
export function validateScript(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["Skript ist kein JSON-Objekt"] };
  }
  if (input.version !== 1) errors.push("version muss 1 sein");
  if (!nonEmptyString(input.title)) errors.push("title fehlt oder ist leer");
  if (!nonEmptyString(input.topic)) errors.push("topic fehlt oder ist leer");

  const characters: Character[] = [];
  if (!Array.isArray(input.characters)) {
    errors.push("characters muss ein Array sein");
  } else {
    input.characters.forEach((c: unknown, i: number) => {
      if (
        !isObject(c) ||
        !nonEmptyString(c.name) ||
        !nonEmptyString(c.fruit) ||
        !nonEmptyString(c.personality)
      ) {
        errors.push(`characters[${i}] braucht nicht-leere name, fruit, personality`);
        return;
      }
      characters.push({ name: c.name, fruit: c.fruit, personality: c.personality });
    });
    const names = characters.map((c) => c.name);
    if (new Set(names).size !== names.length) errors.push("Figurennamen sind nicht eindeutig");
    if (input.characters.length < MIN_CHARACTERS || input.characters.length > MAX_CHARACTERS) {
      errors.push(`Anzahl Figuren muss zwischen ${MIN_CHARACTERS} und ${MAX_CHARACTERS} liegen`);
    }
  }

  const scenes: Scene[] = [];
  if (!Array.isArray(input.scenes)) {
    errors.push("scenes muss ein Array sein");
  } else {
    const names = new Set(characters.map((c) => c.name));
    input.scenes.forEach((s: unknown, i: number) => {
      if (
        !isObject(s) ||
        s.id !== i + 1 ||
        !nonEmptyString(s.description) ||
        !nonEmptyString(s.speaker) ||
        !nonEmptyString(s.text)
      ) {
        errors.push(
          `scenes[${i}] braucht id ${i + 1} sowie nicht-leere description, speaker, text`,
        );
        return;
      }
      if (!names.has(s.speaker)) {
        errors.push(`scenes[${i}].speaker "${s.speaker}" ist keine definierte Figur`);
      }
      scenes.push({ id: s.id, description: s.description, speaker: s.speaker, text: s.text });
    });
    if (input.scenes.length < MIN_SCENES || input.scenes.length > MAX_SCENES) {
      errors.push(`Anzahl Szenen muss zwischen ${MIN_SCENES} und ${MAX_SCENES} liegen`);
    }
  }

  if (errors.length === 0) {
    const duration = estimateDurationSeconds({ scenes });
    if (duration < MIN_DURATION_S || duration > MAX_DURATION_S) {
      errors.push(
        `geschätzte Sprechdauer ${duration.toFixed(1)} s liegt außerhalb von ` +
          `${MIN_DURATION_S}-${MAX_DURATION_S} s`,
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    script: {
      version: 1,
      title: input.title as string,
      topic: input.topic as string,
      characters,
      scenes,
    },
  };
}
