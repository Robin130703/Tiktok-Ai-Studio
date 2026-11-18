export const USAGE =
  "Aufruf: npm run voice -- <skript.json> [--lang de|en] [--voices datei.json] [--out ordner]";

export interface Args {
  script?: string;
  lang?: string;
  voices?: string;
  out?: string;
}

/** Liest den Wert einer Option; fehlt er (Zeilenende oder nächste Option), Fehler. */
function takeValue(argv: string[], i: number, option: string): string {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`Option ${option} braucht einen Wert. ${USAGE}`);
  }
  return v;
}

export function parseArgs(argv: string[]): Args {
  const r: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--lang") r.lang = takeValue(argv, i++, a);
    else if (a === "--voices") r.voices = takeValue(argv, i++, a);
    else if (a === "--out") r.out = takeValue(argv, i++, a);
    else r.script = a;
  }
  return r;
}
