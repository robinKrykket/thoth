// filter.js
// ---------------------------------------------------------------------------
// Classifies captured entries so the report can focus on the backend API calls
// and drop the static-asset noise (images, fonts, css, script files).
//
// CDP tags each request with a resource `type` — "XHR", "Fetch", "Document",
// "Image", "Stylesheet", "Font", "Script", "Media", etc. We lean on that, with
// a couple of sensible fallbacks.
// ---------------------------------------------------------------------------

const ASSET_TYPES = new Set([
  "image",
  "stylesheet",
  "font",
  "media",
  "script",
  "manifest",
  "texttrack",
  "ping",
]);

/** Is this an API-style call worth putting in the report? */
export function isApiCall(entry) {
  const type = (entry.type || "").toLowerCase();

  // The obvious ones: XHR and fetch().
  if (type === "xhr" || type === "fetch") return true;

  // A non-GET navigation is usually a real form submit worth capturing.
  if (entry.method && entry.method !== "GET" && type === "document") return true;

  // JSON responses are almost always API traffic even if mistyped as "Other".
  if (type === "other" && /json/i.test(entry.mimeType || "")) return true;

  return false;
}

/** Is this a static asset we should ignore for analysis? */
export function isAsset(entry) {
  const type = (entry.type || "").toLowerCase();
  return ASSET_TYPES.has(type) && !isApiCall(entry);
}

/** All API calls in a session, in capture order. */
export function apiCalls(entries) {
  return entries.filter(isApiCall);
}
