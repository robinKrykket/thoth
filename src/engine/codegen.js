// codegen.js
// ---------------------------------------------------------------------------
// Generates replayable request snippets for a captured entry, in the formats
// most useful for reproducing the call outside the browser:
//   - curl        (delegated to spec.js — the universal one)
//   - Python      requests
//   - Julia       HTTP.jl   (matches the in-house AiMToolkit stack)
//   - .http       REST Client / IntelliJ HTTP file
//
// All formats use the same shared header set (headers.js → replayHeaders), so
// they stay consistent with the curl output and with each other.
// ---------------------------------------------------------------------------

import { replayHeaders } from "./headers.js";
import { toCurl } from "./spec.js";

/** All snippet formats for one entry, keyed by format name. */
export function buildSnippets(entry) {
  return {
    curl: toCurl(entry),
    python: toPython(entry),
    julia: toJulia(entry),
    http: toHttpFile(entry),
  };
}

// --- Python (requests) -----------------------------------------------------
// JSON string literals are valid Python str literals (same escapes: \n, \", \\,
// \uXXXX), so JSON.stringify gives us safe quoting for free.
function pyStr(s) {
  return JSON.stringify(String(s));
}

function toPython(entry) {
  const headers = replayHeaders(entry);
  const lines = ["import requests", "", "resp = requests.request("];
  lines.push(`    ${pyStr(entry.method || "GET")},`);
  lines.push(`    ${pyStr(entry.url)},`);
  if (headers.length) {
    lines.push("    headers={");
    for (const { name, value } of headers) lines.push(`        ${pyStr(name)}: ${pyStr(value)},`);
    lines.push("    },");
  }
  if (entry.postData) lines.push(`    data=${pyStr(entry.postData)},`);
  lines.push(")");
  lines.push("print(resp.status_code)");
  lines.push("print(resp.text)");
  return lines.join("\n");
}

// --- Julia (HTTP.jl) -------------------------------------------------------
// Julia strings interpolate `$`, so it must be escaped on top of JSON escaping.
function jlStr(s) {
  return JSON.stringify(String(s)).replace(/\$/g, "\\$");
}

function toJulia(entry) {
  const headers = replayHeaders(entry);
  const lines = ["using HTTP", "", "resp = HTTP.request("];
  lines.push(`    ${jlStr(entry.method || "GET")},`);
  lines.push(`    ${jlStr(entry.url)},`);
  // HTTP.request(method, url, headers, body): a body needs a headers arg before
  // it, so emit an empty vector when there are no headers but there is a body.
  if (headers.length) {
    lines.push("    [");
    for (const { name, value } of headers) lines.push(`        ${jlStr(name)} => ${jlStr(value)},`);
    lines.push("    ],");
  } else if (entry.postData) {
    lines.push("    [],");
  }
  if (entry.postData) lines.push(`    ${jlStr(entry.postData)},`);
  lines.push(")");
  lines.push("println(HTTP.status(resp))");
  lines.push("println(String(resp.body))");
  return lines.join("\n");
}

// --- .http file (REST Client / IntelliJ) -----------------------------------
// Raw wire-ish format; no escaping needed.
function toHttpFile(entry) {
  const lines = [`${entry.method || "GET"} ${entry.url}`];
  for (const { name, value } of replayHeaders(entry)) lines.push(`${name}: ${value}`);
  if (entry.postData) {
    lines.push("");
    lines.push(entry.postData);
  }
  return lines.join("\n");
}
