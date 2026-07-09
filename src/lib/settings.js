// settings.js
// ---------------------------------------------------------------------------
// Small key/value settings, stored in chrome.storage.local (not IndexedDB —
// these are tiny and read from several contexts). Holds the LLM provider choice
// and, for the remote provider, the Anthropic API key + model.
//
// The API key lives only in local extension storage on this machine. It is
// sent to Anthropic when generating a remote summary, and never anywhere else.
// ---------------------------------------------------------------------------

const KEY = "thoth:settings";

const DEFAULTS = {
  provider: "local", // "local" (on-device Gemini Nano) | "remote" (Claude)
  anthropicApiKey: "",
  anthropicModel: "claude-opus-4-8",
  maxTokens: 1024,
};

// Models offered in the options dropdown. Opus is the default/most capable;
// the others are cheaper/faster choices for this small summarization task.
export const REMOTE_MODELS = [
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest / cheapest" },
];

export async function getSettings() {
  const stored = await chrome.storage.local.get(KEY);
  return { ...DEFAULTS, ...(stored[KEY] || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
