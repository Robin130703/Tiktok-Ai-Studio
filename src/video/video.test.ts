import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assTime, buildAss, buildCues, escapeAssText } from "./ass.ts";
import { assembleVideo } from "./assemble.ts";
import { buildFfmpegArgs, escapeFilterPath } from "./ffmpeg.ts";
import { resolveMusic } from "./music.ts";
import { buildPlan, FPS, InputError } from "./plan.ts";
import {
  ffprobeBinary,
  ToolNotFoundError,
  type RunResult,
  type Runner,
} from "./runner.ts";
import { checkProbe, verifyVideo } from "./verify.ts";

function voiceScene(sceneId: number, durationSeconds: number, words = true) {
  return {
    sceneId,
    speaker: "A",
    voice: "onyx",
    text: `Text ${sceneId}`,
    file: `scene-${String(sceneId).padStart(2, "0")}.wav`,
    durationSeconds,
    words: words
      ? [
          { word: "Das", start: 0.1, end: 0.3 },
          { word: "ist", start: 0.3, end: 0.5 },
          { word: "{ein}", start: 0.5, end: 0.8 },
          { word: "Test", start: 1.2, end: 1.6 },
        ]
      : [],
    costUsd: 0,
    hash: "h",
  };
}
function mediaScene(sceneId: number, type: "image" | "video" = "image") {
  return {
    sceneId,
    file: `scene-${String(sceneId).padStart(2, "0")}.${type === "image" ? "png" : "mp4"}`,
    type,
    durationSeconds: 1,
    costUsd: 0,
    provider: "dummy",
    prompt: "p",
    hash: "h",
  };
}
const voices = (...scenes: ReturnType<typeof voiceScene>[]) =>
  ({ version: 1, language: "de", scenes, totalDurationSeconds: 0 }) as never;
const media = (...scenes: ReturnType<typeof mediaScene>[]) =>
  ({ version: 1, provider: "dummy", scenes }) as never;
const dirs = { voicesDir: "/v", mediaDir: "/m" };

describe("buildPlan", () => {
  it("ordnet über sceneId zu, nicht über die Reihenfolge", () => {
    const plan = buildPlan(
      voices(voiceScene(2, 2), voiceScene(1, 3)),
      media(mediaScene(1), mediaScene(2, "video")),
      dirs,
    );
    expect(plan.scenes.map((s) => [s.sceneId, s.mediaType])).toEqual([
      [1, "image"],
      [2, "video"],
    ]);
    expect(plan.scenes[0]!.startSeconds).toBe(0);
    expect(plan.scenes[1]!.startSeconds).toBe(3);
  });

  it("Gesamtlänge entspricht der Summe der Sprachdauern (auf ein Bild genau, ohne Drift)", () => {
    const durations = [4.337, 5.113, 6.071, 3.999, 7.123, 5.5, 4.2, 6.6, 5.05, 4.9];
    const plan = buildPlan(
      voices(...durations.map((d, i) => voiceScene(i + 1, d))),
      media(...durations.map((_, i) => mediaScene(i + 1))),
      dirs,
    );
    const sum = durations.reduce((a, b) => a + b, 0);
    expect(Math.abs(plan.totalSeconds - sum)).toBeLessThanOrEqual(0.5 / FPS + 1e-9);
    expect(plan.scenes.reduce((a, s) => a + s.frames, 0)).toBe(plan.totalFrames);
  });

  it("bricht ab, wenn Material zu einer Sprach-sceneId fehlt", () => {
    expect(() =>
      buildPlan(voices(voiceScene(1, 2), voiceScene(2, 2)), media(mediaScene(1)), dirs),
    ).toThrow(/Bild\/Clip fehlt für Szene\(n\) 2/);
  });

  it("bricht ab, wenn Sprache zu einer Material-sceneId fehlt", () => {
    expect(() =>
      buildPlan(voices(voiceScene(1, 2)), media(mediaScene(1), mediaScene(3)), dirs),
    ).toThrow(/Sprache fehlt für Szene\(n\) 3/);
  });

  it("bricht bei doppelten sceneIds und ungültigen Werten ab", () => {
    expect(() =>
      buildPlan(voices(voiceScene(1, 2), voiceScene(1, 2)), media(mediaScene(1)), dirs),
    ).toThrow(/mehrfach/);
    expect(() => buildPlan(voices(voiceScene(1, 0)), media(mediaScene(1)), dirs)).toThrow(
      InputError,
    );
    expect(() => buildPlan(voices(), media(mediaScene(1)), dirs)).toThrow(/keine Szenen/);
    const bad = { ...mediaScene(1), type: "gif" } as never;
    expect(() => buildPlan(voices(voiceScene(1, 2)), media(bad), dirs)).toThrow(/Typ/);
  });
});

describe("ASS-Untertitel", () => {
  it("formatiert Zeiten als H:MM:SS.cc", () => {
    expect(assTime(0)).toBe("0:00:00.00");
    expect(assTime(61.234)).toBe("0:01:01.23");
    expect(assTime(3725.5)).toBe("1:02:05.50");
  });

  it("verschiebt Wortzeiten um den Szenenbeginn und gruppiert je 3 Wörter", () => {
    const cues = buildCues([
      {
        startSeconds: 10,
        durationSeconds: 2,
        text: "x",
        words: voiceScene(1, 2).words,
      },
    ]);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe("Das ist (ein)"); // geschweifte Klammern entschärft
    expect(cues[0]!.start).toBeCloseTo(10.1);
    expect(cues[1]!.text).toBe("Test");
    expect(cues[1]!.start).toBeCloseTo(11.2);
    // Block 1 endet spätestens, wenn Block 2 beginnt, und nie hinter der Szene.
    expect(cues[0]!.end).toBeLessThanOrEqual(cues[1]!.start + 1e-9);
    for (const c of cues) expect(c.end).toBeLessThanOrEqual(12 + 1e-9);
  });

  it("fällt ohne Wortzeiten auf den ganzen Text über die Szene zurück", () => {
    const cues = buildCues([{ startSeconds: 5, durationSeconds: 3, text: "Hallo Welt", words: [] }]);
    expect(cues).toEqual([{ start: 5, end: 8, text: "Hallo Welt" }]);
  });

  it("erzeugt gültige ASS-Datei mit 1080x1920, Stil im sicheren Bereich und Dialogzeilen", () => {
    const ass = buildAss([
      { startSeconds: 0, durationSeconds: 2, text: "t", words: voiceScene(1, 2).words },
    ]);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toMatch(/Style: Default,Arial,88,.*,2,100,100,520,1/);
    expect(ass).toContain("Dialogue: 0,0:00:00.10,");
    expect(ass).toContain(",Default,,0,0,0,,Das ist (ein)");
  });

  it("entschärft Backslashes und Override-Klammern", () => {
    expect(escapeAssText("a\\Nb {x}")).toBe("a/Nb (x)");
  });
});

describe("escapeFilterPath (Windows)", () => {
  it("maskiert Laufwerks-Doppelpunkt zweistufig und wandelt Backslashes", () => {
    expect(escapeFilterPath("C:\\Users\\a b\\out\\subtitles.ass")).toBe(
      "C\\\\:/Users/a b/out/subtitles.ass",
    );
  });
  it("maskiert Apostroph und Filter-Sonderzeichen", () => {
    expect(escapeFilterPath("/tmp/it's[1],x;y.ass")).toBe("/tmp/it\\\\\\'s\\[1\\]\\,x\\;y.ass");
  });
});

describe("buildFfmpegArgs", () => {
  const plan = buildPlan(
    voices(voiceScene(1, 3), voiceScene(2, 2.5), voiceScene(3, 4)),
    media(mediaScene(1), mediaScene(2, "video"), mediaScene(3)),
    dirs,
  );
  const filter = (args: string[]) => args[args.indexOf("-filter_complex") + 1]!;

  it("verwendet Eingänge je Szene (Bild, Clip mit Schleife, Sprache) und optional Musik", () => {
    const args = buildFfmpegArgs({
      plan,
      assFile: "C:\\o\\subtitles.ass",
      musicFile: "C:\\m\\song.mp3",
      outFile: "C:\\o\\video.mp4",
    });
    const inputs = args.flatMap((a, i) => (a === "-i" ? [args[i + 1]!] : []));
    expect(inputs).toHaveLength(7); // 3 Medien + 3 Sprachen + Musik
    expect(inputs[1]).toMatch(/scene-02\.mp4$/);
    expect(inputs[3]).toMatch(/scene-01\.wav$/);
    // Clip: Schleife und Lesebegrenzung direkt vor seinem Eingang
    const clipAt = args.indexOf(inputs[1]!);
    expect(args.slice(clipAt - 5, clipAt)).toEqual(["-stream_loop", "-1", "-t", "2.5", "-i"]);
    // Musik in Endlosschleife
    const musicAt = args.indexOf("C:\\m\\song.mp3");
    expect(args.slice(musicAt - 3, musicAt)).toEqual(["-stream_loop", "-1", "-i"]);
  });

  it("Bild: Ken-Burns mit zoompan auf 1080x1920, Clip: nur scale+crop", () => {
    const f = filter(buildFfmpegArgs({ plan, assFile: "/o/s.ass", outFile: "/o/v.mp4" }));
    expect(f).toContain("[0:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=");
    expect(f).toContain("d=90:s=1080x1920:fps=30"); // 3 s * 30 fps
    expect(f).toContain("z='1+0.25*on/90'");
    expect(f).toContain("x='(iw-iw/zoom)*on/120'"); // Szene 3: Zoom-in mit Schwenk
    expect(f).toMatch(/\[1:v\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,trim=end_frame=75/);
    expect(f.split("zoompan").length - 1).toBe(2); // nur die zwei Bild-Szenen
    expect(f).toContain("concat=n=3:v=1:a=0[vcat]");
  });

  it("brennt ASS ein mit maskiertem Windows-Pfad", () => {
    const f = filter(
      buildFfmpegArgs({ plan, assFile: "C:\\Users\\x\\out\\subtitles.ass", outFile: "o.mp4" }),
    );
    expect(f).toContain("[vcat]ass=filename=C\\\\:/Users/x/out/subtitles.ass[vout]");
  });

  it("Ducking: sidechaincompress und amix, Sprache als Sidechain", () => {
    const f = filter(
      buildFfmpegArgs({ plan, assFile: "/o/s.ass", musicFile: "/m/a.mp3", outFile: "/o/v.mp4" }),
    );
    expect(f).toContain("[speech]asplit=2[sp][sc]");
    expect(f).toContain("[music][sc]sidechaincompress=");
    expect(f).toContain("[sp][ducked]amix=inputs=2:duration=first");
    expect(f).toContain("[6:a]"); // Musik ist Eingang 2*k
    expect(f).toContain("atrim=duration=9.5"); // Videolänge 3+2.5+4
    expect(f).not.toContain("normalize=0"); // erst ab FFmpeg 7.1 vorhanden
  });

  it("ohne Musik: kein Ducking, Sprache direkt als [aout]", () => {
    const args = buildFfmpegArgs({ plan, assFile: "/o/s.ass", outFile: "/o/v.mp4" });
    const f = filter(args);
    expect(f).not.toContain("sidechaincompress");
    expect(f).not.toContain("amix");
    expect(f).toContain("concat=n=3:v=0:a=1[aout]");
    expect(args.filter((a) => a === "-i")).toHaveLength(6);
  });

  it("Ausgabe: H.264/AAC, yuv420p, 30 fps, faststart, Länge = Summe der Sprachdauern", () => {
    const args = buildFfmpegArgs({ plan, assFile: "/o/s.ass", outFile: "/o/v.mp4" });
    const pair = (k: string) => args[args.indexOf(k) + 1];
    expect(pair("-c:v")).toBe("libx264");
    expect(pair("-pix_fmt")).toBe("yuv420p");
    expect(pair("-r")).toBe("30");
    expect(pair("-c:a")).toBe("aac");
    expect(pair("-movflags")).toBe("+faststart");
    expect(args[args.lastIndexOf("-t") + 1]).toBe("9.5");
    expect(args.at(-1)).toBe("/o/v.mp4");
    expect(args).toContain("-nostdin");
  });
});

describe("assembleVideo (FFmpeg gemockt)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "video-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setup(opts: { skipMedia?: number; skipAudio?: number; extraMedia?: number } = {}) {
    const vdir = path.join(dir, "voices");
    const mdir = path.join(dir, "media");
    await mkdir(vdir);
    await mkdir(mdir);
    const ids = [1, 2, 3];
    for (const id of ids) {
      if (id !== opts.skipAudio) await writeFile(path.join(vdir, `scene-0${id}.wav`), "x");
      if (id !== opts.skipMedia) await writeFile(path.join(mdir, `scene-0${id}.png`), "x");
    }
    const vs = voices(...ids.map((id) => voiceScene(id, 20)));
    const ms = media(
      ...ids.map((id) => mediaScene(id)),
      ...(opts.extraMedia ? [mediaScene(opts.extraMedia)] : []),
    );
    await writeFile(path.join(vdir, "voices.json"), JSON.stringify(vs));
    await writeFile(path.join(mdir, "media.json"), JSON.stringify(ms));
    return {
      voicesFile: path.join(vdir, "voices.json"),
      mediaFile: path.join(mdir, "media.json"),
      outFile: path.join(dir, "out", "video.mp4"),
      musicDir: path.join(dir, "music"),
    };
  }

  function mockRunner() {
    const calls: string[][] = [];
    const runner: Runner = async (args): Promise<RunResult> => {
      calls.push(args);
      return { stdout: "ffmpeg version 8.0-test\n", stderr: "" };
    };
    return { runner, calls };
  }

  it("schreibt ASS-Datei und ruft FFmpeg genau einmal mit den erwarteten Argumenten", async () => {
    const files = await setup();
    await mkdir(files.musicDir);
    await writeFile(path.join(files.musicDir, "b.mp3"), "x");
    await writeFile(path.join(files.musicDir, "a.mp3"), "x");
    const { runner, calls } = mockRunner();
    const r = await assembleVideo({ ...files, runner });
    expect(calls[0]).toEqual(["-version"]);
    expect(calls).toHaveLength(2);
    const args = calls[1]!;
    expect(args.at(-1)).toBe(files.outFile);
    expect(r.musicFile).toBe(path.resolve(files.musicDir, "a.mp3")); // alphabetisch erste
    expect(args).toContain(r.musicFile!);
    expect(r.plan.totalSeconds).toBe(60);
    expect(r.warnings).toEqual([]);
    const ass = await readFile(r.assFile, "utf8");
    expect(ass).toContain("Dialogue: 0,0:00:00.10,");
    expect(ass).toContain("Dialogue: 0,0:00:20.10,"); // Szene 2 beginnt bei 20 s
    expect(ass).toContain("Dialogue: 0,0:00:40.10,");
  });

  it("läuft ohne Musikdatei weiter (Hinweis, kein Ducking-Graph)", async () => {
    const files = await setup();
    const { runner, calls } = mockRunner();
    const r = await assembleVideo({ ...files, runner });
    expect(r.musicFile).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/ohne Hintergrundmusik/);
    expect(calls[1]!.join(" ")).not.toContain("sidechaincompress");
  });

  it("bricht ab, wenn eine ausdrücklich angegebene Musikdatei fehlt", async () => {
    const files = await setup();
    const { runner, calls } = mockRunner();
    await expect(
      assembleVideo({ ...files, musicFile: path.join(dir, "gibt-es-nicht.mp3"), runner }),
    ).rejects.toThrow(/Musikdatei nicht gefunden/);
    expect(calls).toHaveLength(1); // nur -version, kein Schnitt
  });

  it("warnt, wenn die Länge außerhalb des Zielbereichs liegt", async () => {
    const files = await setup();
    await writeFile(
      files.voicesFile,
      JSON.stringify(voices(...[1, 2, 3].map((id) => voiceScene(id, 5)))),
    );
    const { runner } = mockRunner();
    const r = await assembleVideo({ ...files, runner });
    expect(r.warnings.join(" ")).toMatch(/Zielbereichs 50-70 s/);
  });

  it("bricht ab bei fehlendem Material, fehlender Sprache, inkonsistenten IDs", async () => {
    const { runner, calls } = mockRunner();
    await expect(
      assembleVideo({ ...(await setup({ skipMedia: 2 })), runner }),
    ).rejects.toThrow(/Bild für Szene 2 fehlt/);
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(path.join(tmpdir(), "video-test-"));
    await expect(
      assembleVideo({ ...(await setup({ skipAudio: 3 })), runner }),
    ).rejects.toThrow(/Audiodatei für Szene 3 fehlt/);
    await rm(dir, { recursive: true, force: true });
    dir = await mkdtemp(path.join(tmpdir(), "video-test-"));
    await expect(
      assembleVideo({ ...(await setup({ extraMedia: 9 })), runner }),
    ).rejects.toThrow(/Sprache fehlt für Szene\(n\) 9/);
    expect(calls.every((c) => c[0] === "-version")).toBe(true); // nie geschnitten
  });

  it("meldet fehlende Eingabedateien verständlich", async () => {
    const { runner } = mockRunner();
    await expect(
      assembleVideo({
        voicesFile: path.join(dir, "nix", "voices.json"),
        mediaFile: path.join(dir, "nix", "media.json"),
        outFile: path.join(dir, "v.mp4"),
        runner,
      }),
    ).rejects.toThrow(/voices\.json nicht gefunden.*npm run voice/);
  });

  it("reicht ToolNotFoundError mit Installationshinweis weiter, bevor etwas gelesen wird", async () => {
    const runner: Runner = async () => {
      throw new ToolNotFoundError("FFmpeg", "ffmpeg");
    };
    const err = await assembleVideo({
      voicesFile: "x",
      mediaFile: "y",
      outFile: path.join(dir, "v.mp4"),
      runner,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolNotFoundError);
    expect((err as Error).message).toContain("winget install --id Gyan.FFmpeg -e");
    expect((err as Error).message).toContain("ffmpeg -version");
  });
});

describe("resolveMusic", () => {
  it("liefert undefined bei fehlendem Ordner", async () => {
    expect(await resolveMusic(undefined, path.join(tmpdir(), "gibt-es-nicht-xyz"))).toBeUndefined();
  });
});

describe("Verifikation per FFprobe (gemockt)", () => {
  const probeJson = (w: number, h: number, dur: string, audio = true) =>
    JSON.stringify({
      streams: [
        { codec_type: "video", codec_name: "h264", width: w, height: h },
        ...(audio ? [{ codec_type: "audio", codec_name: "aac" }] : []),
      ],
      format: { duration: dur },
    });

  it("akzeptiert 1080x1920 mit passender Dauer", async () => {
    const r = await verifyVideo(async () => ({ stdout: probeJson(1080, 1920, "60.02"), stderr: "" }), "v.mp4", {
      expectedSeconds: 60,
    });
    expect(r.ok).toBe(true);
  });

  it("meldet falsche Auflösung, Seitenverhältnis, Dauer und fehlenden Ton", () => {
    const problems = checkProbe(
      { width: 1920, height: 1080, videoCodec: "h264", durationSeconds: 50 },
      { expectedSeconds: 60 },
    );
    expect(problems.join("|")).toMatch(/Auflösung 1920x1080/);
    expect(problems.join("|")).toMatch(/nicht 9:16/);
    expect(problems.join("|")).toMatch(/Audiocodec fehlt/);
    expect(problems.join("|")).toMatch(/Dauer 50\.00/);
  });

  it("leitet FFprobe-Pfad aus FFMPEG_PATH ab", () => {
    expect(ffprobeBinary({})).toBe("ffprobe");
    expect(ffprobeBinary({ FFMPEG_PATH: "C:\\ff\\bin\\ffmpeg.exe" })).toBe("C:\\ff\\bin\\ffprobe.exe");
    expect(ffprobeBinary({ FFMPEG_PATH: "C:\\ff\\bin\\ffmpeg.exe", FFPROBE_PATH: "p" })).toBe("p");
  });
});
