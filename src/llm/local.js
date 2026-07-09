// local.js
// ---------------------------------------------------------------------------
// Thin wrapper around Chrome's built-in on-device model (the Prompt API,
// a.k.a. Gemini Nano). This API is still experimental and its shape has changed
// across Chrome versions, so we:
//   - feature-detect across the known global names,
//   - normalize the availability values to one vocabulary,
//   - report download progress,
//   - and never assume it exists (callers handle "unavailable" gracefully).
//
// Availability vocabulary we expose:
//   "available"     ready to use now
//   "downloadable"  supported, but the model must download first (create() does it)
//   "downloading"   a download is already in progress
//   "unavailable"   not supported here (old Chrome, flag off, or unsupported HW)
// ---------------------------------------------------------------------------

/** Find the Prompt API under whichever global this Chrome exposes it on. */
export function detect() {
  // Newest: a top-level `LanguageModel` global.
  if (typeof LanguageModel !== "undefined") {
    return { api: LanguageModel, style: "modern" };
  }
  // Older: `self.ai.languageModel` / `window.ai.languageModel`.
  const ai =
    (typeof self !== "undefined" && self.ai) ||
    (typeof window !== "undefined" && window.ai) ||
    null;
  if (ai && ai.languageModel) return { api: ai.languageModel, style: "legacy" };
  return null;
}

export async function availability() {
  const d = detect();
  if (!d) return "unavailable";
  try {
    if (d.style === "modern") {
      return normalize(await d.api.availability());
    }
    const caps = await d.api.capabilities();
    return normalize(caps && caps.available);
  } catch (_) {
    return "unavailable";
  }
}

/**
 * Create a session, run one prompt, and tear it down. Returns the model's text.
 * @param systemPrompt  standing instructions for the model
 * @param userText      the (compact, redacted) digest
 * @param onStatus      optional (msg:string) => void for progress updates
 */
export async function run(systemPrompt, userText, { onStatus } = {}) {
  const d = detect();
  if (!d) throw new Error("Chrome's built-in AI (Prompt API) is not available here.");

  // Some Chrome versions download the model on first create(); surface progress.
  const monitor = (m) => {
    m.addEventListener("downloadprogress", (e) => {
      const pct = e.total ? Math.round((e.loaded / e.total) * 100) : Math.round((e.loaded || 0) * 100);
      onStatus && onStatus(`Downloading on-device model… ${pct}%`);
    });
  };

  const session =
    d.style === "modern"
      ? await d.api.create({ initialPrompts: [{ role: "system", content: systemPrompt }], monitor })
      : await d.api.create({ systemPrompt, monitor });

  try {
    onStatus && onStatus("Generating…");
    // Some Chrome builds leave session.prompt() pending forever after the model
    // downloads. Cap it so the UI fails clearly instead of hanging on "Generating…".
    return await withTimeout(session.prompt(userText), PROMPT_TIMEOUT_MS);
  } finally {
    try {
      session.destroy && session.destroy();
    } catch (_) {
      /* best effort */
    }
  }
}

const PROMPT_TIMEOUT_MS = 90_000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `On-device model timed out after ${ms / 1000}s. Try again, or switch to Claude in Settings.`
            )
          ),
        ms
      )
    ),
  ]);
}

function normalize(value) {
  switch (value) {
    case "available":
    case "readily":
      return "available";
    case "downloadable":
    case "after-download":
      return "downloadable";
    case "downloading":
      return "downloading";
    default:
      return "unavailable";
  }
}
