// filter.js
// ---------------------------------------------------------------------------
// Classifies captured entries. Guiding principle: NEVER silently hide a real
// request. Chrome's CDP resource-type label is unreliable — data requests are
// frequently reported as "Other" (or with no type at all) — so we don't gate
// on it alone. The report shows a broad "API calls" set PLUS a complete list of
// everything else, so even when the type label is wrong, nothing disappears.
// ---------------------------------------------------------------------------

// CDP resource types that are always static assets (never API calls).
const ASSET_TYPES = new Set([
  "image",
  "stylesheet",
  "font",
  "media",
  "script",
  "manifest",
  "texttrack",
  "cspviolationreport",
  "preflight",
  "signedexchange",
  "ping",
]);

// URL extensions that mark a static asset regardless of the (unreliable) type.
const ASSET_EXT =
  /\.(?:js|mjs|cjs|css|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|m4s|webm|mp3|wav|ogg|map)(?:$|\?|#)/i;

// Response MIME types that indicate a data/API payload.
const DATA_MIME = /(?:json|xml|javascript|x-www-form-urlencoded|text\/plain|grpc|protobuf|graphql)/i;

export function resourceType(entry) {
  return String(entry.type || "").toLowerCase();
}

/** A static asset (image/script/style/font/media…), by CDP type OR URL extension. */
export function isAsset(entry) {
  if (ASSET_TYPES.has(resourceType(entry))) return true;
  try {
    if (ASSET_EXT.test(new URL(entry.url).pathname)) return true;
  } catch (_) {
    /* unparseable URL — fall through */
  }
  return false;
}

/**
 * Is this a backend API call worth featuring? Deliberately inclusive:
 *   - XHR / fetch / eventsource / websocket           → yes
 *   - any non-GET that isn't a static asset           → yes (form posts, GraphQL…)
 *   - a GET that returns data, or is neither a static  → yes
 *     asset nor a top-level page navigation
 * Static assets and document navigations are excluded here — but they still
 * appear in the report's full request list, so they're never lost.
 */
export function isApiCall(entry) {
  const t = resourceType(entry);
  if (t === "xhr" || t === "fetch" || t === "eventsource" || t === "websocket") return true;

  const method = String(entry.method || "GET").toUpperCase();
  if (method !== "GET") return !isAsset(entry);

  if (isAsset(entry)) return false;
  if (t === "document") return false; // top-level navigation, not an API call
  if (DATA_MIME.test(entry.mimeType || "")) return true;
  // A GET that is neither an asset nor a navigation — show it rather than hide it.
  return true;
}

/** All API calls in a session, in capture order. */
export function apiCalls(entries) {
  return entries.filter(isApiCall);
}

/** Count entries by CDP resource type — a quick diagnostic of what was captured. */
export function typeBreakdown(entries) {
  const counts = {};
  for (const e of entries) {
    const label = e.type || "Other";
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}
