import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadScript } from "../script/store.ts";
import { createOpenAiSpeechClient } from "./client.ts";
import { DEFAULT_VOICE_DIR, generateVoices } from "./generate.ts";
import { parseArgs, USAGE } from "./args.ts";
import { parseLanguage, parseVoiceMap, type VoiceMap } from "./voices.ts";

try {
  const args = parseArgs(process.argv.slice(2));
  const client = createOpenAiSpeechClient(); // prüft OPENAI_API_KEY zuerst
  if (!args.script) {
    throw new Error(USAGE);
  }
  const voices: VoiceMap | undefined = args.voices
    ? parseVoiceMap(JSON.parse(await readFile(args.voices, "utf8")) as unknown, args.voices)
    : undefined;
  const script = await loadScript(args.script);
  const language = parseLanguage(args.lang ?? process.env.VOICE_LANGUAGE);
  const dir = args.out ?? path.join(DEFAULT_VOICE_DIR, path.basename(args.script, ".json"));
  const { meta, usage, metaFile } = await generateVoices({ client, script, dir, voices, language });
  console.log(`Metadaten: ${metaFile}`);
  console.log(
    `Szenen: ${meta.scenes.length} (neu ${usage.generated}, wiederverwendet ${usage.reused})`,
  );
  console.log(
    `Gesamtdauer: ${meta.totalDurationSeconds.toFixed(1)} s, Kosten ca. ${usage.costUsd.toFixed(4)} USD`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
