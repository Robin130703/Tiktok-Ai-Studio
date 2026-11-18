import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadScript } from "../script/store.ts";
import { createOpenAiSpeechClient } from "./client.ts";
import { DEFAULT_VOICE_DIR, generateVoices } from "./generate.ts";
import { parseLanguage, parseVoiceMap, type VoiceMap } from "./voices.ts";

interface Args {
  script?: string;
  lang?: string;
  voices?: string;
  out?: string;
}

/** Aufruf: npm run voice -- <skript.json> [--lang de|en] [--voices datei.json] [--out ordner] */
function parseArgs(argv: string[]): Args {
  const r: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--lang") r.lang = argv[++i];
    else if (a === "--voices") r.voices = argv[++i];
    else if (a === "--out") r.out = argv[++i];
    else r.script = a;
  }
  return r;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const client = createOpenAiSpeechClient(); // prüft OPENAI_API_KEY zuerst
  if (!args.script) {
    throw new Error(
      "Aufruf: npm run voice -- <skript.json> [--lang de|en] [--voices datei.json] [--out ordner]",
    );
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
