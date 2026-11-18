import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { solidPng } from "../media/dummy.ts";
import { assembleVideo } from "./assemble.ts";
import {
  createFfmpegRunner,
  createFfprobeRunner,
  ffmpegBinary,
  ffprobeBinary,
} from "./runner.ts";
import { verifyVideo } from "./verify.ts";

function available(binary: string): boolean {
  return spawnSync(binary, ["-version"], { stdio: "ignore", windowsHide: true }).status === 0;
}

/** Stille WAV (24 kHz, mono, 16 Bit) der gegebenen Länge. */
function silentWav(seconds: number): Buffer {
  const rate = 24000;
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

// Läuft nur, wenn FFmpeg und FFprobe installiert sind; sonst übersprungen (CI, Entwicklungsrechner
// ohne FFmpeg). Der manuelle Ablauf steht in docs/video-assembly.md.
const haveFfmpeg = available(ffmpegBinary()) && available(ffprobeBinary());

describe.skipIf(!haveFfmpeg)("echter FFmpeg-Lauf mit Dummy-Material", () => {
  it("erzeugt 1080x1920-MP4 mit passender Dauer (nur Bild-Szenen, ohne Musik)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "video-real-"));
    try {
      const vdir = path.join(dir, "v");
      const mdir = path.join(dir, "m");
      await mkdir(vdir);
      await mkdir(mdir);
      const durations = [1.5, 2, 1.25];
      const vScenes = [];
      const mScenes = [];
      for (const [i, d] of durations.entries()) {
        const id = i + 1;
        const n = `scene-0${id}`;
        await writeFile(path.join(vdir, `${n}.wav`), silentWav(d));
        await writeFile(path.join(mdir, `${n}.png`), solidPng(40 * id, 90, 200 - 40 * id));
        vScenes.push({
          sceneId: id,
          file: `${n}.wav`,
          durationSeconds: d,
          text: `Szene ${id}`,
          words: [{ word: `Szene${id}`, start: 0.1, end: 0.6 }],
        });
        mScenes.push({ sceneId: id, file: `${n}.png`, type: "image" });
      }
      await writeFile(path.join(vdir, "voices.json"), JSON.stringify({ version: 1, scenes: vScenes }));
      await writeFile(path.join(mdir, "media.json"), JSON.stringify({ version: 1, scenes: mScenes }));
      const outFile = path.join(dir, "out", "video.mp4");
      const r = await assembleVideo({
        voicesFile: path.join(vdir, "voices.json"),
        mediaFile: path.join(mdir, "media.json"),
        outFile,
        noMusic: true,
        runner: createFfmpegRunner(),
      });
      const v = await verifyVideo(createFfprobeRunner(), outFile, {
        expectedSeconds: durations.reduce((a, b) => a + b, 0),
      });
      expect(v.problems).toEqual([]);
      expect(v.probe.width).toBe(1080);
      expect(v.probe.height).toBe(1920);
      expect(r.plan.totalSeconds).toBeCloseTo(4.75, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
