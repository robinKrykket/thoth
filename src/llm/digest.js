// digest.js
// ---------------------------------------------------------------------------
// Turns the structured report into a COMPACT, REDACTED text digest for the LLM.
//
// Two hard rules live here, straight from the project's design decisions:
//   1. Compactness — Gemini Nano's context window is tiny, so we never feed raw
//      HTML or response bodies. One line per call, plus the token summary.
//   2. Redaction — we include token NAMES, KINDS and ORIGINS, but never the
//      secret VALUES. The narrative doesn't need them, and this keeps the same
//      digest safe to send to a remote model in Phase 3.
// ---------------------------------------------------------------------------

const MAX_CALLS = 50; // keep the prompt within the small model's budget
const MAX_URL = 120;

export function buildDigest(report) {
  const { meta, summary, auth, calls } = report;
  const lines = [];

  lines.push(`SESSION: ${meta.title || "(untitled)"} — ${meta.url}`);
  lines.push(
    `TOTALS: ${meta.apiCallCount} API calls ` +
      `(${summary.green} static, ${summary.amber} session-bound, ${summary.red} blocked)`
  );
  lines.push("");

  lines.push("CALLS:");
  const shown = calls.slice(0, MAX_CALLS);
  shown.forEach((c, i) => {
    lines.push(`${i + 1}. [${c.replayability.level.toUpperCase()}] ${c.method} ${truncate(c.url)}`);
  });
  if (calls.length > shown.length) {
    // No silent caps: tell the model (and reader) that some were dropped.
    lines.push(`(+${calls.length - shown.length} more calls omitted for brevity)`);
  }
  lines.push("");

  lines.push("TOKENS:");
  if (!auth.length) {
    lines.push("- none observed");
  } else {
    for (const a of auth) {
      lines.push(`- ${a.kind} "${a.name}": ${originText(a.origin)}; used by ${a.consumerCount} request(s)`);
    }
  }

  return lines.join("\n");
}

function originText(origin) {
  if (!origin) return "origin NOT OBSERVED (set before recording, or computed client-side)";
  if (origin.where === "page-html") return `origin = page HTML (${origin.url})`;
  const label = origin.where === "set-cookie" ? "origin = Set-Cookie on" : "origin = response to";
  return `${label} ${origin.method || ""} ${truncate(origin.url)}`.trim();
}

function truncate(url) {
  const s = String(url || "");
  return s.length > MAX_URL ? s.slice(0, MAX_URL) + "…" : s;
}
