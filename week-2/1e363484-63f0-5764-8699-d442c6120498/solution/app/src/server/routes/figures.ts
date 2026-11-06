// Figure reads, audit trails and regulator links, for signed-in people and for link holders.

import { randomBytes, randomUUID } from "node:crypto";
import { fingerprintOf } from "../domain/derivation.js";
import { findProject, requireRole, visibleProject, type Person, type Project, type ProjectRole } from "../auth.js";
import { config } from "../config.js";
import { pool, transaction } from "../db.js";
import { linkStatus, revokeRefusal, type RegulatorLink } from "../domain/linkStatus.js";
import { isoTimestamp, nowSeconds } from "../domain/time.js";
import { auditTrail, evidenceKeys, findFigure, rederivedFigure, type StoredFigure } from "../figures.js";
import { HttpError, notFound, type Context, type Reply, type Route } from "../http.js";
import { getObject, StorageUnavailable } from "../storage.js";
import { requirePerson } from "./common.js";

const FIGURE_ID = "(?<figure>[A-Z]{2}-F\\d{4})";

async function visibleFigure(person: Person, figureId: string): Promise<{ figure: StoredFigure; project: Project; role: ProjectRole }> {
  const figure = await findFigure(pool, figureId);
  if (!figure) throw notFound();
  const { project, role } = await visibleProject(person, figure.project);
  return { figure, project, role };
}

const LINK_COLUMNS = `id, figure_id, token, epoch(issued_at) AS issued_at, epoch(expires_at) AS expires_at,
  epoch(revoked_at) AS revoked_at`;

/** The HTTP Date header for the one clock read a link surface decided with. */
const dateHeader = (now: number) => ({ Date: new Date(now * 1000).toUTCString() });

function linkBody(link: RegulatorLink, now: number) {
  return {
    id: link.id, token: link.token, url: `${config.publicUrl}/r/${link.token}`, status: linkStatus(link, now),
    issued_at: isoTimestamp(link.issued_at), expires_at: isoTimestamp(link.expires_at),
    revoked_at: link.revoked_at === null ? null : isoTimestamp(link.revoked_at),
  };
}

/** The live link behind a public token, decided at `now`; 404 unknown, 410 revoked or expired. */
async function liveLink(token: string, now: number): Promise<{ figure: StoredFigure; project: Project; link: RegulatorLink }> {
  const { rows } = await pool.query<RegulatorLink>(`SELECT ${LINK_COLUMNS} FROM regulator_links WHERE token = $1`, [token]);
  const link = rows[0];
  if (!link) throw new HttpError(404, { error: "not_found" }, dateHeader(now));
  const status = linkStatus(link, now);
  if (status === "revoked") throw new HttpError(410, { error: "link_revoked", revoked_at: isoTimestamp(link.revoked_at!) }, dateHeader(now));
  if (status === "expired") throw new HttpError(410, { error: "link_expired", expires_at: isoTimestamp(link.expires_at) }, dateHeader(now));
  const figure = (await findFigure(pool, link.figure_id))!;
  return { figure, project: (await findProject(figure.project))!, link };
}

async function publicFigure(ctx: Context): Promise<Reply> {
  const now = nowSeconds();
  const { figure, project, link } = await liveLink(ctx.params.token!, now);
  return {
    status: 200,
    headers: dateHeader(now),
    json: {
      link: { status: linkStatus(link, now), expires_at: isoTimestamp(link.expires_at) },
      project: { name: project.name, kind: project.kind },
      figure: await rederivedFigure(project, figure, now),
    },
  };
}

const TOKEN = "(?<token>[A-Za-z0-9_-]+)";

export const figureRoutes: Route[] = [
  {
    method: "GET", pattern: new RegExp(`^/api/figures/${FIGURE_ID}$`),
    handle: async (ctx) => {
      const { figure, project } = await visibleFigure(await requirePerson(ctx), ctx.params.figure!);
      return { status: 200, json: await rederivedFigure(project, figure, nowSeconds()) };
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/figures/${FIGURE_ID}/audit$`),
    handle: async (ctx) => {
      const { figure } = await visibleFigure(await requirePerson(ctx), ctx.params.figure!);
      return { status: 200, json: await auditTrail(figure) };
    },
  },
  {
    method: "POST", pattern: new RegExp(`^/api/figures/${FIGURE_ID}/links$`),
    handle: async (ctx) => {
      const { figure, role } = await visibleFigure(await requirePerson(ctx), ctx.params.figure!);
      requireRole(role, "sealer");
      const now = nowSeconds();
      const link: RegulatorLink = {
        id: randomUUID(), figure_id: figure.id, token: randomBytes(32).toString("base64url"),
        issued_at: now, expires_at: now + config.linkTtlSeconds, revoked_at: null,
      };
      const { rowCount } = await pool.query(
        `INSERT INTO regulator_links (id, figure_id, token, issued_at, expires_at)
         SELECT $1, id, $3, to_timestamp($4), to_timestamp($5) FROM figures WHERE id = $2 AND status = 'sealed'`,
        [link.id, link.figure_id, link.token, link.issued_at, link.expires_at]);
      if (!rowCount) throw new HttpError(409, { error: "figure_not_sealed" });
      const { revoked_at: _revoked, ...issued } = linkBody(link, now);
      return { status: 201, json: issued, headers: dateHeader(now) };
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/figures/${FIGURE_ID}/links$`),
    handle: async (ctx) => {
      const { figure, role } = await visibleFigure(await requirePerson(ctx), ctx.params.figure!);
      requireRole(role, "sealer");
      const now = nowSeconds();
      const { rows } = await pool.query<RegulatorLink>(
        `SELECT ${LINK_COLUMNS} FROM regulator_links WHERE figure_id = $1 ORDER BY issued_at DESC, id`, [figure.id]);
      return { status: 200, json: { links: rows.map((link) => linkBody(link, now)) }, headers: dateHeader(now) };
    },
  },
  {
    method: "POST", pattern: new RegExp(`^/api/figures/${FIGURE_ID}/links/(?<link>[0-9a-f-]{36})/revoke$`),
    handle: async (ctx) => {
      const { figure, role } = await visibleFigure(await requirePerson(ctx), ctx.params.figure!);
      requireRole(role, "sealer");
      return transaction(async (db) => {
        const { rows } = await db.query<RegulatorLink>(
          `SELECT ${LINK_COLUMNS} FROM regulator_links WHERE id = $1 AND figure_id = $2 FOR UPDATE`, [ctx.params.link, figure.id]);
        const now = nowSeconds();
        const link = rows[0];
        if (!link) throw new HttpError(404, { error: "not_found" }, dateHeader(now));
        const refusal = revokeRefusal(link, now);
        if (refusal) throw new HttpError(409, { error: refusal }, dateHeader(now));
        await db.query("UPDATE regulator_links SET revoked_at = to_timestamp($2) WHERE id = $1", [link.id, now]);
        return { status: 200, json: { id: link.id, status: "revoked", revoked_at: isoTimestamp(now) }, headers: dateHeader(now) };
      });
    },
  },
  { method: "GET", pattern: new RegExp(`^/api/public/links/${TOKEN}$`), handle: publicFigure },
  { method: "POST", pattern: new RegExp(`^/api/public/links/${TOKEN}/rederive$`), handle: publicFigure },
  {
    method: "GET", pattern: new RegExp(`^/api/public/links/${TOKEN}/audit$`),
    handle: async (ctx) => {
      const now = nowSeconds();
      const { figure } = await liveLink(ctx.params.token!, now);
      return { status: 200, json: await auditTrail(figure), headers: dateHeader(now) };
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/public/links/${TOKEN}/evidence$`),
    handle: async (ctx) => {
      const now = nowSeconds();
      const { figure } = await liveLink(ctx.params.token!, now);
      const bytes = await getObject(evidenceKeys(figure.id).readings_key).catch((error: unknown) => {
        throw error instanceof StorageUnavailable ? new HttpError(503, { error: "storage_unavailable" }, dateHeader(now)) : error;
      });
      if (fingerprintOf(bytes) !== figure.fingerprint) {
        throw new HttpError(409, { error: "evidence_mismatch" }, dateHeader(now));
      }
      return {
        status: 200, bytes,
        headers: {
          ...dateHeader(now), "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${figure.id}-readings.csv"`, "X-Fluxseal-Fingerprint": figure.fingerprint,
        },
      };
    },
  },
];
