import { createAnthropicClient } from "./anthropic-client.js";
import { generateScript } from "./generator.js";
import { estimateDurationSeconds } from "./schema.js";
import { saveScript } from "./store.js";

/** Aufruf: node --env-file=.env src/script/cli.ts [Thema] (Node 24 führt TS direkt aus). */
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
