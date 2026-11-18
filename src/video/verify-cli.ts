import { createFfprobeRunner } from "./runner.ts";
import { verifyVideo } from "./verify.ts";

const USAGE = "Aufruf: npm run video:verify -- <video.mp4> [--seconds <erwartete Dauer>]";

try {
  const argv = process.argv.slice(2);
  let file: string | undefined;
  let seconds: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--seconds") seconds = Number(argv[++i]);
    else file = a;
  }
  if (!file || (seconds !== undefined && !Number.isFinite(seconds))) throw new Error(USAGE);
  const { ok, probe, problems } = await verifyVideo(createFfprobeRunner(), file, {
    expectedSeconds: seconds,
  });
  console.log(
    `${probe.width}x${probe.height}, ${probe.durationSeconds.toFixed(2)} s, Video ${probe.videoCodec ?? "-"}, Audio ${probe.audioCodec ?? "-"}`,
  );
  if (!ok) {
    for (const p of problems) console.error(`Abweichung: ${p}`);
    process.exit(1);
  }
  console.log("OK: 1080x1920 (9:16)");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
