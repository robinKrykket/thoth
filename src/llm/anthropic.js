// anthropic.js
// ---------------------------------------------------------------------------
// Raw HTTP client for the Anthropic Messages API. No SDK — this is a plain
// `fetch`, which is the right call for a no-build browser extension.
//
// IMPORTANT: this module is meant to run in the BACKGROUND SERVICE WORKER.
// With `host_permissions` for api.anthropic.com, service-worker fetches are
// exempt from CORS — the reliable MV3 pattern for third-party APIs. (We also
// send the direct-browser-access header as a belt-and-suspenders measure.)
//
// We only send the compact, REDACTED digest built in digest.js — never raw
// tokens, bodies, or HTML.
// ---------------------------------------------------------------------------

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/**
 * Call Claude with a system prompt + user text and return the response text.
 * Throws on any error (no key, HTTP error, refusal, empty response).
 */
export async function callAnthropic({ apiKey, model, system, user, maxTokens = 1024 }) {
  if (!apiKey) throw new Error("No Anthropic API key configured (set one in Settings).");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      // Note: no temperature/top_p/top_k — those 400 on Opus 4.8 / Sonnet 5.
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  // Safety classifiers can decline with a 200 + stop_reason "refusal".
  if (data.stop_reason === "refusal") {
    throw new Error("The model declined to respond to this content.");
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!text) throw new Error("Empty response from the model.");
  return text;
}
