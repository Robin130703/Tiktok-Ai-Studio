import { spawn } from "node:child_process";

/** Ergebnis eines Werkzeugaufrufs. */
export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Injizierbarer Aufrufer für FFmpeg/FFprobe: nimmt nur die Argumente (ohne Programmnamen).
 * Tests übergeben eine Attrappe, der echte Lauf nutzt `createRunner`.
 */
export type Runner = (args: string[]) => Promise<RunResult>;

export const INSTALL_HINT =
  "Installation unter Windows: winget install --id Gyan.FFmpeg -e, danach ein neues Terminal " +
  "öffnen und mit ffmpeg -version prüfen. Alternativ den Pfad in FFMPEG_PATH setzen " +
  "(siehe docs/video-assembly.md).";

/** Das Programm wurde nicht gefunden (nicht installiert oder nicht im PATH). */
export class ToolNotFoundError extends Error {
  readonly tool: string;
  constructor(tool: string, binary: string) {
    super(`${tool} wurde nicht gefunden (versucht: "${binary}"). ${INSTALL_HINT}`);
    this.name = "ToolNotFoundError";
    this.tool = tool;
  }
}

/** Das Programm lief, endete aber mit Fehler. */
export class ToolFailedError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(tool: string, exitCode: number | null, stderr: string) {
    super(`${tool} ist mit Code ${exitCode ?? "?"} fehlgeschlagen:\n${stderr.trim()}`);
    this.name = "ToolFailedError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

const STDERR_TAIL_CHARS = 8000;

/** Startet `binary` per `node:child_process` (ohne Shell, Argumente werden nicht umgedeutet). */
export function createRunner(tool: string, binary: string): Runner {
  return (args) =>
    new Promise<RunResult>((resolve, reject) => {
      const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString("utf8")).slice(-STDERR_TAIL_CHARS);
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") reject(new ToolNotFoundError(tool, binary));
        else reject(err);
      });
      child.on("close", (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new ToolFailedError(tool, code, stderr));
      });
    });
}

export function ffmpegBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.FFMPEG_PATH?.trim() || "ffmpeg";
}

/**
 * FFprobe liegt bei FFmpeg-Paketen im selben Ordner. `FFPROBE_PATH` hat Vorrang; sonst wird
 * aus `FFMPEG_PATH` der Nachbar `ffprobe` abgeleitet, sonst `ffprobe` aus dem PATH.
 */
export function ffprobeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.FFPROBE_PATH?.trim();
  if (explicit) return explicit;
  const ff = env.FFMPEG_PATH?.trim();
  if (ff) return ff.replace(/ffmpeg(\.exe)?$/i, (_m, exe: string | undefined) => `ffprobe${exe ?? ""}`);
  return "ffprobe";
}

export const createFfmpegRunner = (): Runner => createRunner("FFmpeg", ffmpegBinary());
export const createFfprobeRunner = (): Runner => createRunner("FFprobe", ffprobeBinary());

/** Prüft per `-version`, ob FFmpeg aufrufbar ist; wirft sonst `ToolNotFoundError`. */
export async function ensureFfmpeg(runner: Runner): Promise<string> {
  const { stdout } = await runner(["-version"]);
  return stdout.split(/\r?\n/)[0] ?? "";
}
