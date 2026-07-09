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

// The model *download* is separate from a *session*: Chrome fetches Gemini Nano
// to disk once and caches it across restarts — create() never re-downloads it.
// What used to churn was the session (which loads the model into memory). We now
// keep ONE warm session per page and reuse it, so repeated summaries in a tab
// don't rebuild it. It's freed on page unload via dispose().
let warmSession = null;
let warmSystemPrompt = null;

async function getWarmSession(d, systemPrompt, onStatus) {
  if (warmSession && warmSystemPrompt === systemPrompt) return warmSession;
  dispose(); // nothing cached, or the system prompt changed — rebuild

  // downloadprogress only fires when Chrome actually needs to fetch the model
  // (first-ever use, or a component update). It's silent once cached on disk.
  const monitor = (m) => {
    m.addEventListener("downloadprogress", (e) => {
      const pct = e.total ? Math.round((e.loaded / e.total) * 100) : Math.round((e.loaded || 0) * 100);
      onStatus && onStatus(`Preparing on-device model… ${pct}%`);
    });
  };

  warmSession =
    d.style === "modern"
      ? await d.api.create({ initialPrompts: [{ role: "system", content: systemPrompt }], monitor })
      : await d.api.create({ systemPrompt, monitor });
  warmSystemPrompt = systemPrompt;
  return warmSession;
}

/**
 * Run one prompt and return the model's text, reusing the warm session. Each
 * call runs on a fresh clone (when supported) so summaries stay independent
 * while sharing the already-loaded model.
 * @param systemPrompt  standing instructions for the model
 * @param userText      the (compact, redacted) digest
 * @param onStatus      optional (msg:string) => void for progress updates
 */
export async function run(systemPrompt, userText, { onStatus } = {}) {
  const d = detect();
  if (!d) throw new Error("Chrome's built-in AI (Prompt API) is not available here.");

  try {
    const base = await getWarmSession(d, systemPrompt, onStatus);
    onStatus && onStatus("Generating…");

    // A clone reuses the loaded model but starts with a clean context (no bleed
    // between summaries). Fall back to the base session if clone() is unsupported.
    let convo = base;
    let disposable = false;
    if (typeof base.clone === "function") {
      try {
        convo = await base.clone();
        disposable = true;
      } catch (_) {
        convo = base;
      }
    }

    try {
      // Some Chrome builds leave prompt() pending forever; cap it so the UI
      // fails clearly instead of hanging on "Generating…".
      return await withTimeout(convo.prompt(userText), PROMPT_TIMEOUT_MS);
    } finally {
      if (disposable) {
        try {
          convo.destroy && convo.destroy();
        } catch (_) {
          /* best effort */
        }
      }
    }
  } catch (e) {
    // Drop the (possibly stale/broken) warm session so a retry rebuilds it.
    dispose();
    throw e;
  }
}

/** Release the warm session and free the model from memory (call on page unload). */
export function dispose() {
  if (warmSession) {
    try {
      warmSession.destroy && warmSession.destroy();
    } catch (_) {
      /* best effort */
    }
  }
  warmSession = null;
  warmSystemPrompt = null;
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
