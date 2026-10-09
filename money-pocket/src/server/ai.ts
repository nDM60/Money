import Anthropic from "@anthropic-ai/sdk";

/** Claude is used server-side only; the API key never reaches the browser. */
export function aiConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export const AI_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
export function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

/** Server-side refusal fallback (routes declined requests to Anthropic's recommended fallback model). */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
