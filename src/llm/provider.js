// provider.js
// ---------------------------------------------------------------------------
// The narrative layer's public interface. Composes the standing system prompt
// with the redacted digest and dispatches to the configured provider:
//   - "local"  → on-device Gemini Nano (Phase 2)
//   - "remote" → Claude via the background worker (Phase 3)
//
// Both providers receive the identical redacted digest and system prompt, so
// switching providers changes only where the text is generated, not what facts
// leave the report.
// ---------------------------------------------------------------------------

import { availability as localAvailability, run as localRun } from "./local.js";
import { run as remoteRun } from "./remote.js";
import { buildDigest } from "./digest.js";
import { getSettings } from "../lib/settings.js";

const SYSTEM_PROMPT = [
  "You are a precise technical writer documenting reverse-engineered backend API traffic.",
  "Write a short briefing (2-4 short paragraphs) for a developer who wants to reproduce these calls outside the browser.",
  "",
  "Rules:",
  "- Use ONLY the facts provided. Never invent endpoints, headers, parameters, or values.",
  "- Describe the authentication flow: which call produces each token/cookie, and which calls consume it.",
  "- If a token's origin is 'NOT OBSERVED', say it must be obtained separately or was set before recording. Do NOT guess how it is generated.",
  "- Finish with a sentence on what is easy to replay (static) vs. needs a live session (session-bound) vs. blocked.",
  "- Be concise and factual. No preamble such as 'Certainly' or 'Here is'. Output only the briefing.",
].join("\n");

/**
 * Describe the currently-configured provider for the UI (button label/state).
 * @returns { provider, ready, status?, model? }
 */
export async function getProviderInfo() {
  const s = await getSettings();
  if (s.provider === "remote") {
    return { provider: "remote", ready: !!s.anthropicApiKey, model: s.anthropicModel };
  }
  const status = await localAvailability();
  return { provider: "local", ready: status !== "unavailable", status };
}

/**
 * Generate the narrative for a report using the configured provider.
 * @returns { ok: true, text } | { ok: false, reason }
 *   reason: "unavailable" | "no-key" | "error" (with .message)
 */
export async function generateNarrative(report, { onStatus } = {}) {
  const settings = await getSettings();
  const digest = buildDigest(report);

  if (settings.provider === "remote") {
    if (!settings.anthropicApiKey) return { ok: false, reason: "no-key" };
    return remoteRun(SYSTEM_PROMPT, digest, { onStatus });
  }

  // Local (on-device) provider.
  if ((await localAvailability()) === "unavailable") {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const text = await localRun(SYSTEM_PROMPT, digest, { onStatus });
    return { ok: true, text: (text || "").trim() };
  } catch (e) {
    return { ok: false, reason: "error", message: String(e && e.message ? e.message : e) };
  }
}
