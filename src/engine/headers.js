// headers.js
// ---------------------------------------------------------------------------
// Buckets each request header so the report can say which headers were
// *leveraged* by the call vs. which are just browser boilerplate.
//
// We deliberately do NOT claim a header is "required" — you can only prove that
// by replaying without it. We report what was USED, sorted into buckets:
//
//   auth        Authorization / cookies / csrf / api keys / anything token-ish
//   content     content negotiation that shapes the request (content-type)
//   cookie      Cookie / Set-Cookie
//   custom      non-standard X-* headers the app added on purpose
//   boilerplate headers the browser adds automatically (user-agent, sec-*, ...)
//   other       standard headers that didn't match anything above
// ---------------------------------------------------------------------------

// Headers the browser manages on its own. These are noise for replay purposes.
const BOILERPLATE = new Set([
  "host",
  "connection",
  "content-length",
  "user-agent",
  "accept",
  "accept-encoding",
  "accept-language",
  "accept-charset",
  "cache-control",
  "pragma",
  "dnt",
  "upgrade-insecure-requests",
  "referer",
  "origin",
  "te",
  "priority",
  "if-none-match",
  "if-modified-since",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-arch",
  "sec-ch-ua-full-version",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-model",
  "sec-ch-ua-bitness",
]);

// Header names that are unambiguously about authentication.
const AUTH_EXACT = new Set([
  "authorization",
  "proxy-authorization",
  "authentication",
  "x-csrf-token",
  "x-xsrf-token",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-session-token",
]);

// Fuzzy match for auth-ish custom headers we didn't list explicitly.
const AUTH_FUZZY = /(token|auth|api[-_]?key|secret|csrf|xsrf|bearer|session)/i;

/** Return the bucket name for a single header. */
export function classifyHeader(name) {
  const lower = name.toLowerCase();

  if (lower === "cookie" || lower === "set-cookie") return "cookie";
  if (AUTH_EXACT.has(lower) || AUTH_FUZZY.test(lower)) return "auth";
  if (lower === "content-type") return "content";
  if (BOILERPLATE.has(lower)) return "boilerplate";
  if (lower.startsWith("x-")) return "custom";
  return "other";
}

/**
 * Classify a header map into an array of { name, value, bucket }.
 * Order is preserved-ish but grouped so the interesting buckets read first.
 */
export function classifyHeaders(headers) {
  const order = ["auth", "cookie", "content", "custom", "other", "boilerplate"];
  return Object.entries(headers || {})
    .map(([name, value]) => ({ name, value, bucket: classifyHeader(name) }))
    .sort((a, b) => order.indexOf(a.bucket) - order.indexOf(b.bucket));
}

/**
 * The real, trustworthy request headers: the "extra info" set (actual
 * on-the-wire headers incl. cookies) merged over the basic set.
 */
export function mergedRequestHeaders(entry) {
  return { ...(entry.requestHeaders || {}), ...(entry.requestHeadersExtra || {}) };
}

// Buckets worth emitting when generating a replayable request (curl/python/…).
// Everything else is browser boilerplate the HTTP client re-adds itself.
const REPLAY_BUCKETS = new Set(["auth", "cookie", "content", "custom", "other"]);

/**
 * The headers to include in a generated request, as [{ name, value }] — the
 * meaningful ones (auth/cookie/content-type/custom), minus boilerplate and
 * content-length (which clients recompute). Shared by every code generator.
 */
export function replayHeaders(entry) {
  const out = [];
  for (const [name, value] of Object.entries(mergedRequestHeaders(entry))) {
    if (!REPLAY_BUCKETS.has(classifyHeader(name))) continue;
    if (name.toLowerCase() === "content-length") continue;
    out.push({ name, value: String(value) });
  }
  return out;
}
