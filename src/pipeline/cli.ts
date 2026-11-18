import { createDummyProvider } from "../media/dummy.ts";
import { createMediaProvider } from "../media/registry.ts";
import { createAnthropicClient } from "../script/anthropic-client.ts";
import { createFfmpegRunner } from "../video/runner.ts";
import { createOpenAiSpeechClient } from "../voice/client.ts";
import { createDummyLlmClient, createDummySpeechClient } from "./dummy.ts";
import { assertEnv, resolveMaxCost } from "./env.ts";
import { runPipeline } from "./run.ts";

const USAGE =
  "Aufruf: npm run make-video -- [Thema] [--name ausgabename] [--dummy] [--no-music] [--music datei]";

interface Args {
  topic?: string;
  name?: string;
  dummy: boolean;
  noMusic: boolean;
  music?: string;
  help: boolean;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const r: Args = {
    dummy: ["1", "true"].includes((env.PIPELINE_DUMMY ?? "").trim().toLowerCase()),
    noMusic: false,
    help: false,
  };
  const topic: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--name") r.name = argv[++i];
    else if (a === "--dummy") r.dummy = true;
    else if (a === "--no-music") r.noMusic = true;
    else if (a === "--music") r.music = argv[++i];
    else if (a === "--help" || a === "-h") r.help = true;
    else if (a.startsWith("--")) throw new Error(`Unbekannte Option ${a}. ${USAGE}`);
    else topic.push(a);
  }
  if (topic.length > 0) r.topic = topic.join(" ");
  return r;
}

try {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }
  assertEnv(process.env, { dummy: args.dummy });
  const maxCostUsd = resolveMaxCost();
  if (args.dummy) {
    console.log("Dummy-Modus: kein Netzwerk, keine Kosten (Skript, Stimmen, Bilder erfunden).");
  }
  const result = await runPipeline({
    llm: args.dummy ? createDummyLlmClient() : createAnthropicClient(),
    speech: args.dummy ? createDummySpeechClient() : createOpenAiSpeechClient(),
    media: args.dummy ? createDummyProvider() : createMediaProvider(),
    runner: createFfmpegRunner(),
    topic: args.topic,
    name: args.name,
    maxCostUsd,
    musicFile: args.music,
    noMusic: args.noMusic,
    log: (m) => console.log(m),
  });
  console.log(`Kosten gesamt ca. ${result.totalCostUsd.toFixed(4)} USD (Obergrenze ${maxCostUsd})`);
  console.log(`Fertig: ${result.videoFile}`);
} catch (err) {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
