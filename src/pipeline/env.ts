export const DEFAULT_MAX_COST_PER_VIDEO_USD = 1.0;

/** Benutzerfehler (fehlende Konfiguration, Budget): Meldung genügt, kein Stacktrace. */
export class PipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineError";
  }
}

export class BudgetExceededError extends PipelineError {
  readonly spentUsd: number;
  readonly limitUsd: number;
  constructor(step: string, spentUsd: number, limitUsd: number) {
    super(
      `Budget erreicht: bisher ca. ${spentUsd.toFixed(4)} USD bei Obergrenze ` +
        `MAX_COST_PER_VIDEO_USD=${limitUsd}. Abbruch vor dem Schritt "${step}". ` +
        `Bereits erzeugte Zwischenergebnisse bleiben erhalten; ein neuer Lauf mit demselben ` +
        `Ausgabenamen setzt fort.`,
    );
    this.name = "BudgetExceededError";
    this.spentUsd = spentUsd;
    this.limitUsd = limitUsd;
  }
}

/** Liest MAX_COST_PER_VIDEO_USD (Standard 1.00); ungültige Werte sind ein Fehler. */
export function resolveMaxCost(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MAX_COST_PER_VIDEO_USD?.trim();
  if (!raw) return DEFAULT_MAX_COST_PER_VIDEO_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new PipelineError(
      `MAX_COST_PER_VIDEO_USD muss eine Zahl größer 0 sein (z. B. 1.00), nicht "${raw}".`,
    );
  }
  return n;
}

/** Namen der fehlenden, benötigten Variablen (nie die Werte). */
export function missingEnv(env: NodeJS.ProcessEnv, opts: { dummy: boolean }): string[] {
  const missing: string[] = [];
  const need = (name: string): void => {
    if (!env[name]?.trim()) missing.push(name);
  };
  if (!opts.dummy) {
    need("ANTHROPIC_API_KEY");
    need("OPENAI_API_KEY");
    const provider = (env.MEDIA_PROVIDER || "fal").trim().toLowerCase();
    if (provider === "fal") need("FAL_KEY");
  }
  return missing;
}

/** Früher Check vor dem ersten Schritt; wirft eine verständliche Meldung. */
export function assertEnv(env: NodeJS.ProcessEnv, opts: { dummy: boolean }): void {
  const missing = missingEnv(env, opts);
  if (missing.length > 0) {
    throw new PipelineError(
      `Fehlende Umgebungsvariable(n): ${missing.join(", ")}. Lokal in .env eintragen ` +
        `(Vorlage: .env.example) oder zum Ausprobieren ohne Keys mit --dummy starten.`,
    );
  }
}
