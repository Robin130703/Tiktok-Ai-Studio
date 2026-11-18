import type { Character } from "../script/schema.ts";

export interface VoiceSetting {
  /** OpenAI-Stimme, z. B. "onyx". */
  voice: string;
  /** Optionale Sprechanweisung (gpt-4o-mini-tts); ersetzt die automatisch erzeugte. */
  instructions?: string;
}

/** Zuordnung `characters[].name` -> Stimme (konfigurierbar). */
export type VoiceMap = Record<string, VoiceSetting>;

export type Language = "de" | "en";
export const DEFAULT_LANGUAGE: Language = "de";

/** Standard-Stimmen in fester Reihenfolge (max. 4 Figuren, alle verschieden). */
export const DEFAULT_VOICE_POOL = ["onyx", "nova", "fable", "echo"] as const;

export function parseLanguage(value: string | undefined): Language {
  const v = value?.trim().toLowerCase();
  if (!v) return DEFAULT_LANGUAGE;
  if (v === "de" || v === "en") return v;
  throw new Error(`Sprache "${value}" wird nicht unterstützt (erlaubt: de, en)`);
}

export interface ResolvedVoice {
  name: string;
  voice: string;
  instructions: string;
}

function defaultInstructions(c: Character, language: Language): string {
  return language === "de"
    ? `Sprich auf Deutsch, übertrieben und lebendig wie eine Zeichentrickfigur. Figur: ${c.fruit} "${c.name}", Charakter: ${c.personality}.`
    : `Speak in English, exaggerated and lively like a cartoon character. Character: ${c.fruit} "${c.name}", personality: ${c.personality}.`;
}

/**
 * Ordnet jeder Figur eine feste Stimme zu. Konfigurierte Figuren behalten ihre Stimme;
 * alle anderen erhalten der Reihe nach eine Stimme aus dem Standard-Pool, die nicht
 * schon vergeben ist (Fallback statt Fehler). Deterministisch für dasselbe Skript.
 */
export function assignVoices(
  characters: Character[],
  configured: VoiceMap = {},
  language: Language = DEFAULT_LANGUAGE,
): Map<string, ResolvedVoice> {
  const used = new Set(
    characters.flatMap((c) => (configured[c.name] ? [configured[c.name]!.voice] : [])),
  );
  const pool = DEFAULT_VOICE_POOL.filter((v) => !used.has(v));
  let next = 0;
  const result = new Map<string, ResolvedVoice>();
  for (const c of characters) {
    const cfg = configured[c.name];
    const voice = cfg?.voice ?? pool[next++ % pool.length]!;
    result.set(c.name, {
      name: c.name,
      voice,
      instructions: cfg?.instructions ?? defaultInstructions(c, language),
    });
  }
  return result;
}
