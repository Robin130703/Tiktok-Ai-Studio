/**
 * Schmale, austauschbare Schnittstelle zur Bild-/Clip-Quelle (siehe docs/media-provider.md).
 * Der Schnitt (#9) kennt nur diese Typen, nie den konkreten Anbieter.
 */

export type MediaType = "image" | "video";

/** Zielformat: Hochformat 9:16. */
export const ASPECT_RATIO = "9:16" as const;

export interface MediaRequest {
  sceneId: number;
  /** Fertiger Prompt (Szene plus Figurenbeschreibung). */
  prompt: string;
  aspectRatio: typeof ASPECT_RATIO;
  /** Szenendauer in Sekunden (aus voices.json, vom Aufrufer übergeben). */
  durationSeconds: number;
  /** Stabiler Startwert, hält Figuren über Szenen hinweg ähnlich. */
  seed: number;
}

export interface MediaResult {
  data: Buffer;
  type: MediaType;
  /** Dateiendung ohne Punkt, z. B. "png" oder "jpg". */
  extension: string;
  /** Geschätzte Kosten in USD für diese Erzeugung. */
  costUsd: number;
}

export interface MediaProvider {
  /** Eindeutiger Name, gleichzeitig Wert von `MEDIA_PROVIDER`. */
  readonly name: string;
  /** Typ der gelieferten Medien. */
  readonly type: MediaType;
  /** Geschätzte Kosten (USD) je Erzeugung; ermöglicht die Kostenprüfung vor dem Aufruf. */
  readonly estimatedCostUsd?: number;
  generate(req: MediaRequest): Promise<MediaResult>;
}

/** Inhalt wurde vom Moderationsfilter des Anbieters abgelehnt. */
export class MediaModerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaModerationError";
  }
}
