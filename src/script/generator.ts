import type { Script } from "./schema.ts";
import {
  MAX_DURATION_S,
  MAX_SCENES,
  MIN_DURATION_S,
  MIN_SCENES,
  validateScript,
} from "./schema.ts";

/** Schmale Schnittstelle zum LLM, damit Tests ohne echten API-Aufruf laufen. */
export interface LlmClient {
  complete(req: {
    model: string;
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    maxTokens: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export interface Usage {
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  /** Geschätzte Kosten in USD (Preise sind Schätzungen, siehe Doku). */
  costUsd: number;
}

/** USD pro 1 Mio. Token (Schätzung, Stand 2026-11-18, nicht live verifiziert). */
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const DEFAULT_MODEL = "claude-haiku-4-5";
export const DEFAULT_PRICING: Pricing = { inputPerMTok: 1, outputPerMTok: 5 };
export const DEFAULT_MAX_ATTEMPTS = 2; // 1 Versuch + 1 Wiederholung
export const DEFAULT_MAX_COST_USD = 0.1; // Obergrenze laut docs/tech-stack.md

export class ScriptGenerationError extends Error {
  readonly usage: Usage;
  readonly errors: string[];

  constructor(message: string, usage: Usage, errors: string[]) {
    super(message);
    this.usage = usage;
    this.errors = errors;
    this.name = "ScriptGenerationError";
  }
}

export interface GenerateOptions {
  client: LlmClient;
  /** Thema; ohne Angabe wählt das LLM zufällig ein absurdes Thema. */
  topic?: string;
  /** Standard: Env SCRIPT_MODEL, sonst DEFAULT_MODEL. */
  model?: string;
  pricing?: Pricing;
  maxAttempts?: number;
  /** Verhindert weitere Versuche, wenn die Kosten diese Grenze erreicht haben. */
  maxCostUsd?: number;
}

export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.SCRIPT_MODEL?.trim() || DEFAULT_MODEL;
}

export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing = DEFAULT_PRICING,
): number {
  return (
    (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1_000_000
  );
}

const SYSTEM_PROMPT = `Du schreibst Skripte für ca. 60 Sekunden lange Brainrot-Videos mit sprechenden Früchten.
Stil: absurd, schnelle Schnitte, kurze Szenen, kurze Dialogzeilen, kleine verrückte Mini-Handlung mit Pointe.
Inhalt: familienfreundlich. Keine Gewalt, kein Hass, keine Diskriminierung, keine Sexualisierung, keine Drogen,
keine echten Personen, keine Marken, kein Schimpfen. Die TikTok-Community-Richtlinien müssen eingehalten werden.
Sprache: Deutsch.
Ausgabe: ausschließlich ein JSON-Objekt, ohne Markdown und ohne Erklärung, in genau diesem Format:
{"version":1,"title":"...","topic":"...","characters":[{"name":"...","fruit":"...","personality":"..."}],
"scenes":[{"id":1,"description":"...","speaker":"<Name einer Figur>","text":"..."}]}
Regeln: ${MIN_SCENES} bis ${MAX_SCENES} Szenen (ca. 10), ids fortlaufend ab 1; 2 bis 4 Figuren mit festem, eindeutigem Namen;
"description" beschreibt das Bild der Szene (Früchte mit Gesichtern, Ort, Aktion) für einen Bildgenerator;
"text" wird vom "speaker" gesprochen. Insgesamt ca. 150 gesprochene Wörter
(Sprechdauer ${MIN_DURATION_S} bis ${MAX_DURATION_S} Sekunden bei 2,5 Wörtern pro Sekunde).`;

function userPrompt(topic?: string): string {
  return topic?.trim()
    ? `Thema: ${topic.trim()}`
    : "Kein Thema vorgegeben: Wähle zufällig ein absurdes Thema.";
}

/** Entfernt optionale Markdown-Codezäune um das JSON. */
function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(t);
}

/**
 * Erzeugt ein validiertes Skript. Ungültige Ausgaben führen zu einer Wiederholung
 * (Fehler werden dem LLM rückgemeldet); danach ScriptGenerationError.
 */
export async function generateScript(
  opts: GenerateOptions,
): Promise<{ script: Script; usage: Usage }> {
  const model = opts.model ?? resolveModel();
  const pricing = opts.pricing ?? DEFAULT_PRICING;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxCost = opts.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const usage: Usage = { model, attempts: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userPrompt(opts.topic) },
  ];
  let errors: string[] = [];

  while (usage.attempts < maxAttempts) {
    if (usage.attempts > 0 && usage.costUsd >= maxCost) {
      errors = [...errors, `Kostenobergrenze ${maxCost} USD erreicht`];
      break;
    }
    const res = await opts.client.complete({
      model,
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 2000,
    });
    usage.attempts += 1;
    usage.inputTokens += res.inputTokens;
    usage.outputTokens += res.outputTokens;
    usage.costUsd = computeCostUsd(usage.inputTokens, usage.outputTokens, pricing);

    let parsed: unknown;
    try {
      parsed = extractJson(res.text);
    } catch {
      errors = ["Ausgabe ist kein gültiges JSON"];
    }
    if (parsed !== undefined) {
      const result = validateScript(parsed);
      if (result.ok) return { script: result.script, usage };
      errors = result.errors;
    }
    messages.push(
      { role: "assistant", content: res.text },
      {
        role: "user",
        content:
          "Die Ausgabe war ungültig. Behebe diese Fehler und gib das komplette JSON erneut aus:\n- " +
          errors.join("\n- "),
      },
    );
  }
  throw new ScriptGenerationError(
    `Skripterzeugung nach ${usage.attempts} Versuch(en) fehlgeschlagen: ${errors.join("; ")}`,
    usage,
    errors,
  );
}
