// report.js
// ---------------------------------------------------------------------------
// Assembles the analysis modules into one structured report object, then
// renders it two ways:
//   - buildReport()     -> the canonical structured object (also handed to the
//                          LLM layer later, and to the exporter)
//   - renderMarkdown()  -> portable .md for export / pasting into a ticket
//   - renderHtml()      -> rich view for the in-extension viewer page
//
// The structured object is the source of truth; both renderers are pure
// projections of it, so there's no separate "markdown parser" to maintain.
// ---------------------------------------------------------------------------

import { apiCalls } from "./filter.js";
import { classifyHeaders, mergedRequestHeaders } from "./headers.js";
import { extractConsumedSecrets } from "./secrets.js";
import { buildProvenance } from "./provenance.js";
import { buildSnippets } from "./codegen.js";
import { rateReplayability } from "./replay.js";

const LEVEL_EMOJI = { green: "🟢", amber: "🟡", red: "🔴" };

// ===========================================================================
// Build
// ===========================================================================

export function buildReport(session) {
  const entries = session.entries || [];

  // 1. Detect secrets the requests consume, 2. trace each to an origin.
  const secrets = extractConsumedSecrets(entries);
  const provenance = buildProvenance(secrets, entries, session.htmlSnapshots);

  // 3. Build one record per API call, incl. its replayability rating (point F).
  const calls = apiCalls(entries).map((e) => {
    const snippets = buildSnippets(e);
    return {
      order: e.order,
      method: e.method || "GET",
      url: e.url,
      status: e.status ?? null,
      mimeType: e.mimeType || "",
      headers: classifyHeaders(mergedRequestHeaders(e)),
      requestBody: e.postData || null,
      responseBodyPreview: preview(e.responseBody, e.responseBodyOmitted),
      curl: snippets.curl, // kept for the markdown export
      snippets, // { curl, python, julia, http } — used by the viewer's copy buttons
      replayability: rateReplayability(e, provenance),
    };
  });

  // 4. Auth section: every traced secret with its provenance.
  const auth = provenance.map((p) => ({
    name: p.name,
    kind: p.kind,
    value: p.value,
    masked: mask(p.value),
    origin: p.origin,
    consumerCount: p.consumers.length,
  }));

  const summary = { green: 0, amber: 0, red: 0 };
  for (const c of calls) summary[c.replayability.level]++;

  return {
    meta: {
      id: session.id,
      startedAt: session.startedAt,
      generatedAt: Date.now(),
      url: session.url,
      title: session.title,
      totalEntries: entries.length,
      apiCallCount: calls.length,
    },
    summary,
    auth,
    calls,
  };
}

function preview(body, omitted) {
  if (omitted) return `[body omitted: ${omitted}]`;
  if (!body) return "";
  const max = 1500;
  return body.length > max ? body.slice(0, max) + "\n… (truncated)" : body;
}

/** first 4 … last 4 for long secrets; short ones shown whole. */
function mask(value) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// ===========================================================================
// Markdown renderer
// ===========================================================================

export function renderMarkdown(report, narrative) {
  const { meta, summary, auth, calls } = report;
  const out = [];

  out.push(`# API session report`);
  out.push("");
  out.push(`- **Page:** ${meta.title || "(untitled)"} — ${meta.url}`);
  out.push(`- **Recorded:** ${new Date(meta.startedAt).toLocaleString()}`);
  out.push(`- **Captured:** ${meta.totalEntries} requests, ${meta.apiCallCount} API calls`);
  out.push(
    `- **Replayability:** 🟢 ${summary.green} static · 🟡 ${summary.amber} session-bound · 🔴 ${summary.red} blocked`
  );
  out.push("");

  // --- AI-generated overview (optional) ---
  if (narrative) {
    out.push(`## Summary (on-device AI)`);
    out.push("");
    out.push(`> Generated locally from the facts below — verify before relying on it.`);
    out.push("");
    out.push(narrative);
    out.push("");
  }

  // --- Auth / tokens ---
  out.push(`## Authentication & tokens`);
  out.push("");
  if (auth.length === 0) {
    out.push(`_No auth tokens, cookies, or token-like values were observed._`);
  } else {
    out.push(`> ⚠️ Values below are **live secrets** captured from your session.`);
    out.push("");
    for (const a of auth) {
      out.push(`### ${a.name}  (\`${a.kind}\`)`);
      out.push(`- **Value:** \`${a.value}\``);
      out.push(`- **Origin:** ${originMd(a.origin)}`);
      out.push(`- **Used by:** ${a.consumerCount} request(s)`);
      out.push("");
    }
  }

  // --- Calls ---
  out.push(`## API calls`);
  out.push("");
  calls.forEach((c, i) => {
    out.push(`### ${i + 1}. ${c.method} ${c.url}`);
    out.push(
      `${LEVEL_EMOJI[c.replayability.level]} **${c.replayability.label}**` +
        (c.status != null ? ` · HTTP ${c.status}` : "")
    );
    for (const r of c.replayability.reasons) out.push(`- ${r}`);
    out.push("");

    const shown = c.headers.filter((h) => h.bucket !== "boilerplate");
    if (shown.length) {
      out.push(`**Headers used:**`);
      for (const h of shown) out.push(`- \`${h.name}: ${h.value}\`  _(${h.bucket})_`);
      out.push("");
    }

    if (c.requestBody) {
      out.push(`**Request body:**`);
      out.push("```");
      out.push(c.requestBody);
      out.push("```");
      out.push("");
    }

    out.push(`**Replay with curl:**`);
    out.push("```bash");
    out.push(c.curl);
    out.push("```");
    out.push("");
  });

  return out.join("\n");
}

function originMd(origin) {
  if (!origin) return "**not observed** — set before recording, or computed client-side.";
  if (origin.where === "page-html") return `page HTML (${origin.url})`;
  const label = origin.where === "set-cookie" ? "Set-Cookie on" : "response to";
  return `${label} \`${origin.method || ""} ${origin.url}\``.trim();
}

// ===========================================================================
// HTML renderer (for the viewer page)
// ===========================================================================

export function renderHtml(report, narrative) {
  const { meta, summary, auth, calls } = report;

  const authHtml = auth.length
    ? auth
        .map(
          (a) => `
      <div class="auth-item">
        <div class="auth-head"><span class="kind kind-${esc(a.kind)}">${esc(a.kind)}</span> ${esc(a.name)}</div>
        <div class="auth-row"><span class="k">Value</span><code class="secret">${esc(a.value)}</code></div>
        <div class="auth-row"><span class="k">Origin</span><span>${originHtml(a.origin)}</span></div>
        <div class="auth-row"><span class="k">Used by</span><span>${a.consumerCount} request(s)</span></div>
      </div>`
        )
        .join("")
    : `<p class="muted">No auth tokens, cookies, or token-like values were observed.</p>`;

  const callsHtml = calls
    .map(
      (c, i) => `
    <section class="call">
      <div class="call-head">
        <span class="badge badge-${c.replayability.level}">${LEVEL_EMOJI[c.replayability.level]} ${esc(
        c.replayability.label
      )}</span>
        <span class="method">${esc(c.method)}</span>
        <span class="url">${esc(c.url)}</span>
        ${c.status != null ? `<span class="status">HTTP ${c.status}</span>` : ""}
      </div>
      <ul class="reasons">${c.replayability.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${headersHtml(c.headers)}
      ${c.requestBody ? `<div class="sub">Request body</div><pre class="body">${esc(c.requestBody)}</pre>` : ""}
      <div class="curl-head">
        <span class="sub">Replay</span>
        <span class="copy-group">
          <button class="copy-btn" data-call-index="${i}" data-format="curl">Copy curl</button>
          <button class="copy-btn" data-call-index="${i}" data-format="python">Python</button>
          <button class="copy-btn" data-call-index="${i}" data-format="julia">Julia</button>
          <button class="copy-btn" data-call-index="${i}" data-format="http">.http</button>
        </span>
      </div>
      <pre class="curl">${esc(c.snippets.curl)}</pre>
    </section>`
    )
    .join("");

  return `
    <header class="report-head">
      <h1>${esc(meta.title || "API session report")}</h1>
      <p class="muted">${esc(meta.url)}</p>
      <p class="muted">Recorded ${new Date(meta.startedAt).toLocaleString()} ·
        ${meta.totalEntries} requests · ${meta.apiCallCount} API calls</p>
      <div class="tally">
        <span class="badge badge-green">🟢 ${summary.green} static</span>
        <span class="badge badge-amber">🟡 ${summary.amber} session-bound</span>
        <span class="badge badge-red">🔴 ${summary.red} blocked</span>
      </div>
    </header>

    ${
      narrative
        ? `<section class="narrative">
             <div class="narrative-tag">🤖 On-device AI summary — verify against the facts below</div>
             ${narrativeHtml(narrative)}
           </section>`
        : ""
    }

    <h2>Authentication &amp; tokens</h2>
    ${auth.length ? `<p class="warn">⚠️ Values below are live secrets captured from your session.</p>` : ""}
    ${authHtml}

    <h2>API calls</h2>
    ${callsHtml || `<p class="muted">No API calls were captured.</p>`}
  `;
}

function headersHtml(headers) {
  const shown = headers.filter((h) => h.bucket !== "boilerplate");
  if (!shown.length) return "";
  const rows = shown
    .map(
      (h) =>
        `<tr><td class="hname">${esc(h.name)}</td><td class="hval">${esc(h.value)}</td>` +
        `<td><span class="bucket bucket-${esc(h.bucket)}">${esc(h.bucket)}</span></td></tr>`
    )
    .join("");
  return `<div class="sub">Headers used</div><table class="headers"><tbody>${rows}</tbody></table>`;
}

function originHtml(origin) {
  if (!origin)
    return `<em>not observed</em> — set before recording, or computed client-side.`;
  if (origin.where === "page-html") return `page HTML (${esc(origin.url)})`;
  const label = origin.where === "set-cookie" ? "Set-Cookie on" : "response to";
  return `${label} <code>${esc((origin.method || "") + " " + origin.url)}</code>`;
}

/** Render the AI narrative as escaped paragraphs (double newline = new <p>). */
function narrativeHtml(text) {
  return String(text)
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Escape text for safe insertion into HTML. */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
