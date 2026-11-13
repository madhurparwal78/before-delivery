import { springBack } from '../animate.js';
import { clear, el } from '../dom.js';
import { displayTime, ZONES } from '../format.js';
import { navigate } from '../main.js';
import {
  announce,
  ApiFailure,
  get,
  setLiveHandler,
  state,
  write,
  zone,
  type LiveMessage,
} from '../state.js';
import { emptyBand, layoutBand, loadFailed, openDialog, showFormError } from '../widgets.js';

type Group = {
  group: string;
  state: string;
  flapping: boolean;
  snoozed: boolean;
  snoozed_until: string | null;
  in_maintenance: boolean;
  acknowledged_by: string | null;
};

type Rule = {
  id: string;
  name: string;
  stream: string;
  measure: string;
  window_ms: number;
  comparison: string;
  threshold: number;
  groups: Group[];
  last_check: { at: string; failed: boolean } | null;
  history: { check: number; group: string; at: string; from: string; to: string }[];
};

type CaseRow = { number: number; title: string; status: string };

export function groupLabel(group: Group): string {
  let label = `Group ${group.group}, ${group.state}`;
  if (group.flapping) label += ', flapping';
  if (group.snoozed) label += ', snoozed';
  if (group.in_maintenance) label += ', in maintenance';
  return label;
}

export async function renderAlerts(main: HTMLElement): Promise<void> {
  let rules: { rules: Rule[] };
  let cases: { cases: CaseRow[] };
  try {
    rules = await get<{ rules: Rule[] }>('/api/rules');
    cases = await get<{ cases: CaseRow[] }>('/api/cases');
  } catch {
    main.append(loadFailed(() => void renderAlerts(main)));
    return;
  }
  const recent = el('div', { role: 'region', 'aria-label': 'Recent cases', class: 'recent-cases' });
  for (const item of cases.cases.slice(0, 3)) {
    recent.append(
      el('article', { class: 'card case-card', 'aria-label': `Case ${item.number}: ${item.title}, ${item.status}` }, [
        el('h3', {}, [el('a', { href: `/cases/${item.number}`, text: `Case ${item.number}: ${item.title}` })]),
        el('p', { class: 'mono', text: item.status }),
      ]),
    );
  }
  main.append(
    el('h1', { class: 'view-title', text: 'Alerts' }),
    el('div', { class: 'link-row' }, [
      el('a', { href: '/alerts/new', text: 'New rule', 'aria-label': 'New rule' }),
      el('a', {
        href: '/alerts/maintenance',
        text: 'Maintenance windows',
        'aria-label': 'Maintenance windows',
      }),
    ]),
    recent,
  );
  if (rules.rules.length === 0) {
    main.append(
      emptyBand('No alert rules yet.', el('a', { href: '/alerts/new', text: 'New rule', 'aria-label': 'New rule' })),
    );
    return;
  }
  main.append(
    el('table', { 'aria-label': 'Rules', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Rule' }),
          el('th', { scope: 'col', text: 'Stream' }),
          el('th', { scope: 'col', text: 'Groups' }),
          el('th', { scope: 'col', text: 'Last check' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        rules.rules.map((rule) =>
          el('tr', {}, [
            el('td', {}, [el('a', { href: `/alerts/${rule.id}`, text: rule.name })]),
            el('td', { class: 'mono', text: rule.stream }),
            el('td', { class: 'mono', text: String(rule.groups.length) }),
            el('td', {
              class: 'mono',
              text: rule.last_check ? displayTime(zone(), Date.parse(rule.last_check.at)) : 'none',
            }),
          ]),
        ),
      ),
    ]),
  );
}

export async function renderRule(main: HTMLElement, params: Record<string, string>): Promise<void> {
  let rule: Rule;
  try {
    rule = await get<Rule>(`/api/rules/${encodeURIComponent(params.id)}`);
  } catch (cause) {
    if (cause instanceof ApiFailure && cause.status === 404) {
      main.append(el('h1', { class: 'view-title', text: 'Page not found.' }));
      return;
    }
    main.append(loadFailed(() => void renderRule(main, params)));
    return;
  }
  const lastCheck = el('div', { role: 'status', 'aria-label': 'Last check', class: 'last-check mono' });
  const groupsHost = el('div', { class: 'groups-host' });
  const historyHost = el('div', { class: 'history-host' });

  const setLastCheck = (check: Rule['last_check']): void => {
    if (!check) {
      lastCheck.textContent = 'No check yet';
      return;
    }
    lastCheck.textContent = check.failed
      ? `Check failed at ${displayTime(zone(), Date.parse(check.at))}: state kept.`
      : `Last check at ${displayTime(zone(), Date.parse(check.at))}: ok`;
  };

  const acknowledgeGroup = async (group: Group): Promise<void> => {
    await write('POST', `/api/rules/${rule.id}/groups/${encodeURIComponent(group.group)}/ack`);
    announce(`Acknowledged Group ${group.group}`);
    await refresh();
  };

  const groupActions = (group: Group): HTMLElement[] => {
    const acknowledge = el('button', {
      type: 'button',
      'aria-label': 'Acknowledge',
      text: 'Acknowledge',
    });
    acknowledge.addEventListener('click', () => {
      void acknowledgeGroup(group);
    });
    const snooze = el('button', { type: 'button', 'aria-label': 'Snooze group', text: 'Snooze group' });
    snooze.addEventListener('click', () => openSnooze(snooze, rule, group, refresh));
    const addToCase = el('button', { type: 'button', 'aria-label': 'Add to case', text: 'Add to case' });
    addToCase.addEventListener('click', () => openAddToCase(addToCase, { rule: rule.id, group: group.group }));
    return [acknowledge, snooze, addToCase];
  };

  const renderGroups = (): void => {
    clear(groupsHost);
    if (layoutBand() === 'phone') {
      for (const group of rule.groups) {
        const card = el('article', { 'aria-label': groupLabel(group), class: 'card group-card' }, [
          el('p', { class: 'mono', text: `${group.group}: ${group.state}` }),
          group.acknowledged_by
            ? el('p', { text: `Acknowledged by ${group.acknowledged_by}` })
            : null,
          el('div', { class: 'card-actions' }, groupActions(group)),
        ]);
        wireSwipe(card, () => {
          void acknowledgeGroup(group);
        });
        groupsHost.append(card);
      }
      return;
    }
    groupsHost.append(
      el('table', { 'aria-label': 'Groups', class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Group' }),
            el('th', { scope: 'col', text: 'State' }),
            el('th', { scope: 'col', text: 'Acknowledged by' }),
            el('th', { scope: 'col', text: 'Actions' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          rule.groups.map((group) =>
            el('tr', { 'aria-label': groupLabel(group), class: `group-row state-${group.state}` }, [
              el('td', { class: 'mono', text: group.group }),
              el('td', { class: 'mono', text: group.state }),
              el('td', { class: 'mono', text: group.acknowledged_by ?? '' }),
              el('td', {}, groupActions(group)),
            ]),
          ),
        ),
      ]),
    );
  };

  const renderHistory = (): void => {
    clear(historyHost);
    historyHost.append(
      el('table', { 'aria-label': 'State history', class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Check' }),
            el('th', { scope: 'col', text: 'Group' }),
            el('th', { scope: 'col', text: 'From' }),
            el('th', { scope: 'col', text: 'To' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          rule.history.map((entry) =>
            el('tr', {}, [
              el('td', { class: 'mono', text: String(entry.check) }),
              el('td', { class: 'mono', text: entry.group }),
              el('td', { class: 'mono', text: entry.from }),
              el('td', { class: 'mono', text: entry.to }),
            ]),
          ),
        ),
      ]),
    );
  };

  async function refresh(): Promise<void> {
    rule = await get<Rule>(`/api/rules/${encodeURIComponent(params.id)}`);
    setLastCheck(rule.last_check);
    renderGroups();
    renderHistory();
  }

  setLastCheck(rule.last_check);
  renderGroups();
  renderHistory();
  main.append(
    el('h1', { class: 'view-title', text: rule.name }),
    lastCheck,
    groupsHost,
    historyHost,
  );
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'alert') return;
    if (message.rule !== rule.id) return;
    const changedGroup = String(message.group ?? '');
    const newState = String(message.state ?? '');
    const existing = rule.groups.find((group) => group.group === changedGroup);
    if (existing && newState !== '') {
      const stateChanged = existing.state !== newState || message.changed === true;
      existing.state = newState;
      existing.flapping = message.flapping === true;
      existing.snoozed = message.snoozed === true;
      existing.in_maintenance = message.in_maintenance === true;
      existing.acknowledged_by = (message.acknowledged_by as string | null) ?? existing.acknowledged_by;
      if (stateChanged) announce(`Group ${changedGroup} is now ${newState}`);
    }
    if (message.last_check) setLastCheck(message.last_check as Rule['last_check']);
    void refresh();
  });
}

function wireSwipe(card: HTMLElement, acknowledge: () => void): void {
  let startX = 0;
  let startY = 0;
  let active = false;
  card.addEventListener('pointerdown', (event) => {
    active = true;
    startX = event.clientX;
    startY = event.clientY;
  });
  card.addEventListener('pointermove', (event) => {
    if (!active) return;
    const deltaX = event.clientX - startX;
    if (deltaX < 0) card.style.transform = `translateX(${deltaX}px)`;
  });
  card.addEventListener('pointerup', (event) => {
    if (!active) return;
    active = false;
    const deltaX = event.clientX - startX;
    const deltaY = Math.abs(event.clientY - startY);
    if (deltaX < -80 && deltaY < 40) {
      card.style.transform = 'translateX(0)';
      acknowledge();
      return;
    }
    springBack(card);
  });
  card.addEventListener('pointercancel', () => {
    active = false;
    springBack(card);
  });
}

function openSnooze(
  opener: HTMLButtonElement,
  rule: { id: string },
  group: Group,
  refresh: () => Promise<void>,
): void {
  openDialog({
    label: 'Snooze',
    opener,
    content: (dialog) => {
      let choice: '1h' | '1d' | 'recovered' = '1h';
      const options: [string, '1h' | '1d' | 'recovered'][] = [
        ['For 1 hour', '1h'],
        ['For 1 day', '1d'],
        ['Until recovered', 'recovered'],
      ];
      const radios = options.map(([label, value]) => {
        const radio = el('input', {
          type: 'radio',
          name: 'snooze',
          'aria-label': label,
          checked: value === '1h',
        });
        radio.addEventListener('change', () => {
          choice = value;
        });
        return el('label', { class: 'checkbox' }, [radio, label]);
      });
      const snooze = el('button', {
        type: 'button',
        'aria-label': 'Snooze',
        text: 'Snooze',
        class: 'primary',
      });
      snooze.addEventListener('click', () => {
        void (async () => {
          const updated = await write<Group>(
            'POST',
            `/api/rules/${rule.id}/groups/${encodeURIComponent(group.group)}/snooze`,
            { for: choice },
          );
          dialog.close();
          announce(
            updated.snoozed_until === null
              ? `Group ${group.group} snoozed until it recovers.`
              : `Group ${group.group} snoozed until ${displayTime(zone(), Date.parse(updated.snoozed_until))}.`,
          );
          await refresh();
        })();
      });
      return [el('h2', { text: 'Snooze' }), ...radios, snooze];
    },
  });
}

export function openAddToCase(
  opener: HTMLButtonElement,
  item: { rule?: string; group?: string; inbox_item?: string; trace_id?: string },
): void {
  openDialog({
    label: 'Add to case',
    opener,
    content: (dialog) => {
      const select = el('select', { 'aria-label': 'Case' });
      const add = el('button', { type: 'button', 'aria-label': 'Add', text: 'Add', class: 'primary' });
      const host = el('div', {});
      void (async () => {
        const cases = await get<{ cases: CaseRow[] }>('/api/cases');
        for (const row of cases.cases.filter((candidate) => candidate.status !== 'closed')) {
          select.append(el('option', { value: String(row.number), text: `Case ${row.number}: ${row.title}` }));
        }
        select.append(el('option', { value: 'new', text: 'New case' }));
      })();
      add.addEventListener('click', () => {
        add.setAttribute('aria-busy', 'true');
        void (async () => {
          try {
            let number = select.value;
            if (number === 'new' || number === '') {
              const created = await write<{ number: number }>('POST', '/api/cases', {
                title: `Case from ${item.group ?? item.trace_id ?? 'inbox'}`,
              });
              number = String(created.number);
              announce(`Case ${number} created.`);
            }
            await write('POST', `/api/cases/${number}/items`, item);
            dialog.close();
            announce(`Added to case ${number}.`);
          } catch (cause) {
            if (cause instanceof ApiFailure) showFormError(host, cause);
          } finally {
            add.removeAttribute('aria-busy');
          }
        })();
      });
      return [el('h2', { text: 'Add to case' }), host, select, add];
    },
  });
}

export async function renderNewRule(main: HTMLElement): Promise<void> {
  const streams = await get<{ streams: { name: string }[] }>('/api/streams');
  const form = el('form', { class: 'card single-column' });
  const host = el('div', {});
  const name = el('input', { type: 'text', 'aria-label': 'Rule name', 'data-field': 'name' });
  const stream = el(
    'select',
    { 'aria-label': 'Stream', 'data-field': 'stream' },
    streams.streams.map((item) => el('option', { value: item.name, text: item.name })),
  );
  const filterField = el('input', { type: 'text', 'aria-label': 'Filter field', 'data-field': 'filter' });
  const filterOperator = el(
    'select',
    { 'aria-label': 'Filter operator' },
    ['eq', 'ne', 'exists', 'gt', 'gte', 'lt', 'lte'].map((operator) =>
      el('option', { value: operator, text: operator }),
    ),
  );
  const filterValue = el('input', { type: 'text', 'aria-label': 'Filter value' });
  const measure = el(
    'select',
    { 'aria-label': 'Measure', 'data-field': 'measure' },
    ['count', 'avg', 'max', 'min', 'sum'].map((option) => el('option', { value: option, text: option })),
  );
  const measureField = el('input', {
    type: 'text',
    'aria-label': 'Measure field',
    'data-field': 'measure_field',
  });
  const groupBy = el('input', { type: 'text', 'aria-label': 'Group by', 'data-field': 'group_by' });
  const windowMs = el('input', {
    type: 'text',
    'aria-label': 'Window (ms)',
    'data-field': 'window_ms',
    value: '300000',
  });
  const comparison = el(
    'select',
    { 'aria-label': 'Comparison', 'data-field': 'comparison' },
    ['>', '>=', '<', '<='].map((option) => el('option', { value: option, text: option })),
  );
  const threshold = el('input', {
    type: 'text',
    'aria-label': 'Threshold',
    'data-field': 'threshold',
    value: '5',
  });
  const frequency = el(
    'select',
    { 'aria-label': 'Action frequency' },
    [
      el('option', { value: 'change', text: 'On status change' }),
      el('option', { value: 'check', text: 'Every check' }),
      el('option', { value: 'throttle', text: 'At most every <n> ms' }),
    ],
  );
  const interval = el('input', {
    type: 'text',
    'aria-label': 'Interval (ms)',
    'data-field': 'frequency.every_ms',
    hidden: true,
  });
  frequency.addEventListener('change', () => {
    interval.hidden = frequency.value !== 'throttle';
  });
  const save = el('button', {
    type: 'submit',
    'aria-label': 'Save rule',
    text: 'Save rule',
    class: 'primary',
  });
  const rows: [string, HTMLElement][] = [
    ['Rule name', name],
    ['Stream', stream],
    ['Filter field', filterField],
    ['Filter operator', filterOperator],
    ['Filter value', filterValue],
    ['Measure', measure],
    ['Measure field', measureField],
    ['Group by', groupBy],
    ['Window (ms)', windowMs],
    ['Comparison', comparison],
    ['Threshold', threshold],
    ['Action frequency', frequency],
    ['Interval (ms)', interval],
  ];
  form.append(host);
  for (const [label, control] of rows) {
    form.append(el('div', { class: 'field' }, [el('label', { text: label }), control]));
  }
  form.append(save);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.setAttribute('aria-busy', 'true');
    void (async () => {
      const body: Record<string, unknown> = {
        name: name.value,
        stream: stream.value,
        filter:
          filterField.value === ''
            ? null
            : { field: filterField.value, op: filterOperator.value, value: filterValue.value },
        measure: measure.value,
        measure_field: measureField.value === '' ? null : measureField.value,
        group_by: groupBy.value === '' ? null : groupBy.value,
        window_ms: Number(windowMs.value),
        comparison: comparison.value,
        threshold: Number(threshold.value),
        frequency:
          frequency.value === 'throttle'
            ? { kind: 'throttle', every_ms: Number(interval.value) }
            : { kind: frequency.value },
      };
      try {
        const created = await write<{ id: string }>('POST', '/api/rules', body);
        announce(`Rule ${name.value} saved.`);
        navigate(`/alerts/${created.id}`);
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(host, cause, form);
      } finally {
        save.removeAttribute('aria-busy');
      }
    })();
  });
  main.append(el('h1', { class: 'view-title', text: 'New rule' }), form);
}

export async function renderMaintenance(main: HTMLElement): Promise<void> {
  const rules = await get<{ rules: Rule[] }>('/api/rules');
  const windowsHost = el('div', {});
  const form = el('form', { class: 'card single-column' });
  const host = el('div', {});
  const name = el('input', { type: 'text', 'aria-label': 'Name', 'data-field': 'name' });
  const timeZone = el(
    'select',
    { 'aria-label': 'Window time zone', 'data-field': 'time_zone' },
    ZONES.map((option) => el('option', { value: option, text: option })),
  );
  const dayGroup = el('div', { role: 'group', 'aria-label': 'Weekly days', class: 'checkbox-list' });
  const dayNames: [string, string][] = [
    ['Monday', 'mon'],
    ['Tuesday', 'tue'],
    ['Wednesday', 'wed'],
    ['Thursday', 'thu'],
    ['Friday', 'fri'],
    ['Saturday', 'sat'],
    ['Sunday', 'sun'],
  ];
  const dayBoxes = dayNames.map(([label, value]) => {
    const box = el('input', { type: 'checkbox', 'aria-label': label, value });
    dayGroup.append(el('label', { class: 'checkbox' }, [box, label]));
    return { box, value };
  });
  const start = el('input', {
    type: 'text',
    'aria-label': 'Start (HH:MM)',
    'data-field': 'start',
    value: '02:00',
  });
  const duration = el('input', {
    type: 'text',
    'aria-label': 'Duration (ms)',
    'data-field': 'duration_ms',
    value: '3600000',
  });
  const ruleSelect = el(
    'select',
    { 'aria-label': 'Rule', 'data-field': 'rule' },
    rules.rules.map((rule) => el('option', { value: rule.id, text: rule.name })),
  );
  const save = el('button', {
    type: 'submit',
    'aria-label': 'Save window',
    text: 'Save window',
    class: 'primary',
  });
  form.append(
    host,
    el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
    el('div', { class: 'field' }, [el('label', { text: 'Window time zone' }), timeZone]),
    dayGroup,
    el('div', { class: 'field' }, [el('label', { text: 'Start (HH:MM)' }), start]),
    el('div', { class: 'field' }, [el('label', { text: 'Duration (ms)' }), duration]),
    el('div', { class: 'field' }, [el('label', { text: 'Rule' }), ruleSelect]),
    save,
  );

  const refresh = async (): Promise<void> => {
    const data = await get<{
      windows: { id: string; name: string; rule_name: string; next_start: string }[];
    }>('/api/maintenance');
    clear(windowsHost);
    windowsHost.append(
      el('table', { 'aria-label': 'Maintenance windows', class: 'data-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Name' }),
            el('th', { scope: 'col', text: 'Rule' }),
            el('th', { scope: 'col', text: 'Next start' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          data.windows.map((window) =>
            el('tr', {}, [
              el('td', { text: window.name }),
              el('td', { text: window.rule_name }),
              el('td', { class: 'mono', text: displayTime(zone(), Date.parse(window.next_start)) }),
            ]),
          ),
        ),
      ]),
    );
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        await write('POST', '/api/maintenance', {
          name: name.value,
          time_zone: timeZone.value,
          days: dayBoxes.filter((entry) => entry.box.checked).map((entry) => entry.value),
          start: start.value,
          duration_ms: Number(duration.value),
          rule: ruleSelect.value,
        });
        announce(`Maintenance window ${name.value} saved.`);
        await refresh();
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(host, cause, form);
      } finally {
        save.removeAttribute('aria-busy');
      }
    })();
  });

  main.append(el('h1', { class: 'view-title', text: 'Maintenance windows' }), form, windowsHost);
  await refresh();
  if (state.me === null) navigate('/signin');
}
