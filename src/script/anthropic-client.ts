import Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "./generator.js";

/** Echter Client; liest ANTHROPIC_API_KEY aus der Umgebung (nie aus dem Repo). */
export function createAnthropicClient(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt (lokale .env, siehe .env.example)");
  }
  const sdk = new Anthropic({ apiKey });
  return {
    async complete({ model, system, messages, maxTokens }) {
      const res = await sdk.messages.create({
        model,
        system,
        messages,
        max_tokens: maxTokens,
      });
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        text,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    },
  };
}
