import { db, one, tx } from "../db.js";
import { conflict, forbidden, notFound, Validation } from "../http/errors.js";
import type { Reply, SignedInCtx } from "../http/router.js";
import { certificateById, createCertificate, sealVersion } from "./certificates.js";
import { isId, modulesOf, type ModuleRow } from "./courses.js";
import { enrolmentJson, readableEnrolment, type EnrolmentRow } from "./enrolments.js";

/** Enrolments in these states cannot study: held (not yet paid), refunded or withdrawn. */
const INACTIVE = new Set(["held", "refunded", "withdrawn"]);

async function ownEnrolmentModule(ctx: SignedInCtx): Promise<{ enrolment: EnrolmentRow; module: ModuleRow; modules: ModuleRow[] }> {
  const enrolment = await readableEnrolment(db, ctx.user, ctx.params.id);
  const modules = await modulesOf(db, enrolment.course_id);
  const moduleId = ctx.params.module;
  const module = isId(moduleId) ? modules.find((m) => m.id === moduleId) : undefined;
  if (!module) throw notFound();
  if (enrolment.learner_id !== ctx.user.id) throw forbidden();
  return { enrolment, module, modules };
}

const isVerified = async (enrolmentId: string, moduleId: string): Promise<boolean> =>
  (await one(db, "SELECT 1 FROM module_verifications WHERE enrolment_id = $1 AND module_id = $2", [enrolmentId, moduleId])) !== undefined;

export async function readModule(ctx: SignedInCtx): Promise<Reply> {
  const { enrolment, module } = await ownEnrolmentModule(ctx);
  const lesson = module.kind === "lesson";
  return {
    status: 200,
    json: {
      module: {
        id: module.id,
        title: module.title,
        minutes: module.minutes,
        kind: module.kind,
        body: lesson ? module.body : null,
        question: lesson ? { prompt: module.prompt, options: module.options } : null,
      },
      status: (await isVerified(enrolment.id, module.id)) ? "verified" : "unverified",
    },
  };
}

/** A lesson is verified only when its knowledge-check answer is the correct option. */
export async function answerModule(ctx: SignedInCtx): Promise<Reply> {
  const { enrolment, module } = await ownEnrolmentModule(ctx);
  if (INACTIVE.has(enrolment.state)) throw conflict("enrolment_inactive");
  if (module.kind !== "lesson") throw conflict("not_a_lesson");
  if (await isVerified(enrolment.id, module.id)) return { status: 200, json: { enrolment: await enrolmentJson(db, enrolment.id) } };
  const v = new Validation(ctx.body, ["option_index"]);
  if (ctx.body.option_index !== module.answer_index) v.add("option_index", "That is not the best answer. Review the lesson and try again.");
  v.done();
  await db.q("INSERT INTO module_verifications (enrolment_id, module_id, verified_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
    enrolment.id,
    module.id,
    ctx.now,
  ]);
  return { status: 200, json: { enrolment: await enrolmentJson(db, enrolment.id) } };
}

const lessonsUnverified = async (enrolmentId: string, modules: ModuleRow[]): Promise<boolean> => {
  const verified = await db.q<{ module_id: string }>("SELECT module_id FROM module_verifications WHERE enrolment_id = $1", [enrolmentId]);
  const done = new Set(verified.map((v) => v.module_id));
  return modules.some((m) => m.kind === "lesson" && !done.has(m.id));
};

/**
 * Accepting the post-evaluation verifies the evaluation module, completes the enrolment and creates the one
 * certificate for it in a single serialisable transaction; the certificate then seals as soon as its PDF is stored.
 */
export async function submitEvaluation(ctx: SignedInCtx): Promise<Reply> {
  const { user: nurse, body, now } = ctx;
  const found = await readableEnrolment(db, nurse, ctx.params.id);
  if (found.learner_id !== nurse.id) throw forbidden();
  if (found.certificate_id) return { status: 200, json: { certificate: await certificateById(db, found.certificate_id) } };
  if (INACTIVE.has(found.state)) throw conflict("enrolment_inactive");
  const modules = await modulesOf(db, found.course_id);
  if (await lessonsUnverified(found.id, modules)) throw conflict("lessons_unverified");
  const v = new Validation(body, ["rating", "met_outcomes", "comment"]);
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) v.add("rating", "Choose a rating from 1 to 5.");
  if (typeof body.met_outcomes !== "boolean") v.add("met_outcomes", "Answer yes or no.");
  const comment = body.comment ?? null;
  if (comment !== null && (typeof comment !== "string" || comment.length > 1000)) v.add("comment", "Keep comments under 1000 characters.");
  v.done();

  const outcome = await tx(async (t) => {
    const enrolment = await readableEnrolment(t, nurse, found.id, true);
    if (enrolment.certificate_id) return { id: enrolment.certificate_id, created: false };
    if (INACTIVE.has(enrolment.state)) throw conflict("enrolment_inactive");
    const evaluation = modules.find((m) => m.kind === "evaluation");
    await t.q("INSERT INTO evaluations (enrolment_id, rating, met_outcomes, comment, submitted_at) VALUES ($1, $2, $3, $4, $5)", [
      enrolment.id,
      rating,
      body.met_outcomes,
      comment,
      now,
    ]);
    if (evaluation) {
      await t.q("INSERT INTO module_verifications (enrolment_id, module_id, verified_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
        enrolment.id,
        evaluation.id,
        now,
      ]);
    }
    await t.q("UPDATE enrolments SET state = 'completed' WHERE id = $1", [enrolment.id]);
    const verified = await readableEnrolment(t, nurse, enrolment.id);
    return { id: await createCertificate(t, verified, nurse, modules.length, ctx.origin, now), created: true };
  });
  if (!outcome.created) return { status: 200, json: { certificate: await certificateById(db, outcome.id) } };
  const sealed = await sealVersion(outcome.id, 1, now);
  return { status: sealed ? 201 : 202, json: { certificate: await certificateById(db, outcome.id) } };
}
