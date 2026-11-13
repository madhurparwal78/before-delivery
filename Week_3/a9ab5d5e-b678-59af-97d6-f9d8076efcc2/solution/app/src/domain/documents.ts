import { createHash } from 'node:crypto';
import { Deriver } from './derive';
import { Json, canonicalJson } from '../lib/json';
import { ParentRole } from './plan';
import { PlainDate, dateYear, toDateString } from './time';

interface CanonicalDocument {
  value: Json;
  bytes: Buffer;
  digest: string;
}

function canonicalDocument(value: Json): CanonicalDocument {
  const bytes = Buffer.from(canonicalJson(value), 'utf8');
  return { value, bytes, digest: createHash('sha256').update(bytes).digest('hex') };
}

export function buildYearDocument(householdId: string, year: number, deriver: Deriver): CanonicalDocument {
  const first = toDateString(year, 1, 1);
  const last = toDateString(year, 12, 31);
  const days: Json[] = [];
  const nights = { planning: 0, other: 0 };
  for (const night of deriver.range(first, last)) {
    if (night.owner) nights[night.owner] += 1;
    const handover = deriver.handoverOn(night.date);
    days.push({
      date: night.date,
      owner: night.owner,
      ruleId: night.ruleId,
      kind: night.kind,
      ruleName: night.ruleName,
      beats: night.beats,
      exchangeAt: handover ? handover.at : null,
      exchangeZone: handover ? handover.zone : null,
    });
  }
  return canonicalDocument({ householdId, year, days, nights: { planning: nights.planning, other: nights.other } });
}

export interface StatementCost {
  custodyDay: PlainDate;
  amountMinor: number;
  shares: { planning: number; other: number };
  owedMinor: number;
  paidBy: ParentRole;
  state: string;
}

export function buildStatementDocument(
  householdId: string,
  currency: string,
  costs: StatementCost[],
): CanonicalDocument {
  let net = 0;
  for (const cost of costs) {
    if (cost.state !== 'accepted') continue;
    net += cost.paidBy === 'planning' ? cost.owedMinor : -cost.owedMinor;
  }
  const balance =
    net === 0
      ? null
      : net > 0
        ? { owedBy: 'other', owedTo: 'planning', minor: net }
        : { owedBy: 'planning', owedTo: 'other', minor: -net };
  const byYear = new Map<number, { year: number; costs: number; amountMinor: number; shares: { planning: number; other: number } }>();
  for (const cost of costs) {
    if (cost.state !== 'accepted' && cost.state !== 'settled') continue;
    const year = dateYear(cost.custodyDay);
    const existing = byYear.get(year) ?? { year, costs: 0, amountMinor: 0, shares: { planning: 0, other: 0 } };
    existing.costs += 1;
    existing.amountMinor += cost.amountMinor;
    existing.shares.planning += cost.shares.planning;
    existing.shares.other += cost.shares.other;
    byYear.set(year, existing);
  }
  const years = [...byYear.values()].sort((a, b) => a.year - b.year) as unknown as Json;
  return canonicalDocument({ householdId, currency, balance: balance as unknown as Json, years });
}
