// secrets.js
// ---------------------------------------------------------------------------
// Finds the secret VALUES that requests *consume* — bearer tokens, cookies,
// CSRF headers, token-ish query params, etc. These are the things we then trace
// back to an origin (see provenance.js).
//
// We start from what requests SEND (consumers) rather than blindly scanning
// response bodies, because that's exactly the set we care about: "what secret
// does this call depend on, and where did it come from?"
//
// Everything here is a deterministic string operation. No guessing.
// ---------------------------------------------------------------------------

import { mergedRequestHeaders } from "./headers.js";

// Ignore very short values — a 4-char id would collide with everything and
// produce garbage provenance. Real tokens/cookies are comfortably longer.
const MIN_SECRET_LEN = 8;

// Custom headers whose *value* is a secret worth tracing.
const SECRET_HEADER_NAME = /(token|auth|api[-_]?key|secret|csrf|xsrf|session|access)/i;

// Query-string / body field names that tend to carry secrets.
const SECRET_FIELD_NAME = /(token|auth|key|secret|csrf|xsrf|sig|session|code|access)/i;

/**
 * Scan all entries and return a de-duplicated list of consumed secrets:
 *   { value, kind, name, consumers: number[] }   (consumers = entry.order[])
 *
 * kind is one of: "bearer" | "basic" | "cookie" | "header" | "query" | "body"
 */
export function extractConsumedSecrets(entries) {
  // value -> aggregated secret record
  const byValue = new Map();

  const record = (value, kind, name, order) => {
    if (!value || value.length < MIN_SECRET_LEN) return;
    if (!byValue.has(value)) {
      byValue.set(value, { value, kind, name, consumers: new Set() });
    }
    byValue.get(value).consumers.add(order);
  };

  for (const e of entries) {
    const headers = mergedRequestHeaders(e);

    for (const [rawName, rawValue] of Object.entries(headers)) {
      const name = rawName.toLowerCase();
      const value = String(rawValue);

      if (name === "authorization") {
        // "Bearer xxx" / "Basic xxx" / "<scheme> xxx" — trace the credential.
        const m = value.match(/^(\S+)\s+(.+)$/);
        if (m) record(m[2], schemeKind(m[1]), `Authorization (${m[1]})`, e.order);
        else record(value, "header", "Authorization", e.order);
      } else if (name === "cookie") {
        // Split into individual cookies; each value is a candidate secret.
        for (const pair of value.split(";")) {
          const eq = pair.indexOf("=");
          if (eq === -1) continue;
          const cname = pair.slice(0, eq).trim();
          const cval = pair.slice(eq + 1).trim();
          record(cval, "cookie", `Cookie ${cname}`, e.order);
        }
      } else if (SECRET_HEADER_NAME.test(name)) {
        record(value, "header", rawName, e.order);
      }
    }

    // Token-ish query parameters.
    forEachQueryParam(e.url, (k, v) => {
      if (SECRET_FIELD_NAME.test(k)) record(v, "query", `?${k}`, e.order);
    });

    // Token-ish request-body fields (url-encoded or shallow JSON).
    forEachBodyField(e, (k, v) => {
      if (SECRET_FIELD_NAME.test(k)) record(String(v), "body", `body.${k}`, e.order);
    });
  }

  // Normalize the consumer Sets to sorted arrays for stable output.
  return [...byValue.values()].map((s) => ({
    ...s,
    consumers: [...s.consumers].sort((a, b) => a - b),
  }));
}

function schemeKind(scheme) {
  const s = scheme.toLowerCase();
  if (s === "bearer") return "bearer";
  if (s === "basic") return "basic";
  return "header";
}

function forEachQueryParam(url, fn) {
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams.entries()) fn(k, v);
  } catch (_) {
    /* not a parseable URL */
  }
}

function forEachBodyField(entry, fn) {
  const body = entry.postData;
  if (!body || typeof body !== "string") return;
  const ct = String(
    (entry.requestHeaders && (entry.requestHeaders["Content-Type"] || entry.requestHeaders["content-type"])) || ""
  ).toLowerCase();

  if (ct.includes("application/json")) {
    try {
      const obj = JSON.parse(body);
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" || typeof v === "number") fn(k, v);
        }
      }
    } catch (_) {
      /* not valid JSON */
    }
  } else if (ct.includes("application/x-www-form-urlencoded") || body.includes("=")) {
    for (const pair of body.split("&")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      fn(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)));
    }
  }
}
