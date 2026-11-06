import type { StandingsResponse, StandingsRow, StandingsView } from '../../shared/api';
import { api } from '../api';
import { copy, VIEW_LABELS } from '../copy';
import { el, prefersReducedMotion, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { liveRegion } from '../ui';
import { createEventShell } from './eventShell';
import { createSettle, type SettleTrigger } from '../settle';

const VIEWS: StandingsView[] = ['indexed', 'class', 'raw'];

export interface RowView {
  root: HTMLElement;
  position: HTMLElement;
  bestAdjusted: HTMLElement;
  bestIndexed: HTMLElement;
  badge: HTMLElement;
  settleSlot: HTMLElement;
  runsButton: HTMLButtonElement;
  runsDetails: HTMLElement;
  expanded: boolean;
}

function positionText(row: StandingsRow, view: StandingsView): string {
  const position =
    view === 'indexed' ? row.position : view === 'class' ? row.classPosition : row.rawPosition;
  return position === null ? 'No time' : `P${position}`;
}

function badgeText(row: StandingsRow, view: StandingsView): string {
  if (!row.lastChange) return '';
  return row.lastChange.rankChange[view];
}

function runDetail(row: StandingsRow): HTMLElement {
  return el(
    'div',
    { class: 'row-runs__list' },
    row.runs.map((run) =>
      el('p', {
        class: 'row-runs__item mono',
        text:
          run.status === 'rerun_granted'
            ? `Run ${run.runNumber}: RRN`
            : run.outcome === 'dnf'
              ? `Run ${run.runNumber}: DNF`
              : run.outcome === 'time'
                ? `Run ${run.runNumber}: ${run.rawTime} raw, ${run.cones} cones, ${run.adjustedTime} adjusted, ${run.indexedTime} indexed`
                : `Run ${run.runNumber}: pending`,
      }),
    ),
  );
}

export function renderLive(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'live');
  const updates = liveRegion('Standings updates');
  const host = el('div', { class: 'standings-host' });
  const classFilter = el('select', {
    class: 'field__input',
    attrs: { 'aria-label': 'Class filter', id: 'class-filter' },
  });
  let view: StandingsView = 'indexed';
  const tabs = VIEWS.map((candidate) =>
    el('button', {
      class: 'tab',
      text: VIEW_LABELS[candidate],
      attrs: {
        role: 'tab',
        type: 'button',
        id: `tab-${candidate}`,
        'aria-selected': candidate === view ? 'true' : 'false',
        tabindex: candidate === view ? '0' : '-1',
      },
      on: {
        click: () => {
          view = candidate;
          paintTabs();
          void load(true);
        },
      },
    }),
  );
  const tablist = el(
    'div',
    { class: 'tablist', attrs: { role: 'tablist', 'aria-label': 'Standings view' } },
    tabs,
  );

  function paintTabs(): void {
    tabs.forEach((tab, index) => {
      const isSelected = VIEWS[index] === view;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tab.setAttribute('tabindex', isSelected ? '0' : '-1');
      tab.classList.toggle('tab--selected', isSelected);
    });
  }

  replace(
    shell.content,
    el(
      'div',
      { class: 'live' },
      el('h1', { class: 'page-heading', text: 'Live results' }),
      tablist,
      el(
        'div',
        { class: 'field field--inline' },
        el('label', { class: 'field__label', text: 'Class filter', attrs: { for: 'class-filter' } }),
        classFilter,
      ),
      updates,
      host,
    ),
  );

  const wide = window.matchMedia('(min-width: 1024px)');
  const twoColumns = window.matchMedia('(min-width: 600px)');
  const rowViews = new Map<string, RowView>();
  const seenChanges = new Map<string, string>();
  let container: HTMLElement | null = null;
  let containerKind: 'table' | 'list' | null = null;
  let rows: StandingsRow[] = [];
  const settle = createSettle();

  function buildRow(row: StandingsRow): RowView {
    const asTable = containerKind === 'table';
    const position = el('span', { class: 'row__position mono', text: positionText(row, view) });
    const bestAdjusted = el('span', {
      class: 'row__time mono',
      text: row.bestAdjusted ?? '',
    });
    const bestIndexed = el('span', { class: 'row__time mono', text: row.bestIndexed ?? '' });
    const badge = el('span', { class: 'row__badge', text: badgeText(row, view) });
    const settleSlot = el('span', { class: 'row__settle' });
    const runsDetails = el('div', { class: 'row-runs', attrs: { hidden: 'hidden' } }, runDetail(row));
    const runsButton = el('button', {
      class: 'button button--runs',
      text: `Runs for car ${row.carNumber} ${row.classCode}`,
      attrs: {
        type: 'button',
        'aria-expanded': 'false',
      },
    });
    const viewInstance: RowView = {
      root: el('div'),
      position,
      bestAdjusted,
      bestIndexed,
      badge,
      settleSlot,
      runsButton,
      runsDetails,
      expanded: false,
    };
    runsButton.addEventListener('click', () => {
      viewInstance.expanded = !viewInstance.expanded;
      runsButton.setAttribute('aria-expanded', viewInstance.expanded ? 'true' : 'false');
      if (viewInstance.expanded) runsDetails.removeAttribute('hidden');
      else runsDetails.setAttribute('hidden', 'hidden');
    });

    if (asTable) {
      const tr = el(
        'tr',
        { class: 'standings-row' },
        el('td', { class: 'num' }, position),
        el('td', { class: 'num mono', text: String(row.carNumber) }),
        el('td', { text: row.classCode }),
        el('td', { text: row.driverName }),
        el('td', { text: row.carDescription }),
        el('td', { class: 'num' }, bestAdjusted),
        el('td', { class: 'num' }, bestIndexed, settleSlot),
        el('td', {}, badge),
        el('td', {}, runsButton, runsDetails),
      );
      viewInstance.root = tr;
    } else {
      const card = el(
        'li',
        { class: 'standings-card' },
        el(
          'div',
          { class: 'standings-card__head' },
          position,
          el('span', { class: 'standings-card__car mono', text: `${row.carNumber} ${row.classCode}` }),
        ),
        el('p', { class: 'standings-card__driver', text: row.driverName }),
        el(
          'p',
          { class: 'standings-card__times' },
          view === 'indexed' ? bestIndexed : bestAdjusted,
          settleSlot,
        ),
        badge,
        runsButton,
        runsDetails,
      );
      viewInstance.root = card;
    }
    return viewInstance;
  }

  function ensureContainer(): HTMLElement {
    const kind: 'table' | 'list' = wide.matches ? 'table' : 'list';
    if (containerKind === kind && container) return container;
    containerKind = kind;
    rowViews.clear();
    if (kind === 'table') {
      const body = el('tbody');
      const table = el(
        'table',
        { class: 'data-table standings-table', attrs: { 'aria-label': 'Live standings' } },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { class: 'num', text: 'Pos' }),
            el('th', { class: 'num', text: 'Car' }),
            el('th', { text: 'Class' }),
            el('th', { text: 'Driver' }),
            el('th', { text: 'Car description' }),
            el('th', { class: 'num', text: 'Best adjusted' }),
            el('th', { class: 'num', text: 'Best indexed' }),
            el('th', { text: 'Change' }),
            el('th', { text: 'Runs' }),
          ),
        ),
        body,
      );
      replace(host, table);
      container = body;
    } else {
      const list = el('ul', {
        class: twoColumns.matches ? 'standings-list standings-list--two' : 'standings-list',
        attrs: { 'aria-label': 'Live standings' },
      });
      replace(host, list);
      container = list;
    }
    return container;
  }

  function paintRows(trigger: SettleTrigger | null): void {
    const parent = ensureContainer();
    const order: HTMLElement[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.registrationId);
      let instance = rowViews.get(row.registrationId);
      if (!instance) {
        instance = buildRow(row);
        rowViews.set(row.registrationId, instance);
        parent.appendChild(instance.root);
      }
      order.push(instance.root);
    }
    for (const [id, instance] of [...rowViews.entries()]) {
      if (!seen.has(id)) {
        instance.root.remove();
        rowViews.delete(id);
      }
    }

    const settleRow = trigger ? rowViews.get(trigger.row.registrationId) : null;
    const applyValues = (): void => {
      for (const row of rows) {
        const instance = rowViews.get(row.registrationId);
        if (!instance) continue;
        if (settleRow && instance === settleRow) continue;
        instance.position.textContent = positionText(row, view);
        instance.bestAdjusted.textContent = row.bestAdjusted ?? '';
        instance.bestIndexed.textContent = row.bestIndexed ?? '';
        instance.badge.textContent = badgeText(row, view);
        replace(instance.runsDetails, runDetail(row));
      }
    };
    applyValues();

    if (trigger && settleRow) {
      settle.play({
        parent,
        order,
        instance: settleRow,
        trigger,
        view,
        reducedMotion: prefersReducedMotion(),
        onDone: () => {
          const row = rows.find(
            (candidate) => candidate.registrationId === trigger.row.registrationId,
          );
          if (!row) return;
          settleRow.position.textContent = positionText(row, view);
          settleRow.bestAdjusted.textContent = row.bestAdjusted ?? '';
          settleRow.bestIndexed.textContent = row.bestIndexed ?? '';
          settleRow.badge.textContent = badgeText(row, view);
          replace(settleRow.runsDetails, runDetail(row));
        },
      });
      updates.textContent = copy.standings.update(
        trigger.row.carNumber,
        trigger.row.classCode,
        badgeText(trigger.row, view),
      );
      return;
    }

    order.forEach((node, index) => {
      if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
    });
  }

  function paintClassOptions(classes: string[]): void {
    const current = classFilter.value;
    if (classFilter.options.length === classes.length + 1) return;
    replace(
      classFilter,
      el('option', { text: 'All classes', attrs: { value: '' } }),
      ...classes.map((code) => el('option', { text: code, attrs: { value: code } })),
    );
    classFilter.value = current;
  }

  function detectTrigger(response: StandingsResponse): SettleTrigger | null {
    let trigger: SettleTrigger | null = null;
    for (const row of response.rows) {
      const change = row.lastChange;
      const stamp = change ? `${change.at}:${change.runNumber}` : '';
      const previous = seenChanges.get(row.registrationId);
      if (previous !== undefined && stamp !== previous && change) {
        const run = row.runs.find((candidate) => candidate.runNumber === change.runNumber);
        trigger = {
          row,
          runNumber: change.runNumber,
          rawTime: run?.rawTime ?? null,
          cones: run?.outcome === 'time' ? run.cones ?? 0 : 0,
          outcome: run?.outcome ?? null,
        };
      }
      seenChanges.set(row.registrationId, stamp);
    }
    return trigger;
  }

  let initialised = false;

  async function load(immediate = false): Promise<void> {
    const response = await api.events.standings(
      shell.eventId,
      view,
      classFilter.value.length > 0 ? classFilter.value : null,
    );
    const trigger = initialised && !immediate ? detectTrigger(response) : null;
    if (!initialised) {
      for (const row of response.rows) {
        const change = row.lastChange;
        seenChanges.set(row.registrationId, change ? `${change.at}:${change.runNumber}` : '');
      }
      initialised = true;
    } else if (immediate) {
      for (const row of response.rows) {
        const change = row.lastChange;
        seenChanges.set(row.registrationId, change ? `${change.at}:${change.runNumber}` : '');
      }
    }
    rows = response.rows;
    paintRows(trigger);
  }

  classFilter.addEventListener('change', () => {
    void load(true);
  });

  tablist.addEventListener('keydown', (event: KeyboardEvent) => {
    const index = VIEWS.indexOf(view);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = (index + (event.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length;
      view = VIEWS[next] as StandingsView;
      paintTabs();
      tabs[next]?.focus();
      void load(true);
    }
  });

  shell.onEvent((event) => {
    paintClassOptions(event.heats.flatMap((heat) => heat.classes));
  });

  const onMediaChange = (): void => {
    container = null;
    containerKind = null;
    paintRows(null);
  };
  wide.addEventListener('change', onMediaChange);
  twoColumns.addEventListener('change', onMediaChange);

  const timer = window.setInterval(() => {
    void load();
  }, 1_000);
  void load();

  return {
    element: shell.element,
    destroy: () => {
      window.clearInterval(timer);
      wide.removeEventListener('change', onMediaChange);
      twoColumns.removeEventListener('change', onMediaChange);
      settle.cancel();
      shell.destroy();
    },
  };
}
