import { HOUSE_ACTOR } from '../../shared/roles';
import { query } from '../db';

const ACTOR_KEYS = new Set(['by', 'uploaded_by', 'logged_by']);
const DROPPED_KEYS = new Set(['killbill_invoice_id', 'killbill_payment_id', 'recorded_by']);

async function staffIds(): Promise<Set<string>> {
  const rows = await query<{ id: string }>("select id from users where role <> 'owner'");
  return new Set(rows.map((row) => row.id));
}

/** Owners see staff actors as the house, and no Kill Bill ids or transfer recorder. */
export async function projectForOwner(body: unknown): Promise<unknown> {
  const staff = await staffIds();
  return project(body, staff);
}

function project(value: unknown, staff: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => project(entry, staff));
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue;
    if (ACTOR_KEYS.has(key) && isStaffActor(entry, staff)) {
      result[key] = { ...HOUSE_ACTOR };
      continue;
    }
    result[key] = project(entry, staff);
  }
  return result;
}

function isStaffActor(value: unknown, staff: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && staff.has(id);
}
