# Thoth — Build Plan

> **Status:** Phases 0–3 implemented. The extension is named **Thoth** (formerly
> httpRequestSniffer; the internal IndexedDB name is unchanged for continuity).

A Chrome extension that **records a browsing session** (HTTP requests/responses + page HTML),
then produces a **replayable, human-readable report** of the backend API calls — so you can
reproduce those calls outside the browser (curl, Julia/HTTP.jl, Python, etc.).

Primary use case: reverse-engineering the API traffic behind apps like AiM to script them directly.

---

## Design decisions (locked)

| Area | Decision | Why / caveat |
|------|----------|--------------|
| **Capture** | `chrome.debugger` (Chrome DevTools Protocol) | Only reliable way to get **response bodies** in MV3, which we need for token provenance. Accept the "extension is debugging this browser" banner while recording. Can't record a tab that already has DevTools open. |
| **LLM** | Pluggable; on-device (Prompt API / Gemini Nano) by default, optional remote (Claude) | **The core report works with NO LLM.** LLM only writes the English narrative on top of an already-accurate structured spec. |
| **Auth analysis** | Deterministic **provenance tracing** | Report *where each token came from and who used it* by string-matching captured data. We do **not** guess how tokens are cryptographically minted (unknowable client-side, and where a small model hallucinates). |
| **Scope** | Fully general-purpose | No site-specific heuristics. Works the same on any site. |
| **HTML** | Captured, used **only** for provenance search | Its one real job: catch tokens that originate in the page (`<meta name="csrf-token">`, inline bootstrap `<script>`). Never fed to the LLM. |
| **Headers** | Reported as **used/leveraged**, classified into buckets | We never claim a header is "required" — passive observation can't prove that. We classify: auth / content / cookie / custom `X-*` / browser-boilerplate. |
| **Output store** | Canonical in **IndexedDB** | Source of truth. Lets us regenerate reports (e.g. re-run with remote LLM) without re-recording. |
| **Viewing** | Popup = launcher; Dashboard tab = list; Viewer tab renders Markdown→HTML | A `.md` file doesn't render in a browser tab, and the popup is too small/closes on blur — so we render in our own extension pages. |
| **Export to disk** | `chrome.downloads` → `Downloads/Thoth/<session>/` + "Show in folder" | MVP default (chosen while user was away). Folder-picker (File System Access API) is a later enhancement. Exported files contain **live tokens** → warn the user. |

---

## Architecture

```
Manifest V3 extension
├── background (service worker)   orchestrates recording; attaches CDP; buffers; persists
├── popup                         Record / Stop / status / "Open Dashboard"
├── dashboard (extension tab)     session list, open/export/delete, settings (LLM/API key)
├── viewer (extension tab)        renders one report (Markdown→HTML) + copy-curl buttons
├── engine/ (pure JS, testable)
│   ├── filter.js                 API-call vs static-asset classification
│   ├── secrets.js                detect candidate secrets (Authorization, bearer, JWT, Set-Cookie, X-CSRF, token-ish query params)
│   ├── provenance.js             correlate each secret value → first appearance + all consumers
│   ├── headers.js                bucket classification (+ boilerplate denylist)
│   ├── spec.js                   per-call replayable spec + curl generator
│   └── report.js                 assemble report object; render to Markdown
├── llm/
│   ├── provider.js               interface + selection
│   ├── local.js                  Chrome Prompt API; feeds only the compact structured summary (token-budget aware)
│   └── remote.js                 Claude API over fetch; only REDACTED data; user-provided key
├── storage.js                    IndexedDB wrapper (raw sessions + generated reports)
└── vendor/markdown.js            bundled/inlined Markdown renderer (no CDN — CSP)
```

### Data model
- **Session**: `{ id, startedAt, url, title, entries[], htmlSnapshots[] }`
- **Entry**: `{ requestId, method, url, requestHeaders, requestBody, status, responseHeaders, responseBody, mimeType, type, initiator, timing }`
- **Report**: `{ sessionId, generatedAt, provider, calls[], auth[], markdown }`

### CDP capture notes (the fiddly bits)
- Attach `chrome.debugger.attach({tabId}, "1.3")`; enable `Network` + `Page`.
- Events: `Network.requestWillBeSent` (+ `...ExtraInfo` for the real on-the-wire headers incl. cookies/auth), `responseReceived`, `loadingFinished` → then `Network.getResponseBody`.
- Fetch response bodies on `loadingFinished` (before eviction). Large request bodies: `Network.getRequestPostData`.
- HTML snapshots: main-document response body and/or `Runtime.evaluate("document.documentElement.outerHTML")` at action points.
- Handle `onDetach` (user cancels the banner / closes tab) → stop cleanly, persist what we have.
- Binary/base64 bodies: skip or mark, don't try to analyze.

### Provenance output — honest edge case
If a token's value appears in **no** prior response body, `Set-Cookie`, or HTML, the report says:
> *origin not observed — likely computed client-side or set before recording began*

…rather than inventing a source.

---

## Phased delivery

**Phase 0 — Scaffold & raw capture**
Manifest, popup launcher, background SW, IndexedDB, debugger attach/detach, buffer requests+responses+HTML to storage, dashboard lists raw sessions.
*Done when:* you can Record → act → Stop and see the raw captured requests listed. No analysis, no LLM.

**Phase 1 — Deterministic engine (the real value)**
filter → secret detection → provenance → header buckets → per-call spec + curl → **replayability rating (point F)** → Markdown/HTML report → viewer renders it.
Each call gets a traffic-light rating: 🟢 **static** (no secrets consumed — copy the curl and run it) / 🟡 **session-bound** (consumes a cookie/token whose origin we *did* observe — reproducible but expires) / 🔴 **blocked** (consumes a token whose origin was *not* observed — can't reproduce the input from captured data). The rating is derived deterministically from the provenance graph, and its reasons are shown inline on each call so expectations are set in the output, not in a caveat.
*Done when:* you get a complete, accurate report (incl. token provenance, per-call replayability rating, and copyable curl) with **zero LLM involved**.

**Phase 2 — On-device narrative**
Prompt API provider; feed only the compact structured summary; prepend an English narrative to the report. Feature-detect; degrade gracefully if the model is unavailable.

**Phase 3 — Pluggable remote LLM**
Settings UI, API-key storage, **redaction pass** (strip token values → placeholders) before send, Claude provider, "Regenerate report with remote model" action.

**Phase 4 — Backlog / optional**
- ✅ **Export templates: Python `requests`, Julia `HTTP.jl`, raw `.http`** — done (per-call copy buttons in the viewer; `engine/codegen.js`).
- Header **minimize-via-replay** (opt-in; re-fires live requests → idempotency warning; safe for GET, dangerous for state-changing POST).
- Folder-picker export (File System Access API).
- HAR import (process a DevTools-exported HAR with no live capture).

---

## Known risks
- **Prompt API is experimental** (Chrome version/hardware/model-download gated). Core must work without it.
- **Response-body timing/eviction** and large/binary bodies need careful handling.
- **Debugger banner** + single-attach limitation; no recording if DevTools already attached.
- **Secrets on disk**: exported files contain live tokens; Downloads may sync to cloud → warn.
