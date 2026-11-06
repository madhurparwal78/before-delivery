// Private page lifetime (brief: Private pages): live until its end instant (the instant itself is ended),
// until a manager ends it, until a new page replaces it, or, for a manifest page, until its charter closes.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { config } from "../config";
import { one, type Db } from "../db";
import { ApiError, notFound, type Json } from "../http";
import { isoInstant } from "../../shared/zones";

export type PageKind = "manifest" | "broker";

export interface PageRow {
  token: string;
  kind: PageKind;
  workspace_slug: string;
  charter_id: string | null;
  broker_id: string | null;
  issued_at: Date;
  ends_at: Date;
  ended_at: Date | null;
}

export function pageLive(page: PageRow, nowMs: number): boolean {
  return page.ended_at === null && page.ends_at.getTime() > nowMs;
}

/** A page by its token: 404 when unknown, 410 once ended. */
export async function livePage(db: Db, kind: PageKind, token: string, nowMs: number): Promise<PageRow> {
  const page = await one<PageRow>(db, "SELECT * FROM private_pages WHERE token = $1 AND kind = $2", [token, kind]);
  if (!page) throw notFound();
  if (!pageLive(page, nowMs)) throw new ApiError(410, { error: "page_ended" });
  return page;
}

function ownerColumn(kind: PageKind): "charter_id" | "broker_id" {
  return kind === "manifest" ? "charter_id" : "broker_id";
}

/** The newest page of a charter or broker, if any. */
export async function latestPage(db: Db, workspace: string, kind: PageKind, owner: string): Promise<PageRow | undefined> {
  return one<PageRow>(
    db,
    `SELECT * FROM private_pages WHERE workspace_slug = $1 AND kind = $2 AND ${ownerColumn(kind)}::text = $3 ORDER BY issued_at DESC LIMIT 1`,
    [workspace, kind, owner],
  );
}

export function pageStatusJson(page: PageRow | undefined, nowMs: number, withPath: boolean): Json {
  if (!page) return { status: "none", issuedAt: null, endsAt: null, ...(withPath ? { path: null } : {}) };
  return {
    status: pageLive(page, nowMs) ? "live" : "ended",
    issuedAt: isoInstant(page.issued_at.getTime()),
    endsAt: isoInstant(page.ends_at.getTime()),
    ...(withPath ? { path: `/${page.kind === "manifest" ? "m" : "b"}/${page.token}` } : {}),
  };
}

/** Issues a new page and ends every earlier one of the same owner at once. */
export async function issuePage(db: pg.PoolClient, workspace: string, kind: PageKind, owner: string): Promise<PageRow> {
  await endPages(db, workspace, kind, owner);
  const token = randomBytes(24).toString("base64url");
  const lifetime = kind === "manifest" ? config.timers.manifestPageSeconds : config.timers.brokerPageSeconds;
  return (await one<PageRow>(
    db,
    `INSERT INTO private_pages (token, kind, workspace_slug, ${ownerColumn(kind)}, issued_at, ends_at)
     VALUES ($1, $2, $3, $4, date_trunc('second', now()), date_trunc('second', now()) + make_interval(secs => $5)) RETURNING *`,
    [token, kind, workspace, owner, lifetime],
  ))!;
}

/** Ends every page of the owner that has not ended yet; returns how many were live. */
export async function endPages(db: Db, workspace: string, kind: PageKind, owner: string): Promise<number> {
  const result = await db.query(
    `UPDATE private_pages SET ended_at = now()
      WHERE workspace_slug = $1 AND kind = $2 AND ${ownerColumn(kind)}::text = $3 AND ended_at IS NULL AND ends_at > now()`,
    [workspace, kind, owner],
  );
  return result.rowCount ?? 0;
}
