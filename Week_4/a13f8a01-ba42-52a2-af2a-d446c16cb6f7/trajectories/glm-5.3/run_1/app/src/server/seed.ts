// Seed data: the one verified starter account, its four public starter pens
// (whose files ship with the app), and the shelf mirror. Everything here is
// idempotent: it runs on every serve and only fills what is missing.
import { readFileSync, existsSync } from "node:fs";
import type { App } from "./server.js";
import { canonicalHash, snapshotJson } from "../shared/snapshot.js";
import { diffPanes, changedChars } from "../shared/diff.js";
import { SHELF } from "../shared/shelf.js";
import { createHash } from "node:crypto";

export const STARTER_HANDLE = "coldframe";
const STARTER_EMAIL = "starters@coldframe.test";

export interface Starter {
  key: string;
  title: string;
  tags: string[];
  dir: string;
}

export const STARTERS: Starter[] = [
  { key: "starter-courses", title: "Dressed courses", tags: ["starter", "canvas"], dir: "courses" },
  { key: "starter-grid", title: "Grid study", tags: ["starter", "css-grid"], dir: "grid" },
  { key: "starter-type", title: "Type specimen", tags: ["starter", "type"], dir: "type" },
  { key: "starter-physics", title: "Small physics toy", tags: ["starter", "physics"], dir: "physics" },
];

export function starterFiles(dir: string): { html: string; css: string; js: string } {
  const read = (name: string) => {
    const p = new URL(`./starters/${dir}/${name}`, import.meta.url).pathname;
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };
  return { html: read("index.html"), css: read("style.css"), js: read("script.js") };
}

export function shelfMeta(): Map<string, { bytes: number; sha256: string }> {
  const out = new Map<string, { bytes: number; sha256: string }>();
  for (const entry of SHELF) {
    const p = new URL(`../shelf/${entry.file}`, import.meta.url).pathname;
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    out.set(entry.id, { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") });
  }
  return out;
}

export async function seedAppData(app: App): Promise<void> {
  const existing = (await app.db.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [STARTER_HANDLE]))[0];
  let userId = existing?.id;
  if (!userId) {
    userId = newId();
    await app.db.query(
      "INSERT INTO users (id, handle, email, email_lower, password_hash, verified) VALUES ($1, $2, $3, $4, $5, TRUE)",
      [userId, STARTER_HANDLE, STARTER_EMAIL, STARTER_EMAIL.toLowerCase(), `seed:${newId()}`],
    );
  }
  for (const starter of STARTERS) {
    const pen = (await app.db.query<{ id: string; head: number }>("SELECT id, head FROM pens WHERE id = $1", [starter.key]))[0];
    if (pen && pen.head >= 1) continue;
    const files = starterFiles(starter.dir);
    const libraries = starter.dir === "physics" ? ["matter-js@0.20.0"] : [];
    const sha = canonicalHash(files, libraries);
    await app.db.query(
      "INSERT INTO pens (id, owner_id, title, visibility, head) VALUES ($1, $2, $3, 'public', 0) ON CONFLICT (id) DO NOTHING",
      [starter.key, userId, starter.title],
    );
    let pos = 0;
    for (const tag of starter.tags) {
      await app.db.query("INSERT INTO tags (pen_id, tag, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [starter.key, tag, pos]);
      pos++;
    }
    const d = diffPanes({ html: "", css: "", js: "" }, files);
    const chars = changedChars(d.panes);
    await app.db.query(
      `INSERT INTO versions (pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars)
       VALUES ($1, 1, now(), $2, $3, $4, $5, $6, NULL, $7, $8, $9) ON CONFLICT DO NOTHING`,
      [starter.key, sha, files.html, files.css, files.js, libraries, d.added, d.removed, chars],
    );
    await app.db.query("UPDATE pens SET head = 1 WHERE id = $1 AND head < 1", [starter.key]);
    // The version snapshot is written once storage is reachable.
    void writeStarterSnapshot(app, starter.key, 1, files, libraries);
  }
}

async function writeStarterSnapshot(app: App, penId: string, number: number, files: { html: string; css: string; js: string }, libraries: string[]): Promise<void> {
  const key = `pens/${penId}/versions/${number}.json`;
  try {
    if ((await app.storage.head(key)) !== null) return;
    const snap = snapshotJson({ pen_id: penId, number, files, libraries });
    await app.storage.put(key, Buffer.from(snap, "utf8"), "application/json");
  } catch {
    // retried by the next ping that finds storage up
    app.retryingSnapshots.push({ penId, number, files, libraries });
  }
}

function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}
