import type { ApiCtx } from "./api.js";
import { sendJson, send404 } from "./http.js";
import { errorBody, validationBody } from "../shared/errors.js";
import { HttpError, requireUser } from "./api.js";
import { getVisiblePen, type PenRow } from "./domain.js";
import { findShelf } from "../shared/shelf.js";

export async function search(ctx: ApiCtx): Promise<void> {
  const q = ctx.url.searchParams.get("q") ?? "";
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  const tagTokens: string[] = [];
  const textTokens: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("tag:")) tagTokens.push(token.slice(4).toLowerCase());
    else textTokens.push(token.toLowerCase());
  }
  if (tokens.length === 0) {
    sendJson(ctx.res, 200, { query: q, total: 0, pens: [] });
    return;
  }
  const rows = await ctx.app.db.withClient(async (client) => {
    const params: unknown[] = [];
    const conditions: string[] = ["p.visibility = 'public'"];
    textTokens.forEach((t, i) => {
      params.push(`%${t}%`);
      const ph = `$${params.length}`;
      conditions.push(
        `(p.title ILIKE ${ph} OR u.handle ILIKE ${ph} OR EXISTS (SELECT 1 FROM tags t2 WHERE t2.pen_id = p.id AND t2.tag ILIKE ${ph}))`,
      );
    });
    tagTokens.forEach((t) => {
      params.push(t);
      conditions.push(`EXISTS (SELECT 1 FROM tags t3 WHERE t3.pen_id = p.id AND t3.tag = $${params.length})`);
    });
    params.push(50);
    const res = await client.query<PenRow & { likes_count: string; forks_count: string; tags: string[]; owner_handle: string }>(
      `SELECT p.*, (SELECT count(*) FROM likes l WHERE l.pen_id = p.id)::text AS likes_count,
              (SELECT count(*) FROM pens f WHERE f.forked_from_pen_id = p.id)::text AS forks_count,
              COALESCE((SELECT array_agg(t4.tag ORDER BY t4.position) FROM tags t4 WHERE t4.pen_id = p.id), '{}') AS tags,
              u.handle AS owner_handle
       FROM pens p JOIN users u ON u.id = p.owner_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY (SELECT count(*) FROM likes l2 WHERE l2.pen_id = p.id) DESC, p.updated_at DESC, p.id
       LIMIT $${params.length}`,
      params,
    );
    return res.rows;
  });
  sendJson(ctx.res, 200, {
    query: q,
    total: rows.length,
    pens: rows.map((r) => ({
      id: r.id,
      title: r.title,
      owner: r.owner_handle,
      visibility: r.visibility,
      tags: r.tags,
      head: r.head,
      updated_at: isoTime(r.updated_at),
      likes: Number(r.likes_count),
      forks: Number(r.forks_count),
    })),
  });
}

function isoTime(d: Date): string {
  return d.toISOString();
}

export async function createRender(ctx: ApiCtx): Promise<void> {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  if (typeof b.pen_id === "string" && /^[a-z0-9]{10}$/.test(b.pen_id)) {
    const penId = b.pen_id;
    const version = b.version === undefined ? null : Number(b.version);
    const data = await ctx.app.db.withClient(async (client) => {
      const pen = await getVisiblePen(client, penId, ctx.user?.id ?? null);
      if (!pen) return null;
      const n = version ?? pen.head;
      if (n === 0) return null;
      const v = (await client.query<{ html: string; css: string; js: string; libraries: string[] }>(
        "SELECT html, css, js, libraries FROM versions WHERE pen_id = $1 AND number = $2",
        [penId, n],
      )).rows[0];
      return v ?? null;
    });
    if (!data) {
      send404(ctx.res);
      return;
    }
    const rec = ctx.app.renders.create({ html: data.html, css: data.css, js: data.js }, data.libraries, penId);
    sendJson(ctx.res, 201, { render: rec.id, nonce: rec.nonce, url: `/preview/${rec.id}` });
    return;
  }
  const files = (b.files ?? {}) as Record<string, unknown>;
  const html = typeof files.html === "string" ? files.html : typeof b.html === "string" ? b.html : undefined;
  const css = typeof files.css === "string" ? files.css : typeof b.css === "string" ? b.css : undefined;
  const js = typeof files.js === "string" ? files.js : typeof b.js === "string" ? b.js : undefined;
  const libraries = Array.isArray(b.libraries) ? b.libraries.map(String) : undefined;
  if (html === undefined || css === undefined || js === undefined || libraries === undefined) {
    throw new HttpError(422, validationBody({ files: "Give the html, css and js panes and the library list." }));
  }
  for (const lib of libraries) {
    if (!findShelf(lib)) {
      throw new HttpError(422, validationBody({ libraries: "Libraries must be shelf ids." }));
    }
  }
  const rec = ctx.app.renders.create({ html, css, js }, libraries, null);
  sendJson(ctx.res, 201, { render: rec.id, nonce: rec.nonce, url: `/preview/${rec.id}` });
}

export async function listCollections(ctx: ApiCtx): Promise<void> {
  const user = requireUser(ctx);
  const rows = await ctx.app.db.withClient(async (client) => {
    const res = await client.query(
      `SELECT c.id, c.title, count(cp.pen_id)::int AS count FROM collections c
       LEFT JOIN collection_pens cp ON cp.collection_id = c.id
       WHERE c.owner_id = $1 GROUP BY c.id, c.title ORDER BY c.created_at`,
      [user.id],
    );
    return res.rows;
  });
  sendJson(ctx.res, 200, { collections: rows.map((r) => ({ id: r.id, title: r.title, count: Number(r.count) })) });
}

export async function createCollection(ctx: ApiCtx): Promise<void> {
  const user = requireUser(ctx);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  let title = "Untitled collection";
  if (b.title !== undefined) {
    title = String(b.title);
    if (title.length < 1 || title.length > 80) {
      throw new HttpError(422, validationBody({ title: "Give the collection a title of 1 to 80 characters." }));
    }
  }
  const id = newId();
  await ctx.app.db.query("INSERT INTO collections (id, owner_id, title) VALUES ($1, $2, $3)", [id, user.id, title]);
  sendJson(ctx.res, 201, { id, title, pens: [] });
}

export async function getCollectionRoute(ctx: ApiCtx, colId: string): Promise<void> {
  const user = requireUser(ctx);
  const data = await ctx.app.db.withClient(async (client) => {
    const col = (await client.query<{ id: string; title: string; owner_id: string }>(
      "SELECT id, title, owner_id FROM collections WHERE id = $1",
      [colId],
    )).rows[0];
    if (!col || col.owner_id !== user.id) return null;
    const pens = await client.query<PenRow & { likes_count: string; forks_count: string; tags: string[]; owner_handle: string }>(
      `SELECT p.*, (SELECT count(*) FROM likes l WHERE l.pen_id = p.id)::text AS likes_count,
              (SELECT count(*) FROM pens f WHERE f.forked_from_pen_id = p.id)::text AS forks_count,
              COALESCE((SELECT array_agg(t4.tag ORDER BY t4.position) FROM tags t4 WHERE t4.pen_id = p.id), '{}') AS tags,
              u.handle AS owner_handle
       FROM collection_pens cp
       JOIN pens p ON p.id = cp.pen_id
       JOIN users u ON u.id = p.owner_id
       WHERE cp.collection_id = $1
       ORDER BY cp.position`,
      [colId],
    );
    return {
      id: col.id,
      title: col.title,
      pens: pens.rows.map((r) => ({
        id: r.id,
        title: r.title,
        owner: r.owner_handle,
        visibility: r.visibility,
        tags: r.tags,
        head: r.head,
        updated_at: isoTime(r.updated_at),
        likes: Number(r.likes_count),
        forks: Number(r.forks_count),
      })),
    };
  });
  if (!data) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 200, data);
}

export async function patchCollection(ctx: ApiCtx, colId: string): Promise<void> {
  const user = requireUser(ctx);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const data = await ctx.app.db.withClient(async (client) => {
    const col = (await client.query<{ id: string; owner_id: string }>("SELECT id, owner_id FROM collections WHERE id = $1", [colId])).rows[0];
    if (!col || col.owner_id !== user.id) return { notFound: true } as const;
    if (b.title !== undefined) {
      const title = String(b.title);
      if (title.length < 1 || title.length > 80) return { invalid: { title: "Give the collection a title of 1 to 80 characters." } as Record<string, string> } as const;
      await client.query("UPDATE collections SET title = $1 WHERE id = $2", [title, colId]);
    }
    if (b.order !== undefined) {
      if (!Array.isArray(b.order) || b.order.some((x) => typeof x !== "string")) {
        return { invalid: { order: "Order must be a list of pen ids." } as Record<string, string> } as const;
      }
      const order = b.order.map(String);
      const current = (await client.query<{ pen_id: string }>(
        "SELECT pen_id FROM collection_pens WHERE collection_id = $1",
        [colId],
      )).rows.map((r) => r.pen_id);
      const sortedCurrent = [...current].sort();
      const sortedOrder = [...order].sort();
      if (sortedCurrent.length !== sortedOrder.length || sortedCurrent.some((v, i) => v !== sortedOrder[i])) {
        return { invalid: { order: "Order must be exactly the pens in this collection." } as Record<string, string> } as const;
      }
      let pos = 0;
      for (const penId of order) {
        await client.query("UPDATE collection_pens SET position = $1 WHERE collection_id = $2 AND pen_id = $3", [pos, colId, penId]);
        pos++;
      }
    }
    return { ok: true } as const;
  });
  if ("notFound" in data && data.notFound) {
    send404(ctx.res);
    return;
  }
  if ("invalid" in data && data.invalid) {
    sendJson(ctx.res, 422, validationBody(data.invalid));
    return;
  }
  await getCollectionRoute(ctx, colId);
}

export async function deleteCollectionRoute(ctx: ApiCtx, colId: string): Promise<void> {
  const user = requireUser(ctx);
  const result = await ctx.app.db.withClient(async (client) => {
    const col = (await client.query<{ owner_id: string }>("SELECT owner_id FROM collections WHERE id = $1", [colId])).rows[0];
    if (!col || col.owner_id !== user.id) return false;
    await client.query("DELETE FROM collections WHERE id = $1", [colId]);
    return true;
  });
  if (!result) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 204, undefined);
  ctx.res.end();
}

export async function addPenToCollection(ctx: ApiCtx, colId: string): Promise<void> {
  const user = requireUser(ctx);
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const penId = String(b.pen_id ?? "");
  const result = await ctx.app.db.withClient(async (client) => {
    const col = (await client.query<{ owner_id: string }>("SELECT owner_id FROM collections WHERE id = $1", [colId])).rows[0];
    if (!col || col.owner_id !== user.id) return { notFound: true } as const;
    const pen = await getVisiblePen(client, penId, user.id);
    if (!pen) return { penNotFound: true } as const;
    const dup = (await client.query("SELECT 1 FROM collection_pens WHERE collection_id = $1 AND pen_id = $2", [colId, penId])).rowCount === 1;
    if (dup) return { duplicate: true } as const;
    const max = (await client.query<{ n: string }>(
      "SELECT coalesce(max(position) + 1, 0)::text AS n FROM collection_pens WHERE collection_id = $1",
      [colId],
    )).rows[0];
    await client.query("INSERT INTO collection_pens (collection_id, pen_id, position) VALUES ($1, $2, $3)", [colId, penId, Number(max?.n ?? "0")]);
    return { added: true } as const;
  });
  if ("notFound" in result && result.notFound) {
    send404(ctx.res);
    return;
  }
  if ("penNotFound" in result && result.penNotFound) {
    sendJson(ctx.res, 404, errorBody("not_found", "Nothing here."));
    return;
  }
  if ("duplicate" in result && result.duplicate) {
    sendJson(ctx.res, 409, errorBody("duplicate", "That pen is already in this collection."));
    return;
  }
  await getCollectionRoute(ctx, colId);
}

export async function removePenFromCollection(ctx: ApiCtx, colId: string, penId: string): Promise<void> {
  const user = requireUser(ctx);
  const result = await ctx.app.db.withClient(async (client) => {
    const col = (await client.query<{ owner_id: string }>("SELECT owner_id FROM collections WHERE id = $1", [colId])).rows[0];
    if (!col || col.owner_id !== user.id) return false;
    await client.query("DELETE FROM collection_pens WHERE collection_id = $1 AND pen_id = $2", [colId, penId]);
    return true;
  });
  if (!result) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 204, undefined);
  ctx.res.end();
}

function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}
