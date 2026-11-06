import { isUniqueViolation, one, rows, tx } from "./db.mjs";
import { fieldRefusal, isMissing, onlyPublished, refuse, required } from "./http.mjs";
import { appendAudit } from "./audit.mjs";
import { CORRECTION_TYPES } from "./rules.mjs";
import { stamp } from "./time.mjs";

const FIELDS = ["monthly_cap", "lookback_days", "enabled_types", "require_note_on_approve", "self_approval_allowed"];
const SELF_APPROVAL = "Not available. Self approval is refused by this product.";
const LATEST = `SELECT v.*, c.name AS created_by_name FROM policy v JOIN person c ON c.id = v.created_by`;

export async function currentPolicy(client) {
  return one(`${LATEST} ORDER BY v.version DESC LIMIT 1`, [], client);
}

export async function seededOn(client) {
  return (await one("SELECT seeded_on FROM employer WHERE id = 1", [], client)).seeded_on;
}

export const etagOf = (version) => `"${version}"`;

function policyObject(row) {
  return {
    version: row.version,
    monthly_cap: row.monthly_cap,
    lookback_days: row.lookback_days,
    enabled_types: CORRECTION_TYPES.filter((type) => row.enabled_types.includes(type)),
    require_note_on_approve: row.require_note_on_approve,
    self_approval_allowed: row.self_approval_allowed,
    created_by: row.created_by_name,
    created_at: stamp(row.created_at),
  };
}

export async function readPolicy() {
  return policyObject(await currentPolicy());
}

export async function policyHistory(caller) {
  if (caller.role !== "admin") throw refuse(403, "Only people operations reads the policy history.");
  return (await rows(`${LATEST} ORDER BY v.version DESC`)).map(policyObject);
}

/** The policy precondition: `If-Match` must name exactly the version in force. */
function precondition(ifMatch, version) {
  if (ifMatch === undefined) throw refuse(428, "Send If-Match with the policy version you are changing.");
  if (ifMatch !== etagOf(version)) throw stale(version);
}

function stale(version) {
  return refuse(412, `Version ${version} was saved after the one you are changing. Reload to see it.`, {},
    { etag: etagOf(version) });
}

const whole = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

function checkFields(body) {
  onlyPublished(body, FIELDS);
  for (const field of FIELDS.slice(0, 4)) {
    if (isMissing(body, field)) throw required(field);
    const value = body[field];
    if (field === "monthly_cap" && !whole(value, 0, 10)) {
      throw fieldRefusal(400, field, "monthly_cap must be a whole number from 0 to 10.");
    }
    if (field === "lookback_days" && !whole(value, 1, 90)) {
      throw fieldRefusal(400, field, "lookback_days must be a whole number from 1 to 90.");
    }
    if (field === "enabled_types") {
      if (Array.isArray(value) && value.length === 0) {
        throw fieldRefusal(400, field, "At least one correction type must stay available.");
      }
      if (!Array.isArray(value) || new Set(value).size !== value.length
        || !value.every((type) => CORRECTION_TYPES.includes(type))) {
        throw fieldRefusal(400, field, "enabled_types must list correction types, each once.");
      }
    }
    if (field === "require_note_on_approve" && typeof value !== "boolean") {
      throw fieldRefusal(400, field, "require_note_on_approve must be true or false.");
    }
  }
  if ("self_approval_allowed" in body && body.self_approval_allowed !== false) {
    throw fieldRefusal(400, "self_approval_allowed", SELF_APPROVAL);
  }
}

/** `PUT /api/policy`: appends version n+1 and its audit entry; of simultaneous saves on one version one lands. */
export async function savePolicy(caller, body, ifMatch) {
  if (caller.role !== "admin") throw refuse(403, "Only people operations changes the policy.");
  const current = await currentPolicy();
  precondition(ifMatch, current.version);
  checkFields(body);
  const version = current.version + 1;
  try {
    await tx(async (client) => {
      await client.query(
        `INSERT INTO policy (version, employer_id, monthly_cap, lookback_days, enabled_types, require_note_on_approve,
           self_approval_allowed, created_by, created_at)
         VALUES ($1, 1, $2, $3, $4, $5, false, $6, date_trunc('second', now()))`,
        [version, body.monthly_cap, body.lookback_days, CORRECTION_TYPES.filter((t) => body.enabled_types.includes(t)),
          body.require_note_on_approve, caller.id]);
      await appendAudit(client, {
        actorId: caller.id, actorRole: "admin", verb: "policy_saved", subjectType: "policy", subjectId: version,
        note: `Version ${version}.`,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "policy_pkey")) throw stale((await currentPolicy()).version);
    throw error;
  }
  return policyObject(await one(`${LATEST} WHERE v.version = $1`, [version]));
}
