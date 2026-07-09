// viewer.js
// ---------------------------------------------------------------------------
// Loads one session, builds its report, and renders the rich HTML view.
// Wires up the per-call "Copy curl" buttons, the export controls, and the
// AI narrative (Phase 2 on-device / Phase 3 remote — chosen in Settings).
// ---------------------------------------------------------------------------

import { getSession, saveSession } from "../lib/storage.js";
import { buildReport, renderHtml } from "../engine/report.js";
import { exportReport, showInFolder } from "../lib/exporter.js";
import { generateNarrative, getProviderInfo } from "../llm/provider.js";

const reportEl = document.getElementById("report");
const exportBtn = document.getElementById("export");
const showFolderBtn = document.getElementById("show-folder");
const narrateBtn = document.getElementById("narrate");
const settingsBtn = document.getElementById("settings");
const backEl = document.getElementById("back");
const toastEl = document.getElementById("toast");

// Kept in module scope so the buttons can read them.
let currentSession = null;
let currentReport = null;
let lastDownloadId = null;

backEl.href = chrome.runtime.getURL("src/dashboard/dashboard.html");
settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

init();

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return fail("No session id in the URL.");

  currentSession = await getSession(id);
  if (!currentSession) return fail("Session not found (it may have been deleted).");

  currentReport = buildReport(currentSession);
  draw(); // renders with any previously-cached narrative

  reflectAiStatus();
}

/** (Re)render the report body and re-wire its per-call copy buttons. */
function draw() {
  reportEl.innerHTML = renderHtml(currentReport, currentSession.narrative);
  for (const btn of reportEl.querySelectorAll(".copy-btn")) {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.callIndex);
      const fmt = btn.dataset.format || "curl";
      await navigator.clipboard.writeText(currentReport.calls[i].snippets[fmt]);
      const original = btn.textContent;
      btn.textContent = "Copied ✓";
      setTimeout(() => (btn.textContent = original), 1500);
    });
  }
}

// --- AI narrative ----------------------------------------------------------

/** Set the narrate button's label to match the configured provider + state. */
async function reflectAiStatus() {
  const info = await getProviderInfo();
  const regen = !!currentSession.narrative;

  if (info.provider === "remote") {
    if (!info.ready) {
      narrateBtn.textContent = "Set up AI in Settings";
      narrateBtn.title = "Add your Anthropic API key in Settings to enable Claude summaries.";
    } else {
      narrateBtn.textContent = regen ? "✨ Regenerate (Claude)" : "✨ Summarize (Claude)";
    }
    return;
  }

  // Local provider.
  if (!info.ready) {
    narrateBtn.textContent = "AI summary unavailable";
    narrateBtn.title =
      "Chrome's built-in Prompt API isn't available. Enable it at chrome://flags → " +
      "'Prompt API for Gemini Nano', or switch to Claude in Settings.";
  } else {
    narrateBtn.textContent = regen ? "✨ Regenerate summary" : "✨ Summarize (on-device)";
  }
}

narrateBtn.addEventListener("click", async () => {
  narrateBtn.disabled = true;
  try {
    const result = await generateNarrative(currentReport, {
      onStatus: (msg) => (narrateBtn.textContent = msg),
    });

    if (!result.ok) {
      if (result.reason === "no-key") {
        toast("No API key set. Opening Settings…");
        chrome.runtime.openOptionsPage();
      } else if (result.reason === "unavailable") {
        toast(
          "On-device AI isn't available. Enable it in chrome://flags, or switch to Claude in Settings."
        );
      } else {
        toast("Couldn't generate summary: " + (result.message || "unknown error"));
      }
      reflectAiStatus(); // reset the label to a sensible resting state
      return;
    }

    // Cache the narrative onto the session so it persists and exports.
    currentSession.narrative = result.text;
    await saveSession(currentSession);
    draw();
    // Explicit success confirmation (don't leave it on "Generating…").
    narrateBtn.textContent = "✓ Generated";
  } catch (e) {
    toast("Summary failed: " + (e && e.message ? e.message : e));
    reflectAiStatus();
  } finally {
    // Only re-enable here — the label is set per-branch above so success
    // stays on "✓ Generated" instead of being clobbered.
    narrateBtn.disabled = false;
  }
});

// --- export ----------------------------------------------------------------

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  try {
    lastDownloadId = await exportReport(currentSession, currentReport);
    showFolderBtn.hidden = false;
    toast("Exported to Downloads/Thoth/ — contains live secrets.");
  } catch (e) {
    toast("Export failed: " + (e && e.message ? e.message : e));
  } finally {
    exportBtn.disabled = false;
  }
});

showFolderBtn.addEventListener("click", () => {
  if (lastDownloadId != null) showInFolder(lastDownloadId);
});

// --- helpers ---------------------------------------------------------------

function fail(msg) {
  reportEl.innerHTML = `<p class="warn">${msg}</p>`;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), 8000);
}
