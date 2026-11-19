// Inspector links: issue (snapshot, record and email together), revoke, reissue, and the read-only view.
import { randomBytes, randomUUID } from "node:crypto";
import { one, pool, rows, theRow, tx, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { now } from "./clock.ts";
import { config } from "./config.ts";
import { json, type AuthedCtx, type Ctx, type Reply } from "./router.ts";
import { Fields } from "./validate.ts";
import { linkFor, truckById, truckFor, type TruckRow } from "./scope.ts";
import { linkState, projectLink, type LinkRow } from "./projections.ts";
import { inspectorVisit, truckLog } from "./visits.ts";
import { deleteObject, getObject, putObject, snapshotKey } from "./storage.ts";
import { renderPdf, wrap, type PdfLine } from "./pdf.ts";
import { enqueueMail } from "./outbox.ts";
import { inspectorLinkMail } from "./emails.ts";
import { fileHeaders } from "./documents.ts";
import { gapCellText, siteDateTime } from "../shared/format.ts";
import { isoInstant } from "../shared/time.ts";
import { SERVICE_LABELS, type InspectorView } from "../shared/api.ts";

const LINK_SELECT = "SELECT id, truck_id, inspector_email, url, expires_at, revoked_at, created_at, token FROM inspector_links";

/**
 * The inspector copy field list: truck name and permit, operator business, commissary name, address
 * and zone, and per visit its times, services, signature, manager and gap flag. Nothing else.
 */
async function inspectorCopy(db: Db | typeof pool, truck: TruckRow, expiresAt: Date, at: number): Promise<InspectorView> {
  const log = await truckLog(db, truck.id, at);
  return {
    truck: { name: truck.name, permit_number: truck.permit_number },
    operator: { business_name: truck.business_name },
    commissary: { site_name: truck.site_name, address: truck.address, time_zone: truck.time_zone },
    expires_at: isoInstant(expiresAt.getTime()),
    overdue: log.overdue,
    last_departed_at: log.lastDepartedAt ? isoInstant(log.lastDepartedAt.getTime()) : null,
    visits: log.visits.map(inspectorVisit),
  };
}

function snapshotPdf(view: InspectorView): Buffer {
  const zone = view.commissary.time_zone;
  const lines: PdfLine[] = [
    ...wrap(`${view.truck.name} commissary visits`, 14),
    ...wrap(`Truck: ${view.truck.name}   Permit: ${view.truck.permit_number}`, 10),
    ...wrap(`Operator: ${view.operator.business_name}`, 10),
    ...wrap(`Commissary: ${view.commissary.site_name}, ${view.commissary.address}`, 10),
    ...wrap(`Time zone: ${zone}`, 10),
    { text: "", size: 10 },
  ];
  for (const visit of view.visits) {
    lines.push(
      ...wrap(`Arrived ${siteDateTime(visit.arrived_at, zone)}   Departed ${visit.departed_at ? siteDateTime(visit.departed_at, zone) : "—"}`, 10),
      ...wrap(`Services: ${visit.services.map((s) => SERVICE_LABELS[s]).join(", ") || "—"}`, 10),
      ...wrap(`Operator signature: ${visit.operator_signature ?? "—"}   Manager: ${visit.manager_name}`, 10),
      ...wrap(`Gap: ${gapCellText(visit.gap_hours, visit.gap_flagged)}`, 10),
      { text: "", size: 10 },
    );
  }
  return renderPdf(lines);
}

/** Stores the snapshot (handing its key to `keep`), then writes the record and queues the email. */
async function issue(db: Db, truck: TruckRow, email: string, origin: string, at: number, keep: (key: string) => void): Promise<LinkRow> {
  const id = randomUUID();
  const token = randomBytes(18).toString("base64url");
  const expiresAt = new Date(at + config.inspectorLinkTtlSeconds * 1000);
  const url = `${origin}/inspect/${token}`;
  const key = snapshotKey(truck.tenant_id, truck.id, id);
  await putObject(key, snapshotPdf(await inspectorCopy(db, truck, expiresAt, at)), "application/pdf");
  keep(key);
  await db.query(
    `INSERT INTO inspector_links (id, truck_id, inspector_email, token, url, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, truck.id, email, token, url, expiresAt, new Date(at)],
  );
  await enqueueMail(
    db,
    inspectorLinkMail(email, {
      truckName: truck.name,
      siteName: truck.site_name,
      url,
      expiresLocal: siteDateTime(isoInstant(expiresAt.getTime()), truck.time_zone),
      timeZone: truck.time_zone,
    }),
  );
  return theRow<LinkRow>(db, `${LINK_SELECT} WHERE id = $1`, [id]);
}

/** Issuing is all-or-nothing: if anything after the snapshot fails, including the commit, the snapshot is deleted. */
async function issuing(work: (db: Db, keep: (key: string) => void) => Promise<Reply>): Promise<Reply> {
  const keys: string[] = [];
  try {
    return await tx((db) => work(db, (key) => keys.push(key)), { retry: false });
  } catch (error) {
    for (const key of keys) await deleteObject(key);
    throw error;
  }
}

// GET /api/trucks/{truck_id}/inspector-links
export async function listLinks(ctx: AuthedCtx): Promise<Reply> {
  const truck = await truckFor(pool, ctx.user, ctx.params.truck_id);
  const list = await rows<LinkRow>(pool, `${LINK_SELECT} WHERE truck_id = $1 ORDER BY created_at DESC, seq DESC`, [truck.id]);
  const at = now();
  return json(200, { links: list.map((l) => projectLink(l, at)) });
}

// POST /api/trucks/{truck_id}/inspector-links
export async function issueLink(ctx: AuthedCtx): Promise<Reply> {
  const truck = await truckFor(pool, ctx.user, ctx.params.truck_id);
  const fields = new Fields(ctx.body, ["inspector_email"]);
  const email = fields.email("inspector_email", "Enter a valid email address.");
  if (email === undefined) return fields.reject();
  fields.raise();
  return issuing(async (db, keep) => {
    const at = now();
    return json(201, { link: projectLink(await issue(db, truck, email, ctx.origin, at, keep), at) });
  });
}

// POST /api/inspector-links/{id}/revoke
export async function revokeLink(ctx: AuthedCtx): Promise<Reply> {
  const found = await linkFor(pool, ctx.user, ctx.params.id);
  const fields = new Fields(ctx.body, []);
  return tx(async (db) => {
    const at = now();
    const link = await one<LinkRow>(db, `${LINK_SELECT} WHERE id = $1 FOR UPDATE`, [found.id]);
    if (!link || linkState(link, at) !== "live") throw new ApiError("invalid_transition");
    fields.raise();
    await db.query("UPDATE inspector_links SET revoked_at = $2 WHERE id = $1", [link.id, new Date(at)]);
    const after = await theRow<LinkRow>(db, `${LINK_SELECT} WHERE id = $1`, [link.id]);
    return json(200, { link: projectLink(after, at) });
  });
}

// POST /api/inspector-links/{id}/reissue
export async function reissueLink(ctx: AuthedCtx): Promise<Reply> {
  const found = await linkFor(pool, ctx.user, ctx.params.id);
  const fields = new Fields(ctx.body, []);
  const truck = await truckFor(pool, ctx.user, found.truck_id);
  return issuing(async (db, keep) => {
    const at = now();
    const old = await one<LinkRow>(db, `${LINK_SELECT} WHERE id = $1 FOR UPDATE`, [found.id]);
    if (!old || linkState(old, at) !== "live") throw new ApiError("invalid_transition");
    fields.raise();
    await db.query("UPDATE inspector_links SET revoked_at = $2 WHERE id = $1", [old.id, new Date(at)]);
    const issued = await issue(db, truck, old.inspector_email, ctx.origin, at, keep);
    const replaced = await theRow<LinkRow>(db, `${LINK_SELECT} WHERE id = $1`, [old.id]);
    return json(201, { link: projectLink(issued, at), replaced: projectLink(replaced, at) });
  });
}

/** The live link for a token: unknown answers 404, revoked 410 link_revoked, expired 410 link_expired. */
async function liveLink(token: string | undefined, at: number): Promise<LinkRow & { token: string }> {
  if (token === undefined || !/^[A-Za-z0-9_-]+$/.test(token)) throw new ApiError("not_found");
  const link = await one<LinkRow & { token: string }>(pool, `${LINK_SELECT} WHERE token = $1`, [token]);
  if (!link) throw new ApiError("not_found");
  const state = linkState(link, at);
  if (state === "revoked") throw new ApiError("link_revoked");
  if (state === "expired") throw new ApiError("link_expired");
  return link;
}

// GET /api/inspect/{token}
export async function inspectView(ctx: Ctx): Promise<Reply> {
  const at = now();
  const link = await liveLink(ctx.params.token, at);
  const truck = await truckById(pool, link.truck_id);
  if (!truck) throw new ApiError("not_found");
  return json(200, await inspectorCopy(pool, truck, link.expires_at, at));
}

// GET /api/inspect/{token}/log.pdf
export async function inspectPdf(ctx: Ctx): Promise<Reply> {
  const link = await liveLink(ctx.params.token, now());
  const truck = await truckById(pool, link.truck_id);
  if (!truck) throw new ApiError("not_found");
  const data = await getObject(snapshotKey(truck.tenant_id, truck.id, link.id));
  return { kind: "bytes", status: 200, data, headers: { ...fileHeaders("application/pdf", `${truck.name.replace(/[^A-Za-z0-9]/g, "_")}_visit_log.pdf`), "Content-Length": String(data.length) } };
}
