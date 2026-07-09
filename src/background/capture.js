// capture.js
// ---------------------------------------------------------------------------
// Pure reducer for CDP Network events. Kept free of any chrome.* / debugger I/O
// so it can be unit-tested without a browser. background.js owns the debugger
// connection and calls applyNetworkEvent() for each buffered event, and does
// the body retrieval itself (which needs the live debugger).
//
// Redirect handling is the subtle part: when a request is redirected, CDP
// reuses the SAME requestId and fires a second requestWillBeSent whose
// `request` is the redirect TARGET (a 302/303 turns POST → GET). If we just
// overwrote the entry, the original request (e.g. a successful POST) would be
// silently replaced by its GET redirect. Instead we "seal" each hop as its own
// entry and start a fresh one for the target, so nothing is lost.
// ---------------------------------------------------------------------------

/**
 * Get-or-create the CURRENT entry for a requestId. Entries are stored keyed by
 * a monotonic `order` (so multiple redirect hops of one requestId can coexist);
 * `reqIndex` maps a requestId to its active hop.
 */
export function entryFor(recording, requestId) {
  let e = recording.reqIndex[requestId];
  if (!e) {
    e = { requestId, order: recording.seq++ };
    recording.session.entries[e.order] = e;
    recording.reqIndex[requestId] = e;
  }
  return e;
}

/** Look up the current hop for a requestId without creating one. */
export function currentEntry(recording, requestId) {
  return recording.reqIndex[requestId] || null;
}

/** Apply one buffered CDP network event (everything except body retrieval). */
export function applyNetworkEvent(recording, method, params) {
  switch (method) {
    case "Network.requestWillBeSent": {
      // A redirect reuses this requestId — seal the previous hop first so the
      // original request (method/url/body) is preserved as its own entry.
      if (params.redirectResponse) sealRedirectHop(recording, params);

      const e = entryFor(recording, params.requestId);
      e.url = params.request.url;
      e.method = params.request.method;
      e.requestHeaders = params.request.headers || {};
      e.postData = params.request.postData || null;
      e.hasPostData = !!params.request.hasPostData;
      e.type = params.type || e.type || "Other";
      e.initiator = params.initiator || null;
      e.wallTime = params.wallTime || null;
      break;
    }

    // The "extra info" events carry the REAL on-the-wire headers (Cookie /
    // Authorization the basic event may omit) — trusted for secret detection.
    case "Network.requestWillBeSentExtraInfo": {
      entryFor(recording, params.requestId).requestHeadersExtra = params.headers || {};
      break;
    }

    case "Network.responseReceived": {
      const e = entryFor(recording, params.requestId);
      const r = params.response || {};
      e.status = r.status;
      e.statusText = r.statusText;
      e.mimeType = r.mimeType;
      e.responseHeaders = r.headers || {};
      if (params.type) e.type = params.type;
      break;
    }

    case "Network.responseReceivedExtraInfo": {
      entryFor(recording, params.requestId).responseHeadersExtra = params.headers || {};
      break;
    }

    case "Network.loadingFailed": {
      const e = entryFor(recording, params.requestId);
      e.failed = true;
      e.errorText = params.errorText;
      break;
    }

    // Network.loadingFinished is handled in background.js (it needs the debugger
    // to fetch the response body).
  }
}

/**
 * A redirected request reuses its requestId. Record the redirect response on the
 * current hop, tag where it pointed, and detach it from reqIndex so the next
 * entryFor() creates a fresh entry for the redirect target.
 */
function sealRedirectHop(recording, params) {
  const prev = recording.reqIndex[params.requestId];
  if (!prev) return;
  const rr = params.redirectResponse || {};
  prev.status = rr.status;
  prev.statusText = rr.statusText;
  prev.mimeType = rr.mimeType || prev.mimeType;
  prev.responseHeaders = rr.headers || prev.responseHeaders || {};
  prev.redirectedTo = params.request && params.request.url;
  delete recording.reqIndex[params.requestId];
}

/** Convert the order-keyed entry map into a clean, order-sorted array. */
export function finalizeSession(session) {
  const entries = Object.values(session.entries).sort((a, b) => a.order - b.order);
  return { ...session, entries };
}
