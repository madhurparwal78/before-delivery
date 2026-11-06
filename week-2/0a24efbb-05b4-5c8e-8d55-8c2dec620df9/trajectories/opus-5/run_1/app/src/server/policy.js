import { daysBetween, monthOf, utcSeconds } from '../shared/businessTime.js';
import { CORRECTION_TYPES } from '../shared/constants.js';
import { refusals } from '../shared/copy.js';
import { appendAuditEntry } from './audit.js';
import { LOCKS, lock, pool, transaction } from './db.js';
import { Refusal, refuse, refuseField } from './errors.js';
import { checkNoNul, checkUnpublishedKeys } from './bodyChecks.js';

export const POLICY_FIELDS = [
  'monthly_cap',
  'lookback_days',
  'enabled_types',
  'require_note_on_approve',
  'self_approval_allowed',
];

const REQUIRED_POLICY_FIELDS = ['monthly_cap', 'lookback_days', 'enabled_types', 'require_note_on_approve'];

export async function policyInForce(client = pool) {
  const result = await client.query(
    `SELECT p.version, p.employer_id, p.monthly_cap, p.lookback_days, p.enabled_types,
            p.require_note_on_approve, p.self_approval_allowed, p.created_by, p.created_at, c.name AS created_by_name
       FROM policy p JOIN person c ON c.id = p.created_by
      ORDER BY p.version DESC LIMIT 1`,
    [],
  );
  return result.rows[0] ?? null;
}

export async function policyHistory(client = pool) {
  const result = await client.query(
    `SELECT p.version, p.employer_id, p.monthly_cap, p.lookback_days, p.enabled_types,
            p.require_note_on_approve, p.self_approval_allowed, p.created_by, p.created_at, c.name AS created_by_name
       FROM policy p JOIN person c ON c.id = p.created_by
      ORDER BY p.version DESC`,
    [],
  );
  return result.rows;
}

export function policyObject(row) {
  return {
    version: row.version,
    monthly_cap: row.monthly_cap,
    lookback_days: row.lookback_days,
    enabled_types: CORRECTION_TYPES.filter((type) => row.enabled_types.includes(type)),
    require_note_on_approve: row.require_note_on_approve,
    self_approval_allowed: false,
    created_by: row.created_by_name,
    created_at: utcSeconds(row.created_at),
  };
}

/** The one correction window rule: business dates counted back from seeded_on. */
export function dayIsInsideWindow(day, seededOn, lookbackDays) {
  const back = daysBetween(day, seededOn);
  return back >= 0 && back <= lookbackDays;
}

/** The corrections that count towards a person's monthly cap when raising. */
export async function capUsedForRaise(client, personId, day) {
  const result = await client.query(
    `SELECT count(*)::int AS used FROM regularisation_request
      WHERE person_id = $1 AND state IN ('approved', 'pending') AND to_char(day, 'YYYY-MM') = $2`,
    [personId, monthOf(day)],
  );
  return result.rows[0].used;
}

/** The corrections that count towards the cap when approving: approved only. */
export async function capUsedForApproval(client, personId, day, exceptRequestId) {
  const result = await client.query(
    `SELECT count(*)::int AS used FROM regularisation_request
      WHERE person_id = $1 AND state = 'approved' AND to_char(day, 'YYYY-MM') = $2 AND id <> $3`,
    [personId, monthOf(day), exceptRequestId],
  );
  return result.rows[0].used;
}

function checkPolicyField(field, body) {
  const present = Object.prototype.hasOwnProperty.call(body, field) && body[field] !== null;
  if (!present) {
    if (REQUIRED_POLICY_FIELDS.includes(field)) refuseField(400, refusals.missingField(field), field);
    return;
  }
  const value = body[field];
  if (field === 'monthly_cap') {
    if (!Number.isInteger(value) || value < 0 || value > 10) refuseField(400, refusals.monthlyCapValue, field);
    return;
  }
  if (field === 'lookback_days') {
    if (!Number.isInteger(value) || value < 1 || value > 90) refuseField(400, refusals.lookbackDaysValue, field);
    return;
  }
  if (field === 'enabled_types') {
    if (!Array.isArray(value)) refuseField(400, refusals.enabledTypesValue, field);
    for (const entry of value) checkNoNul(entry, field);
    const known = value.every((entry) => CORRECTION_TYPES.includes(entry));
    const unique = new Set(value).size === value.length;
    if (!known || !unique) refuseField(400, refusals.enabledTypesValue, field);
    if (value.length === 0) refuseField(400, refusals.enabledTypesEmpty, field);
    return;
  }
  if (field === 'require_note_on_approve') {
    if (value !== true && value !== false) refuseField(400, refusals.requireNoteValue, field);
    return;
  }
  if (value !== false) refuseField(400, refusals.selfApprovalValue, field);
}

function parsePrecondition(header) {
  if (typeof header !== 'string') return null;
  return header.trim();
}

/** Saves a new policy version, appending it after the version the caller is changing. */
export async function savePolicy(caller, body, ifMatchHeader) {
  if (caller.role !== 'admin') refuse(403, refusals.onlyAdminChangesPolicy);

  const ifMatch = parsePrecondition(ifMatchHeader);
  if (!ifMatch) refuse(428, refusals.policyPreconditionRequired);

  return transaction(async (client) => {
    await lock(client, LOCKS.policy);
    const current = await policyInForce(client);
    if (ifMatch !== `"${current.version}"`) {
      throw new Refusal(412, refusals.policyStale(current.version), { etag: `"${current.version}"` });
    }

    checkUnpublishedKeys(body, POLICY_FIELDS);
    for (const field of POLICY_FIELDS) checkPolicyField(field, body);

    const version = current.version + 1;
    const now = new Date();
    await client.query(
      `INSERT INTO policy (version, employer_id, monthly_cap, lookback_days, enabled_types, require_note_on_approve, self_approval_allowed, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8)`,
      [
        version,
        caller.employer_id,
        body.monthly_cap,
        body.lookback_days,
        CORRECTION_TYPES.filter((type) => body.enabled_types.includes(type)),
        body.require_note_on_approve,
        caller.id,
        now,
      ],
    );
    await appendAuditEntry(client, {
      request_id: null,
      actor_id: caller.id,
      actor_role: 'admin',
      verb: 'policy_saved',
      subject_type: 'policy',
      subject_id: version,
      occurred_at: now,
      note: `Version ${version}.`,
    });
    const saved = await policyInForce(client);
    return policyObject(saved);
  });
}
