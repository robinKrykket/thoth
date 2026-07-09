// background.js  (MV3 service worker, type: module)
// ---------------------------------------------------------------------------
// The capture engine. Uses chrome.debugger (Chrome DevTools Protocol) to attach
// to the active tab and record every request/response — crucially including
// RESPONSE BODIES, which the webRequest API cannot give us in Manifest V3 and
// which we need to trace where auth tokens come from.
//
// Flow:
//   START  -> attach debugger to the active tab, enable Network + Page domains,
//             begin buffering CDP events into an in-memory session.
//   (user clicks around; events stream in)
//   STOP   -> grab a final HTML snapshot, detach, persist the session to
//             IndexedDB, clear state.
//
// Caveat (documented on purpose): the buffer lives in the service worker's
// memory during a recording. An active debugger attachment plus the steady
// stream of CDP events keeps the worker alive, and recordings are short, so
// this is fine for v1. Incremental persistence is a future hardening step.
// ---------------------------------------------------------------------------

import { saveSession } from "../lib/storage.js";
import { callAnthropic } from "../llm/anthropic.js";
import { getSettings } from "../lib/settings.js";

// Don't try to store enormous or binary response bodies. 2 MB of text is plenty
// to find a token in; anything larger is almost certainly a file download.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// The one and only active recording, or null when idle.
//   { tabId, session, seq }   seq = monotonic counter for event ordering.
let recording = null;

// ===========================================================================
// Recording lifecycle
// ===========================================================================

async function startRecording() {
  if (recording) throw new Error("Already recording.");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found.");

  const target = { tabId: tab.id };

  // attach() throws if DevTools is already open on this tab (only one client
  // may speak CDP to a target at a time). We surface that message to the popup.
  await chrome.debugger.attach(target, "1.3");
  await chrome.debugger.sendCommand(target, "Network.enable", {});
  await chrome.debugger.sendCommand(target, "Page.enable", {});

  recording = {
    tabId: tab.id,
    seq: 0,
    session: {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      url: tab.url,
      title: tab.title,
      // requestId -> entry, converted to a sorted array when we finalize.
      entries: {},
      htmlSnapshots: [],
    },
  };

  await setBadge(true);
}

async function stopRecording() {
  if (!recording) throw new Error("Not recording.");
  const { tabId, session } = recording;
  const target = { tabId };

  // Best-effort final DOM snapshot. Useful for tokens embedded in the page
  // (e.g. <meta name="csrf-token">) that never appear in a response body.
  try {
    const res = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    if (res && res.result && typeof res.result.value === "string") {
      session.htmlSnapshots.push({
        url: session.url,
        capturedAt: Date.now(),
        html: res.result.value.slice(0, MAX_BODY_BYTES),
      });
    }
  } catch (_) {
    /* page may be gone; snapshot is optional */
  }

  // Detach cleanly. If the user already cancelled the banner, onDetach fired and
  // recording is being finalized there instead — guard against a double detach.
  try {
    await chrome.debugger.detach(target);
  } catch (_) {
    /* already detached */
  }

  const finalized = finalizeSession(session);
  recording = null;
  await setBadge(false);
  await saveSession(finalized);
  return finalized.id;
}

/** Convert the requestId->entry map into a clean, order-sorted array. */
function finalizeSession(session) {
  const entries = Object.values(session.entries).sort(
    (a, b) => a.order - b.order
  );
  return { ...session, entries };
}

// ===========================================================================
// CDP event handling
// ===========================================================================

// Get-or-create the entry for a requestId. Events can arrive out of order (e.g.
// requestWillBeSentExtraInfo sometimes precedes requestWillBeSent), so we lazily
// create a stub and fill it in as events come.
function entryFor(requestId) {
  const entries = recording.session.entries;
  if (!entries[requestId]) {
    entries[requestId] = { requestId, order: recording.seq++ };
  }
  return entries[requestId];
}

async function onDebuggerEvent(source, method, params) {
  // Ignore anything not from the tab we're actively recording.
  if (!recording || source.tabId !== recording.tabId) return;

  switch (method) {
    case "Network.requestWillBeSent": {
      const e = entryFor(params.requestId);
      e.url = params.request.url;
      e.method = params.request.method;
      e.requestHeaders = params.request.headers || {};
      e.postData = params.request.postData || null;
      e.hasPostData = !!params.request.hasPostData;
      e.type = params.type || e.type || "Other";
      e.initiator = params.initiator || null;
      e.wallTime = params.wallTime || null;
      // A redirect reuses the requestId; note it but keep the latest request.
      if (params.redirectResponse) e.redirected = true;
      break;
    }

    // The "extra info" events carry the REAL on-the-wire headers, including
    // Cookie / Authorization that the basic event may omit. These are what we
    // trust for secret detection.
    case "Network.requestWillBeSentExtraInfo": {
      const e = entryFor(params.requestId);
      e.requestHeadersExtra = params.headers || {};
      break;
    }

    case "Network.responseReceived": {
      const e = entryFor(params.requestId);
      const r = params.response || {};
      e.status = r.status;
      e.statusText = r.statusText;
      e.mimeType = r.mimeType;
      e.responseHeaders = r.headers || {};
      if (params.type) e.type = params.type;
      break;
    }

    case "Network.responseReceivedExtraInfo": {
      const e = entryFor(params.requestId);
      e.responseHeadersExtra = params.headers || {};
      break;
    }

    case "Network.loadingFinished": {
      // Now that the body is complete, pull it before it can be evicted.
      await captureResponseBody(params.requestId);
      break;
    }

    case "Network.loadingFailed": {
      const e = entryFor(params.requestId);
      e.failed = true;
      e.errorText = params.errorText;
      break;
    }
  }
}

async function captureResponseBody(requestId) {
  const e = recording.session.entries[requestId];
  if (!e) return;
  try {
    const { body, base64Encoded } = await chrome.debugger.sendCommand(
      { tabId: recording.tabId },
      "Network.getResponseBody",
      { requestId }
    );
    if (base64Encoded) {
      e.responseBodyOmitted = "binary"; // don't bother analyzing binary blobs
    } else if (body && body.length > MAX_BODY_BYTES) {
      e.responseBodyOmitted = "too-large";
    } else {
      e.responseBody = body || "";
    }
  } catch (err) {
    // Common + harmless: 204s, redirects, and already-evicted resources have no
    // retrievable body ("No resource with given identifier found").
    e.responseBodyError = String(err && err.message ? err.message : err);
  }
}

// If the user clicks "Cancel" on the debugger banner (or the tab closes) we get
// a detach we didn't initiate. Save whatever we captured so the work isn't lost.
async function onDetach(source, reason) {
  if (!recording || source.tabId !== recording.tabId) return;
  const finalized = finalizeSession(recording.session);
  finalized.endedReason = reason; // e.g. "canceled_by_user" / "target_closed"
  recording = null;
  await setBadge(false);
  await saveSession(finalized);
}

// ===========================================================================
// UI badge + messaging
// ===========================================================================

async function setBadge(on) {
  await chrome.action.setBadgeText({ text: on ? "REC" : "" });
  if (on) await chrome.action.setBadgeBackgroundColor({ color: "#d33" });
}

// Register listeners once at top level (required for MV3 service workers, which
// may be torn down and restarted between events).
chrome.debugger.onEvent.addListener(onDebuggerEvent);
chrome.debugger.onDetach.addListener(onDetach);

// The popup talks to us over runtime messages. We always `return true` from the
// async branches so Chrome keeps the response channel open until the promise
// settles.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START") {
    startRecording()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: errText(e) }));
    return true;
  }
  if (msg.type === "STOP") {
    stopRecording()
      .then((sessionId) => sendResponse({ ok: true, sessionId }))
      .catch((e) => sendResponse({ ok: false, error: errText(e) }));
    return true;
  }
  if (msg.type === "STATUS") {
    sendResponse({
      recording: !!recording,
      tabId: recording ? recording.tabId : null,
      count: recording ? Object.keys(recording.session.entries).length : 0,
    });
    return false;
  }

  // --- Remote LLM (Claude). The fetch runs here so it's CORS-exempt. ---
  if (msg.type === "REMOTE_NARRATE") {
    (async () => {
      const s = await getSettings();
      const text = await callAnthropic({
        apiKey: s.anthropicApiKey,
        model: s.anthropicModel,
        system: msg.system,
        user: msg.user,
        maxTokens: s.maxTokens,
      });
      return { ok: true, text };
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: errText(e) }));
    return true;
  }

  if (msg.type === "REMOTE_TEST") {
    (async () => {
      const s = await getSettings();
      await callAnthropic({
        apiKey: s.anthropicApiKey,
        model: s.anthropicModel,
        system: "Reply with the single word OK.",
        user: "ping",
        maxTokens: 16,
      });
      return { ok: true, model: s.anthropicModel };
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: errText(e) }));
    return true;
  }
});

function errText(e) {
  return String(e && e.message ? e.message : e);
}
