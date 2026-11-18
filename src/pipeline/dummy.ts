import type { LlmClient } from "../script/generator.ts";
import type { SpeechClient } from "../voice/generate.ts";

const NAMES = ["Bruno", "Erna", "Kiwi-Karl"];
const FRUITS = ["Banane", "Erdbeere", "Kiwi"];
// 15 Wörter pro Szene, 10 Szenen = 150 Wörter = 60 s Sprechdauer-Schätzung.
const LINE =
  "Das ist ein kostenloser Probelauf mit erfundenem Text und ohne jeden einzigen echten Dienst dahinter";

/** Kostenloser LLM-Ersatz ohne Netzwerk: liefert ein gültiges Skript zum Thema. */
export function createDummyLlmClient(): LlmClient {
  return {
    async complete({ messages }) {
      const first = messages[0]?.content ?? "";
      const topic = first.startsWith("Thema:") ? first.slice("Thema:".length).trim() : "Probelauf";
      const script = {
        version: 1,
        title: `Probelauf ${topic}`,
        topic,
        characters: NAMES.map((name, i) => ({
          name,
          fruit: FRUITS[i],
          personality: "gelassen",
        })),
        scenes: Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          description: `Szene ${i + 1}: ${FRUITS[i % 3]} spricht über ${topic}`,
          speaker: NAMES[i % 3],
          text: LINE,
        })),
      };
      return { text: JSON.stringify(script), inputTokens: 0, outputTokens: 0 };
    },
  };
}

const SAMPLE_RATE = 8000;

/** Stille WAV (mono, 16 Bit) der gegebenen Länge. */
export function silentWav(seconds: number): Buffer {
  const data = Buffer.alloc(Math.max(1, Math.round(seconds * SAMPLE_RATE)) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Kostenloser TTS-Ersatz ohne Netzwerk: Stille, Wortzeiten gleichmäßig verteilt (2,5 Wörter/s). */
export function createDummySpeechClient(): SpeechClient {
  let lastInput = "";
  return {
    async synthesize({ input }) {
      lastInput = input;
      const words = input.split(/\s+/).filter(Boolean).length;
      return silentWav(words / 2.5);
    },
    async transcribe() {
      const words = lastInput.split(/\s+/).filter(Boolean);
      return {
        words: words.map((word, i) => ({ word, start: i / 2.5, end: (i + 0.9) / 2.5 })),
      };
    },
  };
}
