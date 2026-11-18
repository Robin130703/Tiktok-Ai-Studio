import { VIDEO_HEIGHT, VIDEO_WIDTH } from "./ass.ts";
import { FPS, type Plan, type PlannedScene } from "./plan.ts";

/**
 * Baut die FFmpeg-Argumente für den gesamten Schnitt (ein Aufruf, ein `-filter_complex`).
 * Reine Funktion ohne Seiteneffekte, damit Tests die Kommandozeile prüfen können.
 *
 * Aufbau des Filtergraphen (FFmpeg-Filterdoku: ffmpeg.org/ffmpeg-filters.html):
 * - Bild-Szene: `scale ...:force_original_aspect_ratio=increase` + `crop` füllt 2x-Format
 *   (2160x3840) ohne Verzerrung und ohne Ränder; `zoompan` (Ken Burns) rechnet auf 1080x1920
 *   herunter. Die 2x-Vorskalierung verhindert das bekannte Ruckeln von zoompan bei
 *   Sub-Pixel-Bewegung. `d=<Bilder>` erzeugt aus dem einen Eingangsbild genau so viele
 *   Ausgabebilder; der Zoomverlauf hängt an `on` (Nummer des Ausgabebilds), also linear und
 *   unabhängig vom Eingabetakt. `trim=end_frame` sichert die exakte Länge.
 * - Clip-Szene: nur `scale`+`crop` auf 1080x1920, `fps=30`, auf die Szenenlänge gekürzt
 *   (zu kurze Clips laufen per `-stream_loop -1` in Schleife, `-t` begrenzt das Lesen).
 * - Alle Szenen enden in gleichem Format (yuv420p, SAR 1, 30 fps), eine Voraussetzung von
 *   `concat`. Danach brennt der `ass`-Filter die Untertitel ein.
 * - Sprache: je Szene auf Stereo/48 kHz gebracht, mit `apad`+`atrim` exakt auf die
 *   Szenenlänge gesetzt (Audio und Video bleiben dadurch deckungsgleich), dann `concat`.
 * - Musik (optional): Endlosschleife, auf Videolänge gekürzt, Lautstärke gesenkt, ein-/
 *   ausgeblendet. `sidechaincompress` senkt die Musik, solange die Sprache (Sidechain) laut
 *   ist (Ducking); `amix` mischt Sprache und abgesenkte Musik. `amix` teilt standardmäßig
 *   durch die Eingangszahl, `volume=2` gleicht das aus (funktioniert in allen Versionen,
 *   anders als das erst in FFmpeg 7.1 eingeführte `normalize=0`). `alimiter` verhindert
 *   Übersteuern.
 */

export const MUSIC_VOLUME = 0.3;
export const DUCK_THRESHOLD = 0.02;
export const DUCK_RATIO = 10;
export const DUCK_ATTACK_MS = 15;
export const DUCK_RELEASE_MS = 350;
export const MUSIC_FADE_IN_S = 1;
export const MUSIC_FADE_OUT_S = 1.5;
const KEN_BURNS_ZOOM = 0.25;
const SUPERSAMPLE = 2;

function num(n: number): string {
  return String(Number(n.toFixed(4)));
}

/**
 * Pfad für einen Filteroption-Wert maskieren (z. B. `ass=filename=...`). FFmpeg entschärft
 * Zeichenketten in zwei Stufen (Filteroption, dann Filtergraph), siehe Abschnitt "Quoting
 * and escaping" der ffmpeg-utils-Doku. Windows: Backslashes werden zu `/` (von FFmpeg
 * akzeptiert), der Laufwerks-Doppelpunkt `C:` muss maskiert werden, sonst gilt er als
 * Optionstrenner. Ergebnis für `C:\Users\a b\x.ass` ist `C\\:/Users/a b/x.ass`.
 */
export function escapeFilterPath(file: string): string {
  const slashes = file.replace(/\\/g, "/");
  const optionLevel = slashes.replace(/[\\':]/g, "\\$&");
  return optionLevel.replace(/[\\'[\],;]/g, "\\$&");
}

function imageFilter(scene: PlannedScene, index: number, inLabel: string, outLabel: string): string {
  const n = scene.frames;
  // Abwechselnd: Zoom-in mittig, Zoom-out mittig, Zoom-in mit Schwenk (Dynamik statt Standbild).
  const variant = index % 3;
  const z = variant === 1 ? `${1 + KEN_BURNS_ZOOM}-${KEN_BURNS_ZOOM}*on/${n}` : `1+${KEN_BURNS_ZOOM}*on/${n}`;
  const x = variant === 2 ? `(iw-iw/zoom)*on/${n}` : "iw/2-(iw/zoom/2)";
  const y = variant === 2 ? "(ih-ih/zoom)/2" : "ih/2-(ih/zoom/2)";
  const w = VIDEO_WIDTH * SUPERSAMPLE;
  const h = VIDEO_HEIGHT * SUPERSAMPLE;
  return (
    `[${inLabel}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
    `zoompan=z='${z}':x='${x}':y='${y}':d=${n}:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${FPS},` +
    `trim=end_frame=${n},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[${outLabel}]`
  );
}

function clipFilter(scene: PlannedScene, inLabel: string, outLabel: string): string {
  return (
    `[${inLabel}]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},fps=${FPS},trim=end_frame=${scene.frames},` +
    `setpts=PTS-STARTPTS,setsar=1,format=yuv420p[${outLabel}]`
  );
}

export interface BuildArgsOptions {
  plan: Plan;
  /** Pfad zur ASS-Datei (wird für den Filter maskiert). */
  assFile: string;
  musicFile?: string;
  outFile: string;
}

export function buildFfmpegArgs(opts: BuildArgsOptions): string[] {
  const { plan, assFile, musicFile, outFile } = opts;
  const k = plan.scenes.length;
  const args: string[] = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];

  // Eingänge 0..k-1: Bild/Clip je Szene, k..2k-1: Sprache je Szene, 2k: Musik.
  for (const s of plan.scenes) {
    if (s.mediaType === "video") {
      args.push("-stream_loop", "-1", "-t", num(s.durationSeconds));
    }
    args.push("-i", s.mediaFile);
  }
  for (const s of plan.scenes) args.push("-i", s.audioFile);
  if (musicFile) args.push("-stream_loop", "-1", "-i", musicFile);

  const f: string[] = [];
  plan.scenes.forEach((s, i) => {
    f.push(s.mediaType === "video" ? clipFilter(s, `${i}:v`, `v${i}`) : imageFilter(s, i, `${i}:v`, `v${i}`));
  });
  f.push(`${plan.scenes.map((_, i) => `[v${i}]`).join("")}concat=n=${k}:v=1:a=0[vcat]`);
  f.push(`[vcat]ass=filename=${escapeFilterPath(assFile)}[vout]`);

  plan.scenes.forEach((s, i) => {
    f.push(
      `[${k + i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,` +
        `atrim=duration=${num(s.durationSeconds)},asetpts=PTS-STARTPTS[a${i}]`,
    );
  });
  const speechLabel = musicFile ? "speech" : "aout";
  f.push(`${plan.scenes.map((_, i) => `[a${i}]`).join("")}concat=n=${k}:v=0:a=1[${speechLabel}]`);

  if (musicFile) {
    const total = plan.totalSeconds;
    const fadeOutStart = Math.max(0, total - MUSIC_FADE_OUT_S);
    f.push(
      `[${2 * k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${num(total)},` +
        `asetpts=PTS-STARTPTS,volume=${MUSIC_VOLUME},afade=t=in:d=${MUSIC_FADE_IN_S},` +
        `afade=t=out:st=${num(fadeOutStart)}:d=${MUSIC_FADE_OUT_S}[music]`,
    );
    f.push(`[speech]asplit=2[sp][sc]`);
    f.push(
      `[music][sc]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:` +
        `attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}[ducked]`,
    );
    f.push(`[sp][ducked]amix=inputs=2:duration=first:dropout_transition=0,volume=2,alimiter=limit=0.95[aout]`);
  }

  args.push("-filter_complex", f.join(";"));
  args.push("-map", "[vout]", "-map", "[aout]");
  args.push(
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high",
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "-t", num(plan.totalSeconds),
    outFile,
  );
  return args;
}
