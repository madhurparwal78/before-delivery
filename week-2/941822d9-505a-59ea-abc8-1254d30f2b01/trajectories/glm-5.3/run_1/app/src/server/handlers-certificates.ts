import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable } from "./db.ts";
import { serialiseEnrolment } from "./dto.ts";
import { loadEnrolment, enrolmentModules } from "./handlers-checkout.ts";
import { loadCertificate, serialiseCertificateDto } from "./handlers-learning.ts";
import { sealVersion } from "./sealing.ts";
import { config } from "./config.ts";
import { getObject } from "./storage.ts";
import { pdfKey, shareLinkTtlSeconds } from "./certificates.ts";
import { newToken } from "./session.ts";
import type { Ctx, PublicCtx } from "./route.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam } from "./route.ts";
import { PROVIDER } from "./config.ts";

async function readableCertificate(ctx: Ctx, id: string) {
  const cert = await loadCertificate(id);
  if (!cert) throw notFound();
  const { rows } = await query<{ nurse_id: string; funding: string; hospital_id: string | null }>(
    `SELECT e.nurse_id, e.funding, e.hospital_id
       FROM certificates c
       JOIN enrolments e ON e.id = c.enrolment_id
      WHERE c.id = $1`,
    [cert.id],
  );
  const access = rows[0];
  if (!access) throw notFound();
  const allowed =
    access.nurse_id === ctx.user.id ||
    ctx.user.role === "planner" ||
    (ctx.user.role === "coordinator" && ctx.user.organisation_id !== null && access.hospital_id === ctx.user.organisation_id && (access.funding === "seat" || access.funding === "co_pay"));
  if (!allowed) throw notFound();
  return { cert, access };
}

export async function getCertificate(ctx: Ctx): Promise<void> {
  const { cert } = await readableCertificate(ctx, pathParam(ctx, "id"));
  ctx.res.json({ certificate: serialiseCertificateDto(cert) });
}

export async function downloadCertificatePdf(ctx: Ctx | PublicCtx): Promise<void> {
  const token = ctx.query.get("token");
  if (token !== null) {
    const { rows } = await query<{ certificate_id: string; version: number }>(
      `SELECT certificate_id, version FROM download_tokens WHERE token = $1 AND expires_at > now()`,
      [token],
    );
    const row = rows[0];
    if (!row || row.certificate_id !== pathParam(ctx, "id")) throw notFound();
    const cert = await loadCertificate(row.certificate_id);
    if (!cert) throw notFound();
    let bytes: Buffer;
    try {
      bytes = await getObject(pdfKey(cert.serial, row.version));
    } catch {
      throw err(503, "storage_unavailable");
    }
    ctx.res.set("Content-Type", "application/pdf");
    ctx.res.set("Cache-Control", "no-store");
    ctx.res.set("Referrer-Policy", "no-referrer");
    ctx.res.send(bytes);
    return;
  }

  if (ctx.user === null) throw notFound();
  const { cert } = await readableCertificate(ctx, pathParam(ctx, "id"));
  if (cert.state === "sealing") throw err(409, "pdf_pending");
  let bytes: Buffer;
  try {
    bytes = await getObject(pdfKey(cert.serial, cert.current_version));
  } catch {
    throw err(503, "storage_unavailable");
  }
  ctx.res.set("Content-Type", "application/pdf");
  ctx.res.send(bytes);
}

export async function transcript(ctx: Ctx): Promise<void> {
  const { rows } = await query<{ id: string }>(
    `SELECT c.id FROM certificates c JOIN enrolments e ON e.id = c.enrolment_id WHERE e.nurse_id = $1 ORDER BY c.created_at`,
    [ctx.user.id],
  );
  const list = [];
  let totalH = 0;
  for (const r of rows) {
    const cert = await loadCertificate(r.id);
    if (!cert) continue;
    if (cert.state === "sealed") totalH += cert.contact_hours_h;
    list.push(serialiseCertificateDto(cert));
  }
  ctx.res.json({ certificates: list, total_hours: (totalH / 100).toFixed(2) });
}

export async function createShareLink(ctx: Ctx): Promise<void> {
  const cert = await loadCertificate(uuidOr404(pathParam(ctx, "id")));
  if (!cert) throw notFound();
  if (cert.nurse_id !== ctx.user.id) throw notFound();
  if (cert.state !== "sealed") throw err(409, "certificate_not_sealed");

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    errors[key] = "This field is not accepted.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const link = await withSerializable(async (client) => {
    await client.query(
      `UPDATE share_links SET state = 'revoked' WHERE certificate_id = $1 AND state = 'active'`,
      [cert.id],
    );
    const token = newToken(32);
    const ttl = shareLinkTtlSeconds();
    const { rows } = await client.query<{ id: string; token: string; created_at: Date; expires_at: Date }>(
      `INSERT INTO share_links (id, certificate_id, token, state, created_at, expires_at)
       VALUES (gen_random_uuid(), $1, $2, 'active', now(), now() + make_interval(secs => $3))
       RETURNING id, token, created_at, expires_at`,
      [cert.id, token, ttl],
    );
    return rows[0];
  });
  if (!link) throw new Error("share link insert failed");
  ctx.res.status(201).json({
    link: {
      id: link.id,
      url: `/verify/${link.token}`,
      state: "active",
      created_at: link.created_at.toISOString(),
      expires_at: link.expires_at.toISOString(),
    },
  });
}

export async function listShareLinks(ctx: Ctx): Promise<void> {
  const cert = await loadCertificate(uuidOr404(pathParam(ctx, "id")));
  if (!cert) throw notFound();
  if (cert.nurse_id !== ctx.user.id) throw notFound();
  const { rows } = await query<{ id: string; token: string; state: string; created_at: Date; expires_at: Date }>(
    `SELECT id, token, state, created_at, expires_at FROM share_links WHERE certificate_id = $1
      ORDER BY created_at DESC`,
    [cert.id],
  );
  ctx.res.json({
    links: rows.map((r) => ({
      id: r.id,
      url: `/verify/${r.token}`,
      state: linkState(r.state, r.expires_at),
      created_at: r.created_at.toISOString(),
      expires_at: r.expires_at.toISOString(),
    })),
  });
}

const linkState = (state: string, expiresAt: Date): string => {
  if (state === "active" && Date.now() >= expiresAt.getTime()) return "expired";
  return state;
};

export async function revokeShareLink(ctx: Ctx): Promise<void> {
  const cert = await loadCertificate(uuidOr404(pathParam(ctx, "id")));
  if (!cert) throw notFound();
  if (cert.nurse_id !== ctx.user.id) throw notFound();
  const { rows } = await query<{ id: string; state: string; expires_at: Date }>(
    `SELECT id, state, expires_at FROM share_links WHERE certificate_id = $1 AND id = $2`,
    [cert.id, pathParam(ctx, "linkId")],
  );
  const link = rows[0];
  if (!link) throw notFound();
  await query(`UPDATE share_links SET state = 'revoked' WHERE id = $1`, [link.id]);
  ctx.res.status(204).end();
}

export async function verifyToken(ctx: PublicCtx): Promise<void> {
  const { rows } = await query<{
    certificate_id: string;
    state: string;
    expires_at: Date;
    token: string;
  }>(
    `SELECT l.certificate_id, l.state, l.expires_at, l.token
       FROM share_links l WHERE l.token = $1`,
    [pathParam(ctx, "token")],
  );
  const link = rows[0];
  if (!link) throw notFound();
  const expired = Date.now() >= link.expires_at.getTime();
  if (link.state !== "active" || expired) throw notFound();
  const cert = await loadCertificate(link.certificate_id);
  if (!cert) throw notFound();
  const current = cert.versions.find((v) => v.version === cert.current_version);
  ctx.res.json({
    certificate: {
      serial: cert.serial,
      nurse_name: current?.nurse_name ?? "",
      course_title: cert.course_title,
      contact_hours: (cert.contact_hours_h / 100).toFixed(2),
      issued_on: cert.issued_on,
      state: cert.state === "revoked" ? "revoked" : "sealed",
      provider: PROVIDER.name,
      accreditation_statement: PROVIDER.accreditation,
    },
  });
}

export async function verifyTokenPdf(ctx: PublicCtx): Promise<void> {
  const { rows } = await query<{ certificate_id: string; state: string; expires_at: Date }>(
    `SELECT certificate_id, state, expires_at FROM share_links WHERE token = $1`,
    [pathParam(ctx, "token")],
  );
  const link = rows[0];
  if (!link) throw notFound();
  if (link.state !== "active" || Date.now() >= link.expires_at.getTime()) throw notFound();
  const cert = await loadCertificate(link.certificate_id);
  if (!cert) throw notFound();
  if (cert.state === "revoked") throw notFound();
  let bytes: Buffer;
  try {
    bytes = await getObject(pdfKey(cert.serial, cert.current_version));
  } catch {
    throw err(503, "storage_unavailable");
  }
  ctx.res.set("Content-Type", "application/pdf");
  ctx.res.send(bytes);
}

export { loadEnrolment, enrolmentModules, serialiseEnrolment, config, sealVersion };
