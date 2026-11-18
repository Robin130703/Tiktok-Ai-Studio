import path from "node:path";
import { loadScript } from "../script/store.ts";
import { loadSceneDurations } from "./durations.ts";
import { DEFAULT_MEDIA_DIR, generateMedia } from "./generate.ts";
import { createMediaProvider } from "./registry.ts";

const USAGE = "Aufruf: npm run media -- <skript.json> [--voices voices.json] [--out ordner]";

interface Args {
  script?: string;
  voices?: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const r: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--voices") r.voices = argv[++i];
    else if (a === "--out") r.out = argv[++i];
    else r.script = a;
  }
  return r;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const provider = createMediaProvider(); // prüft MEDIA_PROVIDER und FAL_KEY zuerst
  if (!args.script) throw new Error(USAGE);
  const name = path.basename(args.script, ".json");
  const script = await loadScript(args.script);
  const voicesFile = args.voices ?? path.join("output/voices", name, "voices.json");
  const durations = await loadSceneDurations(voicesFile, script);
  const dir = args.out ?? path.join(DEFAULT_MEDIA_DIR, name);
  const { meta, usage, metaFile } = await generateMedia({ provider, script, durations, dir });
  console.log(`Metadaten: ${metaFile}`);
  console.log(
    `Quelle: ${meta.provider}, Szenen: ${meta.scenes.length} (neu ${usage.generated}, wiederverwendet ${usage.reused})`,
  );
  console.log(`Kosten dieses Laufs ca. ${usage.costUsd.toFixed(4)} USD`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
