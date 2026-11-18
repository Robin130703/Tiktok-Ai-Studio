import { fal } from "@fal-ai/client";
import {
  MediaModerationError,
  type MediaProvider,
  type MediaRequest,
  type MediaResult,
} from "./provider.ts";

/** Schmale Schnittstelle zu fal.ai, damit Tests ohne API-Aufruf laufen. */
export interface FalClient {
  generateImage(req: {
    model: string;
    prompt: string;
    width: number;
    height: number;
    seed: number;
  }): Promise<{ data: Buffer; extension: string; flaggedNsfw: boolean }>;
}

export const FAL_MODEL = "fal-ai/flux/schnell";
/** Exakt 9:16, beide Seiten durch 16 teilbar. Der Schnitt skaliert auf 1080x1920. */
export const IMAGE_WIDTH = 576;
export const IMAGE_HEIGHT = 1024;
/** Schätzung in USD pro Megapixel (nicht live verifiziert, Stand 2026-11-18). */
export const DEFAULT_USD_PER_MEGAPIXEL = 0.003;

export function createFalProvider(
  client: FalClient,
  usdPerMegapixel: number = DEFAULT_USD_PER_MEGAPIXEL,
): MediaProvider {
  return {
    name: "fal",
    type: "image",
    async generate(req: MediaRequest): Promise<MediaResult> {
      const out = await client.generateImage({
        model: FAL_MODEL,
        prompt: req.prompt,
        width: IMAGE_WIDTH,
        height: IMAGE_HEIGHT,
        seed: req.seed,
      });
      // Bei Treffer liefert fal ein schwarzes Bild; das darf nie verwendet werden.
      if (out.flaggedNsfw) {
        throw new MediaModerationError("Der Moderationsfilter von fal.ai hat das Bild abgelehnt");
      }
      return {
        data: out.data,
        type: "image",
        extension: out.extension,
        costUsd: ((IMAGE_WIDTH * IMAGE_HEIGHT) / 1_000_000) * usdPerMegapixel,
      };
    },
  };
}

/** Echter Client; liest FAL_KEY aus der Umgebung (nie aus dem Repo). */
export function createFalClient(env: NodeJS.ProcessEnv = process.env): FalClient {
  const key = env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY ist nicht gesetzt (lokale .env, siehe .env.example)");
  }
  fal.config({ credentials: key });
  return {
    async generateImage({ model, prompt, width, height, seed }) {
      const res = await fal.subscribe(model, {
        input: {
          prompt,
          image_size: { width, height },
          num_images: 1,
          num_inference_steps: 4,
          seed,
          enable_safety_checker: true,
        },
      });
      const data = res.data as {
        images?: { url: string; content_type?: string }[];
        has_nsfw_concepts?: boolean[];
      };
      const image = data.images?.[0];
      if (!image) throw new Error("fal.ai lieferte kein Bild");
      const flaggedNsfw = data.has_nsfw_concepts?.[0] === true;
      const resp = await fetch(image.url);
      if (!resp.ok) throw new Error(`Bild-Download fehlgeschlagen (HTTP ${resp.status})`);
      const ext = image.content_type?.includes("png") ? "png" : "jpg";
      return { data: Buffer.from(await resp.arrayBuffer()), extension: ext, flaggedNsfw };
    },
  };
}
