// options.js
// ---------------------------------------------------------------------------
// Settings UI: pick the AI provider and, for Claude, store the API key + model.
// ---------------------------------------------------------------------------

import { getSettings, saveSettings, REMOTE_MODELS } from "../lib/settings.js";
import { testConnection } from "../llm/remote.js";

const providerRadios = () => [...document.querySelectorAll('input[name="provider"]')];
const remoteConfig = document.getElementById("remote-config");
const apiKeyEl = document.getElementById("api-key");
const modelEl = document.getElementById("model");
const saveBtn = document.getElementById("save");
const testBtn = document.getElementById("test");
const statusEl = document.getElementById("status");

// Populate the model dropdown once.
for (const m of REMOTE_MODELS) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  modelEl.appendChild(opt);
}

init();

async function init() {
  const s = await getSettings();
  for (const r of providerRadios()) r.checked = r.value === s.provider;
  apiKeyEl.value = s.anthropicApiKey || "";
  modelEl.value = s.anthropicModel;
  reflectProvider();
}

function selectedProvider() {
  return providerRadios().find((r) => r.checked)?.value || "local";
}

// Show the Claude config only when the remote provider is selected.
function reflectProvider() {
  remoteConfig.style.display = selectedProvider() === "remote" ? "block" : "none";
}
providerRadios().forEach((r) => r.addEventListener("change", reflectProvider));

saveBtn.addEventListener("click", async () => {
  await saveSettings({
    provider: selectedProvider(),
    anthropicApiKey: apiKeyEl.value.trim(),
    anthropicModel: modelEl.value,
  });
  flash("Saved.", "ok");
});

testBtn.addEventListener("click", async () => {
  // Save first so the background worker tests the current values.
  await saveSettings({
    provider: selectedProvider(),
    anthropicApiKey: apiKeyEl.value.trim(),
    anthropicModel: modelEl.value,
  });
  testBtn.disabled = true;
  flash("Testing…", "muted");
  const res = await testConnection();
  testBtn.disabled = false;
  if (res.ok) flash(`Connection OK (${res.model}).`, "ok");
  else flash("Failed: " + (res.error || "unknown error"), "err");
});

function flash(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "save-status " + kind;
}
