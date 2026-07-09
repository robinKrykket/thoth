// replay.js  — point F: per-call replayability rating
// ---------------------------------------------------------------------------
// Rates how easily each call can be reproduced outside the browser, derived
// entirely from the provenance graph. The point is to set expectations right in
// the report instead of burying them in a caveat nobody reads.
//
//   🟢 green  "static"        consumes no secrets — copy the curl and run it.
//   🟡 amber  "session-bound" consumes a cookie/token whose origin we OBSERVED
//                             (reproducible by replaying the earlier call, but
//                             it will expire / rotate).
//   🔴 red    "blocked"       consumes a token whose origin was NOT observed
//                             (set before recording, or computed client-side) —
//                             you can't reproduce the input from captured data.
// ---------------------------------------------------------------------------

/**
 * @param entry       a captured entry
 * @param provenance  output of buildProvenance()
 * @returns { level: "green"|"amber"|"red", label, reasons: string[] }
 */
export function rateReplayability(entry, provenance) {
  // Which traced secrets does THIS call send?
  const consumed = provenance.filter((p) => p.consumers.includes(entry.order));

  if (consumed.length === 0) {
    return {
      level: "green",
      label: "Static",
      reasons: ["Consumes no auth, cookie, or token inputs — copy the curl and run it as-is."],
    };
  }

  const reasons = [];
  let anyBlocked = false;

  for (const p of consumed) {
    const what = describe(p);

    if (!p.origin) {
      anyBlocked = true;
      reasons.push(
        `Depends on ${what}, whose origin was not observed in this session ` +
          `(set before recording began, or computed client-side). You'll need ` +
          `to record the step that produces it, or reproduce it by hand.`
      );
    } else if (p.kind === "cookie") {
      reasons.push(
        `Depends on ${what}, set via ${originText(p.origin)} — session-bound and ` +
          `will expire. Replay that request first to obtain a fresh cookie.`
      );
    } else {
      reasons.push(
        `Depends on ${what}, obtained from ${originText(p.origin)} — reproduce ` +
          `that call first; the token may expire.`
      );
    }
  }

  return {
    level: anyBlocked ? "red" : "amber",
    label: anyBlocked ? "Blocked" : "Session-bound",
    reasons,
  };
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
