import { parseFilter, compose, FilterTooComplex } from '../src/express/filter.js';
import { ExpressionError } from '../src/express/expression.js';

const fields = new Set(['state', 'assigned_to', 'priority', 'is_major', 'created_at', 'hold_reason', 'short_description', 'configuration_item', 'caller', 'sla_breached']);
const known = (p: string) => {
  const first = p.split('.')[0];
  return fields.has(first) || fields.has(p) || p.includes('.');
};

function roundTrip(t: string): void {
  try {
    const { builder, filter } = parseFilter(t, known);
    const again = parseFilter(filter, known);
    const same = JSON.stringify(again.builder) === JSON.stringify(builder) && again.filter === filter;
    console.log(`${same ? 'OK  ' : 'FAIL'} "${t}" -> "${filter}"`);
  } catch (e) {
    if (e instanceof FilterTooComplex) console.log(`FAIL "${t}": too complex`);
    else if (e instanceof ExpressionError) console.log(`ERR  "${t}": ${e.message}`);
    else console.log(`ERR  "${t}": ${e}`);
  }
}

// Seeded queues
roundTrip('state in ["new", "assigned", "in_progress", "on_hold"]');
roundTrip('assigned_to.username = me() and state in ["new", "assigned", "in_progress", "on_hold"]');
roundTrip('is_empty(assigned_to) and state in ["new", "assigned"]');
roundTrip('state = "on_hold" and hold_reason = "awaiting_requester"');
roundTrip('is_major = true and state in ["new", "assigned", "in_progress", "on_hold"]');
roundTrip('(assigned_to.username = me()) and (state in ["new", "assigned", "in_progress", "on_hold"])');
roundTrip('priority = 1');
roundTrip('(created_at >= "2026-11-04T00:00:00+01:00") and (created_at < "2026-11-05T00:00:00+01:00")');
roundTrip('sla_breached = true and state in ["new", "assigned", "in_progress", "on_hold"]');
roundTrip('is_empty(assigned_to)');
roundTrip('not is_empty(assigned_to)');
// Canonicalisation
roundTrip('state  in [ "new" , "assigned" ]');
roundTrip('(state="on_hold")and(hold_reason="awaiting_requester")');
