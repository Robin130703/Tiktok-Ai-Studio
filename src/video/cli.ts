import path from "node:path";
import { assembleVideo, DEFAULT_VIDEO_DIR } from "./assemble.ts";
import { createFfmpegRunner } from "./runner.ts";

const USAGE =
  "Aufruf: npm run video -- <skript.json> [--voices voices.json] [--media media.json] " +
  "[--music datei] [--no-music] [--out video.mp4]";

interface Args {
  script?: string;
  voices?: string;
  media?: string;
  music?: string;
  noMusic: boolean;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const r: Args = { noMusic: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--voices") r.voices = argv[++i];
    else if (a === "--media") r.media = argv[++i];
    else if (a === "--music") r.music = argv[++i];
    else if (a === "--no-music") r.noMusic = true;
    else if (a === "--out") r.out = argv[++i];
    else r.script = a;
  }
  return r;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.script) throw new Error(USAGE);
  const name = path.basename(args.script, ".json");
  const result = await assembleVideo({
    voicesFile: args.voices ?? path.join("output/voices", name, "voices.json"),
    mediaFile: args.media ?? path.join("output/media", name, "media.json"),
    outFile: args.out ?? path.join(DEFAULT_VIDEO_DIR, name, "video.mp4"),
    musicFile: args.music,
    noMusic: args.noMusic,
    runner: createFfmpegRunner(),
  });
  for (const w of result.warnings) console.warn(`Hinweis: ${w}`);
  console.log(`Video: ${result.outFile}`);
  console.log(`Untertitel: ${result.assFile}`);
  console.log(
    `Szenen: ${result.plan.scenes.length}, Länge ${result.plan.totalSeconds.toFixed(1)} s, Musik: ${result.musicFile ?? "keine"}`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
