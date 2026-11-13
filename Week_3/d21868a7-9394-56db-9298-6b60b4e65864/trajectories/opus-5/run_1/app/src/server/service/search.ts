import { formatMl } from '../../domain/decimal.ts';
import { ValidationError } from '../../domain/errors.ts';
import type { Role } from '../../domain/routes.ts';
import { windowStatus } from '../../domain/time.ts';
import type { SignedInUser } from '../auth.ts';
import { pool } from '../db.ts';
import { serverNow, windowRows } from '../reads.ts';
import { labelOf, windowFigures, type WindowRow } from '../records.ts';

/** Search reach, labels, details and links, by kind and by the caller's role. */

export interface Suggestion {
  kind: 'turnout' | 'grower' | 'channel' | 'operator';
  label: string;
  detail: string;
  href: string;
}

const KIND_ORDER: Record<Suggestion['kind'], number> = { channel: 0, turnout: 1, grower: 2, operator: 3 };

interface ChannelRow {
  id: string;
  name: string;
  rail_order: number;
}

interface TurnoutInfo {
  code: string;
  channel_id: string;
  channel_name: string;
  rail_order: number;
  grower_id: number;
  grower_name: string;
}

interface OperatorRow {
  code: string;
  name: string | null;
  kind: 'district' | 'contractor';
  phone: string | null;
  erased: boolean;
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function digits(text: string): string {
  return text.replace(/\D+/g, '');
}

export async function searchSuggestions(user: SignedInUser, q: string | null): Promise<Suggestion[]> {
  if (q === null || q.length < 2 || q.length > 60) {
    throw ValidationError.field('q', 'Search for 2 to 60 characters.');
  }

  const role = user.role;
  const now = serverNow();
  const channels = (await pool.query<ChannelRow>('select id, name, rail_order from channels order by rail_order')).rows;
  const windows = await windowRows({});
  const turnouts = (
    await pool.query<TurnoutInfo>(
      `select t.code, t.channel_id, c.name as channel_name, c.rail_order, t.grower_id, u.name as grower_name
         from turnouts t join channels c on c.id = t.channel_id join users u on u.id = t.grower_id
        order by c.rail_order, t.code`,
    )
  ).rows;

  const ownChannelIds = new Set(
    turnouts.filter((turnout) => turnout.grower_id === user.id).map((turnout) => turnout.channel_id),
  );

  const suggestions: Suggestion[] = [];

  const channelsInReach =
    role === 'grower' ? channels.filter((channel) => ownChannelIds.has(channel.id)) : channels;
  for (const channel of channelsInReach) {
    if (!contains(channel.name, q)) continue;
    const earliest = windows
      .filter((window) => window.channel_id === channel.id)
      .find((window) => windowStatus(window.opens_at, window.closes_at, now) !== 'closed');
    suggestions.push({
      kind: 'channel',
      label: channel.name,
      detail: channelDetail(earliest),
      href: channelHref(role, channel.id, earliest),
    });
  }

  if (role === 'grower' || role === 'dispatcher' || role === 'clerk') {
    const inReach = role === 'grower' ? turnouts.filter((turnout) => turnout.grower_id === user.id) : turnouts;
    for (const turnout of inReach) {
      if (!contains(turnout.code, q)) continue;
      suggestions.push({
        kind: 'turnout',
        label: turnout.code,
        detail: `${turnout.channel_name}, ${turnout.grower_name}`,
        href:
          role === 'grower'
            ? '/grower'
            : role === 'dispatcher'
              ? `/board?channels=${turnout.channel_id}`
              : `/channels/${turnout.channel_id}/capacity`,
      });
    }
  }

  if (role === 'dispatcher' || role === 'clerk') {
    const growers = (
      await pool.query<{ id: number; name: string }>(
        "select id, name from users where role = 'grower' order by id",
      )
    ).rows;
    for (const grower of growers) {
      if (!contains(grower.name, q)) continue;
      const theirs = turnouts.filter((turnout) => turnout.grower_id === grower.id);
      const channelIds = [...new Set(theirs.map((turnout) => turnout.channel_id))];
      suggestions.push({
        kind: 'grower',
        label: grower.name,
        detail: theirs.map((turnout) => turnout.code).join(', '),
        href:
          role === 'dispatcher'
            ? `/board?channels=${channelIds.join(',')}`
            : `/channels/${channelIds[0] as string}/capacity`,
      });
    }
  }

  if (role === 'grower' || role === 'dispatcher' || role === 'clerk') {
    const operators = (
      await pool.query<OperatorRow>(
        `select operator_code as code, name, operator_kind as kind, phone, erased
           from users where role = 'operator' order by operator_code`,
      )
    ).rows;
    for (const operator of operators) {
      const matches =
        contains(operator.code, q) ||
        (!operator.erased &&
          operator.kind === 'contractor' &&
          ((operator.name !== null && contains(operator.name, q)) ||
            (operator.phone !== null && digits(q).length > 0 && digits(operator.phone).includes(digits(q)))));
      if (!matches) continue;
      suggestions.push({
        kind: 'operator',
        label: operator.erased ? `Operator ${operator.code}` : `${operator.name as string} (${operator.code})`,
        detail: operator.kind === 'district' ? 'District operator' : 'Contractor',
        href: operatorHref(role, operator.kind),
      });
    }
  }

  return suggestions
    .sort((a, b) => {
      if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    })
    .slice(0, 8);
}

function channelDetail(earliest: WindowRow | undefined): string {
  if (earliest === undefined) return 'No open windows';
  const figures = windowFigures(earliest);
  const base = `${formatMl(figures.remainingMl)} ML left, ${labelOf(earliest)}`;
  return figures.restrictionCapMlDay === null
    ? base
    : `${base}, restricted to ${formatMl(figures.restrictionCapMlDay)} ML/day`;
}

function channelHref(role: Role, channelId: string, earliest: WindowRow | undefined): string {
  switch (role) {
    case 'grower':
      return earliest === undefined ? '/grower/orders/new' : `/grower/orders/new?window=${earliest.id}`;
    case 'dispatcher':
      return earliest === undefined ? `/board?channels=${channelId}` : `/board?channels=${channelId}&window=${earliest.id}`;
    case 'clerk':
    case 'reviewer':
      return `/channels/${channelId}/capacity`;
    case 'operator':
      return '/field';
  }
}

function operatorHref(role: Role, kind: 'district' | 'contractor'): string {
  if (role === 'grower') return '/grower/orders/new';
  if (role === 'dispatcher') return kind === 'contractor' ? '/contractors' : '/board';
  return kind === 'contractor' ? '/contractors' : '/packs';
}
