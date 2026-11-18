export const USAGE =
  "Aufruf: npm run make-video -- [Thema] [--name ausgabename] [--dummy] [--no-music] [--music datei]";

export interface Args {
  topic?: string;
  name?: string;
  dummy: boolean;
  noMusic: boolean;
  music?: string;
  help: boolean;
}

/** Liest den Wert einer Option; fehlt er (Zeilenende oder nächste Option), Fehler. */
function takeValue(argv: string[], i: number, option: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`Option ${option} braucht einen Wert. ${USAGE}`);
  }
  return v;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const r: Args = {
    dummy: ["1", "true"].includes((env.PIPELINE_DUMMY ?? "").trim().toLowerCase()),
    noMusic: false,
    help: false,
  };
  const topic: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--name") r.name = takeValue(argv, i++, a);
    else if (a === "--dummy") r.dummy = true;
    else if (a === "--no-music") r.noMusic = true;
    else if (a === "--music") r.music = takeValue(argv, i++, a);
    else if (a === "--help" || a === "-h") r.help = true;
    else if (a.startsWith("--")) throw new Error(`Unbekannte Option ${a}. ${USAGE}`);
    else topic.push(a);
  }
  if (topic.length > 0) r.topic = topic.join(" ");
  return r;
}
