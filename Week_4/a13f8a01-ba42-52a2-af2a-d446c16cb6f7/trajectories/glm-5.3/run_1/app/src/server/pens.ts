import type { PoolClient } from "pg";
import type { ApiCtx } from "./api.js";
import { sendJson, send404 } from "./http.js";
import { errorBody, validationBody, conflictBody } from "../shared/errors.js";
import { canonicalHash, snapshotJson, type Panes } from "../shared/snapshot.js";
import { diffPanes, changedChars } from "../shared/diff.js";
import { findShelf } from "../shared/shelf.js";
import { newToken } from "./auth.js";
import {
  getPen, getVisiblePen, getVersionRow, countLikes, countForks, penTags, forkedFromFor, newId, isoTime,
  canSee, type PenRow, type VersionRow,
} from "./domain.js";
import { HttpError, requireUser, requireVerified, versionJson } from "./api.js";

export async function listPens(ctx: ApiCtx): Promise<void> {
  const user = requireUser(ctx);
  const rows = await ctx.app.db.withClient(async (client) => {
    const res = await client.query<PenRow>(
      "SELECT * FROM pens WHERE owner_id = $1 ORDER BY updated_at DESC, id",
      [user.id],
    );
    return Promise.all(res.rows.map(async (pen) => (await import("./api.js")).penSummaryJson(client, pen)));
  });
  sendJson(ctx.res, 200, { pens: rows });
}

export async function createPen(ctx: ApiCtx): Promise<void> {
  const user = requireUser(ctx);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  let title = typeof b.title === "string" ? b.title : undefined;
  if (title !== undefined && (title.length < 1 || title.length > 80)) {
    throw new HttpError(422, validationBody({ title: "Give the pen a title of 1 to 80 characters." }));
  }
  const id = newId();
  await ctx.app.db.query(
    "INSERT INTO pens (id, owner_id, title, visibility, head) VALUES ($1, $2, $3, 'private', 0)",
    [id, user.id, title ?? "Untitled pen"],
  );
  const pen = await ctx.app.db.withClient(async (client) => {
    const p = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [id])).rows[0]!;
    return (await import("./api.js")).penJson(ctx.app, client, p, user.id);
  });
  sendJson(ctx.res, 201, pen);
}

export async function getPenRoute(ctx: ApiCtx, penId: string): Promise<void> {
  const viewer = ctx.user;
  const data = await ctx.app.db.withClient(async (client) => {
    const pen = await getVisiblePen(client, penId, viewer?.id ?? null);
    if (!pen) return null;
    return (await import("./api.js")).penJson(ctx.app, client, pen, viewer?.id ?? null);
  });
  if (!data) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 200, data);
}

export async function patchPen(ctx: ApiCtx, penId: string): Promise<void> {
  const user = requireUser(ctx);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const data = await ctx.app.db.withClient(async (client) => {
    const pen = await getPen(client, penId);
    if (!pen) return { notFound: true } as const;
    if (pen.owner_id !== user.id) {
      return { forbidden: true } as const;
    }
    const updates: string[] = [];
    const params: unknown[] = [];
    let changedVisibility = false;
    if (b.title !== undefined) {
      const title = String(b.title);
      if (title.length < 1 || title.length > 80) {
        return { invalid: { title: "Give the pen a title of 1 to 80 characters." } as Record<string, string> } as const;
      }
      params.push(title);
      updates.push(`title = $${params.length}`);
    }
    if (b.visibility !== undefined) {
      const vis = String(b.visibility);
      if (vis !== "private" && vis !== "unlisted" && vis !== "public") {
        return { invalid: { visibility: "Visibility must be private, unlisted or public." } as Record<string, string> } as const;
      }
      if (!user.verified) {
        return { unverified: true } as const;
      }
      params.push(vis);
      updates.push(`visibility = $${params.length}`);
      changedVisibility = vis !== pen.visibility;
    }
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags)) {
        return { invalid: { tags: "Tags must be a list." } as Record<string, string> } as const;
      }
      const tags = b.tags.map(String);
      const seen = new Set<string>();
      for (const tag of tags) {
        if (!/^[a-z0-9-]{1,24}$/.test(tag) || seen.has(tag)) {
          return { invalid: { tags: "Tags use 1 to 24 lowercase letters, digits or hyphens." } as Record<string, string> } as const;
        }
        seen.add(tag);
      }
      if (tags.length > ctx.app.config.maxTags) {
        return { tooManyTags: true } as const;
      }
      params.push(tags);
      updates.push("tags = $" + params.length);
    }
    if (updates.length === 0) {
      return { pen } as const;
    }
    updates.push("updated_at = now()");
    params.push(penId);
    await client.query(`UPDATE pens SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
    if (b.tags !== undefined) {
      const idx = params.indexOf(b.tags);
      const tags = b.tags.map(String);
      await client.query("DELETE FROM tags WHERE pen_id = $1", [penId]);
      let pos = 0;
      for (const tag of tags) {
        await client.query("INSERT INTO tags (pen_id, tag, position) VALUES ($1, $2, $3)", [penId, tag, pos]);
        pos++;
      }
      void idx;
    }
    void changedVisibility;
    const fresh = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [penId])).rows[0]!;
    return { pen: fresh } as const;
  });
  if (data === null) {
    send404(ctx.res);
    return;
  }
  if ("notFound" in data && data.notFound) {
    send404(ctx.res);
    return;
  }
  if ("forbidden" in data && data.forbidden) {
    sendJson(ctx.res, 403, errorBody("forbidden", "You may not change this pen."));
    return;
  }
  if ("unverified" in data && data.unverified) {
    sendJson(ctx.res, 403, errorBody("unverified", "Verify your email to do this."));
    return;
  }
  if ("invalid" in data && data.invalid) {
    sendJson(ctx.res, 422, validationBody(data.invalid));
    return;
  }
  if ("tooManyTags" in data && data.tooManyTags) {
    sendJson(ctx.res, 422, validationBody({ tags: `A pen can have up to ${ctx.app.config.maxTags} tags.` }));
    return;
  }
  const pen = data.pen;
  if (pen.visibility === "public" || true) {
    ctx.app.events.countsChanged(pen.id);
  }
  const json = await ctx.app.db.withClient(async (client) => {
    const fresh = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [penId])).rows[0] ?? pen;
    return (await import("./api.js")).penJson(ctx.app, client, fresh, user.id);
  });
  sendJson(ctx.res, 200, json);
}

export async function deletePenRoute(ctx: ApiCtx, penId: string): Promise<void> {
  const user = requireUser(ctx);
  const pen = await ctx.app.db.withClient(async (client) => getPen(client, penId));
  if (!pen) {
    send404(ctx.res);
    return;
  }
  if (pen.owner_id !== user.id) {
    sendJson(ctx.res, 403, errorBody("forbidden", "You may not delete this pen."));
    return;
  }
  // Remove snapshot objects first; if storage refuses, nothing is deleted.
  try {
    await ctx.app.storage.deletePrefix(`pens/${penId}/`);
  } catch {
    sendJson(ctx.res, 503, errorBody("storage_unavailable", "Storage is unreachable, so the pen was not deleted."));
    return;
  }
  await ctx.app.db.withClient(async (client) => {
    await client.query("DELETE FROM pens WHERE id = $1", [penId]);
  });
  ctx.app.renders.deletePenRenders(penId);
  ctx.app.events.penRemoved(penId);
  sendJson(ctx.res, 204, undefined);
  ctx.res.end();
}

export async function listVersions(ctx: ApiCtx, penId: string): Promise<void> {
  const viewer = ctx.user;
  const data = await ctx.app.db.withClient(async (client) => {
    const pen = await getVisiblePen(client, penId, viewer?.id ?? null);
    if (!pen) return null;
    const res = await client.query<VersionRow>(
      "SELECT pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars FROM versions WHERE pen_id = $1 ORDER BY number",
      [penId],
    );
    return res.rows;
  });
  if (!data) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 200, { versions: data.map((v) => ({ number: v.number, created_at: isoTime(v.created_at), sha256: v.sha256, restored_from: v.restored_from, added: v.added, removed: v.removed, changed_chars: v.changed_chars })) });
}

export async function getVersionRoute(ctx: ApiCtx, penId: string, n: number): Promise<void> {
  const viewer = ctx.user;
  const v = await ctx.app.db.withClient(async (client) => {
    const pen = await getVisiblePen(client, penId, viewer?.id ?? null);
    if (!pen) return null;
    return getVersionRow(client, penId, n);
  });
  if (!v) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 200, {
    pen_id: v.pen_id,
    number: v.number,
    created_at: isoTime(v.created_at),
    sha256: v.sha256,
    files: { html: v.html, css: v.css, js: v.js },
    libraries: v.libraries,
    restored_from: v.restored_from,
  });
}

export async function diffRoute(ctx: ApiCtx, penId: string): Promise<void> {
  const viewer = ctx.user;
  const aRaw = ctx.url.searchParams.get("a");
  const bRaw = ctx.url.searchParams.get("b");
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (aRaw === null || bRaw === null || !Number.isInteger(a) || !Number.isInteger(b)) {
    throw new HttpError(422, validationBody({ a: "Give version numbers.", b: "Give version numbers." }));
  }
  const data = await ctx.app.db.withClient(async (client) => {
    const pen = await getVisiblePen(client, penId, viewer?.id ?? null);
    if (!pen) return null;
    const va = await getVersionRow(client, penId, a);
    const vb = await getVersionRow(client, penId, b);
    if (!va || !vb) return null;
    return { va, vb };
  });
  if (!data) {
    send404(ctx.res);
    return;
  }
  const d = diffPanes(
    { html: data.va.html, css: data.va.css, js: data.va.js },
    { html: data.vb.html, css: data.vb.css, js: data.vb.js },
  );
  sendJson(ctx.res, 200, { a, b, ...d });
}

// ---------- versions: save, restore, fork ----------

interface SaveInput {
  baseVersion: number;
  files: Panes;
  libraries: string[];
  restoredFrom: number | null;
}

function parseSaveBody(app: import("./server.js").App, body: unknown): SaveInput | { invalid: Record<string, string> } {
  const b = (body ?? {}) as Record<string, unknown>;
  const files = (b.files ?? {}) as Record<string, unknown>;
  const html = typeof files.html === "string" ? files.html : undefined;
  const css = typeof files.css === "string" ? files.css : undefined;
  const js = typeof files.js === "string" ? files.js : undefined;
  const baseVersion = Number(b.base_version);
  const libraries = Array.isArray(b.libraries) ? b.libraries.map(String) : undefined;
  const fields: Record<string, string> = {};
  if (html === undefined || css === undefined || js === undefined) {
    fields.files = "Give the html, css and js panes.";
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 0) {
    fields.base_version = "Give the version this save is based on.";
  }
  if (libraries === undefined) {
    fields.libraries = "Give the library list.";
  }
  if (Object.keys(fields).length > 0) return { invalid: fields };
  const libs = libraries!;
  const seen = new Set<string>();
  for (const lib of libs) {
    if (!findShelf(lib) || seen.has(lib)) {
      return { invalid: { libraries: "Libraries must be shelf ids, each at most once." } };
    }
    seen.add(lib);
  }
  const panes: Panes = { html: html!, css: css!, js: js! };
  for (const pane of ["html", "css", "js"] as const) {
    const bytes = Buffer.byteLength(panes[pane], "utf8");
    if (bytes > app.config.paneLimitBytes) {
      return { invalid: { [pane]: `The ${pane.toUpperCase()} pane is over ${app.config.paneLimitBytes} bytes.` } };
    }
  }
  return { baseVersion, files: panes, libraries: libs, restoredFrom: null };
}

// The one place that stores a version: snapshot first, read back, verify the
// hash, then insert the row and move the head inside one transaction.
async function storeVersion(
  ctx: ApiCtx,
  pen: PenRow,
  input: SaveInput,
  createdAt: Date | null,
): Promise<VersionRow> {
  const app = ctx.app;
  const head = pen.head;
  const number = head + 1;
  const sha = canonicalHash(input.files, input.libraries);
  const key = `pens/${pen.id}/versions/${number}.json`;
  const snapshot = snapshotJson({ pen_id: pen.id, number, files: input.files, libraries: input.libraries });
  await app.storage.put(key, Buffer.from(snapshot, "utf8"), "application/json");
  const readBack = await app.storage.get(key);
  if (canonicalHash(readBackFiles(readBack), input.libraries) !== sha) {
    throw new HttpError(503, errorBody("storage_unavailable", "Storage is unreachable."));
  }
  return await app.db.withClient(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [pen.id]);
    const fresh = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [pen.id])).rows[0]!;
    if (fresh.head !== input.baseVersion) {
      throw new HttpError(409, { error: "version_conflict" as const, message: "Version conflict.", head: fresh.head });
    }
    const prev = head > 0 ? await getVersionRow(client, pen.id, head) : null;
    const prevPanes: Panes = prev ? { html: prev.html, css: prev.css, js: prev.js } : { html: "", css: "", js: "" };
    const d = diffPanes(prevPanes, input.files);
    const chars = changedChars(d.panes);
    const inserted = await client.query<VersionRow>(
      `INSERT INTO versions (pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars`,
      [pen.id, number, createdAt ?? new Date(), sha, input.files.html, input.files.css, input.files.js, input.libraries, input.restoredFrom, d.added, d.removed, chars],
    );
    await client.query("UPDATE pens SET head = $1, updated_at = $2 WHERE id = $3", [number, new Date(), pen.id]);
    const row = inserted.rows[0]!;
    return row;
  });
}

function readBackFiles(buf: Buffer): Panes {
  const obj = JSON.parse(buf.toString("utf8")) as { files: { html: string; css: string; js: string } };
  return { html: obj.files.html, css: obj.files.css, js: obj.files.js };
}

export async function saveVersion(ctx: ApiCtx, penId: string): Promise<void> {
  const user = requireUser(ctx);
  const parsed = parseSaveBody(ctx.app, ctx.body);
  if ("invalid" in parsed) {
    throw new HttpError(422, validationBody(parsed.invalid));
  }
  const idemKey = ctx.req.headers["idempotency-key"];
  if (idemKey !== undefined && !/^[\x20-\x7E]{1,64}$/.test(String(idemKey))) {
    throw new HttpError(422, validationBody({ idempotency_key: "The key must be 1 to 64 visible ASCII characters." }));
  }
  const pen = await ctx.app.db.withClient(async (client) => getPen(client, penId));
  if (!pen) {
    send404(ctx.res);
    return;
  }
  if (pen.owner_id !== user.id) {
    throw new HttpError(403, errorBody("forbidden", "You may not change this pen."));
  }
  if (!user.verified) {
    throw new HttpError(403, errorBody("unverified", "Verify your email to do this."));
  }
  if (typeof idemKey === "string") {
    const stored = await idempotentLookup(ctx, user.id, "save", penId, idemKey, ctx.raw);
    if (stored) return;
  }
  let row: VersionRow;
  try {
    row = await storeVersion(ctx, pen, parsed, null);
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) {
      sendJson(ctx.res, 503, errorBody("storage_unavailable", "Storage is unreachable, so this version was not saved."));
      return;
    }
    throw e;
  }
  ctx.app.events.headChanged(penId, row.number);
  ctx.app.events.countsChanged(penId);
  if (typeof idemKey === "string") {
    await idempotentStore(ctx, user.id, "save", penId, idemKey, ctx.raw, 201, versionJson(row));
  }
  sendJson(ctx.res, 201, versionJson(row));
}

export async function restoreVersion(ctx: ApiCtx, penId: string): Promise<void> {
  const user = requireUser(ctx);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const version = Number(b.version);
  const baseVersion = Number(b.base_version);
  if (!Number.isInteger(version) || !Number.isInteger(baseVersion)) {
    throw new HttpError(422, validationBody({ version: "Give the version to restore and the base version." }));
  }
  const idemKey = ctx.req.headers["idempotency-key"];
  const pen = await ctx.app.db.withClient(async (client) => getPen(client, penId));
  if (!pen) {
    send404(ctx.res);
    return;
  }
  if (pen.owner_id !== user.id) {
    throw new HttpError(403, errorBody("forbidden", "You may not change this pen."));
  }
  if (!user.verified) {
    throw new HttpError(403, errorBody("unverified", "Verify your email to do this."));
  }
  if (typeof idemKey === "string") {
    const stored = await idempotentLookup(ctx, user.id, "restore", penId, String(idemKey), ctx.raw);
    if (stored) return;
  }
  const source = await ctx.app.db.withClient(async (client) => getVersionRow(client, penId, version));
  if (!source) {
    send404(ctx.res);
    return;
  }
  const input: SaveInput = {
    baseVersion,
    files: { html: source.html, css: source.css, js: source.js },
    libraries: source.libraries,
    restoredFrom: version,
  };
  let row: VersionRow;
  try {
    row = await storeVersion(ctx, pen, input, null);
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) {
      sendJson(ctx.res, 503, errorBody("storage_unavailable", "Storage is unreachable, so the pen was not restored."));
      return;
    }
    throw e;
  }
  ctx.app.events.headChanged(penId, row.number);
  if (typeof idemKey === "string") {
    await idempotentStore(ctx, user.id, "restore", penId, String(idemKey), ctx.raw, 201, versionJson(row));
  }
  sendJson(ctx.res, 201, versionJson(row));
}

export async function forkPen(ctx: ApiCtx, penId: string): Promise<void> {
  const user = requireUser(ctx);
  requireVerified(user);
  const idemKey = ctx.req.headers["idempotency-key"];
  const source = await ctx.app.db.withClient(async (client) => getVisiblePen(client, penId, user.id));
  if (!source) {
    send404(ctx.res);
    return;
  }
  if (source.head === 0) {
    throw new HttpError(409, errorBody("nothing_to_fork", "This pen has no versions to fork."));
  }
  if (typeof idemKey === "string") {
    const stored = await idempotentLookup(ctx, user.id, "fork", penId, String(idemKey), ctx.raw);
    if (stored) return;
  }
  const sourceVersion = await ctx.app.db.withClient(async (client) => getVersionRow(client, penId, source.head));
  if (!sourceVersion) {
    throw new HttpError(409, errorBody("nothing_to_fork", "This pen has no versions to fork."));
  }
  const forkId = newId();
  const visibility = source.visibility === "private" ? "private" : "unlisted";
  const input: SaveInput = {
    baseVersion: 0,
    files: { html: sourceVersion.html, css: sourceVersion.css, js: sourceVersion.js },
    libraries: sourceVersion.libraries,
    restoredFrom: null,
  };
  await ctx.app.db.query(
    "INSERT INTO pens (id, owner_id, title, visibility, head, forked_from_pen_id, forked_from_version) VALUES ($1, $2, $3, $4, 1, $5, $6)",
    [forkId, user.id, source.title, visibility, source.id, source.head],
  );
  const tags = await ctx.app.db.withClient(async (client) => penTags(client, penId));
  let pos = 0;
  for (const tag of tags) {
    await ctx.app.db.query("INSERT INTO tags (pen_id, tag, position) VALUES ($1, $2, $3)", [forkId, tag, pos]);
    pos++;
  }
  let forkRow: VersionRow;
  try {
    const forkPen = await ctx.app.db.withClient(async (client) => {
      const p = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [forkId])).rows[0]!;
      return p;
    });
    forkRow = await storeVersion(ctx, forkPen, input, null);
  } catch (e) {
    if (e instanceof HttpError && e.status === 503) {
      sendJson(ctx.res, 503, errorBody("storage_unavailable", "Storage is unreachable, so the fork was not made."));
      return;
    }
    throw e;
  }
  ctx.app.events.countsChanged(source.id);
  ctx.app.events.countsChanged(forkId);
  if (typeof idemKey === "string") {
    const forkJson = await ctx.app.db.withClient(async (client) => {
      const p = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [forkId])).rows[0]!;
      return (await import("./api.js")).penJson(ctx.app, client, p, user.id);
    });
    await idempotentStore(ctx, user.id, "fork", penId, String(idemKey), ctx.raw, 201, forkJson);
    sendJson(ctx.res, 201, forkJson);
  } else {
    const forkJson = await ctx.app.db.withClient(async (client) => {
      const p = (await client.query<PenRow>("SELECT * FROM pens WHERE id = $1", [forkId])).rows[0]!;
      return (await import("./api.js")).penJson(ctx.app, client, p, user.id);
    });
    sendJson(ctx.res, 201, forkJson);
  }
  // Fork notice email: once, only for a public source forked by someone else.
  if (source.visibility === "public" && source.owner_id !== user.id) {
    const owner = (await ctx.app.db.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [source.owner_id]))[0];
    if (owner) {
      const msg = {
        to: owner.email,
        subject: `${user.handle} forked your pen "${source.title}"`,
        text: `${user.handle} forked "${source.title}" into a new pen.\n\nSee the fork: ${ctx.app.config.publicUrl}/pen/${forkId}\n`,
      };
      const ok = await ctx.app.mail.send(msg);
      if (!ok) ctx.app.mail.queue(`fork-notice:${forkId}`, msg);
    }
  }
}

export async function likePen(ctx: ApiCtx, penId: string, want: boolean): Promise<void> {
  const user = requireUser(ctx);
  requireVerified(user);
  const data = await ctx.app.db.withClient(async (client) => {
    const pen = await getVisiblePen(client, penId, user.id);
    if (!pen) return null;
    if (want) {
      await client.query(
        "INSERT INTO likes (user_id, pen_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [user.id, penId],
      );
    } else {
      await client.query("DELETE FROM likes WHERE user_id = $1 AND pen_id = $2", [user.id, penId]);
    }
    await client.query("UPDATE pens SET updated_at = updated_at WHERE id = $1", [penId]);
    const likes = await countLikes(client, penId);
    return { likes };
  });
  if (!data) {
    send404(ctx.res);
    return;
  }
  ctx.app.events.countsChanged(penId);
  sendJson(ctx.res, 200, { liked: want, likes: data.likes });
}

export async function exportPen(ctx: ApiCtx, penId: string): Promise<void> {
  const viewer = ctx.user;
  const data = await ctx.app.db.withClient(async (client) => {
    const pen = await getVisiblePen(client, penId, viewer?.id ?? null);
    if (!pen) return null;
    if (pen.head === 0) return { nothing: true } as const;
    const v = await getVersionRow(client, penId, pen.head);
    return v ? { v } : null;
  });
  if (!data) {
    send404(ctx.res);
    return;
  }
  if ("nothing" in data && data.nothing) {
    sendJson(ctx.res, 409, errorBody("nothing_to_export", "Save a version before exporting."));
    return;
  }
  const v = data.v;
  // The zip holds exactly index.html, style.css and script.js.
  const files: Array<[string, Buffer]> = [
    ["index.html", Buffer.from(v.html, "utf8")],
    ["style.css", Buffer.from(v.css, "utf8")],
    ["script.js", Buffer.from(v.js, "utf8")],
  ];
  const zip = makeZip(files);
  const buf = Buffer.concat([zip]);
  ctx.res.writeHead(200, {
    "content-type": "application/zip",
    "content-length": buf.length,
    "content-disposition": `attachment; filename="${penId}-v${v.number}.zip"`,
  });
  ctx.res.end(buf);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

// Minimal zip writer with stored (uncompressed) entries.
export function makeZip(files: Array<[string, Buffer]>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

// ---------- idempotency ----------

async function idempotentLookup(
  ctx: ApiCtx,
  userId: string,
  route: string,
  penId: string,
  key: string,
  raw: Buffer | null,
): Promise<boolean> {
  const rows = await ctx.app.db.query<{ body: string; status: number; response: string }>(
    "SELECT body, status, response FROM idempotency WHERE user_id = $1 AND route = $2 AND key = $3",
    [userId, `${route}:${penId}`, key],
  );
  const row = rows[0];
  if (!row) return false;
  const bodyStr = raw ? raw.toString("utf8") : "";
  if (row.body !== bodyStr) {
    throw new HttpError(409, errorBody("idempotency_conflict", "This key was used with a different body."));
  }
  sendJson(ctx.res, row.status, JSON.parse(row.response));
  return true;
}

async function idempotentStore(
  ctx: ApiCtx,
  userId: string,
  route: string,
  penId: string,
  key: string,
  raw: Buffer | null,
  status: number,
  response: unknown,
): Promise<void> {
  const bodyStr = raw ? raw.toString("utf8") : "";
  await ctx.app.db.query(
    "INSERT INTO idempotency (user_id, route, key, body, status, response) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
    [userId, `${route}:${penId}`, key, bodyStr, status, JSON.stringify(response)],
  );
}
