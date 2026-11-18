/**
 * Untertitel als ASS-Datei (Advanced SubStation Alpha), eingebrannt über den FFmpeg-Filter
 * `ass`. Zeiten stammen aus den Wort-Zeitstempeln von #7 (voices.json), verschoben um den
 * Beginn der jeweiligen Szene im fertigen Video.
 */

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleScene {
  /** Beginn der Szene im Video in Sekunden. */
  startSeconds: number;
  durationSeconds: number;
  /** Gesprochener Text; Rückfall, wenn keine Wort-Zeitstempel vorliegen. */
  text: string;
  words: SubtitleWord[];
}

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;

/**
 * Sicherer Bereich für 9:16 (TikTok blendet unten Beschreibung/Bedienung, oben Tabs ein):
 * Text unten zentriert (Alignment 2) mit 520 px Abstand zum unteren Rand (über dem
 * unteren Bedienbereich, ca. 27 %) und 100 px seitlich. Schrift 88 px fett, weiß mit
 * schwarzer Kontur (6 px) und Schatten: gut lesbar auf hellen wie dunklen Bildern.
 */
export const SUBTITLE_STYLE = {
  fontName: "Arial",
  fontSize: 88,
  outline: 6,
  shadow: 3,
  marginV: 520,
  marginSide: 100,
} as const;

/** Wörter pro Einblendung (kurze Häppchen passen zum schnellen Brainrot-Stil). */
export const WORDS_PER_CUE = 3;
const MIN_CUE_SECONDS = 0.1;
/** Kleine Lücken zwischen Wörtern überbrücken, damit der Text nicht flackert. */
const MAX_BRIDGED_GAP_SECONDS = 0.35;
const TAIL_SECONDS = 0.1;

/** ASS-Zeitformat H:MM:SS.cc (Hundertstelsekunden). */
export function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/** Entschärft Zeichen mit Sonderbedeutung in ASS-Text (Override-Blöcke, Zeilenumbrüche). */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "/")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Bildet aus den Szenen die Einblendungen mit absoluten Zeiten im Video. */
export function buildCues(scenes: SubtitleScene[]): Cue[] {
  const cues: Cue[] = [];
  for (const scene of scenes) {
    const sceneEnd = scene.startSeconds + scene.durationSeconds;
    const words = scene.words.filter((w) => w.word.trim().length > 0);
    const local: Cue[] = [];
    if (words.length === 0) {
      // Rückfall ohne Zeitstempel: ganzer Text über die Szenendauer.
      local.push({ start: 0, end: scene.durationSeconds, text: scene.text });
    } else {
      for (let i = 0; i < words.length; i += WORDS_PER_CUE) {
        const group = words.slice(i, i + WORDS_PER_CUE);
        const next = words[i + WORDS_PER_CUE];
        const start = group[0]!.start;
        let end = group[group.length - 1]!.end + TAIL_SECONDS;
        if (next) {
          // Kleine Lücke zum nächsten Block überbrücken, nie in den nächsten Block hineinragen.
          if (next.start - end <= MAX_BRIDGED_GAP_SECONDS) end = Math.max(end, next.start);
          end = Math.min(end, Math.max(next.start, start + MIN_CUE_SECONDS));
        }
        local.push({ start, end, text: group.map((w) => w.word.trim()).join(" ") });
      }
    }
    for (const c of local) {
      const start = Math.min(scene.startSeconds + Math.max(0, c.start), sceneEnd);
      const end = Math.min(scene.startSeconds + c.end, sceneEnd);
      if (end - start < 0.01) continue; // außerhalb der Szene (Zeitstempel jenseits der Dauer)
      const text = escapeAssText(c.text);
      if (text) cues.push({ start, end, text });
    }
  }
  return cues;
}

/** Erzeugt den Inhalt der ASS-Datei (Auflösung 1080x1920, damit Größen in Pixeln gelten). */
export function buildAss(scenes: SubtitleScene[]): string {
  const s = SUBTITLE_STYLE;
  // Farben im Format &HAABBGGRR: Weiß, Schwarz (Kontur), halbtransparentes Schwarz (Schatten).
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${VIDEO_WIDTH}`,
    `PlayResY: ${VIDEO_HEIGHT}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${s.fontName},${s.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${s.outline},${s.shadow},2,${s.marginSide},${s.marginSide},${s.marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = buildCues(scenes).map(
    (c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text}`,
  );
  return [...header, ...events, ""].join("\n");
}
