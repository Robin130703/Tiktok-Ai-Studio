import { createDummyProvider } from "./dummy.ts";
import { createFalClient, createFalProvider } from "./fal.ts";
import type { MediaProvider } from "./provider.ts";

export const DEFAULT_PROVIDER = "fal";
export const PROVIDER_NAMES = ["fal", "dummy"] as const;

/** Wählt den Anbieter per `MEDIA_PROVIDER` (Standard `fal`). */
export function createMediaProvider(env: NodeJS.ProcessEnv = process.env): MediaProvider {
  const name = (env.MEDIA_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  switch (name) {
    case "dummy":
      return createDummyProvider();
    case "fal":
      return createFalProvider(createFalClient(env));
    default:
      throw new Error(
        `Unbekannter MEDIA_PROVIDER "${name}". Erlaubt: ${PROVIDER_NAMES.join(", ")}`,
      );
  }
}
