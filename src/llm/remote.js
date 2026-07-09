// remote.js
// ---------------------------------------------------------------------------
// Page-side shim for the remote (Claude) provider. The actual HTTP call happens
// in the background service worker (see anthropic.js) because that context is
// CORS-exempt; here we just message the worker and await the result.
// ---------------------------------------------------------------------------

/**
 * Generate a narrative via Claude. Returns the same shape as the local path:
 *   { ok: true, text } | { ok: false, reason: "error", message }
 */
export async function run(systemPrompt, userText, { onStatus } = {}) {
  onStatus && onStatus("Contacting Claude…");
  const res = await chrome.runtime.sendMessage({
    type: "REMOTE_NARRATE",
    system: systemPrompt,
    user: userText,
  });
  if (!res || !res.ok) {
    return { ok: false, reason: "error", message: res ? res.error : "No response from background." };
  }
  return { ok: true, text: (res.text || "").trim() };
}

/** Validate the configured API key/model with a tiny request. */
export async function testConnection() {
  const res = await chrome.runtime.sendMessage({ type: "REMOTE_TEST" });
  return res || { ok: false, error: "No response from background." };
}
