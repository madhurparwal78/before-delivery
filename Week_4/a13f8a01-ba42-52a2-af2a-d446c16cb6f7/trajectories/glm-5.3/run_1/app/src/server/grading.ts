import type { ApiCtx } from "./api.js";
import { sendJson, send404 } from "./http.js";
import { errorBody, validationBody } from "../shared/errors.js";
import { canonicalHash, snapshotJson } from "../shared/snapshot.js";
import { diffPanes, changedChars } from "../shared/diff.js";
import { hashPassword, createSession, SESSION_COOKIE } from "./auth.js";
import { newId } from "./domain.js";

interface SeedUser {
  handle: string;
  email: string;
  password: string;
  verified: boolean;
}

interface SeedVersion {
  files: { html: string; css: string; js: string };
  libraries: string[];
  created_at?: string;
}

interface SeedPen {
  key: string;
  owner: string;
  title?: string;
  visibility?: string;
  tags?: string[];
  versions?: SeedVersion[];
  forked_from?: { key: string; version: number };
}

interface SeedBody {
  users?: SeedUser[];
  pens?: SeedPen[];
  likes?: Array<{ user: string; pen: string }>;
  collections?: Array<{ key: string; owner: string; title?: string; pens?: string[] }>;
}

export async function handleGradingSeed(ctx: ApiCtx): Promise<void> {
  const b = (ctx.body ?? {}) as SeedBody;
  const users = b.users ?? [];
  const pens = b.pens ?? [];
  const likes = b.likes ?? [];
  const collections = b.collections ?? [];

  const validate = () => {
    const fields: Record<string, string> = {};
    const handles = new Set<string>();
    for (const u of users) {
      if (!/^[a-z0-9-]{3,20}$/.test(u.handle ?? "")) fields.handle = "Use 3 to 20 lowercase letters, digits or hyphens.";
      if (typeof u.email !== "string" || typeof u.password !== "string") fields.user = "Give a handle, email and password.";
      if (handles.has(u.handle)) fields.handle = "Handles must be unique.";
      handles.add(u.handle);
    }
    const penKeys = new Set<string>();
    for (const p of pens) {
      if (!p.key) fields.pens = "Give every pen a key.";
      if (penKeys.has(p.key)) fields.pens = "Pen keys must be unique.";
      penKeys.add(p.key);
      if (p.visibility !== undefined && !["private", "unlisted", "public"].includes(p.visibility)) {
        fields.pens = "Visibility must be private, unlisted or public.";
      }
      let last = 0;
      for (const v of p.versions ?? []) {
        const t = v.created_at ? Date.parse(v.created_at) : 0;
        if (Number.isNaN(t)) fields.pens = "created_at must be an ISO time.";
        if (t < last) fields.pens = "created_at values must increase along the list.";
        last = t;
      }
    }
    return Object.keys(fields).length > 0 ? fields : null;
  };

  const fields = validate();
  if (fields) {
    sendJson(ctx.res, 422, validationBody(fields));
    return;
  }

  const app = ctx.app;
  const existingUser = async (handle: string) =>
    (await app.db.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [handle]))[0];
  const existingPen = async (ownerId: string, key: string) =>
    (await app.db.query<{ id: string }>("SELECT id FROM seed_keys WHERE owner_id = $1 AND key = $1", [ownerId]))[0];

  const userIds = new Map<string, string>();
  const penIds = new Map<string, string>();
  const collectionIds = new Map<string, string>();
  const emails = new Set<string>();
  const userEmail = new Map<string, string>();

  try {
    for (const u of users) {
      const found = await existingUser(u.handle);
      if (found) {
        userIds.set(u.handle, found.id);
        userEmail.set(u.handle, u.email);
        continue;
      }
      const id = newId();
      await app.db.query(
        "INSERT INTO users (id, handle, email, email_lower, password_hash, verified) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, u.handle, u.email, u.email.toLowerCase(), hashPassword(u.password), u.verified !== false],
      );
      userIds.set(u.handle, id);
      userEmail.set(u.handle, u.email);
    }

    // Versions need storage; if it is down the whole seed is refused.
    for (const p of pens) {
      const ownerId = userIds.get(p.owner);
      if (!ownerId) {
        sendJson(ctx.res, 422, validationBody({ pens: "Every pen needs an owner in this call." }));
        return;
      }
      if (p.forked_from && !penIds.has(p.forked_from.key)) {
        sendJson(ctx.res, 422, validationBody({ pens: "forked_from must refer to a pen earlier in this call." }));
        return;
      }
      const id = newId();
      penIds.set(p.key, id);
      const visibility = p.visibility ?? "private";
      const forkPen = p.forked_from ? penIds.get(p.forked_from.key)! : null;
      await app.db.query(
        "INSERT INTO pens (id, owner_id, title, visibility, head, forked_from_pen_id, forked_from_version) VALUES ($1, $2, $3, $4, 0, $5, $6)",
        [id, ownerId, p.title ?? "Untitled pen", visibility, forkPen, p.forked_from?.version ?? null],
      );
      let pos = 0;
      for (const tag of p.tags ?? []) {
        await app.db.query("INSERT INTO tags (pen_id, tag, position) VALUES ($1, $2, $3)", [id, tag, pos]);
        pos++;
      }
      let number = 0;
      let prev: { html: string; css: string; js: string } = { html: "", css: "", js: "" };
      for (const v of p.versions ?? []) {
        number++;
        const files = { html: v.files.html, css: v.files.css, js: v.files.js };
        const libraries = v.libraries ?? [];
        const sha = canonicalHash(files, libraries);
        const key = `pens/${id}/versions/${number}.json`;
        const snapshot = snapshotJson({ pen_id: id, number, files, libraries });
        try {
          await app.storage.put(key, Buffer.from(snapshot, "utf8"), "application/json");
          const back = await app.storage.get(key);
          if (canonicalHash(JSON.parse(back.toString("utf8")).files, libraries) !== sha) throw new Error("mismatch");
        } catch {
          sendJson(ctx.res, 503, errorBody("storage_unavailable", "Storage is unreachable."));
          return;
        }
        const d = diffPanes(prev, files);
        const chars = changedChars(d.panes);
        await app.db.query(
          `INSERT INTO versions (pen_id, number, created_at, sha256, html, css, js, libraries, restored_from, added, removed, changed_chars)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, $11)`,
          [id, number, v.created_at ? new Date(v.created_at) : new Date(), sha, files.html, files.css, files.js, libraries, d.added, d.removed, chars],
        );
        prev = files;
      }
      await app.db.query("UPDATE pens SET head = $1 WHERE id = $2", [number, id]);
    }

    for (const l of likes) {
      const userId = userIds.get(l.user);
      const penId = penIds.get(l.pen);
      if (!userId || !penId) {
        sendJson(ctx.res, 422, validationBody({ likes: "Likes must name a user and pen from this call." }));
        return;
      }
      await app.db.query("INSERT INTO likes (user_id, pen_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, penId]);
    }

    for (const c of collections) {
      const ownerId = userIds.get(c.owner);
      if (!ownerId) {
        sendJson(ctx.res, 422, validationBody({ collections: "Collections must have an owner in this call." }));
        return;
      }
      const id = newId();
      collectionIds.set(c.key, id);
      await app.db.query("INSERT INTO collections (id, owner_id, title) VALUES ($1, $2, $3)", [id, ownerId, c.title ?? "Untitled collection"]);
      let pos = 0;
      for (const penKey of c.pens ?? []) {
        const penId = penIds.get(penKey);
        if (!penId) {
          sendJson(ctx.res, 422, validationBody({ collections: "Collections must name pens from this call." }));
          return;
        }
        await app.db.query("INSERT INTO collection_pens (collection_id, pen_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, penId, pos]);
        pos++;
      }
    }
  } catch (e) {
    const msg = e instanceof Error && /duplicate key/i.test(e.message) ? "duplicate" : "error";
    if (msg === "duplicate") {
      sendJson(ctx.res, 409, errorBody("duplicate", "That handle, pen or collection already exists."));
      return;
    }
    sendJson(ctx.res, 503, errorBody("storage_unavailable", "Storage is unreachable."));
    return;
  }

  sendJson(ctx.res, 201, {
    users: Object.fromEntries(userIds),
    pens: Object.fromEntries(penIds),
    collections: Object.fromEntries(collectionIds),
  });
}

export async function handleGradingSession(ctx: ApiCtx): Promise<void> {
  const b = (ctx.body ?? {}) as Record<string, unknown>;
  const handle = String(b.handle ?? "");
  const user = (await ctx.app.db.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [handle]))[0];
  if (!user) {
    send404(ctx.res);
    return;
  }
  const session = await createSession(ctx.app.db, user.id);
  ctx.res.setHeader("set-cookie", `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/`);
  const full = (await ctx.app.db.query<{ id: string; handle: string; email: string; verified: boolean }>(
    "SELECT id, handle, email, verified FROM users WHERE id = $1",
    [user.id],
  ))[0];
  if (!full) {
    send404(ctx.res);
    return;
  }
  sendJson(ctx.res, 200, { user: { id: full.id, handle: full.handle, email: full.email, verified: full.verified } });
}
