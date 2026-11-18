import { createHash } from "node:crypto";
import type { Character, Scene, Script } from "../script/schema.ts";

/** Gemeinsamer Stil für alle Szenen eines Videos (Teil der Figurenkonsistenz). */
export const STYLE =
  "vertical 9:16 3D cartoon render, Pixar-like, vibrant colors, soft studio lighting, " +
  "expressive faces, no text, no watermark";

/** Feste Figurenbeschreibung aus Name, Frucht und Persönlichkeit; immer derselbe Wortlaut. */
export function characterLook(c: Character): string {
  return (
    `${c.name}, a cute anthropomorphic ${c.fruit} character with big round eyes, ` +
    `small arms and legs, recognizable ${c.fruit} shape and colors, personality: ${c.personality}`
  );
}

/** Stabiler Seed pro Figur (aus dem Namen), gleich über alle Szenen und Läufe. */
export function characterSeed(name: string): number {
  return createHash("sha256").update(name).digest().readUInt32BE(0);
}

/**
 * Prompt je Szene: Stil, Sprecher als Hauptfigur, alle übrigen Figuren als Referenz
 * (das Skript nennt Figuren pro Szene nicht strukturiert), dann die Szenenbeschreibung.
 */
export function buildPrompt(script: Script, scene: Scene): { prompt: string; seed: number } {
  const speaker = script.characters.find((c) => c.name === scene.speaker);
  if (!speaker) {
    throw new Error(`Szene ${scene.id}: unbekannte Figur "${scene.speaker}"`);
  }
  const others = script.characters.filter((c) => c !== speaker);
  const parts = [
    STYLE,
    `Main character, speaking: ${characterLook(speaker)}`,
    ...(others.length > 0
      ? [`If other characters appear, they look like: ${others.map(characterLook).join("; ")}`]
      : []),
    `Scene: ${scene.description}`,
  ];
  return { prompt: parts.join(". "), seed: characterSeed(speaker.name) };
}
