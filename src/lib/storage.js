// storage.js
// ---------------------------------------------------------------------------
// IndexedDB wrapper. This is the CANONICAL store for recorded sessions.
//
// A "session" record holds the raw captured data (requests, responses, HTML
// snapshots). Reports are *derived* from a session on demand (see engine/), so
// we never have to re-record just to regenerate a report with, say, a better
// LLM. We do cache the last-generated report back onto the session record for
// speed, but it can always be thrown away and rebuilt.
//
// This module is imported by BOTH the background service worker and the
// extension pages (dashboard/viewer). IndexedDB is available in all of those
// contexts, so one shared module keeps the schema in exactly one place.
// ---------------------------------------------------------------------------

// Kept as the original name on purpose: renaming the DB would orphan any
// sessions recorded before the rename to "Thoth". This id is never user-visible.
const DB_NAME = "httpRequestSniffer";
const DB_VERSION = 1;
const STORE = "sessions";

/** Open (and if needed, create) the database. Returns a Promise<IDBDatabase>. */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath "id" — every session carries its own uuid.
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Small helper: wrap an IDBRequest in a Promise. */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Insert or replace a full session record. */
export async function saveSession(session) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(session);
  await promisify(tx);
  db.close();
  return session.id;
}

/** Fetch one full session (with all its heavy body data) by id. */
export async function getSession(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const result = await promisify(tx.objectStore(STORE).get(id));
  db.close();
  return result || null;
}

/**
 * List sessions as lightweight metadata only (no bodies), newest first.
 * IndexedDB hands back whole records, so we read them and project down to the
 * fields the dashboard needs — fine at the scale of a personal tool.
 */
export async function listSessions() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const all = await promisify(tx.objectStore(STORE).getAll());
  db.close();
  return all
    .map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      url: s.url,
      title: s.title,
      entryCount: (s.entries || []).length,
    }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** Delete a session permanently. */
export async function deleteSession(id) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await promisify(tx);
  db.close();
}
