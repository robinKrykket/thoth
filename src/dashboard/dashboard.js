// dashboard.js
// ---------------------------------------------------------------------------
// Lists recorded sessions and lets you open / export / delete each one.
// If opened with ?open=<id> (from the popup right after a recording) it jumps
// straight to that session's report.
// ---------------------------------------------------------------------------

import { listSessions, getSession, deleteSession } from "../lib/storage.js";
import { buildReport } from "../engine/report.js";
import { exportReport, showInFolder } from "../lib/exporter.js";

const listEl = document.getElementById("list");
const toastEl = document.getElementById("toast");

// Jump straight to a freshly recorded session if asked.
const openId = new URLSearchParams(location.search).get("open");
if (openId) {
  location.replace(viewerUrl(openId));
} else {
  document
    .getElementById("settings")
    .addEventListener("click", () => chrome.runtime.openOptionsPage());
  render();
}

async function render() {
  const sessions = await listSessions();
  if (!sessions.length) {
    listEl.innerHTML = `<p class="muted">No sessions yet. Click the extension icon and hit Record.</p>`;
    return;
  }

  listEl.innerHTML = "";
  for (const s of sessions) {
    const row = document.createElement("div");
    row.className = "session-row";
    row.innerHTML = `
      <div class="session-meta">
        <div class="session-title">${escapeHtml(s.title || "(untitled)")}</div>
        <div class="session-sub muted">${escapeHtml(s.url || "")}</div>
        <div class="session-sub muted">
          ${new Date(s.startedAt).toLocaleString()} · ${s.entryCount} requests
        </div>
      </div>
      <div class="session-actions">
        <button class="btn" data-act="open">Open</button>
        <button class="btn" data-act="export">Export</button>
        <button class="btn btn-danger" data-act="delete">Delete</button>
      </div>`;

    row.querySelector('[data-act="open"]').addEventListener("click", () => {
      location.href = viewerUrl(s.id);
    });
    row.querySelector('[data-act="export"]').addEventListener("click", () =>
      onExport(s.id)
    );
    row.querySelector('[data-act="delete"]').addEventListener("click", () =>
      onDelete(s.id)
    );

    listEl.appendChild(row);
  }
}

async function onExport(id) {
  const session = await getSession(id);
  const report = buildReport(session);
  const downloadId = await exportReport(session, report);
  toast(`Exported to Downloads/Thoth/. `, () => showInFolder(downloadId));
}

async function onDelete(id) {
  if (!confirm("Delete this session permanently?")) return;
  await deleteSession(id);
  render();
}

function viewerUrl(id) {
  return chrome.runtime.getURL(`src/viewer/viewer.html?id=${encodeURIComponent(id)}`);
}

// --- tiny toast with an optional action link ---
function toast(message, action) {
  toastEl.innerHTML = escapeHtml(message);
  if (action) {
    const a = document.createElement("button");
    a.className = "link";
    a.textContent = "Show in folder";
    a.addEventListener("click", action);
    toastEl.appendChild(a);
  }
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), 6000);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
