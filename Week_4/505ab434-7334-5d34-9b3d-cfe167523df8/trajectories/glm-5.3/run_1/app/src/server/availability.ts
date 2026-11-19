import {
  AUDIENCE_PLURALS,
  BADGE_AVAILABLE,
  BADGE_REQUEST_REQUIRED,
  BADGE_RESTRICTED,
  BADGE_RETIRED,
  type Audience,
  type Badge,
} from '../shared/domain';
import { formatDay } from './datetime';

export interface LicenceRow {
  permittedApplications: string[];
  prohibitedApplications: string[];
  audiences: string[];
  territories: string[];
  excludedTerritories: string[];
}

export interface ViewerContext {
  principalId: string;
  role: string;
  audience: Audience;
  organisationTerritory: string;
  groupIds: string[];
  engagementEndsOn: string | null;
}

export interface GrantRow {
  id: string;
  holderType: 'principal' | 'group';
  holderPrincipalId: string | null;
  holderGroupId: string | null;
  status: string;
  notBefore: string | null;
  notAfter: string;
}

export interface AssetRow {
  id: string;
  name: string;
  state: string;
  successorName: string | null;
  licence: LicenceRow;
}

export interface DecisionInputs {
  asset: AssetRow;
  grants: GrantRow[];
  viewer: ViewerContext;
  openRequests: { id: string; state: string }[];
  pendingProofGrants: { id: string }[];
  now: Date;
  timeZone: string;
}

export interface Decision {
  badge: Badge;
  reason: string | null;
  canRequest: boolean;
  requestReason: string | null;
  openRequestId: string | null;
  coveringGrant: GrantRow | null;
}

/** Marker id for the implicit employee grant that released assets carry. */
export const IMPLICIT_GRANT_ID = 'implicit';

/**
 * The single availability decision, evaluated on demand against the app clock
 * for every library read, link issue and link use.
 */
export function decideAvailability(inputs: DecisionInputs): Decision {
  const tz = inputs.timeZone;
  if (inputs.asset.state === 'retired') {
    return denied(
      BADGE_RETIRED,
      `Retired. Use ${inputs.asset.successorName ?? 'the successor'} instead.`,
    );
  }
  if (inputs.asset.state === 'restricted') {
    return denied(BADGE_RESTRICTED, 'Restricted by the brand team.');
  }
  const failure = audienceDenied(inputs, tz);
  if (failure) return denied(BADGE_RESTRICTED, failure);
  const covering = coveringGrant(inputs, tz);
  if (covering) {
    return {
      badge: BADGE_AVAILABLE,
      reason: null,
      canRequest: false,
      requestReason: null,
      openRequestId: null,
      coveringGrant: covering,
    };
  }
  if (inputs.viewer.role === 'agency') {
    const open = inputs.openRequests.find((r) =>
      ['draft', 'routed', 'under_review', 'changes_requested'].includes(r.state),
    );
    if (open) {
      return {
        badge: BADGE_REQUEST_REQUIRED,
        reason: 'Request use to download.',
        canRequest: false,
        requestReason: `You already have ${open.id} open.`,
        openRequestId: open.id,
        coveringGrant: null,
      };
    }
    const pending = inputs.pendingProofGrants[0];
    if (pending) {
      return {
        badge: BADGE_REQUEST_REQUIRED,
        reason: 'Request use to download.',
        canRequest: false,
        requestReason: `Upload your proof for ${pending.id} first.`,
        openRequestId: null,
        coveringGrant: null,
      };
    }
    return {
      badge: BADGE_REQUEST_REQUIRED,
      reason: 'Request use to download.',
      canRequest: true,
      requestReason: null,
      openRequestId: null,
      coveringGrant: null,
    };
  }
  return denied(BADGE_RESTRICTED, `Not licensed for ${AUDIENCE_PLURALS[inputs.viewer.audience]}.`);
}

function denied(badge: Badge, reason: string): Decision {
  return { badge, reason, canRequest: false, requestReason: null, openRequestId: null, coveringGrant: null };
}

function audienceDenied(inputs: DecisionInputs, tz: string): string | null {
  const { licence } = inputs.asset;
  const { viewer } = inputs;
  if (!licence.audiences.includes(viewer.audience)) {
    return `Not licensed for ${AUDIENCE_PLURALS[viewer.audience]}.`;
  }
  if (licence.excludedTerritories.includes(viewer.organisationTerritory)) {
    return `Not licensed in ${viewer.organisationTerritory}.`;
  }
  if (viewer.role === 'agency' && viewer.engagementEndsOn) {
    const end = localEndOfDay(viewer.engagementEndsOn, tz);
    if (inputs.now.getTime() > end.getTime()) {
      return `Your engagement ended on ${formatDay(viewer.engagementEndsOn, tz)}.`;
    }
  }
  return null;
}

function coveringGrant(inputs: DecisionInputs, tz: string): GrantRow | null {
  for (const grant of inputs.grants) {
    if (grant.status !== 'active') continue;
    if (!coversViewer(grant, inputs.viewer)) continue;
    if (!inWindow(grant, inputs.now, tz)) continue;
    return grant;
  }
  return null;
}

function coversViewer(grant: GrantRow, viewer: ViewerContext): boolean {
  if (grant.holderType === 'principal') return grant.holderPrincipalId === viewer.principalId;
  return viewer.groupIds.includes(grant.holderGroupId ?? '');
}

function inWindow(grant: GrantRow, now: Date, tz: string): boolean {
  if (grant.notBefore) {
    const start = localStartOfDay(grant.notBefore, tz);
    if (now.getTime() < start.getTime()) return false;
  }
  const end = localEndOfDay(grant.notAfter, tz);
  return now.getTime() <= end.getTime();
}

function localStartOfDay(date: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`bad date ${date}`);
  return zonedToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0, tz);
}

export function localEndOfDay(date: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`bad date ${date}`);
  return zonedToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999, tz);
}

export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tz: string,
): Date {
  const naive = Date.UTC(year, month, day, hour, minute, second, ms);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const offsetFor = (d: Date): number => {
    const parts = fmt.formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - Math.floor(d.getTime() / 1000) * 1000;
  };
  const guess = new Date(naive);
  let offset = offsetFor(guess);
  const check = new Date(naive - offset);
  const offset2 = offsetFor(check);
  if (offset2 !== offset) offset = offset2;
  return new Date(naive - offset);
}
