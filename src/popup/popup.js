// popup.js
// ---------------------------------------------------------------------------
// The popup is a thin launcher: Record / Stop, live status, and a link to the
// dashboard. All real work happens in the background service worker; we just
// send it messages and reflect the result.
// ---------------------------------------------------------------------------

const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");
const errorEl = document.getElementById("error");
const dashboardEl = document.getElementById("dashboard");

let isRecording = false;

/** Ask the background worker whether a recording is in progress. */
async function refreshStatus() {
  const s = await chrome.runtime.sendMessage({ type: "STATUS" });
  isRecording = !!(s && s.recording);
  render(s && s.count);
}

function render(count) {
  clearError();
  if (isRecording) {
    statusEl.textContent = `Recording… ${count ?? 0} requests captured`;
    statusEl.className = "status recording";
    toggleEl.textContent = "■ Stop & generate report";
    toggleEl.className = "btn btn-stop";
  } else {
    statusEl.textContent = "Idle";
    statusEl.className = "status idle";
    toggleEl.textContent = "● Record";
    toggleEl.className = "btn btn-record";
  }
}

toggleEl.addEventListener("click", async () => {
  toggleEl.disabled = true;
  try {
    if (!isRecording) {
      const res = await chrome.runtime.sendMessage({ type: "START" });
      if (!res.ok) throw new Error(res.error);
      isRecording = true;
      render(0);
    } else {
      const res = await chrome.runtime.sendMessage({ type: "STOP" });
      if (!res.ok) throw new Error(res.error);
      isRecording = false;
      render(0);
      // Jump straight to the freshly generated report.
      openDashboard(res.sessionId);
      window.close();
    }
  } catch (e) {
    showError(String(e && e.message ? e.message : e));
  } finally {
    toggleEl.disabled = false;
  }
});

dashboardEl.addEventListener("click", () => openDashboard());

function openDashboard(sessionId) {
  const url = chrome.runtime.getURL(
    "src/dashboard/dashboard.html" + (sessionId ? `?open=${sessionId}` : "")
  );
  chrome.tabs.create({ url });
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}
function clearError() {
  errorEl.hidden = true;
}

refreshStatus();
