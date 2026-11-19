// Record creation: priority from the matrix, assignment rules, SLA attach.

import { Db, clock } from './db.js';
import { Table, compute_priority } from '../shared/model.js';
import type { Ctx } from './server.js';
import { RecordSnapshot } from './recordengine.js';

import { parse, evaluate, truthy } from '../express/expression.js';
import { recordScope } from './filterengine.js';

/** Priority from the matrix with the business-critical bump. */
export async function computePriorityFor(db: Db, table: Table, fields: Record<string, unknown>): Promise<number | null> {
  if (table === 'change' || table === 'task') return null;
  const impact = fields.impact as number | null ?? (table === 'request_item' ? 3 : null);
  const urgency = fields.urgency as number | null ?? (table === 'request_item' ? 2 : null);
  if (impact === null || urgency === null) return null;
  const ci = fields.configuration_item as string | null;
  let businessCritical = false;
  if (ci) {
    const res = await db.query(`SELECT business_critical FROM cis WHERE name = $1`, [ci]);
    if (res.rows.length) businessCritical = Boolean(res.rows[0].business_critical);
  }
  return compute_priority(impact, urgency, businessCritical);
}

/** Assignment rules run when a record is created with no group and no assignee. */
export async function assignByRules(ctx: Ctx, snap: RecordSnapshot): Promise<{ group: string | null; assignee: string | null; activity: string | null }> {
  if (snap.fields.assignment_group || snap.fields.assigned_to) {
    return { group: snap.fields.assignment_group as string | null, assignee: snap.fields.assigned_to as string | null, activity: null };
  }
  const rules = await ctx.db.query(
    `SELECT name, "order", condition, "group" FROM assignment_rules WHERE "table" = $1 AND active ORDER BY "order", name`,
    [snap.table],
  );
  const scope = recordScope(snap);
  for (const rule of rules.rows) {
    let matches = false;
    try {
      matches = truthy(evaluate(parse(String(rule.condition)), {
        rec: scope,
        now: clock.nowMs(),
        me: '',
        roles: new Set(),
        resolve: (path: string) => {
          let cur: unknown = scope;
          for (const part of path.split('.')) {
            if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
              cur = (cur as Record<string, unknown>)[part];
            } else {
              return null;
            }
          }
          return cur;
        },
      }));
    } catch {
      matches = false;
    }
    if (!matches) continue;

    const group = String(rule.group);
    // Round robin within the group: the pointer moves to the next member after
    // the one assigned last, skipping inactive, out-of-office and over-capacity.
    const capacity = Number(ctx.settings.get('ASSIGNMENT_CAPACITY') ?? 10);
    const members = await ctx.db.query(`SELECT members FROM groups WHERE name = $1`, [group]);
    const list = members.rows.length ? (members.rows[0].members as string[]) : [];
    const chosen = await pickMember(ctx.db, list, capacity);
    if (chosen) {
      return { group, assignee: chosen.username, activity: `Assigned to ${chosen.displayName} by rule "${String(rule.name)}".` };
    }
    return { group: 'Triage', assignee: null, activity: `No one in ${group} could take ${snap.number}; sent to Triage.` };
  }
  return { group: null, assignee: null, activity: null };
}

interface Member { username: string; displayName: string }

async function pickMember(db: Db, members: string[], capacity: number): Promise<Member | null> {
  const openStates = ['new', 'assigned', 'in_progress', 'on_hold', 'assessing', 'known_error', 'fix_in_progress', 'open'];
  for (const attempt of members) {
    const person = await db.query(
      `SELECT username, display_name, active, out_of_office, capacity FROM people WHERE username = $1`,
      [attempt],
    );
    if (!person.rows.length) continue;
    const row = person.rows[0];
    if (!row.active || row.out_of_office) continue;
    const limit = row.capacity === null ? capacity : Number(row.capacity);
    const load = await db.query(
      `SELECT count(*)::int AS n FROM records WHERE fields->>'assigned_to' = $1 AND state = ANY($2)`,
      [attempt, openStates],
    );
    if (Number(load.rows[0].n) >= limit) continue;
    return { username: String(row.username), displayName: String(row.display_name) };
  }
  return null;
}


