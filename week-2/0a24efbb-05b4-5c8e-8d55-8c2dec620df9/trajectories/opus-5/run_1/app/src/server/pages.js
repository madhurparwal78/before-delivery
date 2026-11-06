import { addDays, businessTimeOfDay, monthTitle } from '../shared/businessTime.js';
import { ROLE_LINES } from '../shared/constants.js';
import { feedback, ui } from '../shared/copy.js';
import { canonicalQueueQuery, parseQueueQuery } from '../shared/queueQuery.js';
import { initialsOf } from '../shared/text.js';
import { computeCounts, readCalendar } from './calendar.js';
import { config } from './config.js';
import { calendarScopeIds, employer, peopleByIds, requestScopeIds } from './people.js';
import { policyHistory, policyInForce, policyObject } from './policy.js';
import { claimedInstants } from './attendance.js';
import { parseRecordId, readQueue, readRequestDetail } from './requests.js';
import { readTrail } from './trail.js';

const EMPTY_WORDINGS = {
  employee: feedback.emptyEmployee,
  manager: feedback.emptyManager,
  admin: feedback.emptyAdmin,
};

export function callerShellData(caller) {
  return {
    name: caller.name,
    role: caller.role,
    roleLine: ROLE_LINES[caller.role],
    initials: initialsOf(caller.name),
  };
}

export function deskShell({ caller, policyVersion, screenName, layout = 'single', announcement = '' }) {
  return {
    variant: 'desk',
    layout,
    caller: callerShellData(caller),
    policyVersion,
    screenName,
    announcement,
    breadcrumb: [{ label: ui.desk, href: '/requests' }, { label: screenName }],
  };
}

export function bareShell({ screenName, policyVersion = null, announcement = '' }) {
  return {
    variant: 'bare',
    layout: 'centred',
    caller: null,
    policyVersion,
    screenName,
    announcement,
    breadcrumb: [],
  };
}

export function sharedShell({ screenName }) {
  return {
    variant: 'shared',
    layout: 'single',
    caller: null,
    policyVersion: null,
    screenName,
    announcement: '',
    breadcrumb: [],
  };
}

export async function currentPolicyVersion() {
  const policy = await policyInForce();
  return policy.version;
}

function claimDifferences(detail) {
  const request = detail.request;
  const claimed = claimedInstants({
    day: request.day,
    correction_type: request.correction_type,
    claimed_in: request.claimed_in,
    claimed_out: request.claimed_out,
  });
  const lines = [];
  const recordedIn = detail.evidence.recorded_in;
  const recordedOut = detail.evidence.recorded_out;
  if (claimed.in && recordedIn && businessTimeOfDay(claimed.in) !== businessTimeOfDay(recordedIn)) {
    lines.push('The claimed sign in differs from the recorded sign in.');
  }
  if (claimed.out && recordedOut && businessTimeOfDay(claimed.out) !== businessTimeOfDay(recordedOut)) {
    lines.push('The claimed sign out differs from the recorded sign out.');
  }
  if (claimed.in && !recordedIn) lines.push('No sign in was recorded that day.');
  if (claimed.out && !recordedOut) lines.push('No sign out was recorded that day.');
  return lines;
}

/**
 * The queue page, with its detail pane or its draft row. Returns either `{ page }`
 * or `{ answer }` naming the product's own page answer.
 */
export async function buildQueuePage({ caller, mode, searchParams, idSegment }) {
  const parsed = parseQueueQuery(searchParams);
  if (parsed.failure) return { answer: 'badQuery' };
  const query = parsed.query;

  const queue = await readQueue(caller, query);
  const scopePeople =
    caller.role === 'employee'
      ? null
      : (await peopleByIds(await requestScopeIds(caller))).map((person) => ({
          name: person.name,
          work_address: person.work_address,
        }));

  const filtersApplied = Boolean(query.state || query.type || query.person || query.month || query.q);
  const page = {
    mode,
    path: mode === 'detail' ? `/requests/${idSegment}` : mode === 'draft' ? '/requests/new' : '/requests',
    query,
    queue,
    scopePeople,
    filtersApplied,
    emptyWording: filtersApplied ? feedback.emptyFiltered : EMPTY_WORDINGS[caller.role],
    canRaise: caller.role !== 'admin',
    canDecide: false,
    canWithdraw: false,
    detail: null,
    differences: [],
    leaveLabel: null,
    nextDay: null,
    caller: callerShellData(caller),
  };

  if (mode === 'detail') {
    const read = await readRequestDetail(caller, parseRecordId(idSegment));
    page.detail = read.detail;
    page.leaveLabel = read.leaveLabel;
    page.differences = claimDifferences(read.detail);
    page.nextDay = addDays(read.detail.request.day, 1);
    page.canDecide = caller.role === 'manager' && read.raiserId !== caller.id;
    page.canWithdraw = read.raiserId === caller.id;
  }

  return { page, query };
}

export function queueScreenName(mode, page) {
  if (mode === 'draft') return ui.draftHeading;
  if (mode === 'detail') return ui.detailHeading(page.detail.request.day);
  return ui.queueHeading;
}

export function queueBreadcrumb(screenName, query) {
  return [{ label: ui.desk, href: `/requests${canonicalQueueQuery(query)}` }, { label: screenName }];
}

export async function buildCalendarPage({ caller, searchParams }) {
  const read = await readCalendar(caller, {
    month: searchParams.get('month') ?? '',
    person: searchParams.get('person') ?? '',
  });
  const scope = await peopleByIds(await calendarScopeIds(caller));
  return {
    month: read.month,
    days: read.days,
    people: scope.map((person) => ({ id: person.id, name: person.name, work_address: person.work_address })),
    person: searchParams.get('person') ?? '',
    canShare: caller.role === 'manager' || caller.role === 'admin',
    publicUrl: config.publicUrl,
  };
}

export async function buildPolicyPage(caller) {
  const [current, history, trail] = await Promise.all([policyInForce(), policyHistory(), readTrail(caller)]);
  return {
    policy: policyObject(current),
    history: history.map(policyObject),
    trail: trail.entries,
  };
}

export async function buildSharedMonthPage({ person, month }) {
  const site = await employer();
  const byDay = await computeCounts([person.id], month, site.seeded_on);
  return {
    name: person.name,
    month,
    days: [...byDay.entries()].map(([day, counts]) => ({ day, counts })),
    screenName: ui.sharedMonthHeading(person.name, monthTitle(month)),
  };
}
