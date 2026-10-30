import { err, notFound, validationError } from "./errors.ts";
import { query, withSerializable } from "./db.ts";
import { serialiseEnrolment } from "./dto.ts";
import { loadEnrolment, enrolmentModules, type EnrolmentRecord } from "./handlers-checkout.ts";
import type { Ctx } from "./route.ts";
import { uuidOr404 } from "./validation.ts";
import { pathParam } from "./route.ts";
import type { PoolClient } from "pg";
import { awardedHoursH, nextSerial } from "./certificates.ts";
import { sealVersion } from "./sealing.ts";

/** The enrolment, but only when it belongs to this learner. */
async function ownEnrolment(ctx: Ctx, id: string): Promise<EnrolmentRecord> {
  const enrolment = await loadEnrolment(uuidOr404(id));
  if (!enrolment) throw notFound();
  if (enrolment.nurse_id !== ctx.user.id) throw notFound();
  return enrolment;
}

export async function getModule(ctx: Ctx): Promise<void> {
  const enrolment = await ownEnrolment(ctx, pathParam(ctx, "id"));
  const { rows } = await query<{ id: string; title: string; minutes: number; kind: "lesson" | "evaluation"; body: string | null; question_prompt: string | null; question_options: string[] | null; verified: string }>(
    `SELECT m.id, m.title, m.minutes, m.kind, m.body, m.question_prompt, m.question_options,
            (mv.enrolment_id IS NOT NULL)::text AS verified
       FROM modules m
       LEFT JOIN module_verifications mv ON mv.module_id = m.id AND mv.enrolment_id = $2
      WHERE m.course_id = $1 AND m.id = $3`,
    [enrolment.course_id, enrolment.id, pathParam(ctx, "moduleId")],
  );
  const m = rows[0];
  if (!m) throw notFound();
  ctx.res.json({
    module: {
      id: m.id,
      title: m.title,
      minutes: m.minutes,
      kind: m.kind,
      body: m.body ?? "",
      question: m.kind === "lesson" ? { prompt: m.question_prompt ?? "", options: m.question_options ?? [] } : null,
    },
    status: m.verified === "true" ? "verified" : "unverified",
  });
}

export async function answerModule(ctx: Ctx): Promise<void> {
  const enrolment = await ownEnrolment(ctx, pathParam(ctx, "id"));

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "option_index") errors[key] = "This field is not accepted.";
  }

  const { rows } = await query<{ id: string; kind: "lesson" | "evaluation"; answer_index: number | null; question_options: string[] | null; verified: string }>(
    `SELECT m.id, m.kind, m.answer_index, m.question_options,
            (mv.enrolment_id IS NOT NULL)::text AS verified
       FROM modules m
       LEFT JOIN module_verifications mv ON mv.module_id = m.id AND mv.enrolment_id = $2
      WHERE m.course_id = $1 AND m.id = $3`,
    [enrolment.course_id, enrolment.id, pathParam(ctx, "moduleId")],
  );
  const m = rows[0];
  if (!m) throw notFound();

  if (enrolment.state === "held" || enrolment.state === "refunded" || enrolment.state === "withdrawn") {
    throw err(409, "enrolment_inactive");
  }
  if (m.kind === "evaluation") throw err(409, "not_a_lesson");
  if (m.verified === "true") {
    const fresh = await loadEnrolment(enrolment.id);
    if (!fresh) throw notFound();
    ctx.res.json({ enrolment: serialiseEnrolment(fresh, await enrolmentModules(fresh.id)) });
    return;
  }
  const optionCount = (m.question_options ?? []).length;
  const raw = body.option_index;
  const optionIndex = typeof raw === "number" && Number.isInteger(raw) ? raw : null;
  if (optionIndex === null || optionIndex < 0 || optionIndex >= optionCount || optionIndex !== m.answer_index) {
    errors.option_index = "That is not the best answer. Review the lesson and try again.";
    throw validationError(errors);
  }

  await query(
    `INSERT INTO module_verifications (enrolment_id, module_id, verified_at) VALUES ($1, $2, now())
     ON CONFLICT (enrolment_id, module_id) DO NOTHING`,
    [enrolment.id, m.id],
  );

  const fresh = await loadEnrolment(enrolment.id);
  if (!fresh) throw notFound();
  ctx.res.json({ enrolment: serialiseEnrolment(fresh, await enrolmentModules(fresh.id)) });
}

export async function submitEvaluation(ctx: Ctx): Promise<void> {
  const enrolment = await ownEnrolment(ctx, pathParam(ctx, "id"));

  // The existing-certificate short-circuit runs before every conflict and
  // validation and ignores the body.
  const existingCert = await query<{ id: string }>(`SELECT id FROM certificates WHERE enrolment_id = $1`, [enrolment.id]);
  const existing = existingCert.rows[0];
  if (existing) {
    const cert = await loadCertificate(existing.id);
    if (!cert) throw notFound();
    ctx.res.json({ certificate: serialiseCertificateDto(cert) });
    return;
  }

  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!["rating", "met_outcomes", "comment"].includes(key)) errors[key] = "This field is not accepted.";
  }

  if (enrolment.state === "held" || enrolment.state === "refunded" || enrolment.state === "withdrawn") {
    throw err(409, "enrolment_inactive");
  }

  const { rows: lessonRows } = await query<{ total: string; verified: string }>(
    `SELECT (SELECT count(*) FROM modules m WHERE m.course_id = $1 AND m.kind = 'lesson')::text AS total,
            (SELECT count(*) FROM module_verifications mv JOIN modules m ON m.id = mv.module_id
              WHERE mv.enrolment_id = $2 AND m.kind = 'lesson')::text AS verified`,
    [enrolment.course_id, enrolment.id],
  );
  if (Number(lessonRows[0]?.verified ?? 0) < Number(lessonRows[0]?.total ?? 0)) {
    throw err(409, "lessons_unverified");
  }

  const rating = body.rating;
  const met = body.met_outcomes;
  const comment = body.comment;
  if (!(typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    errors.rating = "Choose a rating from 1 to 5.";
  }
  if (typeof met !== "boolean") errors.met_outcomes = "Answer yes or no.";
  if (comment !== undefined && comment !== null && (typeof comment !== "string" || comment.length > 1000)) {
    errors.comment = "Keep comments under 1000 characters.";
  }
  if (Object.keys(errors).length > 0) throw validationError(errors);

  const origin = ctx.origin;
  const certificateId = await withSerializable(async (client) => {
    // The post-evaluation module is verified when the evaluation is accepted.
    await client.query(
      `INSERT INTO module_verifications (enrolment_id, module_id, verified_at)
       SELECT $1, m.id, now() FROM modules m WHERE m.course_id = $2 AND m.kind = 'evaluation'
       ON CONFLICT (enrolment_id, module_id) DO NOTHING`,
      [enrolment.id, enrolment.course_id],
    );
    const certId = await createCertificate(client, {
      enrolmentId: enrolment.id,
      nurseId: ctx.user.id,
      nurseName: ctx.user.display_name,
      verifiedMinutes: await verifiedMinutes(client, enrolment.id),
    });
    await client.query(
      `INSERT INTO evaluations (enrolment_id, rating, met_outcomes, comment, submitted_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (enrolment_id) DO NOTHING`,
      [enrolment.id, rating as number, met as boolean, typeof comment === "string" ? comment : null],
    );
    await client.query(`UPDATE enrolments SET state = 'completed' WHERE id = $1 AND state = 'confirmed'`, [enrolment.id]);
    await client.query(`UPDATE certificates SET origin = $2 WHERE id = $1`, [certId, origin]);
    return certId;
  });

  let sealed = true;
  try {
    const cert = await loadCertificate(certificateId);
    if (!cert) throw notFound();
    await sealVersion(sealDataFor(cert, 1), origin);
  } catch {
    sealed = false;
  }
  const fresh = await loadCertificate(certificateId);
  if (!fresh) throw notFound();
  ctx.res.status(sealed ? 201 : 202).json({ certificate: serialiseCertificateDto(fresh) });
}

async function verifiedMinutes(client: PoolClient, enrolmentId: string): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COALESCE(sum(m.minutes),0)::text AS total
       FROM module_verifications mv JOIN modules m ON m.id = mv.module_id
      WHERE mv.enrolment_id = $1`,
    [enrolmentId],
  );
  return Number(rows[0]?.total ?? 0);
}

async function createCertificate(client: PoolClient, input: { enrolmentId: string; nurseId: string; nurseName: string; verifiedMinutes: number }): Promise<string> {
  const hoursH = awardedHoursH(input.verifiedMinutes);
  const serial = await nextSerial(client);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO certificates (id, enrolment_id, nurse_id, serial, contact_hours_h, current_version, state, reissue_pending, origin)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 'sealing', false, '') RETURNING id`,
    [input.enrolmentId, input.nurseId, serial, hoursH],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("certificate insert failed");
  await client.query(
    `INSERT INTO certificate_versions (certificate_id, version, state, nurse_name) VALUES ($1, 1, 'sealing', $2)`,
    [id, input.nurseName],
  );
  return id;
}

type CertificateFull = {
  id: string;
  enrolment_id: string;
  serial: string;
  course_title: string;
  contact_hours_h: number;
  current_version: number;
  state: "sealing" | "sealed" | "revoked";
  reissue_pending: boolean;
  issued_on: string | null;
  verified_module_count: number;
  nurse_id: string;
  nurse_email: string;
  origin: string;
  versions: Array<{ version: number; state: "sealing" | "sealed" | "reissued" | "revoked"; sealed_on: string | null; nurse_name: string }>;
};

export async function loadCertificate(id: string): Promise<CertificateFull | null> {
  const { rows } = await query<CertificateFull>(
    `SELECT c.id, c.enrolment_id, c.serial, co.title AS course_title, c.contact_hours_h, c.current_version, c.state,
            c.reissue_pending, to_char(c.issued_on,'YYYY-MM-DD') AS issued_on,
            (SELECT count(*) FROM module_verifications mv JOIN modules m ON m.id = mv.module_id
              WHERE mv.enrolment_id = c.enrolment_id)::int AS verified_module_count,
            c.nurse_id, u.email AS nurse_email, c.origin,
            COALESCE((SELECT json_agg(json_build_object('version', v.version, 'state', v.state,
                          'sealed_on', to_char(v.sealed_on,'YYYY-MM-DD'), 'nurse_name', v.nurse_name) ORDER BY v.version)
                        FROM certificate_versions v WHERE v.certificate_id = c.id), '[]') AS versions
       FROM certificates c
       JOIN enrolments e ON e.id = c.enrolment_id
       JOIN courses co ON co.id = e.course_id
       JOIN users u ON u.id = c.nurse_id
      WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export function serialiseCertificateDto(cert: CertificateFull): Record<string, unknown> {
  const current = cert.versions.find((v) => v.version === cert.current_version);
  return {
    id: cert.id,
    serial: cert.serial,
    state: cert.state,
    version: cert.current_version,
    reissue_pending: cert.reissue_pending,
    nurse_name: current?.nurse_name ?? "",
    course_title: cert.course_title,
    contact_hours: (cert.contact_hours_h / 100).toFixed(2),
    issued_on: cert.issued_on,
    enrolment_id: cert.enrolment_id,
    verified_module_count: cert.verified_module_count,
    versions: cert.versions.map((v) => ({ version: v.version, state: v.state, sealed_on: v.sealed_on, nurse_name: v.nurse_name })),
  };
}

function sealDataFor(cert: CertificateFull, version: number): Parameters<typeof sealVersion>[0] {
  const current = cert.versions.find((v) => v.version === version);
  return {
    certificate_id: cert.id,
    version,
    serial: cert.serial,
    nurse_name: current?.nurse_name ?? "",
    course_title: cert.course_title,
    contact_hours_h: cert.contact_hours_h,
    nurse_email: cert.nurse_email,
    is_first_version: version === 1,
  };
}

export async function requestRefund(ctx: Ctx): Promise<void> {
  const enrolment = await ownEnrolment(ctx, pathParam(ctx, "id"));


  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== "reason") errors[key] = "This field is not accepted.";
  }

  if (enrolment.state === "completed" || enrolment.state === "certified") throw err(409, "already_certified");
  if (enrolment.funding === "seat" || enrolment.state === "held" || enrolment.state === "refunded" || enrolment.state === "withdrawn") {
    throw err(409, "not_refundable");
  }

  const { rows: pending } = await query<{ id: string }>(
    `SELECT id FROM refund_requests WHERE enrolment_id = $1 AND state = 'pending'`,
    [enrolment.id],
  );
  if (pending.length > 0) throw err(409, "refund_pending");

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0 || reason.length > 500) {
    errors.reason = "Tell the planner why you are asking for a refund.";
    throw validationError(errors);
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO refund_requests (id, enrolment_id, state, reason) VALUES (gen_random_uuid(), $1, 'pending', $2) RETURNING id`,
    [enrolment.id, reason],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("refund insert failed");
  const request = await loadRefundRequest(id);
  if (!request) throw notFound();
  ctx.res.status(201).json({ refund_request: request });
}

export async function loadRefundRequest(id: string): Promise<Record<string, unknown> | null> {
  const { rows } = await query(
    `SELECT r.id, r.enrolment_id, u.display_name AS nurse_name, co.title AS course_title, r.state, r.reason, r.requested_at,
            r.refund_total_cents, r.employer_refund_cents, r.learner_refund_cents,
            r.decided_by, du.display_name AS decided_by_name, r.decided_at, r.decision_note
       FROM refund_requests r
       JOIN enrolments e ON e.id = r.enrolment_id
       JOIN courses co ON co.id = e.course_id
       JOIN users u ON u.id = e.nurse_id
       LEFT JOIN users du ON du.id = r.decided_by
      WHERE r.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    enrolment_id: row.enrolment_id,
    nurse_name: row.nurse_name,
    course_title: row.course_title,
    state: row.state,
    reason: row.reason,
    requested_at: (row.requested_at as Date).toISOString(),
    refund_total: row.refund_total_cents === null ? null : cents(row.refund_total_cents as number),
    employer_refund: row.employer_refund_cents === null ? null : cents(row.employer_refund_cents as number),
    learner_refund: row.learner_refund_cents === null ? null : cents(row.learner_refund_cents as number),
    decided_by: row.decided_by === null ? null : { id: row.decided_by, display_name: row.decided_by_name },
    decided_at: row.decided_at === null ? null : (row.decided_at as Date).toISOString(),
    decision_note: row.decision_note,
  };
}

const cents = (c: number): string => (c / 100).toFixed(2);
