import type { Runner } from "./runner.ts";

export interface VideoProbe {
  width: number;
  height: number;
  videoCodec?: string;
  audioCodec?: string;
  durationSeconds: number;
}

export interface VerifyOptions {
  expectedSeconds?: number;
  /** Erlaubte Abweichung der Dauer in Sekunden. */
  toleranceSeconds?: number;
}

export interface VerifyResult {
  ok: boolean;
  probe: VideoProbe;
  problems: string[];
}

/** Liest Streams und Dauer per FFprobe (JSON-Ausgabe). */
export async function probeVideo(ffprobe: Runner, file: string): Promise<VideoProbe> {
  const { stdout } = await ffprobe([
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height:format=duration",
    "-of", "json",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const video = json.streams?.find((s) => s.codec_type === "video");
  const audio = json.streams?.find((s) => s.codec_type === "audio");
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    durationSeconds: Number(json.format?.duration ?? 0),
  };
}

/** Prüft Auflösung 1080x1920, Seitenverhältnis 9:16, H.264/AAC und (optional) die Dauer. */
export function checkProbe(probe: VideoProbe, opts: VerifyOptions = {}): string[] {
  const problems: string[] = [];
  if (probe.width !== 1080 || probe.height !== 1920) {
    problems.push(`Auflösung ${probe.width}x${probe.height}, erwartet 1080x1920`);
  }
  if (probe.height === 0 || Math.abs(probe.width / probe.height - 9 / 16) > 0.001) {
    problems.push(`Seitenverhältnis ${probe.width}:${probe.height} ist nicht 9:16`);
  }
  if (probe.videoCodec !== "h264") problems.push(`Videocodec ${probe.videoCodec ?? "fehlt"}, erwartet h264`);
  if (probe.audioCodec !== "aac") problems.push(`Audiocodec ${probe.audioCodec ?? "fehlt"}, erwartet aac`);
  if (opts.expectedSeconds !== undefined) {
    const tol = opts.toleranceSeconds ?? 0.25;
    if (Math.abs(probe.durationSeconds - opts.expectedSeconds) > tol) {
      problems.push(
        `Dauer ${probe.durationSeconds.toFixed(2)} s weicht von ${opts.expectedSeconds.toFixed(2)} s um mehr als ${tol} s ab`,
      );
    }
  }
  return problems;
}

export async function verifyVideo(
  ffprobe: Runner,
  file: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const probe = await probeVideo(ffprobe, file);
  const problems = checkProbe(probe, opts);
  return { ok: problems.length === 0, probe, problems };
}
