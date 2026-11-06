import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable } from "./db.ts";
import { loadCertificate, serialiseCertificateDto } from "./handlers-learning.ts";
import { sealVersion } from "./sealing.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam, type Ctx } from "./route.ts";

function parseReasonBody(ctx: { body: unknown }): { errors: Record<string, string> } {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "reason") errors[key] = "This field is not accepted.";
  }
  const rawReason = body.reason;
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length === 0 || reason.length > 500) errors.reason = "Give a reason of 1 to 500 characters.";
  return { errors };
}

export async function reissueCertificate(ctx: Ctx): Promise<void> {
  const { errors } = parseReasonBody(ctx);
  const cert = await loadCertificate(uuidOr404(pathParam(ctx, "id")));
  if (!cert) throw notFound();

  const nurseName = await query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1`,
    [cert.nurse_id],
  ).then((r) => r.rows[0]?.display_name ?? "");

  let newVersion = 0;
  await withSerializable(async (client) => {
    const { rows } = await client.query<{ reissue_pending: boolean; state: string; current_version: number }>(
      `SELECT reissue_pending, state, current_version FROM certificates WHERE id = $1 FOR UPDATE`,
      [cert.id],
    );
    const fresh = rows[0];
    if (!fresh) throw notFound();
    if (fresh.state !== "sealed") throw err(409, "invalid_transition", { from: fresh.state, to: "reissued" });
    if (fresh.reissue_pending) throw err(409, "reissue_pending");
    if (Object.keys(errors).length > 0) throw validationError(errors);
    newVersion = fresh.current_version + 1;
    await client.query(
      `INSERT INTO certificate_versions (certificate_id, version, state, nurse_name) VALUES ($1, $2, 'sealing', $3)`,
      [cert.id, newVersion, nurseName],
    );
    await client.query(`UPDATE certificates SET reissue_pending = true, origin = $2 WHERE id = $1`, [cert.id, ctx.origin]);
  });

  let sealed = true;
  try {
    await sealVersion(
      {
        certificate_id: cert.id,
        version: newVersion,
        serial: cert.serial,
        nurse_name: nurseName,
        course_title: cert.course_title,
        contact_hours_h: cert.contact_hours_h,
        nurse_email: cert.nurse_email,
        is_first_version: false,
      },
      ctx.origin,
    );
  } catch {
    sealed = false;
  }
  const fresh = await loadCertificate(cert.id);
  if (!fresh) throw notFound();
  ctx.res.status(sealed ? 201 : 202).json({ certificate: serialiseCertificateDto(fresh) });
}

export async function revokeCertificate(ctx: Ctx): Promise<void> {
  const { errors } = parseReasonBody(ctx);
  const cert = await loadCertificate(uuidOr404(pathParam(ctx, "id")));
  if (!cert) throw notFound();

  await withSerializable(async (client) => {
    const { rows } = await client.query<{ reissue_pending: boolean; state: string }>(
      `SELECT reissue_pending, state FROM certificates WHERE id = $1 FOR UPDATE`,
      [cert.id],
    );
    const fresh = rows[0];
    if (!fresh) throw notFound();
    if (fresh.state !== "sealed") throw err(409, "invalid_transition", { from: fresh.state, to: "revoked" });
    if (fresh.reissue_pending) throw err(409, "reissue_pending");
    if (Object.keys(errors).length > 0) throw validationError(errors);
    await client.query(`UPDATE certificates SET state = 'revoked' WHERE id = $1`, [cert.id]);
    await client.query(
      `UPDATE certificate_versions SET state = 'revoked' WHERE certificate_id = $1 AND version = $2`,
      [cert.id, cert.current_version],
    );
  });

  const fresh = await loadCertificate(cert.id);
  if (!fresh) throw notFound();
  ctx.res.json({ certificate: serialiseCertificateDto(fresh) });
}

export async function plannerCertificatesSearch(ctx: Ctx): Promise<void> {
  const q = ctx.query.get("q") ?? "";
  if (q.length > 100) throw validationError({ q: "Search with at most 100 characters." });
  const like = `%${q}%`;
  const { rows } = await query<{ id: string }>(
    `SELECT DISTINCT c.id
       FROM certificates c
       JOIN enrolments e ON e.id = c.enrolment_id
       JOIN users u ON u.id = c.nurse_id
       LEFT JOIN certificate_versions v ON v.certificate_id = c.id
      WHERE $1 = ''
         OR c.serial ILIKE $2
         OR u.display_name ILIKE $2
         OR v.nurse_name ILIKE $2
      ORDER BY c.id`,
    [q, like],
  );
  const list = [];
  for (const r of rows) {
    const cert = await loadCertificate(r.id);
    if (cert) list.push(serialiseCertificateDto(cert));
  }
  ctx.res.json({ certificates: list });
}
