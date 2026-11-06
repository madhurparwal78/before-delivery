// A case as stored, its status as of now, its Handshake track and its API body.
import type { Db } from "../db.js";
import { rows } from "../db.js";
import { amountText, type Asset } from "../money.js";
import { initials, maskIdentity } from "../names.js";
import { isoInstant, secondsUntil } from "../../shared/format.js";

export type CaseStatus =
  | "awaiting_ownership" | "in_review" | "awaiting_answer" | "accepted" | "rejected" | "no_response" | "cleared"
  | "released" | "returned";
export type CasePath = "counterparty" | "sunrise" | "below_threshold" | "self_hosted" | "review";
/** The path a case follows after screening: the case path itself, or where a review acceptance led. */
export type CaseRoute = Exclude<CasePath, "review">;

export interface DecidedUnder {
  jurisdictionCode: string;
  thresholdCents: bigint | null;
  thresholdCurrency: string;
  ruleInForceSince: string | null;
  rateCents: bigint;
  confirmationLimitCents: bigint;
  counterpartyName: string | null;
  counterpartyRule: "in_force" | "no_rule" | null;
}

/** decided_under as kept in jsonb, with cents as decimal strings. */
interface StoredDecidedUnder extends Omit<DecidedUnder, "thresholdCents" | "rateCents" | "confirmationLimitCents"> {
  thresholdCents: string | null;
  rateCents: string;
  confirmationLimitCents: string;
}

export function storeDecidedUnder(d: DecidedUnder): StoredDecidedUnder {
  return { ...d, thresholdCents: d.thresholdCents?.toString() ?? null, rateCents: d.rateCents.toString(),
    confirmationLimitCents: d.confirmationLimitCents.toString() };
}

function readDecidedUnder(d: StoredDecidedUnder): DecidedUnder {
  return { ...d, thresholdCents: d.thresholdCents === null ? null : BigInt(d.thresholdCents), rateCents: BigInt(d.rateCents),
    confirmationLimitCents: BigInt(d.confirmationLimitCents) };
}

export interface CaseRow {
  id: string;
  workspace_slug: string;
  reference: string;
  created_at: Date;
  created_by_kind: "member" | "partner_key";
  created_by_name: string;
  asset: Asset;
  amount_atomic: string;
  destination_address: string;
  sending_address: string;
  wallet: "hosted" | "self_hosted";
  counterparty_id: string | null;
  customer_id: string;
  originator_name: string | null;
  originator_identity_number: string | null;
  originator_date_of_birth: string | null;
  beneficiary_name: string | null;
  fiat_value_cents: bigint;
  currency: string;
  decided_under: StoredDecidedUnder;
  path: CasePath;
  route: CaseRoute | null;
  status: CaseStatus;
  ownership_required: boolean;
  ownership_confirmed_on: string | null;
  ownership_recorded_at: Date | null;
  ownership_recorded_by: string | null;
  claim_member_id: string | null;
  claim_member_name: string | null;
  claimed_at: Date | null;
  claim_ends_at: Date | null;
  decision: "accept" | "reject" | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  data_sent_channel: "network" | "request_page" | null;
  data_sent_at: Date | null;
  name_as_sent: string | null;
  answer_due_at: Date | null;
  answer_decision: "accepted" | "rejected" | null;
  answer_at: Date | null;
  answer_late: boolean | null;
  answer_via: "network" | "request_page" | null;
  release_reason_text: string | null;
  release_reason_by: string | null;
  release_reason_at: Date | null;
  outcome: "released" | "returned" | null;
  closed_at: Date | null;
  erasure_due_at: Date | null;
  erased_at: Date | null;
  archived_at: Date | null;
  cp_name: string | null;
  cp_lei: string | null;
  cp_jurisdiction: string | null;
  cp_network: "on_network" | "off_network" | null;
}

export const CASE_SELECT = `
  SELECT c.*, cp.legal_name AS cp_name, cp.lei AS cp_lei, cp.jurisdiction_code AS cp_jurisdiction, cp.network AS cp_network
    FROM cases c LEFT JOIN counterparties cp ON cp.id = c.counterparty_id`;

export interface RequestPageRow {
  id: string;
  case_id: string;
  contact_email: string;
  sent_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  answered_at: Date | null;
}

interface StoredObjectRow {
  case_id: string;
  kind: "message" | "certificate";
  object_key: string;
  sha256: string;
  deleted_at: Date | null;
}

interface CaseExtras {
  requestPage: RequestPageRow | null;
  objects: StoredObjectRow[];
}

/** The latest request page and the stored objects of each case, fetched in two queries. */
export async function caseExtras(db: Db, caseIds: string[]): Promise<Map<string, CaseExtras>> {
  const out = new Map<string, CaseExtras>(caseIds.map((id) => [id, { requestPage: null, objects: [] }]));
  if (caseIds.length === 0) return out;
  const pages = await rows<RequestPageRow>(db,
    "SELECT DISTINCT ON (case_id) * FROM request_pages WHERE case_id = ANY($1) ORDER BY case_id, sent_at DESC, id", [caseIds]);
  for (const page of pages) out.get(page.case_id)!.requestPage = page;
  const objects = await rows<StoredObjectRow>(db,
    "SELECT case_id, kind, object_key, sha256, deleted_at FROM stored_objects WHERE case_id = ANY($1) ORDER BY stored_at, id", [caseIds]);
  for (const object of objects) out.get(object.case_id)!.objects.push(object);
  return out;
}

const OPEN: CaseStatus[] = ["awaiting_ownership", "in_review", "awaiting_answer", "accepted", "rejected", "no_response", "cleared"];

export function isOpen(status: CaseStatus): boolean {
  return OPEN.includes(status);
}

/** From the due instant on, a case still awaiting an answer reads No response. */
export function effectiveStatus(c: CaseRow, now: number): CaseStatus {
  return c.status === "awaiting_answer" && c.answer_due_at && now >= c.answer_due_at.getTime() ? "no_response" : c.status;
}

/** True exactly in the releasable states. */
export function releaseAllowed(c: CaseRow, now: number): boolean {
  const status = effectiveStatus(c, now);
  return status === "accepted" || status === "cleared" || (status === "no_response" && c.release_reason_text !== null);
}

type PageStatus = "live" | "ended" | "answered";

export function pageStatus(page: RequestPageRow, now: number): PageStatus {
  if (page.ended_at || now >= page.ends_at.getTime()) return "ended";
  return page.answered_at ? "answered" : "live";
}

type StationState = "pending" | "current" | "done" | "late" | "refused" | "not_required";

interface Station {
  station: "screened" | "counterparty" | "data_sent" | "answered" | "closed";
  label: string;
  state: StationState;
  text: string;
  at: string | null;
}

type Step = [StationState, string, Date | null];
const NOT_REACHED: Step = ["pending", "Not reached", null];

/** The five stations of the Handshake track, from the server's record only. */
function handshakeTrack(c: CaseRow, now: number): Station[] {
  const status = effectiveStatus(c, now);
  const open = isOpen(status);
  const decided = readDecidedUnder(c.decided_under);

  let counterparty: Step;
  if (c.wallet === "self_hosted") counterparty = ["done", "Self-hosted wallet", c.created_at];
  else if (c.path !== "review") counterparty = ["done", c.name_as_sent ?? decided.counterpartyName ?? "", c.created_at];
  else if (c.decision === "accept") counterparty = ["done", c.name_as_sent ?? decided.counterpartyName ?? "", c.decided_at];
  else if (c.decision === "reject") counterparty = ["refused", "Rejected in review", c.decided_at];
  else counterparty = open ? ["current", "In review", null] : NOT_REACHED;

  let dataSent: Step = NOT_REACHED;
  let answered: Step = NOT_REACHED;
  if (c.route === "self_hosted") {
    dataSent = c.ownership_required ? ["done", "Ownership", c.created_at] : ["not_required", "Not required", null];
    if (!c.ownership_required) answered = ["not_required", "Not required", null];
    else if (c.ownership_recorded_at) answered = ["done", "Confirmed", c.ownership_recorded_at];
    else if (open) answered = ["current", "Ownership pending", null];
  } else if (c.route === "below_threshold") {
    dataSent = ["not_required", "Below threshold", null];
    answered = ["not_required", "Not required", null];
  } else if (c.route === "sunrise" || c.route === "counterparty") {
    dataSent = ["done", c.data_sent_channel === "network" ? "Message sent" : "Request page sent", c.data_sent_at];
    if (c.route === "sunrise") answered = ["not_required", "No rule in force", null];
    else if (c.answer_decision && !c.answer_late) {
      answered = c.answer_decision === "accepted" ? ["done", "Accepted", c.answer_at] : ["refused", "Rejected", c.answer_at];
    } else if (c.answer_due_at && c.answer_due_at.getTime() <= (c.closed_at?.getTime() ?? now)) {
      answered = ["late", "No response", c.answer_due_at];
    } else if (open) answered = ["current", "Waiting for answer", null];
  }

  let closed: Step;
  if (c.outcome) closed = ["done", c.outcome === "released" ? "Released" : "Returned", c.closed_at];
  else if (status === "rejected") closed = ["current", "Return only", null];
  else if (status === "no_response" && !c.release_reason_text) closed = ["current", "Reason needed", null];
  else if (releaseAllowed(c, now)) closed = ["current", "Ready to release", null];
  else closed = ["pending", "Open", null];

  const steps: [Station["station"], string, Step][] = [
    ["screened", "Screened", ["done", "Address checked", c.created_at]],
    ["counterparty", "Counterparty found", counterparty],
    ["data_sent", "Data sent", dataSent],
    ["answered", "Answered", answered],
    ["closed", "Closed", closed],
  ];
  return steps.map(([station, label, [state, text, at]]) => ({
    station, label, state, text,
    at: at && (state === "done" || state === "late" || state === "refused") ? isoInstant(at.getTime()) : null,
  }));
}

const iso = (d: Date | null): string | null => (d ? isoInstant(d.getTime()) : null);

/** The published case body; masked (for a support agent) it has initials, the last four identity characters and no birth date. */
export function caseBody(c: CaseRow, extras: CaseExtras, masked: boolean, now: number) {
  const status = effectiveStatus(c, now);
  const decided = readDecidedUnder(c.decided_under);
  const erasureDue = c.erasure_due_at;
  const erasureStatus = c.erased_at ? "erased" : !erasureDue ? "not_due" : now >= erasureDue.getTime() ? "pending" : "scheduled";
  const page = extras.requestPage;
  const claimActive = c.claim_ends_at && c.claim_ends_at.getTime() > now && !c.decision;
  return {
    id: c.id,
    reference: c.reference,
    createdAt: isoInstant(c.created_at.getTime()),
    createdBy: c.created_by_kind === "member"
      ? { kind: "member" as const, name: c.created_by_name }
      : { kind: "partner_key" as const, label: c.created_by_name },
    asset: c.asset,
    amount: amountText(c.asset, BigInt(c.amount_atomic)),
    destinationAddress: c.destination_address,
    sendingAddress: c.sending_address,
    wallet: c.wallet,
    counterparty: c.counterparty_id
      ? { id: c.counterparty_id, name: c.cp_name, lei: c.cp_lei, jurisdictionCode: c.cp_jurisdiction, network: c.cp_network }
      : null,
    originator: c.originator_name === null ? null : masked
      ? { customerId: c.customer_id, name: initials(c.originator_name), identityNumber: maskIdentity(c.originator_identity_number ?? "") }
      : { customerId: c.customer_id, name: c.originator_name, identityNumber: c.originator_identity_number,
        dateOfBirth: c.originator_date_of_birth },
    beneficiaryName: c.beneficiary_name === null ? null : masked ? initials(c.beneficiary_name) : c.beneficiary_name,
    fiatValueCents: c.fiat_value_cents,
    currency: c.currency,
    decidedUnder: decided,
    path: c.path,
    status,
    dataSent: c.data_sent_channel
      ? { channel: c.data_sent_channel, at: iso(c.data_sent_at), counterpartyNameAsSent: c.name_as_sent }
      : null,
    answer: c.answer_decision
      ? { decision: c.answer_decision, at: iso(c.answer_at), late: c.answer_late === true, via: c.answer_via }
      : null,
    answerDueAt: iso(c.answer_due_at),
    answerRemainingSeconds: c.answer_due_at ? (status === "awaiting_answer" ? secondsUntil(c.answer_due_at, now) : 0) : null,
    ownership: {
      required: c.ownership_required,
      confirmedOn: c.ownership_confirmed_on,
      recordedAt: iso(c.ownership_recorded_at),
      recordedBy: c.ownership_recorded_by,
    },
    review: c.path === "review"
      ? {
        claim: claimActive && c.claim_ends_at
          ? { memberId: c.claim_member_id, memberName: c.claim_member_name, claimedAt: iso(c.claimed_at),
            endsAt: iso(c.claim_ends_at), remainingSeconds: secondsUntil(c.claim_ends_at, now) }
          : null,
        decision: c.decision
          ? { decision: c.decision, reason: c.decision_reason, decidedBy: c.decided_by, decidedAt: iso(c.decided_at) }
          : null,
      }
      : null,
    requestPage: page
      ? { status: pageStatus(page, now), sentAt: iso(page.sent_at), endsAt: iso(page.ends_at),
        remainingSeconds: pageStatus(page, now) === "live" ? secondsUntil(page.ends_at, now) : 0,
        contactEmail: page.contact_email }
      : null,
    releaseReason: c.release_reason_text
      ? { text: c.release_reason_text, recordedBy: c.release_reason_by, recordedAt: iso(c.release_reason_at) }
      : null,
    releaseAllowed: releaseAllowed(c, now),
    outcome: c.outcome,
    closedAt: iso(c.closed_at),
    erasure: {
      status: erasureStatus,
      dueAt: iso(erasureDue),
      erasedAt: iso(c.erased_at),
      digests: extras.objects.map((o) => ({ kind: o.kind, objectKey: o.object_key, sha256: o.sha256 })),
    },
    archived: false,
    track: handshakeTrack(c, now),
    now: isoInstant(now),
  };
}

export function archivedSummary(c: CaseRow) {
  return { id: c.id, reference: c.reference, archived: true, archivedAt: iso(c.archived_at), closedAt: iso(c.closed_at) };
}
