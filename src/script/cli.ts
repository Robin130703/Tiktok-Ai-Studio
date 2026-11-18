import { createAnthropicClient } from "./anthropic-client.ts";
import { generateScript } from "./generator.ts";
import { estimateDurationSeconds } from "./schema.ts";
import { saveScript } from "./store.ts";

/** Aufruf: npm run script -- [Thema] (Node 24 führt TS direkt aus). */
try {
  const topic = process.argv.slice(2).join(" ") || undefined;
  const { script, usage } = await generateScript({ client: createAnthropicClient(), topic });
  const file = await saveScript(script, usage);
  console.log(`Skript: ${file}`);
  console.log(
    `Szenen: ${script.scenes.length}, geschätzte Dauer: ${estimateDurationSeconds(script).toFixed(1)} s`,
  );
  console.log(
    `Nutzung: ${usage.inputTokens} in / ${usage.outputTokens} out Token, ca. ${usage.costUsd.toFixed(4)} USD`,
  );
} catch (err) {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
