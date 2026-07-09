// replay.js  — point F: per-call outcome + replayability rating
// ---------------------------------------------------------------------------
// The traffic light reflects two things, in priority order:
//
//   🔴 red    "failed"        the request itself did not succeed — a network
//                             error, or an HTTP >= 400 response. Replaying it
//                             as-is just reproduces the failure.
//   🟢 green  "static"        succeeded and consumes no secrets — copy & run.
//   🟡 amber  "session-bound" succeeded but sends a cookie/token. The captured
//                             values let you replay it now; they expire (and if
//                             a token's origin wasn't observed, you can't
//                             regenerate it without re-recording).
//
// Note: a successful request is NEVER red. HTTP status is the success signal —
// which isn't perfect (a server can return 200 with an error in the body), but
// it keeps the red light meaning "this didn't work" rather than "hard to
// replay", which was the confusing behavior before.
// ---------------------------------------------------------------------------

/**
 * @param entry       a captured entry
 * @param provenance  output of buildProvenance()
 * @returns { level: "green"|"amber"|"red", label, reasons: string[] }
 */
export function rateReplayability(entry, provenance) {
  // 1. Did the request fail? That — not token provenance — is what red means.
  const status = entry.status;
  const httpError = typeof status === "number" && status >= 400;
  if (entry.failed || httpError) {
    return {
      level: "red",
      label: entry.failed ? "Failed" : `Failed · HTTP ${status}`,
      reasons: [
        entry.failed
          ? `The request did not complete${entry.errorText ? ` (${entry.errorText})` : ""}.`
          : `The server returned HTTP ${status}, so the call failed. Replaying it as-is reproduces the same error.`,
      ],
    };
  }

  // 2. Succeeded — which traced secrets does it send?
  const consumed = provenance.filter((p) => p.consumers.includes(entry.order));
  if (consumed.length === 0) {
    return {
      level: "green",
      label: "Static",
      reasons: ["Consumes no auth, cookie, or token inputs — copy the snippet and run it as-is."],
    };
  }

  // 3. Succeeded but session-bound: the captured values replay now, but expire.
  const reasons = consumed.map((p) => {
    const what = describe(p);
    if (!p.origin) {
      return (
        `Uses ${what}. Its origin wasn't observed this session, so the captured ` +
        `value works until it expires — you can't regenerate it from what was recorded.`
      );
    }
    if (p.kind === "cookie") {
      return `Uses ${what}, set via ${originText(p.origin)} — session-bound; replay that request for a fresh cookie.`;
    }
    return `Uses ${what}, obtained from ${originText(p.origin)} — reproduce that call for a fresh token.`;
  });

  return { level: "amber", label: "Session-bound", reasons };
}

function describe(p) {
  const kind =
    p.kind === "bearer"
      ? "bearer token"
      : p.kind === "basic"
      ? "basic-auth credential"
      : p.kind === "cookie"
      ? "cookie"
      : `${p.kind} secret`;
  return `${kind} "${p.name}"`;
}

function originText(origin) {
  if (!origin) return "an unobserved source";
  if (origin.where === "page-html") return `the page HTML (${origin.url})`;
  const label = origin.where === "set-cookie" ? "a Set-Cookie on" : "the response to";
  return `${label} ${origin.method || ""} ${origin.url}`.trim();
}
