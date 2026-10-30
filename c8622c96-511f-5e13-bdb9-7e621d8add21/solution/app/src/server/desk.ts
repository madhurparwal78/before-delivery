// The desk editor: review queue, publish and hold, withdrawals and legal takedowns.
import { requireRole } from "./auth.js";
import { serverNow } from "./clock.js";
import { query, transaction, type Client } from "./db.js";
import { bumpVersion, etagOf } from "./essays.js";
import { creditLine, creditsOf, essayBodies, essayBody, loadEssay, visibleEssay, type EssayRow } from "./essay-model.js";
import { ApiError, sendJson } from "./http.js";
import { licenceState, type LicenceRow } from "./licence-state.js";
import { assertTransition, ON_SHEET, publishedState } from "./lifecycle.js";
import { cancelEssayMail, queueTakedownNotice } from "./mail.js";
import { on, type Ctx } from "./router.js";
import { deleteObject, keys, moveObject, VARIANTS } from "./s3.js";
import { emptyBody, strictBody } from "./strict-body.js";

const NOTE_MESSAGE = "Desk note must be 1 to 1000 characters";
const REFERENCE_MESSAGE = "Legal reference must be 1 to 200 characters";

const length = (text: string): number => [...text].length;

on("GET", "/api/desk/queue", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "desk_editor");
  const now = await serverNow();
  const review = await query<EssayRow>("SELECT * FROM essays WHERE state = 'in_review' ORDER BY submitted_at, id");
  const withdrawals = await query<EssayRow>(
    "SELECT * FROM essays WHERE withdrawal_requested AND state = ANY($1) ORDER BY id", [ON_SHEET]);
  sendJson(ctx.res, 200, {
    essays: await essayBodies(ctx.person, review, now),
    withdrawal_requests: await essayBodies(ctx.person, withdrawals, now),
  });
});

on("GET", "/api/desk/essays", "none", async (ctx: Ctx) => {
  requireRole(ctx.person, "desk_editor");
  const essays = await query<EssayRow>("SELECT * FROM essays ORDER BY created_at DESC, id");
  sendJson(ctx.res, 200, { essays: await essayBodies(ctx.person, essays, await serverNow()) });
});

/** Locks an essay for a desk action after the visibility and role checks. */
async function deskEssay(ctx: Ctx, client: Client): Promise<EssayRow> {
  const essay = await visibleEssay(ctx.person, ctx.params[0] ?? "", client, true);
  requireRole(ctx.person, "desk_editor");
  return essay;
}

async function respond(ctx: Ctx, client: Client, id: string): Promise<Record<string, unknown>> {
  return essayBody(ctx.person, await loadEssay(id, client) as EssayRow, await serverNow(client), client);
}

on("POST", "/api/essays/:id/publish", "json", async (ctx: Ctx) => {
  const body = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "publish");
    emptyBody(ctx.body);
    await bumpVersion(client, essay.id, "state = $2", [publishedState(essay.lift_at, await serverNow(client))]);
    return respond(ctx, client, essay.id);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version as number) });
});

on("POST", "/api/essays/:id/hold", "json", async (ctx: Ctx) => {
  const body = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "hold");
    const { values, errors } = strictBody(ctx.body, { note: { kind: "string", message: NOTE_MESSAGE } });
    if (typeof values.note === "string" && (length(values.note) < 1 || length(values.note) > 1000)) {
      errors.add("note", NOTE_MESSAGE);
    }
    errors.fail();
    await query("INSERT INTO desk_notes (essay_id, note, at) VALUES ($1, $2, $3)",
      [essay.id, values.note, await serverNow(client)], client);
    await bumpVersion(client, essay.id, "state = 'draft'");
    return respond(ctx, client, essay.id);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version as number) });
});

async function clearShortlists(client: Client, essayId: string): Promise<void> {
  await query("DELETE FROM shortlist_items WHERE frame_id IN (SELECT id FROM frames WHERE essay_id = $1)", [essayId], client);
}

on("POST", "/api/essays/:id/withdraw", "json", async (ctx: Ctx) => {
  const body = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "withdraw");
    if (!essay.withdrawal_requested) {
      throw new ApiError(409, "no_withdrawal_request", "No credited contributor has asked to withdraw this essay.");
    }
    emptyBody(ctx.body);
    await bumpVersion(client, essay.id, "state = 'withdrawn', withdrawal_requested = false");
    await clearShortlists(client, essay.id);
    await cancelEssayMail(client, essay.id, ["alert"]);
    return respond(ctx, client, essay.id);
  });
  sendJson(ctx.res, 200, body, { ETag: etagOf(body.version as number) });
});

/** Deletes derivatives and grant records and moves originals under the legal-hold prefix. */
export async function purgeTakenDown(essayId: string): Promise<void> {
  const frames = await query<{ id: string }>("SELECT id FROM frames WHERE essay_id = $1", [essayId]);
  const licences = await query<{ id: string }>("SELECT id FROM licences WHERE essay_id = $1", [essayId]);
  for (const frame of frames) {
    for (const variant of VARIANTS) await deleteObject(keys.derivative(essayId, frame.id, variant));
    await moveObject(keys.original(essayId, frame.id), keys.legalHold(essayId, frame.id));
  }
  for (const licence of licences) await deleteObject(keys.grant(licence.id));
  await query("UPDATE essays SET storage_purge_pending = false WHERE id = $1", [essayId]);
}

on("POST", "/api/essays/:id/takedown", "json", async (ctx: Ctx) => {
  const result = await transaction(async (client) => {
    const essay = await deskEssay(ctx, client);
    assertTransition(essay.state, "takedown");
    const { values, errors } = strictBody(ctx.body, { reference: { kind: "string", message: REFERENCE_MESSAGE } });
    if (typeof values.reference === "string" && (length(values.reference) < 1 || length(values.reference) > 200)) {
      errors.add("reference", REFERENCE_MESSAGE);
    }
    errors.fail();
    const now = await serverNow(client);
    // Waits for any activation in progress on this essay's licences (they hold the licence row lock).
    const licences = await query<LicenceRow>("SELECT * FROM licences WHERE essay_id = $1 FOR UPDATE", [essay.id], client);
    const revoked = licences.filter((l) => {
      const state = licenceState(l, now);
      return state === "pending_invoice" || state === "active" || state === "expired";
    });
    await query("UPDATE licences SET status = 'revoked', attempt_started_at = NULL WHERE id = ANY($1)",
      [revoked.map((l) => l.id)], client);
    await query("UPDATE licences SET status = 'removed' WHERE essay_id = $1 AND status = 'pending'", [essay.id], client);
    await clearShortlists(client, essay.id);
    await cancelEssayMail(client, essay.id);
    const names = (await creditsOf([essay.id], client)).map((c) => c.name);
    const line = { id: essay.id, title: essay.title, creditLine: creditLine(names) };
    for (const room of new Set(revoked.map((l) => l.newsroom))) {
      const roomLicences = revoked.filter((l) => l.newsroom === room);
      const people = await query<{ email: string }>(
        `SELECT email FROM people WHERE id = ANY($1) OR (newsroom = $2 AND role = 'licensing_manager') ORDER BY email`,
        [roomLicences.map((l) => l.licensed_by), room], client);
      for (const person of people) await queueTakedownNotice(client, line, person.email, roomLicences.map((l) => l.id));
    }
    await bumpVersion(client, essay.id, "state = 'taken_down', takedown_reference = $2, storage_purge_pending = true",
      [values.reference]);
    return { id: essay.id, state: "taken_down", revoked_licences: revoked.length };
  });
  await purgeTakenDown(result.id).catch(() => undefined);
  sendJson(ctx.res, 200, result);
});
