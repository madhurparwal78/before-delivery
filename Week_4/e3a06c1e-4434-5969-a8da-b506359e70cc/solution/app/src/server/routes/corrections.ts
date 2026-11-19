// Corrections: draft -> submitted -> approved | returned, and returned -> draft (reopen).
// Every transition is one conditional UPDATE, so of two simultaneous decisions exactly one wins.
import { OPEN_CORRECTION_STATES, type Correction, type CorrectionState } from "../../shared/types";
import { authenticate, isUuid, permit, visibleProject, visibleSessionProject, type Caller } from "../access";
import { ApiError, invalid, jsonFields, notFound, sendJson, type Request, type Router } from "../http";
import { isUniqueViolation, one, rows } from "../db";
import { CORRECTION_SELECT, correctionObject, segmentById, transcriptOf } from "../transcript";
import { publish } from "../events";
import { limited } from "../../shared/text";

const TEXT_ERROR = "Enter the corrected words.";
const NOTE_ERROR = "Add a note of up to 500 characters.";
/** The state machine: each action is allowed only from this state (approve and return end it; reopen goes back to draft). */
const FROM: Record<"edit" | "submit" | "approve" | "return" | "reopen", CorrectionState> = {
  edit: "draft",
  submit: "draft",
  approve: "submitted",
  return: "submitted",
  reopen: "returned",
};

const invalidTransition = () => new ApiError(409, "invalid_transition", "That change isn't possible from the correction's current state.");

function correctedText(value: unknown): string {
  const text = limited(value, 1, 500);
  if (text === null) throw invalid({ text: TEXT_ERROR });
  return text;
}

async function load(id: string): Promise<Correction | undefined> {
  const [row] = isUuid(id) ? await rows<Parameters<typeof correctionObject>[0]>(`${CORRECTION_SELECT} WHERE c.id = $1`, [id]) : [];
  return row ? correctionObject(row) : undefined;
}

/** A correction inside the caller's visible projects, else 404. */
async function visibleCorrection(request: Request): Promise<{ caller: Caller; correction: Correction }> {
  const caller = await authenticate(request.req);
  const correction = await load(request.params.correction);
  if (!correction) throw notFound();
  await visibleSessionProject(caller, correction.session_id);
  return { caller, correction };
}

/** Applies an action only from its state in FROM; a lost race or any other state is 409 invalid_transition. */
async function transition(id: string, action: keyof typeof FROM, set: string, params: unknown[]): Promise<Correction> {
  const moved = await one<{ id: string }>(`UPDATE corrections SET ${set} WHERE id = $1 AND state = $2 RETURNING id`, [id, FROM[action], ...params]);
  if (!moved) throw invalidTransition();
  return (await load(id))!;
}

function authorOnly(caller: Caller, correction: Correction): void {
  permit(caller, "corrections.author");
  if (correction.author.id !== caller.id) throw new ApiError(403, "not_author", "Only the correction's author can do that.");
}

function deciderOnly(caller: Caller, correction: Correction): void {
  permit(caller, "corrections.decide");
  if (correction.author.id === caller.id) throw new ApiError(403, "own_correction", "You can't approve your own correction.");
}

export function registerCorrections(router: Router): void {
  router.add("POST", "/api/sessions/:session/segments/:segment/corrections", async (request) => {
    const caller = await authenticate(request.req);
    await visibleSessionProject(caller, request.params.session);
    const segment = isUuid(request.params.segment) ? await one<{ id: string }>("SELECT id FROM segments WHERE id = $1 AND session_id = $2", [request.params.segment, request.params.session]) : undefined;
    if (!segment) throw notFound();
    permit(caller, "corrections.author");
    const open = () => new ApiError(409, "correction_open", "Another reviewer already has an open correction on this segment.");
    if (await one("SELECT 1 AS open FROM corrections WHERE segment_id = $1 AND state = ANY($2)", [segment.id, OPEN_CORRECTION_STATES])) throw open();
    const text = correctedText(jsonFields(request).text);
    try {
      const created = (await one<{ id: string }>(
        "INSERT INTO corrections (segment_id, session_id, author_id, state, text) VALUES ($1, $2, $3, 'draft', $4) RETURNING id",
        [segment.id, request.params.session, caller.id, text],
      ))!;
      sendJson(request.res, 201, { correction: await load(created.id) });
    } catch (error) {
      if (isUniqueViolation(error)) throw open();
      throw error;
    }
  });

  router.add("PATCH", "/api/corrections/:correction", async (request) => {
    const { caller, correction } = await visibleCorrection(request);
    authorOnly(caller, correction);
    if (correction.state !== FROM.edit) throw invalidTransition();
    const text = correctedText(jsonFields(request).text);
    sendJson(request.res, 200, { correction: await transition(correction.id, "edit", "text = $3", [text]) });
  });

  router.add("POST", "/api/corrections/:correction/submit", async (request) => {
    const { caller, correction } = await visibleCorrection(request);
    authorOnly(caller, correction);
    sendJson(request.res, 200, { correction: await transition(correction.id, "submit", "state = 'submitted', submitted_at = now()", []) });
  });

  router.add("POST", "/api/corrections/:correction/reopen", async (request) => {
    const { caller, correction } = await visibleCorrection(request);
    authorOnly(caller, correction);
    sendJson(request.res, 200, { correction: await transition(correction.id, "reopen", "state = 'draft', submitted_at = NULL, decided_at = NULL, decided_by = NULL", []) });
  });

  router.add("POST", "/api/corrections/:correction/approve", async (request) => {
    const { caller, correction } = await visibleCorrection(request);
    deciderOnly(caller, correction);
    const approved = await transition(correction.id, "approve", "state = 'approved', decided_at = now(), decided_by = $3", [caller.id]);
    publish(correction.session_id, { event: "correction", data: { segment_id: correction.segment_id } });
    const segment = await segmentById(correction.session_id, correction.segment_id);
    sendJson(request.res, 200, { correction: approved, segment, wer: (await transcriptOf(correction.session_id)).wer });
  });

  router.add("POST", "/api/corrections/:correction/return", async (request) => {
    const { caller, correction } = await visibleCorrection(request);
    deciderOnly(caller, correction);
    if (correction.state !== FROM.return) throw invalidTransition();
    const note = limited(jsonFields(request).note, 1, 500);
    if (note === null) throw invalid({ note: NOTE_ERROR });
    sendJson(request.res, 200, { correction: await transition(correction.id, "return", "state = 'returned', note = $3, decided_at = now(), decided_by = $4", [note, caller.id]) });
  });

  router.add("GET", "/api/projects/:project/corrections", async (request) => {
    const caller = await authenticate(request.req);
    const project = await visibleProject(caller, request.params.project);
    permit(caller, "corrections.list");
    const state = request.query.get("state");
    const found = await rows<Parameters<typeof correctionObject>[0]>(
      `${CORRECTION_SELECT} JOIN sessions s ON s.id = c.session_id WHERE s.project_id = $1 ${state ? "AND c.state = $2" : ""} ORDER BY c.created_at DESC`,
      state ? [project.id, state] : [project.id],
    );
    sendJson(request.res, 200, { corrections: found.map(correctionObject) });
  });
}
