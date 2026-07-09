// spec.js
// ---------------------------------------------------------------------------
// Turns a captured entry into a copy-paste `curl` command so you can replay the
// call outside the browser. curl is the universal lingua franca — trivially
// convertible to Julia/HTTP.jl, Python requests, or fetch().
//
// We include the headers that actually shape the call (auth / cookie / content
// / custom) and drop pure browser boilerplate, so the command is readable
// rather than a wall of sec-ch-ua noise. curl sets Host/Content-Length itself.
// ---------------------------------------------------------------------------

import { replayHeaders } from "./headers.js";

/** Build a multi-line curl command string for an entry. */
export function toCurl(entry) {
  const lines = [`curl -X ${entry.method || "GET"} ${shq(entry.url)}`];

  for (const { name, value } of replayHeaders(entry)) {
    lines.push(`  -H ${shq(`${name}: ${value}`)}`);
  }

  if (entry.postData) {
    lines.push(`  --data-raw ${shq(entry.postData)}`);
  }

  return lines.join(" \\\n");
}

/**
 * Single-quote a string for POSIX shells. Inside single quotes nothing is
 * special except a single quote itself, which we escape as: '\''
 */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
