// The six-step brief (brief: API › Brief).
import { randomUUID } from "node:crypto";
import { ADD_ONS, AUDIENCES, DOOR_WALLS, INSTALLATIONS, VENUES, type AddOn } from "../../shared/catalog.js";
import { requireCaller, type Caller } from "../auth.js";
import { commissionView, issueQuote, loadCommission } from "../commissions.js";
import { one, pool, tx, type Db } from "../db.js";
import { fail, invalid, jsonBody, ok, record, UUID, type Request, type Router } from "../http.js";

type Answer = Record<string, unknown>;

interface BriefRow {
  id: string;
  client_id: string;
  answers: Record<string, Answer>;
  answered_through: number;
  next_step: number | null;
  commission_id: string | null;
}

const view = (b: BriefRow) => ({ id: b.id, answers: b.answers, answeredThrough: b.answered_through, nextStep: b.next_step, commissionId: b.commission_id });

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

const halfMetre = (n: number | null): n is number => n !== null && n >= 4 && n <= 60 && Number.isInteger(n * 2);

/** Validates one step's answer; returns the normalised answer or throws the published 422. */
function validateStep(step: number, answer: Answer): Answer {
  const errors: Record<string, string> = {};
  let clean: Answer = {};
  switch (step) {
    case 1: {
      const title = typeof answer.title === "string" ? answer.title.trim() : "";
      if (typeof answer.installationType !== "string" || !(answer.installationType in INSTALLATIONS)) errors.installationType = "Pick what should stand in the room.";
      if (title.length < 2 || title.length > 80) errors.title = "Give the piece a name of 2 to 80 characters.";
      clean = { installationType: answer.installationType, title };
      break;
    }
    case 2:
      if (!VENUES.some((v) => v.id === answer.venueId)) errors.venueId = "Pick a venue from the list.";
      clean = { venueId: answer.venueId };
      break;
    case 3: {
      const widthM = asNumber(answer.widthM);
      const depthM = asNumber(answer.depthM);
      if (!halfMetre(widthM)) errors.widthM = "Enter a width from 4 to 60 metres in half-metre steps.";
      if (!halfMetre(depthM)) errors.depthM = "Enter a depth from 4 to 60 metres in half-metre steps.";
      clean = { widthM, depthM };
      break;
    }
    case 4:
      if (typeof answer.doorWall !== "string" || !(answer.doorWall in DOOR_WALLS)) errors.doorWall = "Pick the wall with the main door.";
      clean = { doorWall: answer.doorWall };
      break;
    case 5:
      if (typeof answer.audience !== "string" || !(answer.audience in AUDIENCES)) errors.audience = "Pick how many people will be there at once.";
      clean = { audience: answer.audience };
      break;
    default: {
      const addOns = Array.isArray(answer.addOns) ? answer.addOns : null;
      const notes = answer.notes === undefined || answer.notes === null ? "" : answer.notes;
      const known = addOns !== null && addOns.every((a) => typeof a === "string" && a in ADD_ONS) && new Set(addOns).size === addOns.length;
      if (!known) errors.addOns = "Pick from the listed extras.";
      if (typeof notes !== "string" || notes.length > 2000) errors.notes = "Keep notes to 2,000 characters or fewer.";
      clean = { addOns: known ? (Object.keys(ADD_ONS) as AddOn[]).filter((a) => addOns.includes(a)) : addOns, notes };
    }
  }
  if (Object.keys(errors).length) invalid(errors);
  return clean;
}

async function briefFor(db: Db, caller: Caller, id: string, lock = false): Promise<BriefRow> {
  if (!UUID.test(id)) return fail(404, "not_found");
  const row = await one<BriefRow & Record<string, unknown>>(`SELECT * FROM briefs WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
  return row && row.client_id === caller.id ? row : fail(404, "not_found");
}

const mayBrief = (caller: Caller): boolean => caller.roles.includes("client");

async function create(req: Request) {
  const caller = await requireCaller(req);
  if (!mayBrief(caller)) fail(403, "forbidden");
  const row = await one<BriefRow & Record<string, unknown>>("INSERT INTO briefs (id, client_id) VALUES ($1, $2) RETURNING *", [randomUUID(), caller.id]);
  return ok(view(row as BriefRow), 201);
}

async function read(req: Request) {
  const caller = await requireCaller(req);
  return ok(view(await briefFor(pool, caller, req.params.id)));
}

async function saveStep(req: Request) {
  const caller = await requireCaller(req);
  const step = /^[1-6]$/.test(req.params.n) ? Number(req.params.n) : 0;
  return tx(async (db) => {
    const brief = await briefFor(db, caller, req.params.id, true);
    if (!step) fail(404, "not_found");
    if (!mayBrief(caller)) fail(403, "forbidden");
    if (brief.commission_id) fail(409, "brief_completed");
    if (step > brief.answered_through + 1) fail(409, "step_out_of_order");
    const answer = validateStep(step, record(record(jsonBody(req)).answer));
    const answers = { ...brief.answers, [String(step)]: answer };
    const saved = await one<BriefRow & Record<string, unknown>>(
      "UPDATE briefs SET answers = $2, answered_through = GREATEST(answered_through, $3), next_step = $4 WHERE id = $1 RETURNING *",
      [brief.id, JSON.stringify(answers), step, step < 6 ? step + 1 : null], db,
    );
    return ok(view(saved as BriefRow));
  });
}

async function complete(req: Request) {
  const caller = await requireCaller(req);
  return tx(async (db) => {
    const brief = await briefFor(db, caller, req.params.id, true);
    if (brief.commission_id) {
      const existing = await loadCommission(db, brief.commission_id);
      return ok(await commissionView(db, existing ?? fail(404, "not_found"), Date.now()), 200);
    }
    if (!mayBrief(caller)) fail(403, "forbidden");
    if (brief.answered_through < 6) fail(409, "brief_incomplete");
    const a = (n: number): Answer => brief.answers[String(n)];
    const id = randomUUID();
    await db.query(
      `INSERT INTO commissions (id, brief_id, client_id, title, state, installation_type, venue_id, width_m, depth_m, door_wall, audience, notes, size, add_ons)
       VALUES ($1, $2, $3, $4, 'briefed', $5, $6, $7, $8, $9, $10, $11, 'compact', $12)`,
      [id, brief.id, caller.id, a(1).title, a(1).installationType, a(2).venueId, a(3).widthM, a(3).depthM, a(4).doorWall, a(5).audience, a(6).notes, a(6).addOns],
    );
    await db.query("UPDATE briefs SET commission_id = $2 WHERE id = $1", [brief.id, id]);
    const c = (await loadCommission(db, id)) ?? fail(404, "not_found");
    await issueQuote(db, c, Date.now());
    return ok(await commissionView(db, c, Date.now()), 201);
  });
}

export function registerBriefs(router: Router): void {
  router.add("POST", "/api/briefs", create);
  router.add("GET", "/api/briefs/:id", read);
  router.add("PUT", "/api/briefs/:id/steps/:n", saveStep);
  router.add("POST", "/api/briefs/:id/complete", complete);
}
