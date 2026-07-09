// provenance.js
// ---------------------------------------------------------------------------
// For each consumed secret (from secrets.js), find where its value FIRST
// appeared as a *source* we could obtain it from:
//
//   - a response body            (e.g. a login/token endpoint returned it)
//   - a Set-Cookie response header
//   - a captured HTML snapshot   (e.g. <meta name="csrf-token"> or inline JS)
//
// This is pure, deterministic string matching — the trustworthy core of the
// tool. If a value appears in none of those, its origin is `null`, and we say
// so honestly ("origin not observed") rather than inventing one.
//
// We also try a couple of cheap value transforms (URL-decoding, Bearer-prefix
// stripping) so a token that's passed through verbatim-but-encoded still
// matches. We do NOT attempt to reverse hashes/signatures — that's the
// documented limitation.
// ---------------------------------------------------------------------------

/**
 * @param secrets  output of extractConsumedSecrets()
 * @param entries  session.entries (sorted by order)
 * @param snapshots session.htmlSnapshots
 * @returns array of provenance records:
 *   { value, kind, name, consumers, origin }
 *   origin = null | { where, entryOrder, method, url }
 *   where  = "response-body" | "set-cookie" | "page-html"
 */
export function buildProvenance(secrets, entries, snapshots = []) {
  return secrets.map((s) => ({
    ...s,
    origin: findOrigin(s.value, entries, snapshots),
  }));
}

function findOrigin(value, entries, snapshots) {
  // Candidate string forms of the same secret that might appear in a source.
  const needles = valueVariants(value);

  let best = null; // lowest entryOrder wins ("first seen")

  for (const e of entries) {
    // A response body that contains the value is the strongest origin signal.
    if (e.responseBody && containsAny(e.responseBody, needles)) {
      best = keepEarliest(best, {
        where: "response-body",
        entryOrder: e.order,
        method: e.method,
        url: e.url,
      });
    }

    // A Set-Cookie header that sets the value.
    const setCookie = getSetCookie(e);
    if (setCookie && containsAny(setCookie, needles)) {
      best = keepEarliest(best, {
        where: "set-cookie",
        entryOrder: e.order,
        method: e.method,
        url: e.url,
      });
    }
  }

  // HTML snapshots are captured at stop time, so they sort after network
  // entries — only used when nothing better was found.
  if (!best) {
    for (const snap of snapshots) {
      if (snap.html && containsAny(snap.html, needles)) {
        best = { where: "page-html", entryOrder: Infinity, url: snap.url };
        break;
      }
    }
  }

  return best;
}

function keepEarliest(current, candidate) {
  if (!current || candidate.entryOrder < current.entryOrder) return candidate;
  return current;
}

/** Cheap value variants so verbatim-but-encoded tokens still match. */
function valueVariants(value) {
  const set = new Set([value]);
  try {
    set.add(decodeURIComponent(value));
  } catch (_) {
    /* value wasn't valid percent-encoding */
  }
  set.add(encodeURIComponent(value));
  return [...set].filter((v) => v && v.length >= 8);
}

function containsAny(haystack, needles) {
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}

/** Pull the Set-Cookie value out of either header set (names vary in case). */
function getSetCookie(entry) {
  const sources = [entry.responseHeadersExtra, entry.responseHeaders];
  for (const h of sources) {
    if (!h) continue;
    for (const [name, value] of Object.entries(h)) {
      if (name.toLowerCase() === "set-cookie") return String(value);
    }
  }
  return null;
}
