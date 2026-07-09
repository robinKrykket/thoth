// exporter.js
// ---------------------------------------------------------------------------
// Writes a report to disk via chrome.downloads. Files land in
//   <Downloads>/Thoth/<timestamp-title>/
// as report.md (the human report) + session.json (raw data + structured report,
// so a session can be re-analyzed later).
//
// Note: blob URLs can only be created in a document context (not the service
// worker), which is fine — export is always triggered from the dashboard or
// viewer page. Exported files contain LIVE tokens; the UI warns about that.
// ---------------------------------------------------------------------------

import { renderMarkdown } from "../engine/report.js";

/**
 * Export a session + its report. Returns the downloadId of the .md file so the
 * caller can offer a "Show in folder" button.
 */
export async function exportReport(session, report) {
  const folder = `Thoth/${folderName(session)}`;
  // Include the cached AI narrative in the export if one was generated.
  const markdown = renderMarkdown(report, session.narrative);
  const raw = JSON.stringify({ session, report }, null, 2);

  const mdId = await downloadText(markdown, `${folder}/report.md`, "text/markdown");
  await downloadText(raw, `${folder}/session.json`, "application/json");
  return mdId;
}

/** Reveal a downloaded file in the OS file manager. */
export function showInFolder(downloadId) {
  chrome.downloads.show(downloadId);
}

function downloadText(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  return chrome.downloads.download({ url, filename, saveAs: false }).then((id) => {
    // Give the download time to start, then release the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return id;
  });
}

/** e.g. "2026-07-09T14-32-05_my-app-dashboard" */
function folderName(session) {
  const stamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, "-");
  const slug = (session.title || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${stamp}_${slug || "session"}`;
}
