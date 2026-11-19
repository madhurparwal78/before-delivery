import type { Db } from "./db";
import { poolDb, withTransaction } from "./db";
import { config } from "./config";
import { businessNow } from "./clock";
import { validation, notFound, conflict, unsupportedType, storageUnavailable } from "./errors";
import { extractTags, sourceHost, trimmedName, isEmail } from "./domain";
import { solidImage, type ProcessedImage } from "./image";
import { putObject, storageState } from "./storage";
import { hashPassword } from "./auth";
import { broadcastFeed } from "./live";

/** The grading seed route (DP-04): one call, records in the listed order, ids returned. */
export async function runGradingSeed(body: Record<string, unknown>): Promise<Record<string, number>> {
  const ids: Record<string, number> = {};
  const userKey = (k: string): number => {
    const id = ids[`user:${k}`];
    if (id === undefined) throw notFound();
    return id;
  };
  const boardKey = (k: string): number => {
    const id = ids[`board:${k}`];
    if (id === undefined) throw notFound();
    return id;
  };

  const storageOk = storageState().ok;

  // Users
  const users = Array.isArray(body.users) ? body.users as unknown[] : [];
  for (const u of users) {
    const r = u as Record<string, unknown>;
    const key = String(r.key ?? "");
    const email = String(r.email ?? "");
    const password = String(r.password ?? "");
    const name = String(r.name ?? "");
    const handle = String(r.handle ?? "");
    if (!key || !isEmail(email) || password.length < 8 || name.length < 1 || name.length > 50
      || !/^[a-z0-9_]{3,20}$/.test(handle)) throw validation("handle");
    const at = r.at ? new Date(String(r.at)) : businessNow();
    if (Number.isNaN(at.getTime())) throw validation("at");
    const row = await poolDb.queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, handle, created_at) values ($1, $2, $3, $4, $5)
       on conflict (lower(email)) do update set name = excluded.name returning id`,
      [email.toLowerCase(), hashPassword(password), name, handle, at]
    );
    ids[`user:${key}`] = Number(row!.id);
  }

  // Boards
  const boards = Array.isArray(body.boards) ? body.boards as unknown[] : [];
  for (const b of boards) {
    const r = b as Record<string, unknown>;
    const key = String(r.key ?? "");
    const ownerId = userKey(String(r.owner));
    const name = trimmedName(String(r.name ?? ""));
    const visibility = String(r.visibility ?? "public");
    if (!key || name.length < 1 || name.length > config.boardNameMax
      || (visibility !== "public" && visibility !== "secret")) throw validation("name");
    const at = r.at ? new Date(String(r.at)) : businessNow();
    if (Number.isNaN(at.getTime())) throw validation("at");
    const taken = await poolDb.queryOne<{ id: string }>(
      `select id from boards where owner_id = $1 and lower(name) = lower($2)`, [ownerId, name]
    );
    if (taken) throw conflict("board_name_taken");
    const row = await poolDb.queryOne<{ id: string }>(
      `insert into boards (owner_id, name, name_key, visibility, seq, created_at) values ($1, $2, $3, $4, 0, $5) returning id`,
      [ownerId, name, name.toLowerCase(), visibility, at]
    );
    const boardId = Number(row!.id);
    ids[`board:${key}`] = boardId;
    // Members
    const members = Array.isArray(r.members) ? r.members as unknown[] : [];
    for (const m of members) {
      const mr = m as Record<string, unknown>;
      const userId = userKey(String(mr.user));
      const role = String(mr.role);
      if (role !== "editor" && role !== "viewer") throw validation("role");
      await poolDb.query(
        `insert into board_members (board_id, user_id, role, created_at) values ($1, $2, $3, $4) on conflict do nothing`,
        [boardId, userId, role, at]
      );
    }
    // Sections take positions 1, 2 and onward in the order listed.
    const sections = Array.isArray(r.sections) ? r.sections as unknown[] : [];
    let position = 1;
    for (const s of sections) {
      const sr = s as Record<string, unknown>;
      const sKey = String(sr.key ?? "");
      const sName = trimmedName(String(sr.name ?? ""));
      if (!sKey || sName.length < 1 || sName.length > config.boardNameMax) throw validation("name");
      const sTaken = await poolDb.queryOne<{ id: string }>(
        `select id from sections where board_id = $1 and lower(name) = lower($2)`, [boardId, sName]
      );
      if (sTaken) throw conflict("section_name_taken");
      const sRow = await poolDb.queryOne<{ id: string }>(
        `insert into sections (board_id, name, name_key, position, created_at) values ($1, $2, $3, $4, $5) returning id`,
        [boardId, sName, sName.toLowerCase(), position, at]
      );
      ids[`section:${sKey}`] = Number(sRow!.id);
      position++;
    }
  }

  // Pins: seeded images are solid images generated and processed like an upload.
  const pins = Array.isArray(body.pins) ? body.pins as unknown[] : [];
  for (const p of pins) {
    const r = p as Record<string, unknown>;
    const key = String(r.key ?? "");
    const ownerId = userKey(String(r.owner));
    const boardId = boardKey(String(r.board));
    const sectionKey = r.section === null || r.section === undefined ? null : String(r.section);
    const sectionId = sectionKey ? ids[`section:${sectionKey}`] ?? null : null;
    const title = String(r.title ?? "");
    const description = String(r.description ?? "");
    const alt = String(r.alt ?? "");
    const source = r.source === null || r.source === undefined ? null : String(r.source);
    if (!key || title.length < 1 || title.length > config.titleMax) throw validation("title");
    if (description.length > config.descriptionMax) throw validation("description");
    if (alt.trim().length < 1 || alt.length > 500) throw validation("alt");
    if (source !== null) {
      try {
        const u = new URL(source);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      } catch { throw validation("source"); }
    }
    const img = r.image as Record<string, unknown> | undefined;
    if (!img) throw validation("image");
    const width = Number(img.width);
    const height = Number(img.height);
    const format = String(img.format) as "png" | "jpeg";
    const color = String(img.color ?? "#888888");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw validation("image");
    if (width * height > config.imageMaxPixels) throw validation("image");
    const ratio = width / height;
    if (ratio < 0.5 || ratio > 2.0) throw validation("image");
    if (format !== "png" && format !== "jpeg") throw validation("image");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw validation("image");
    const at = r.at ? new Date(String(r.at)) : businessNow();
    if (Number.isNaN(at.getTime())) throw validation("at");
    if (!storageOk) throw storageUnavailable();

    let processed: ProcessedImage;
    try {
      processed = await solidImage(width, height, format, color);
    } catch (e) {
      if (e instanceof Error && (e.message.includes("unsupported"))) throw unsupportedType();
      throw storageUnavailable();
    }
    const pinId = await storeSeededPin({
      ownerId, boardId, sectionId, title, description, alt, source, processed, at,
    });
    ids[`pin:${key}`] = pinId;
    // Seeded pins reach open feeds live like any other (DP-15).
    void broadcastFeed([pinId]);
    // Boards listed with a cover pin resolve after all pins exist; collect for a second pass.
  }

  // Board covers may reference a pin created later in the same call.
  for (const b of boards) {
    const r = b as Record<string, unknown>;
    const boardId = ids[`board:${String(r.key ?? "")}`];
    if (boardId === undefined) continue;
    if (r.cover !== null && r.cover !== undefined) {
      const coverPinId = ids[`pin:${String(r.cover)}`];
      if (coverPinId !== undefined) {
        await poolDb.query(`update boards set cover_pin_id = $2 where id = $1`, [boardId, coverPinId]);
      }
    }
  }

  // Saves
  const saves = Array.isArray(body.saves) ? body.saves as unknown[] : [];
  for (const s of saves) {
    const r = s as Record<string, unknown>;
    const key = String(r.key ?? "");
    const ofPinId = ids[`pin:${String(r.of)}`];
    if (ofPinId === undefined) throw notFound();
    const byId = userKey(String(r.by));
    const boardId = boardKey(String(r.board));
    const sectionKey = r.section === null || r.section === undefined ? null : String(r.section);
    const sectionId = sectionKey ? ids[`section:${sectionKey}`] ?? null : null;
    const at = r.at ? new Date(String(r.at)) : businessNow();
    const origin = await poolDb.queryOne<{ root_id: string | null }>(`select root_id from pins where id = $1`, [ofPinId]);
    if (!origin) throw notFound();
    const rootId = origin.root_id === null ? ofPinId : Number(origin.root_id);
    const already = await poolDb.queryOne<{ id: string }>(
      `select id from pins where board_id = $1 and status = 'live' and (id = $2 or root_id = $2)`,
      [boardId, rootId]
    );
    if (already) throw conflict("already_on_board");
    const saved = await insertPinTx(async tx => {
      const countRow = await tx.queryOne<{ n: string }>(
        `select count(*)::text as n from pins where board_id = $1 and section_id is not distinct from $2 and status = 'live'`,
        [boardId, sectionId]
      );
      const position = Number(countRow!.n) + 1;
      const row = await tx.queryOne<{ id: string }>(
        `insert into pins (owner_id, board_id, section_id, image_id, root_id, title, description, alt, source, source_host, tags, position, status, created_at, updated_at)
         select $2, $3, $4, image_id, $5, title, description, alt, source, source_host, tags, $7, 'live', $6, $6
         from pins where id = $1 returning id`,
        [ofPinId, byId, boardId, sectionId, rootId, at, position]
      );
      return Number(row!.id);
    });
    if (key) ids[`pin:${key}`] = saved;
    await poolDb.query(
      `update boards set last_saved_at = greatest(coalesce(last_saved_at, $2), $2) where id = $1`,
      [boardId, at]
    );
    void broadcastFeed([saved]);
  }

  // Follows
  const follows = Array.isArray(body.follows) ? body.follows as unknown[] : [];
  for (const f of follows) {
    const r = f as Record<string, unknown>;
    const follower = userKey(String(r.follower));
    if (r.user !== undefined) {
      const target = userKey(String(r.user));
      await poolDb.query(
        `insert into follows_users (follower_id, target_id, created_at) values ($1, $2, $3) on conflict do nothing`,
        [follower, target, businessNow()]
      );
    } else if (r.board !== undefined) {
      const boardId = boardKey(String(r.board));
      await poolDb.query(
        `insert into follows_boards (follower_id, board_id, created_at) values ($1, $2, $3) on conflict do nothing`,
        [follower, boardId, businessNow()]
      );
    } else {
      throw validation("follows");
    }
  }

  // Comments
  const comments = Array.isArray(body.comments) ? body.comments as unknown[] : [];
  for (const c of comments) {
    const r = c as Record<string, unknown>;
    const key = String(r.key ?? "");
    const pinId = ids[`pin:${String(r.pin)}`];
    if (pinId === undefined) throw notFound();
    const author = userKey(String(r.author));
    const text = String(r.text ?? "");
    if (text.length < 1 || text.length > config.commentMax) throw validation("text");
    const at = r.at ? new Date(String(r.at)) : businessNow();
    let parentId: number | null = null;
    if (r.parent !== null && r.parent !== undefined) {
      const parentKey = String(r.parent);
      const parentCommentId = ids[`comment:${parentKey}`];
      if (parentCommentId === undefined) throw notFound();
      const parent = await poolDb.queryOne<{ parent_id: string | null }>(`select parent_id from comments where id = $1`, [parentCommentId]);
      parentId = parent?.parent_id === null || parent?.parent_id === undefined ? parentCommentId : Number(parent!.parent_id);
    }
    const row = await poolDb.queryOne<{ id: string }>(
      `insert into comments (pin_id, author_id, parent_id, text, created_at) values ($1, $2, $3, $4, $5) returning id`,
      [pinId, author, parentId, text, at]
    );
    if (key) ids[`comment:${key}`] = Number(row!.id);
  }

  // Reactions
  const reactions = Array.isArray(body.reactions) ? body.reactions as unknown[] : [];
  for (const rr of reactions) {
    const r = rr as Record<string, unknown>;
    const pinId = ids[`pin:${String(r.pin)}`];
    if (pinId === undefined) throw notFound();
    const userId = userKey(String(r.user));
    const type = String(r.type);
    if (type !== "love" && type !== "idea" && type !== "wow" && type !== "thanks") throw validation("type");
    const at = r.at ? new Date(String(r.at)) : businessNow();
    await poolDb.query(
      `insert into reactions (pin_id, user_id, type, created_at) values ($1, $2, $3, $4)
       on conflict (pin_id, user_id) do update set type = excluded.type`,
      [pinId, userId, type, at]
    );
  }

  return ids;
}

async function insertPinTx(fn: (tx: Db) => Promise<number>): Promise<number> {
  return withTransaction(fn);
}

/** Pins and saves are placed in each container in the order listed, first at position 1. */
async function storeSeededPin(args: {
  ownerId: number; boardId: number; sectionId: number | null;
  title: string; description: string; alt: string; source: string | null;
  processed: ProcessedImage; at: Date;
}): Promise<number> {
  const { processed } = args;
  // Seeded images are processed the same way as an upload: storage first, then live.
  const imageRow = await poolDb.queryOne<{ id: string }>(
    `insert into images (width, height, sha256, format, created_at) values ($1, $2, $3, $4, $5) returning id`,
    [processed.width, processed.height, processed.sha256, processed.format, args.at]
  );
  const imageId = Number(imageRow!.id);
  const ext = processed.format === "jpeg" ? "jpg" : "png";
  const ctype = processed.format === "jpeg" ? "image/jpeg" : "image/png";
  const keys: string[] = [];
  try {
    const originalKey = `images/${imageId}/original.${ext}`;
    await putObject(originalKey, processed.original, ctype);
    keys.push(originalKey);
    for (const v of processed.variants) {
      const key = `images/${imageId}/w${v.width}.${ext}`;
      await putObject(key, v.bytes, ctype);
      keys.push(key);
    }
  } catch {
    try { await import("./storage").then(m => m.deleteObjects(keys)); } catch { /* nothing confirmed */ }
    await poolDb.query(`delete from images where id = $1`, [imageId]);
    throw storageUnavailable();
  }

  return withTransaction(async tx => {
    // Pins and saves are placed in the order listed: the first listed gets position 1 (DP-04).
    const countRow = await tx.queryOne<{ n: string }>(
      `select count(*)::text as n from pins where board_id = $1 and section_id is not distinct from $2 and status = 'live'`,
      [args.boardId, args.sectionId]
    );
    const position = Number(countRow!.n) + 1;
    const row = await tx.queryOne<{ id: string }>(
      `insert into pins (owner_id, board_id, section_id, image_id, root_id, title, description, alt, source, source_host, tags, position, status, created_at, updated_at)
       values ($1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, $11, 'live', $12, $12) returning id`,
      [args.ownerId, args.boardId, args.sectionId, imageId, args.title, args.description, args.alt,
       args.source, args.source ? sourceHost(args.source) : null,
       extractTags(args.title, args.description), position, args.at]
    );
    await tx.query(`update boards set last_saved_at = $2 where id = $1 and (last_saved_at is null or last_saved_at < $2)`,
      [args.boardId, args.at]);
    return Number(row!.id);
  });
}
