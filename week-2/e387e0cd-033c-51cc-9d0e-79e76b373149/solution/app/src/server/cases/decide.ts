// Case creation: the path decision (decided once, at creation), sending the data and issuing request pages.
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../config.js";
import { digest } from "../auth.js";
import { one, type Db } from "../db.js";
import { FieldCheck, refuse } from "../errors.js";
import { ADDRESS_MESSAGE, isValidAddress } from "../lei.js";
import { amountText, ASSET_DECIMALS, fiatValueCents, isAsset, parseAmount, type Asset } from "../money.js";
import { codePoints } from "../names.js";
import { ruleInForce } from "../rules.js";
import type { Mail } from "../smtp.js";
import type { Workspace } from "../workspaces.js";
import { businessDate, formatCrypto, formatDateTime, maskAddress, stamp } from "../../shared/format.js";
import { storeDecidedUnder, type CasePath, type CaseRoute, type CaseStatus, type DecidedUnder } from "./record.js";

interface CounterpartyRef {
  id: string;
  legal_name: string;
  due_diligence: "trusted" | "pending" | "restricted" | "blocked";
  network: "on_network" | "off_network";
  jurisdiction_code: string;
  contact_email: string | null;
}

interface CaseInput {
  asset: Asset;
  atomic: bigint;
  destinationAddress: string;
  customer: { id: string; name: string; identity_number: string; date_of_birth: string };
  beneficiaryName: string;
  counterparty: CounterpartyRef | null;
}

type CreatedBy = { kind: "member" | "partner_key"; name: string };

/** Fields of a new case. A Blocked counterparty is a state refusal, answered before field errors. */
export async function validateCaseInput(db: Db, workspace: Workspace, body: Record<string, unknown>): Promise<CaseInput> {
  const check = new FieldCheck();
  const { asset, amount, destinationAddress, customerId, beneficiaryName } = body;
  if (!isAsset(asset)) check.fail("asset", "Choose BTC, ETH, USDC or SOL.");
  let atomic: bigint | null = null;
  if (typeof amount !== "string") check.fail("amount", "Send the amount as a string.");
  else if (isAsset(asset)) {
    atomic = parseAmount(asset, amount);
    if (atomic === null) check.fail("amount", `Enter an amount greater than zero with at most ${ASSET_DECIMALS[asset]} decimals.`);
  }
  let counterparty: CounterpartyRef | null = null;
  if (!isValidAddress(destinationAddress)) check.fail("destinationAddress", ADDRESS_MESSAGE);
  else {
    counterparty = await one<CounterpartyRef>(db,
      `SELECT cp.id, cp.legal_name, cp.due_diligence, cp.network, cp.jurisdiction_code, cp.contact_email
         FROM address_registry r JOIN counterparties cp ON cp.id = r.counterparty_id
        WHERE r.workspace_slug = $1 AND r.address = $2`, [workspace.slug, destinationAddress]);
    if (counterparty?.due_diligence === "blocked") {
      throw refuse.conflict("counterparty_blocked", "This counterparty is Blocked. The withdrawal was not created.");
    }
  }
  const customer = typeof customerId === "string"
    ? await one<CaseInput["customer"]>(db,
      "SELECT id, name, identity_number, date_of_birth FROM customers WHERE id = $1 AND workspace_slug = $2", [customerId, workspace.slug])
    : null;
  if (!customer) check.fail("customerId", "Choose a customer.");
  const beneficiary = typeof beneficiaryName === "string" ? beneficiaryName : "";
  if (beneficiary.trim() === "" || codePoints(beneficiary) > 140) check.fail("beneficiaryName", "Enter the beneficiary's name.");
  check.throwIfAny();
  return {
    asset: asset as Asset, atomic: atomic as bigint, destinationAddress: destinationAddress as string,
    customer: customer as CaseInput["customer"], beneficiaryName: beneficiary, counterparty,
  };
}

interface Continuation {
  route: Exclude<CaseRoute, "self_hosted">;
  status: CaseStatus;
}

/** Steps 4 to 6 of the path decision, used at creation and again when a review accepts the case. */
export function continueAfterScreening(fiat: bigint, decided: DecidedUnder): Continuation {
  if (decided.thresholdCents !== null && fiat < decided.thresholdCents) return { route: "below_threshold", status: "cleared" };
  if (decided.counterpartyRule === "no_rule") return { route: "sunrise", status: "cleared" };
  return { route: "counterparty", status: "awaiting_answer" };
}

interface PathDecision {
  path: CasePath;
  route: CaseRoute | null;
  status: CaseStatus;
  ownershipRequired: boolean;
}

/** The published path decision, steps 1 to 6 in order (step 2, Blocked, refuses during validation). */
function decidePath(input: CaseInput, fiat: bigint, decided: DecidedUnder): PathDecision {
  if (!input.counterparty) {
    const ownershipRequired = fiat > decided.confirmationLimitCents;
    return { path: "self_hosted", route: "self_hosted", status: ownershipRequired ? "awaiting_ownership" : "cleared", ownershipRequired };
  }
  if (input.counterparty.due_diligence === "restricted") {
    return { path: "review", route: null, status: "in_review", ownershipRequired: false };
  }
  const next = continueAfterScreening(fiat, decided);
  return { path: next.route, route: next.route, status: next.status, ownershipRequired: false };
}

interface SendTarget {
  id: string;
  reference: string;
  asset: Asset;
  amount_atomic: string;
  destination_address: string;
  sending_address: string;
  counterparty_id: string;
}

/** Issues a private data request page and the mail that carries its address (sent after commit). */
export async function issueRequestPage(db: PoolClient, workspace: Workspace, target: SendTarget, contactEmail: string, atMs: number): Promise<Mail> {
  const token = randomBytes(24).toString("base64url");
  const sentAt = stamp(atMs);
  const endsAt = new Date(sentAt.getTime() + config.timers.dataRequestPage * 1000);
  await db.query(
    "UPDATE request_pages SET ended_at = $2, ends_at = LEAST(ends_at, $2) WHERE case_id = $1 AND ended_at IS NULL", [target.id, sentAt]);
  await db.query(
    `INSERT INTO request_pages (id, workspace_slug, case_id, token_hash, contact_email, sent_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`, [randomUUID(), workspace.slug, target.id, digest(token), contactEmail, sentAt, endsAt]);
  const amount = formatCrypto(target.asset, amountText(target.asset, BigInt(target.amount_atomic)));
  return {
    to: [contactEmail],
    subject: `Travel Rule data request ${target.reference} from ${workspace.name}`,
    text: [
      `${workspace.legalName} asks for your answer to the Travel Rule data of a withdrawal to your exchange.`,
      "",
      `Case reference: ${target.reference}`,
      `Asset and amount: ${amount}`,
      `From address: ${maskAddress(target.sending_address)}`,
      `To address: ${maskAddress(target.destination_address)}`,
      "",
      "Answer on this private data request page:",
      `${config.publicUrl}/r/${token}`,
      "",
      `This page ends at ${formatDateTime(endsAt.getTime(), workspace.timeZone, workspace.city)}.`,
      "",
      "Lanternline Handshake Desk",
    ].join("\n"),
  };
}

/** Data sent: a signed network message (metered) or a data request page by mail. Returns the mail to send. */
export async function sendData(db: PoolClient, workspace: Workspace, target: SendTarget, route: Continuation["route"], atMs: number): Promise<Mail | null> {
  const cp = await one<CounterpartyRef>(db,
    "SELECT id, legal_name, due_diligence, network, jurisdiction_code, contact_email FROM counterparties WHERE id = $1",
    [target.counterparty_id]);
  if (!cp) throw new Error(`counterparty ${target.counterparty_id} is missing`);
  const sentAt = stamp(atMs);
  const channel = cp.network === "on_network" ? "network" : "request_page";
  const dueAt = route === "counterparty" ? new Date(sentAt.getTime() + config.timers.answerWindow * 1000) : null;
  await db.query(
    "UPDATE cases SET data_sent_channel = $2, data_sent_at = $3, name_as_sent = $4, answer_due_at = $5 WHERE id = $1",
    [target.id, channel, sentAt, cp.legal_name, dueAt]);
  if (channel === "network") {
    await db.query("INSERT INTO metered_messages (workspace_slug, at, direction) VALUES ($1, $2, 'sent')", [workspace.slug, sentAt]);
    return null;
  }
  return issueRequestPage(db, workspace, target, cp.contact_email ?? "", atMs);
}

/** Creates the case in one transaction; the reference counts per workspace from 000001. */
export async function createCase(db: PoolClient, workspace: Workspace, input: CaseInput, createdBy: CreatedBy): Promise<{ id: string; mail: Mail | null }> {
  const nowMs = Date.now();
  const createdAt = stamp(nowMs);
  const counter = await one<{ number: number }>(db,
    "UPDATE workspaces SET next_case_number = next_case_number + 1 WHERE slug = $1 RETURNING next_case_number - 1 AS number",
    [workspace.slug]);
  const number = counter!.number;
  const rate = await one<{ rate_cents: bigint }>(db,
    `SELECT rate_cents FROM rates WHERE workspace_slug = $1 AND asset = $2 AND in_force_since <= $3
      ORDER BY in_force_since DESC LIMIT 1`, [workspace.slug, input.asset, businessDate(workspace.timeZone, nowMs)]);
  if (!rate) throw new Error(`no ${input.asset} rate in force`);
  const ownRule = await ruleInForce(db, workspace, workspace.jurisdictionCode, nowMs);
  const counterpartyRule = input.counterparty
    ? ((await ruleInForce(db, workspace, input.counterparty.jurisdiction_code, nowMs)) ? "in_force" : "no_rule")
    : null;
  const decided: DecidedUnder = {
    jurisdictionCode: workspace.jurisdictionCode,
    thresholdCents: ownRule?.thresholdCents ?? null,
    thresholdCurrency: workspace.currency,
    ruleInForceSince: ownRule?.since ?? null,
    rateCents: rate.rate_cents,
    confirmationLimitCents: workspace.confirmationLimitCents,
    counterpartyName: input.counterparty?.legal_name ?? null,
    counterpartyRule,
  };
  const fiat = fiatValueCents(input.asset, input.atomic, rate.rate_cents);
  const decision = decidePath(input, fiat, decided);
  const id = randomUUID();
  const target: SendTarget = {
    id, reference: `${workspace.casePrefix}${String(number).padStart(6, "0")}`, asset: input.asset,
    amount_atomic: input.atomic.toString(), destination_address: input.destinationAddress,
    sending_address: workspace.sendingAddress, counterparty_id: input.counterparty?.id ?? "",
  };
  await db.query(
    `INSERT INTO cases (id, workspace_slug, number, reference, created_at, created_by_kind, created_by_name, asset, amount_atomic,
       destination_address, sending_address, wallet, counterparty_id, customer_id, originator_name, originator_identity_number,
       originator_date_of_birth, beneficiary_name, fiat_value_cents, currency, decided_under, path, route, status,
       ownership_required)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
    [id, workspace.slug, number, target.reference, createdAt, createdBy.kind, createdBy.name, input.asset, target.amount_atomic,
      input.destinationAddress, workspace.sendingAddress, input.counterparty ? "hosted" : "self_hosted", input.counterparty?.id ?? null,
      input.customer.id, input.customer.name, input.customer.identity_number, input.customer.date_of_birth, input.beneficiaryName,
      fiat, workspace.currency, JSON.stringify(storeDecidedUnder(decided)), decision.path, decision.route, decision.status,
      decision.ownershipRequired]);
  const sends = decision.route === "counterparty" || decision.route === "sunrise";
  const mail = sends ? await sendData(db, workspace, target, decision.route as Continuation["route"], nowMs) : null;
  return { id, mail };
}
