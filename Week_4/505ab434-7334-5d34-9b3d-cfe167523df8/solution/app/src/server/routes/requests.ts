// Requests: create, read, submit, withdraw, resubmit, stage decisions, conditions and the review queue.
import { createHash } from "node:crypto";
import { cardOf, CARD_NAME_SQL } from "../availability.ts";
import { config } from "../config.ts";
import { normaliseCondition, conditionText } from "../conditions.ts";
import { Denied, withDenialAudit } from "../denial.ts";
import { pool, transaction, type Tx } from "../db.ts";
import { ApiError, forbidden, invalidBody, notFound, wrongState } from "../errors.ts";
import { created, ok, type Ctx, type Router } from "../http.ts";
import { canSeeRequest, requestDetail } from "../requestView.ts";
import {
  announce,
  decideStage,
  loadRequest,
  canMove,
  loadStages,
  openStage,
  reopenForResubmission,
  submitRequest,
  withdrawRequest,
  type RequestRow,
  type StageRow,
} from "../requestWorkflow.ts";
import { stageLabel } from "../routing.ts";
import { liveRules } from "../rules.ts";
import { isCalendarDate } from "../../shared/dates.ts";
import {
  APPLICATION_VALUES,
  CONDITION_KINDS,
  DECISIONS,
  DECISION_LABELS,
  REQUEST_STATE_LABELS,
  applicationOf,
  type AssetClass,
  type ConditionKind,
  type Decision,
  type Escalation,
} from "../../shared/domain.ts";
import type { Principal, QueueRow, RequestSummary } from "../../shared/api.ts";

interface Fields {
  applicationClass: string;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: string[];
  note: string;
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

/** Request fields from a body, with `base` filling what the body leaves out; wrong types are an invalid body. */
function fieldsOf(raw: Record<string, unknown>, base: Fields | null): Fields {
  const pick = <K extends keyof Fields>(key: K, ok: (v: unknown) => boolean): Fields[K] => {
    const value = raw[key];
    if (value === undefined && base) return base[key];
    if (!ok(value)) throw invalidBody();
    return value as Fields[K];
  };
  return {
    applicationClass: pick("applicationClass", (v) => typeof v === "string" && APPLICATION_VALUES.includes(v)),
    territories: pick("territories", isStrings),
    campaignStartsOn: pick("campaignStartsOn", isCalendarDate),
    campaignEndsOn: pick("campaignEndsOn", isCalendarDate),
    citedRules: pick("citedRules", isStrings),
    note: pick("note", (v) => typeof v === "string"),
  };
}

/** Validation in the body's field order: the first failure names the refusal (brief: Request validation). */
async function validateFields(tx: Tx, requesterId: string, assetId: string, fields: Fields): Promise<void> {
  const licence = (await tx.one<{ permitted: string[]; prohibited: string[]; territories: string[] }>(
    `SELECT l.permitted_applications AS permitted, l.prohibited_applications AS prohibited, l.territories
       FROM assets a JOIN licences l ON l.id = a.licence_id WHERE a.id = $1`, [assetId]))!;
  const label = applicationOf(fields.applicationClass)!.label;
  if (licence.prohibited.includes(fields.applicationClass) || !licence.permitted.includes(fields.applicationClass)) {
    throw new ApiError(422, "application_prohibited", `${label} use is not permitted by this licence.`);
  }
  const org = (await tx.one<{ engagement_territories: string[] | null }>(
    "SELECT o.engagement_territories FROM principals p JOIN organisations o ON o.id = p.organisation_id WHERE p.id = $1", [requesterId]))!;
  const engagement = org.engagement_territories ?? [];
  const within = (code: string): boolean => engagement.includes(code) && (licence.territories.includes("worldwide") || licence.territories.includes(code));
  if (fields.territories.length === 0 || !fields.territories.every(within)) {
    throw new ApiError(422, "territory_invalid", `Territories must be within your engagement: ${engagement.join(", ")}.`);
  }
  if (fields.campaignEndsOn < fields.campaignStartsOn) throw new ApiError(422, "campaign_dates", "Campaign end must be on or after its start.");
  if (fields.citedRules.length === 0) throw new ApiError(422, "rules_required", "Cite at least one rule.");
  const live = new Set((await liveRules(tx)).map((r) => r.identifier));
  for (const identifier of fields.citedRules) {
    if (!live.has(identifier)) throw new ApiError(422, "rule_unknown", `${identifier} is not a live rule.`);
  }
  if (fields.note.length > 2000) throw new ApiError(422, "note_too_long", "Note must be 2,000 characters or fewer.");
}

const fingerprintOf = (raw: Record<string, unknown>): string =>
  createHash("sha256")
    .update(JSON.stringify(["assetId", "variantId", "applicationClass", "territories", "campaignStartsOn", "campaignEndsOn", "citedRules", "note", "submit"].map((k) => raw[k] ?? null)))
    .digest("hex");

const isAgency = (principal: Principal): boolean => principal.role === "agency";

async function visibleRequest(tx: Tx, principal: Principal, id: string): Promise<RequestRow> {
  const req = await loadRequest(tx, id, true);
  if (!req || !canSeeRequest(principal, req)) throw notFound();
  return req;
}

/** The requester-only actions: another caller who can see the request is refused. */
function requireRequester(principal: Principal, req: RequestRow): void {
  if (principal.id !== req.requester_id) throw forbidden();
}

const notAllowedIn = (req: RequestRow): ApiError => wrongState(`${req.id} is already ${REQUEST_STATE_LABELS[req.state]}.`);

async function create(ctx: Ctx): Promise<ReturnType<typeof created>> {
  const user = ctx.user();
  if (!isAgency(user)) throw forbidden();
  const raw = await ctx.json();
  return transaction(async (tx) => {
    if (typeof raw.idempotencyKey !== "string" || raw.idempotencyKey === "") throw invalidBody();
    await tx.q("SELECT pg_advisory_xact_lock(hashtext($1))", [`request:${user.id}`]);
    const fingerprint = fingerprintOf(raw);
    const earlier = await tx.one<RequestRow>(
      "SELECT * FROM requests WHERE requester_id = $1 AND idempotency_key = $2 ORDER BY created_at DESC, id DESC LIMIT 1", [user.id, raw.idempotencyKey]);
    if (earlier && Date.parse(tx.now) - Date.parse(earlier.created_at) <= config.submitDedupSeconds * 1000) {
      if (earlier.fingerprint !== fingerprint) throw new ApiError(409, "idempotency_conflict", "This submission key was already used for a different request.");
      return created(await requestDetail(tx, user, earlier));
    }
    if (typeof raw.assetId !== "string" || (raw.variantId !== null && typeof raw.variantId !== "string") || typeof raw.submit !== "boolean") {
      throw invalidBody();
    }
    const card = await cardOf(tx, user, raw.assetId, (raw.variantId as string | null) ?? null);
    if (!card) throw notFound();
    if (card.badge !== "Request required") throw new ApiError(409, "not_requestable", `${card.cardName} cannot be requested: ${card.reason}`);
    if (card.openRequestId) throw new ApiError(409, "duplicate_open_request", `You already have ${card.openRequestId} open.`);
    if (!card.canRequest) throw new ApiError(409, "not_requestable", `${card.cardName} cannot be requested: ${card.requestReason}`);
    const fields = fieldsOf(raw, null);
    await validateFields(tx, user.id, raw.assetId, fields);
    const id = `REQ-${String(await tx.next("request")).padStart(4, "0")}`;
    await tx.q(
      `INSERT INTO requests (id, requester_id, asset_id, variant_id, application_class, territories, campaign_starts_on, campaign_ends_on,
         cited_rules, note, state, holder_id, idempotency_key, fingerprint, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$2,$11,$12,$13)`,
      [id, user.id, raw.assetId, raw.variantId ?? null, fields.applicationClass, fields.territories, fields.campaignStartsOn,
        fields.campaignEndsOn, fields.citedRules, fields.note, raw.idempotencyKey, fingerprint, tx.now],
    );
    const req = (await loadRequest(tx, id))!;
    if (raw.submit) await submitRequest(tx, req, { id: user.id, role: user.role }, null);
    else announce(tx, req);
    return created(await requestDetail(tx, user, (await loadRequest(tx, id))!));
  });
}

async function submit(ctx: Ctx): Promise<ReturnType<typeof ok>> {
  const user = ctx.user();
  return transaction(async (tx) => {
    const req = await visibleRequest(tx, user, ctx.params.id);
    requireRequester(user, req);
    if (req.state !== "draft") throw notAllowedIn(req);
    await submitRequest(tx, req, { id: user.id, role: user.role }, { state: "draft" });
    return ok(await requestDetail(tx, user, (await loadRequest(tx, req.id))!));
  });
}

async function withdraw(ctx: Ctx): Promise<ReturnType<typeof ok>> {
  const user = ctx.user();
  return transaction(async (tx) => {
    const req = await visibleRequest(tx, user, ctx.params.id);
    requireRequester(user, req);
    if (!canMove(req.state, "withdrawn")) throw notAllowedIn(req);
    await withdrawRequest(tx, req, { id: user.id, role: user.role });
    return ok(await requestDetail(tx, user, (await loadRequest(tx, req.id))!));
  });
}

async function resubmit(ctx: Ctx): Promise<ReturnType<typeof ok>> {
  const user = ctx.user();
  return transaction(async (tx) => {
    const req = await visibleRequest(tx, user, ctx.params.id);
    requireRequester(user, req);
    if (req.state !== "changes_requested") throw notAllowedIn(req);
    const raw = await ctx.json(true);
    const fields = fieldsOf(raw, {
      applicationClass: req.application_class,
      territories: req.territories,
      campaignStartsOn: req.campaign_starts_on,
      campaignEndsOn: req.campaign_ends_on,
      citedRules: req.cited_rules,
      note: req.note,
    });
    await validateFields(tx, user.id, req.asset_id, fields);
    await tx.q(
      `UPDATE requests SET application_class = $2, territories = $3, campaign_starts_on = $4, campaign_ends_on = $5, cited_rules = $6, note = $7 WHERE id = $1`,
      [req.id, fields.applicationClass, fields.territories, fields.campaignStartsOn, fields.campaignEndsOn, fields.citedRules, fields.note],
    );
    const updated = (await loadRequest(tx, req.id))!;
    await reopenForResubmission(tx, updated);
    await submitRequest(tx, updated, { id: user.id, role: user.role }, { state: "changes_requested" });
    return ok(await requestDetail(tx, user, (await loadRequest(tx, req.id))!));
  });
}

/** Who may act on a stage: its assignee or an owner. Others are refused (403) and the refusal is audited. */
function requireStageHolder(user: Principal, req: RequestRow, stage: StageRow | undefined, holderName: string, action: "request.decided" | "condition.added"): void {
  if (user.role === "owner" || (stage && stage.assignee_id === user.id)) return;
  const record = { actorId: user.id, actorRole: user.role, action, resourceType: "request", resourceId: req.id, requestId: req.id };
  if (user.role !== "brand_reviewer" && user.role !== "legal_reviewer") throw new Denied("forbidden", "You can't do that.", record);
  throw new Denied("not_stage_holder", `Only ${holderName} or an owner can decide this stage.`, record);
}

async function nameOf(tx: Tx, id: string): Promise<string> {
  return id === "system" ? "System" : (await tx.one<{ display_name: string }>("SELECT display_name FROM principals WHERE id = $1", [id]))!.display_name;
}

async function decide(ctx: Ctx): Promise<ReturnType<typeof ok>> {
  const user = ctx.user();
  return withDenialAudit(async (tx) => {
    const req = await visibleRequest(tx, user, ctx.params.id);
    const stages = await loadStages(tx, req.id);
    const stage = stages.find((s) => String(s.n) === ctx.params.n);
    if (!stage) throw notFound();
    requireStageHolder(user, req, stage, await nameOf(tx, stage.assignee_id ?? req.holder_id), "request.decided");
    if (req.state === "withdrawn") throw new ApiError(409, "withdrawn", `${req.id} was withdrawn by ${await nameOf(tx, req.requester_id)}.`);
    if (stage.decision) {
      throw new ApiError(409, "already_decided", `Already decided by ${await nameOf(tx, stage.decided_by!)}: ${DECISION_LABELS[stage.decision]}.`);
    }
    if (req.state !== "under_review" || openStage(stages)!.n !== stage.n) throw notAllowedIn(req);
    const raw = await ctx.json();
    const decision = raw.decision;
    if (!DECISIONS.includes(decision as Decision) || (raw.comment !== null && raw.comment !== undefined && typeof raw.comment !== "string")) throw invalidBody();
    const comment = typeof raw.comment === "string" && raw.comment.trim() !== "" ? raw.comment.trim() : null;
    if (decision === "reject" && !comment) throw new ApiError(422, "reason_required", "Give a reason.");
    if (decision === "request_changes" && !comment) throw new ApiError(422, "comment_required", "Say what needs to change.");
    await decideStage(tx, req, stages, stage, { id: user.id, role: user.role }, decision as Decision, comment);
    return ok(await requestDetail(tx, user, (await loadRequest(tx, req.id))!));
  });
}

async function addCondition(ctx: Ctx): Promise<ReturnType<typeof created>> {
  const user = ctx.user();
  return withDenialAudit(async (tx) => {
    const req = await visibleRequest(tx, user, ctx.params.id);
    const stages = await loadStages(tx, req.id);
    const open = req.state === "under_review" ? openStage(stages) : undefined;
    requireStageHolder(user, req, open, await nameOf(tx, req.holder_id), "condition.added");
    if (req.state !== "under_review") throw notAllowedIn(req);
    const raw = await ctx.json();
    if (!CONDITION_KINDS.includes(raw.kind as ConditionKind)) throw invalidBody();
    const kind = raw.kind as ConditionKind;
    const value = normaliseCondition(kind, raw.value);
    const text = conditionText(kind, value);
    const id = `CON-${String(await tx.next("condition")).padStart(4, "0")}`;
    const position = ((await tx.one<{ n: number }>("SELECT count(*) AS n FROM conditions WHERE request_id = $1", [req.id]))!.n) + 1;
    await tx.q("INSERT INTO conditions (id, request_id, kind, value, text, added_by, position) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, req.id, kind, value, text, user.id, position]);
    tx.audit({ actorId: user.id, actorRole: user.role, action: "condition.added", resourceType: "condition", resourceId: id, requestId: req.id, before: null, after: { kind, text } });
    tx.live({ type: "request.updated", requestId: req.id }, { roles: ["owner", "brand_reviewer", "legal_reviewer"], principals: [req.requester_id] });
    return created({ id, kind, text });
  });
}

interface QueueQuery {
  request_id: string;
  n: number;
  kind: "brand" | "legal";
  card_name: string;
  asset_class: AssetClass;
  application_class: string;
  requester_name: string;
  organisation_name: string;
  deadline: string;
  escalation: Escalation | null;
}

async function queue(ctx: Ctx): Promise<ReturnType<typeof ok>> {
  const user = ctx.user();
  if (!["owner", "brand_reviewer", "legal_reviewer"].includes(user.role)) throw notFound();
  const rows = await pool.query<QueueQuery & { kinds: string[] }>(
    `SELECT r.id AS request_id, s.n, s.kind, r.deadline, r.escalation, r.application_class,
            ${CARD_NAME_SQL} AS card_name, a.class AS asset_class,
            p.display_name AS requester_name, o.name AS organisation_name,
            (SELECT array_agg(k.kind ORDER BY k.n) FROM request_stages k WHERE k.request_id = r.id) AS kinds
       FROM request_stages s JOIN requests r ON r.id = s.request_id JOIN assets a ON a.id = r.asset_id
       LEFT JOIN variants v ON v.id = r.variant_id JOIN principals p ON p.id = r.requester_id JOIN organisations o ON o.id = p.organisation_id
      WHERE s.assignee_id = $1 AND s.decision IS NULL AND r.state = 'under_review'
        AND s.n = (SELECT min(f.n) FROM request_stages f WHERE f.request_id = r.id AND f.decision IS NULL)
      ORDER BY r.deadline, r.id`,
    [user.id],
  );
  const result: QueueRow[] = rows.rows.map((row) => ({
    requestId: row.request_id,
    stage: row.n,
    stageLabel: stageLabel(row.kinds as ("brand" | "legal")[], row.n, row.asset_class),
    cardName: row.card_name,
    applicationLabel: applicationOf(row.application_class)!.label,
    requesterName: row.requester_name,
    organisationName: row.organisation_name,
    deadline: row.deadline,
    escalation: row.escalation,
  }));
  return ok({ rows: result });
}

export function registerRequests(router: Router): void {
  router.post("/api/requests", create);
  router.get("/api/requests", async (ctx) => {
    const user = ctx.user();
    if (!isAgency(user)) throw forbidden();
    const rows = await pool.query<{ id: string; card_name: string; application_class: string; state: keyof typeof REQUEST_STATE_LABELS; deadline: string | null }>(
      `SELECT r.id, r.application_class, r.state, r.deadline,
              ${CARD_NAME_SQL} AS card_name
         FROM requests r JOIN assets a ON a.id = r.asset_id LEFT JOIN variants v ON v.id = r.variant_id
        WHERE r.requester_id = $1 ORDER BY r.id`,
      [user.id],
    );
    const requests: RequestSummary[] = rows.rows.map((r) => ({
      id: r.id,
      cardName: r.card_name,
      applicationLabel: applicationOf(r.application_class)!.label,
      state: r.state,
      stateLabel: REQUEST_STATE_LABELS[r.state],
      deadline: r.deadline,
    }));
    return ok({ requests });
  });
  router.get("/api/requests/:id", async (ctx) => {
    const user = ctx.user();
    return transaction(async (tx) => {
      const req = await loadRequest(tx, ctx.params.id);
      if (!req || !canSeeRequest(user, req)) throw notFound();
      return ok(await requestDetail(tx, user, req));
    });
  });
  router.post("/api/requests/:id/submit", submit);
  router.post("/api/requests/:id/withdraw", withdraw);
  router.post("/api/requests/:id/resubmit", resubmit);
  router.post("/api/requests/:id/stages/:n/decision", decide);
  router.post("/api/requests/:id/conditions", addCondition);
  router.get("/api/queue", queue);
}
