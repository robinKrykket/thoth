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
import { applyNetworkEvent, finalizeSession, currentEntry } from "./capture.js";

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
    reqIndex: {}, // requestId -> current entry (the active redirect hop)
    session: {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      url: tab.url,
      title: tab.title,
      // order -> entry (multiple redirect hops per requestId can coexist);
      // converted to a sorted array when we finalize.
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

// ===========================================================================
// CDP event handling
// ===========================================================================

async function onDebuggerEvent(source, method, params) {
  // Ignore anything not from the tab we're actively recording.
  if (!recording || source.tabId !== recording.tabId) return;

  // loadingFinished needs the live debugger to fetch the response body;
  // every other event is a pure buffer update handled by capture.js.
  if (method === "Network.loadingFinished") {
    await captureResponseBody(params.requestId);
    return;
  }
  applyNetworkEvent(recording, method, params);
}

async function captureResponseBody(requestId) {
  const e = currentEntry(recording, requestId);
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
