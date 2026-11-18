import OpenAI from "openai";
import type { SpeechClient } from "./generate.ts";

/** Echter Client; liest OPENAI_API_KEY aus der Umgebung (nie aus dem Repo). */
export function createOpenAiSpeechClient(env: NodeJS.ProcessEnv = process.env): SpeechClient {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY ist nicht gesetzt (lokale .env, siehe .env.example)");
  }
  const sdk = new OpenAI({ apiKey });
  return {
    async synthesize({ model, voice, instructions, input }) {
      const res = await sdk.audio.speech.create({
        model,
        voice,
        instructions,
        input,
        response_format: "wav",
      });
      return Buffer.from(await res.arrayBuffer());
    },
    async transcribe({ model, audio, language }) {
      const file = new File([new Uint8Array(audio)], "scene.wav", { type: "audio/wav" });
      const res = await sdk.audio.transcriptions.create({
        model,
        file,
        language,
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      });
      return {
        words: (res.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
      };
    },
  };
}
