import {
  getJson,
  type Breach,
  type DayDetail,
  type MonthState,
  type RestWindow,
  type Strip,
} from '../api.js';
import { COPY, DAY_STATE_LABELS, ruleSentence } from '../copy.js';
import { el, setStatus, statusRegion, twoDecimals } from '../dom.js';
import { createGlobe } from '../ui/globe.js';
import { createHourFold } from '../ui/hour-fold.js';
import {
  addNoteButton,
  countersignButton,
  downloadCopyLink,
  sealButton,
  signButton,
  type DayActionTargets,
} from '../ui/day-actions.js';
import type { Page, PageContext } from '../main.js';

const STRIP_MS = 336 * 3_600_000;

function instant(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
}

type BreachRun = {
  rule: Breach['rule'];
  windowHours: number;
  ruleSet: 'standard' | 'flag_exception';
  first: string;
  last: string;
  stillBreaching: boolean;
};

function runsOf(breaches: Breach[]): BreachRun[] {
  const sorted = [...breaches].sort((a, b) =>
    a.rule === b.rule
      ? a.window_hours - b.window_hours ||
        Date.parse(a.window_start_utc) - Date.parse(b.window_start_utc)
      : a.rule.localeCompare(b.rule),
  );
  const runs: BreachRun[] = [];
  for (const breach of sorted) {
    const previous = runs[runs.length - 1];
    const startMs = Date.parse(breach.window_start_utc);
    if (
      previous !== undefined &&
      previous.rule === breach.rule &&
      previous.windowHours === breach.window_hours &&
      Date.parse(previous.last) + 1_800_000 === startMs
    ) {
      previous.last = breach.window_start_utc;
      previous.stillBreaching = previous.stillBreaching || breach.still_breaching;
      continue;
    }
    runs.push({
      rule: breach.rule,
      windowHours: breach.window_hours,
      ruleSet: breach.rule_set,
      first: breach.window_start_utc,
      last: breach.window_start_utc,
      stillBreaching: breach.still_breaching,
    });
  }
  return runs;
}

/** A YYYY-MM-DD value naming a day that exists on the calendar. */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function renderVoyage(
  context: PageContext,
  _vesselId: string,
  crewId: string,
): Promise<Page> {
  const viewer = context.me;
  if (viewer === null) {
    return { element: el('div', { class: 'page' }, [el('h1', { text: COPY.pageUnknown })]) };
  }
  const role = viewer.role;
  const requestedStart = context.query.get('start');
  const requestedDate = context.query.get('date');
  let stripStart = requestedStart !== null && requestedStart !== '' ? requestedStart : null;

  const globe = createGlobe();
  const fold = createHourFold();
  const positionLine = el('p', { class: 'position' });
  const fixList = el('ul', { class: 'plain-list' });

  const recordLine = el('p', { class: 'record-line' });
  const ruleSentences = el('ul', { class: 'plain-list rules' });
  const ruleSetLine = el('p', { class: 'rule-set' });
  const dayStatus = statusRegion('Day status');
  const dayLine = el('p', { class: 'day-line' });
  const monthStatus = statusRegion('Month status');
  const noteList = el('ul', { class: 'plain-list' });
  const breachList = el('ul', { class: 'plain-list breaches' });
  const dayActions = el('div', { class: 'actions' });
  const monthActions = el('div', { class: 'actions' });
  const notices = el('div', { class: 'notices' });

  let recordDate = requestedDate !== null && isRealDate(requestedDate)
    ? requestedDate
    : null;
  let pinnedDate = recordDate;
  let strip: Strip | null = null;
  let loadTimer: number | null = null;

  const targets: DayActionTargets = {
    crewId,
    role,
    shipDate: () => recordDate ?? '',
    month: () => (recordDate ?? '').slice(0, 7),
    dayStatus,
    monthStatus,
    feedback: context.feedback,
    refresh: async () => {
      await loadRecord(true);
    },
  };

  function buildDayActions(detail: DayDetail | null): void {
    const nodes: HTMLElement[] = [];
    if (role === 'crew') nodes.push(signButton(targets));
    else nodes.push(countersignButton(targets));
    nodes.push(addNoteButton(targets));
    dayActions.replaceChildren(...nodes);
    const noticeNodes: HTMLElement[] = [];
    for (const event of detail?.events ?? []) {
      if (!event.mismatch) continue;
      noticeNodes.push(
        el('div', { class: 'notice mismatch' }, [
          el('p', { text: COPY.recordMismatch }),
          addNoteButton(targets, { label: 'Add a note to this mismatch', eventId: event.id }),
        ]),
      );
    }
    for (const entry of detail?.entries ?? []) {
      if (!entry.late) continue;
      noticeNodes.push(
        el('div', { class: 'notice late' }, [
          el('span', { class: 'badge', text: COPY.lateEntry }),
          el('span', { text: ` ${entry.start_utc} to ${entry.end_utc}, ${entry.kind}` }),
        ]),
      );
    }
    notices.replaceChildren(...noticeNodes);
  }

  async function loadRecord(keepStatus = false): Promise<void> {
    if (recordDate === null) return;
    const month = recordDate.slice(0, 7);
    recordLine.textContent = COPY.recordPaneLine(recordDate, month);
    const [dayResult, monthResult] = await Promise.all([
      getJson<DayDetail>(`/api/crew/${crewId}/days/${recordDate}`),
      getJson<MonthState>(`/api/crew/${crewId}/months/${month}`),
    ]);
    if (dayResult.ok) {
      if (!keepStatus) setStatus(dayStatus, DAY_STATE_LABELS[dayResult.body.state] ?? '');
      dayLine.textContent =
        dayResult.body.state === 'open'
          ? COPY.openDayLine(dayResult.body.closes_at_ship_time)
          : COPY.closedDayLine;
      noteList.replaceChildren(
        ...dayResult.body.notes.map((note) =>
          el('li', {
            text: `${note.created_at_utc}, ${
              note.author_role === 'owner_master' ? 'owner-master' : 'crew member'
            }: ${note.text}`,
          }),
        ),
      );
      buildDayActions(dayResult.body);
    }
    if (monthResult.ok) {
      setStatus(monthStatus, monthResult.body.label);
      const nodes: HTMLElement[] = [];
      if (role === 'owner_master') nodes.push(sealButton(targets));
      if (monthResult.body.state === 'sealed') nodes.push(downloadCopyLink(targets));
      monthActions.replaceChildren(...nodes);
    }
  }

  async function loadBreaches(): Promise<void> {
    if (strip === null) return;
    const result = await getJson<{ breaches: Breach[] }>(
      `/api/crew/${crewId}/breaches?from=${encodeURIComponent(
        strip.start_utc,
      )}&to=${encodeURIComponent(strip.end_utc)}`,
    );
    const breaches = result.ok ? result.body.breaches : [];
    if (breaches.length === 0) {
      breachList.replaceChildren(el('li', { text: COPY.noBreaches }));
      return;
    }
    breachList.replaceChildren(
      ...runsOf(breaches).map((run) =>
        el('li', {}, [
          el('span', {
            text: `${ruleSentence(run.rule, run.ruleSet)} ${run.windowHours}-hour windows starting ${
              run.first
            } to ${run.last}.`,
          }),
          ...(run.stillBreaching
            ? []
            : [el('span', { class: 'changed', text: ` ${COPY.recordedBreachChanged}` })]),
        ]),
      ),
    );
  }

  function describeWindow(window: RestWindow): void {
    ruleSentences.replaceChildren(
      ...window.rules_failed.map((rule) =>
        el('li', { text: ruleSentence(rule, window.rule_set) }),
      ),
    );
    ruleSetLine.textContent =
      window.rule_set === 'flag_exception' ? COPY.ruleSetFlagException : COPY.ruleSetStandard;
    globe.turnTo(window.longitude, window.latitude);
    positionLine.textContent =
      window.longitude === null || window.latitude === null
        ? COPY.globeNoFix
        : `Latitude ${twoDecimals(window.latitude)}, longitude ${twoDecimals(window.longitude)}`;
  }

  function dateForWindow(window: RestWindow): string | null {
    if (strip === null) return null;
    const lastCellMs = Date.parse(window.end_utc) - 1_800_000;
    const index = Math.round((lastCellMs - Date.parse(strip.start_utc)) / 1_800_000);
    return strip.cells[index]?.ship_date ?? null;
  }

  async function loadStrip(start: string | null): Promise<void> {
    const query = start === null ? '' : `?start=${encodeURIComponent(start)}`;
    const result = await getJson<Strip>(`/api/crew/${crewId}/strip${query}`);
    if (!result.ok) return;
    strip = result.body;
    stripStart = strip.start_utc;
    globe.setFixes(strip.fixes);
    fixList.replaceChildren(
      ...strip.fixes.map((fix) =>
        el('li', {
          text: `${fix.at_utc}: ${twoDecimals(fix.latitude)}, ${twoDecimals(fix.longitude)}`,
        }),
      ),
    );
    fold.setStrip(strip);
    await loadBreaches();
  }

  fold.onWindowChange((shown) => {
    describeWindow(shown);
    const windowDate = dateForWindow(shown);
    const nextDate = pinnedDate ?? windowDate;
    pinnedDate = null;
    if (nextDate !== null && nextDate !== recordDate) {
      recordDate = nextDate;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      loadTimer = window.setTimeout(() => {
        void loadRecord();
      }, 200);
    }
  });

  fold.onShift((direction) => {
    const base = stripStart === null ? Date.now() : Date.parse(stripStart);
    void loadStrip(instant(base + direction * STRIP_MS));
  });

  await loadStrip(stripStart);
  if (recordDate === null) {
    const current = fold.current();
    if (current !== null) recordDate = dateForWindow(current);
  }
  await loadRecord();

  const element = el('div', { class: 'page voyage' }, [
    el('h1', { text: 'Voyage review' }),
    el('div', { class: 'voyage-grid' }, [
      el('section', { 'aria-label': 'Voyage', class: 'pane voyage-pane' }, [
        el('h2', { class: 'pane-label', text: 'Voyage' }),
        globe.element,
        positionLine,
        el('h3', { class: 'small-label', text: 'Position fixes' }),
        fixList,
      ]),
      el('section', { 'aria-label': 'Watch strip', class: 'pane strip-region' }, [
        el('h2', { class: 'pane-label', text: 'Watch strip' }),
        fold.element,
      ]),
      el('section', { 'aria-label': 'Record', class: 'pane record-pane' }, [
        el('h2', { class: 'pane-label', text: 'Record' }),
        recordLine,
        fold.verdict,
        ruleSentences,
        ruleSetLine,
        dayStatus,
        dayLine,
        dayActions,
        notices,
        el('h3', { class: 'small-label', text: 'Notes' }),
        noteList,
        el('h3', { class: 'small-label', text: 'Breaches' }),
        breachList,
        el('h3', { class: 'small-label', text: 'Month' }),
        monthStatus,
        monthActions,
      ]),
    ]),
  ]);

  const monthTimer = window.setInterval(() => {
    void loadRecord(true);
  }, 10_000);

  return {
    element,
    stop: () => {
      window.clearInterval(monthTimer);
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      fold.stop();
      globe.stop();
    },
  };
}

