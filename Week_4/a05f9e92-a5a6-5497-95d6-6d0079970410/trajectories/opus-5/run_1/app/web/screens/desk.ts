/**
 * The ticket workspace: queues, the grid, the filter builder and the record
 * form, with the published keyboard rules.
 */

import { api, ApiFailure, live, type LiveMessage } from '../lib/api';
import { copy, countdownText, pausedForText, percentText, type SlaView } from '../lib/copy';
import { animate, button, el, focus, link, section, selectBox, timings } from '../lib/dom';
import {
  announce,
  hasRole,
  navigate,
  onLive,
  openDialog,
  pin,
  restSection,
  stateScreen,
  state,
} from '../lib/shell';

export interface RecordSummary {
  readonly number: string;
  readonly table: string;
  readonly state: string;
  readonly state_label: string;
  readonly short_description: string | null;
  readonly priority: number | null;
  readonly assigned_to: string | null;
  readonly sla: SlaView | null;
  readonly label: string;
}

export interface FieldView {
  value: unknown;
  display: string | null;
  version: number;
  label: string;
  mandatory: boolean;
  read_only: boolean;
  visible: boolean;
}

export interface RecordView {
  readonly number: string;
  readonly table: string;
  readonly state: string;
  readonly state_label: string;
  readonly fields: Record<string, FieldView>;
  readonly priority_overridden: boolean;
  readonly slas: readonly SlaView[];
  readonly links: {
    parent: string | null;
    children: string[];
    problem: string | null;
    incidents: string[];
    fix_change: string | null;
  };
  readonly workaround: { problem: string; text: string } | null;
  readonly transitions: readonly { to: string; label: string }[];
}

export interface SavedFilter {
  readonly id: number;
  readonly name: string;
  readonly table: string;
  readonly filter: string;
  readonly shared: boolean;
}

export interface ListResponse {
  readonly records: readonly RecordSummary[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly groups?: readonly { value: unknown; label: string; count: number; filter: string }[];
}

/** A countdown comes from the last server message plus the browser's elapsed delta. */
export class Countdown {
  private readonly received = new Map<number, number>();

  record(sla: SlaView): void {
    this.received.set(sla.id, performance.now());
  }

  /** shown remaining, by the published formula. */
  remaining(sla: SlaView): number {
    const at = this.received.get(sla.id);
    if (at === undefined) return sla.remaining_seconds;
    const since = (performance.now() - at) / 1000;
    if (!sla.ticking) return sla.remaining_seconds;
    if (sla.next_change_at === null) return sla.remaining_seconds - since;
    const window = (Date.parse(sla.next_change_at) - Date.parse(sla.server_time)) / 1000;
    return sla.remaining_seconds - Math.min(since, Math.max(0, window));
  }
}

export const countdown = new Countdown();

/** The SLA region: one progressbar and countdown per live SLA. */
export function slaRegion(slas: readonly SlaView[]): HTMLElement {
  const region = el('div', { class: 'region', role: 'region', 'aria-label': 'SLA', dataRegion: 'sla' });
  const shown = slas.filter((sla) => sla.stage !== 'cancelled');
  for (const sla of shown) {
    countdown.record(sla);
    const fill = el('div', { class: 'bar-fill' });
    fill.style.width = `${Math.min(100, sla.percent)}%`;
    const bar = el(
      'div',
      {
        class: 'bar',
        role: 'progressbar',
        'aria-label': sla.definition,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.min(100, sla.percent)),
        dataSla: String(sla.id),
      },
      [fill],
    );
    const text = el('p', { dataCountdown: String(sla.id) }, [
      countdownText(sla, countdown.remaining(sla)),
    ]);
    const parts: (Node | string)[] = [bar, text, el('p', {}, [percentText(sla.percent)])];
    if (sla.stage === 'paused') parts.push(el('p', {}, [pausedForText(sla)]));
    if (sla.breached) {
      parts.push(el('p', { class: 'status' }, ['Breached']));
    }
    region.append(el('div', { class: 'region' }, parts));
  }
  return region;
}

let ticker: number | null = null;

/** Once per second, every countdown on the page is redrawn from server values. */
export function startTicking(getSlas: () => readonly SlaView[]): void {
  if (ticker !== null) window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    for (const sla of getSlas()) {
      const node = document.querySelector<HTMLElement>(`[data-countdown="${sla.id}"]`);
      if (!node) continue;
      node.textContent = countdownText(sla, countdown.remaining(sla));
    }
  }, 1000);
}

/** The SLA bar grows from its old percent to its new one over 420 ms. */
export function animateSlaBar(slaId: number, fromPercent: number, toPercent: number): void {
  const fill = document.querySelector<HTMLElement>(`[data-sla="${slaId}"] .bar-fill`);
  if (!fill) return;
  fill.style.width = `${Math.min(100, toPercent)}%`;
  animate(fill, [{ width: `${Math.min(100, fromPercent)}%` }, { width: `${Math.min(100, toPercent)}%` }], timings.settle);
}

export interface BuilderCondition {
  path: string;
  op: string;
  value: unknown;
}

export interface BuilderGroup {
  connector: 'and' | 'or';
  conditions: BuilderCondition[];
}

export interface Builder {
  connector: 'and' | 'or';
  groups: BuilderGroup[];
}

const operators = [
  { value: '=', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: '<', label: 'is before' },
  { value: '<=', label: 'is at or before' },
  { value: '>', label: 'is after' },
  { value: '>=', label: 'is at or after' },
  { value: 'contains', label: 'contains' },
  { value: 'startswith', label: 'starts with' },
  { value: 'in', label: 'is one of' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'not_is_empty', label: 'is not empty' },
];

const incidentPaths = [
  'number',
  'state',
  'short_description',
  'description',
  'caller',
  'caller.department.name',
  'configuration_item',
  'impact',
  'urgency',
  'priority',
  'assignment_group',
  'assigned_to',
  'assigned_to.username',
  'hold_reason',
  'resolution_code',
  'confidential',
  'is_major',
  'sla_breached',
  'created_at',
];

function emptyBuilder(): Builder {
  return { connector: 'and', groups: [{ connector: 'and', conditions: [{ path: 'state', op: '=', value: '' }] }] };
}

function readValueText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === 'me()') return 'me()';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function writeValueText(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export interface FilterDialogOptions {
  readonly table: string;
  readonly filter: string;
  readonly onApply: (filter: string) => void;
  readonly onSave: (filter: string) => void;
  readonly sheet: boolean;
}

/**
 * The condition builder. The filter text box rewrites itself in canonical form
 * within half a second of each builder change, and reading the text back
 * rebuilds this very builder.
 */
export function openFilterDialog(options: FilterDialogOptions): void {
  let builder: Builder = emptyBuilder();

  openDialog({ label: 'Filter', sheet: options.sheet }, (dialog) => {
    const groupsHost = section({ class: 'stackv' });
    const filterText = el('input', { type: 'text', 'aria-label': 'Filter text', value: options.filter });
    let rewrite: number | null = null;

    const compose = async (): Promise<string> => {
      const response = await api.post<{ filter: string }>('/api/filters/compose', {
        table: options.table,
        builder,
      });
      return response.filter;
    };

    const scheduleRewrite = (): void => {
      if (rewrite !== null) window.clearTimeout(rewrite);
      rewrite = window.setTimeout(() => {
        void compose()
          .then((text) => {
            filterText.value = text;
          })
          .catch(() => undefined);
      }, 300);
    };

    const render = (focusPath?: { group: number; condition: number } | { group: number }): void => {
      groupsHost.replaceChildren();
      const groupsMatch = el('div', { role: 'radiogroup', 'aria-label': 'Groups match' }, [
        radio('All groups', builder.connector === 'and', () => {
          builder = { ...builder, connector: 'and' };
          render();
          scheduleRewrite();
        }),
        radio('Any group', builder.connector === 'or', () => {
          builder = { ...builder, connector: 'or' };
          render();
          scheduleRewrite();
        }),
      ]);
      groupsHost.append(groupsMatch);

      builder.groups.forEach((group, groupIndex) => {
        const g = groupIndex + 1;
        const groupNode = el('div', { role: 'group', 'aria-label': `Group ${g}` });
        groupNode.append(
          el('div', { role: 'radiogroup', 'aria-label': `Group ${g} match` }, [
            radio('All conditions', group.connector === 'and', () => {
              group.connector = 'and';
              render();
              scheduleRewrite();
            }),
            radio('Any condition', group.connector === 'or', () => {
              group.connector = 'or';
              render();
              scheduleRewrite();
            }),
          ]),
        );

        group.conditions.forEach((condition, conditionIndex) => {
          const c = conditionIndex + 1;
          const row = el('div', {
            role: 'group',
            'aria-label': `Condition ${c} of group ${g}`,
            dataGroup: String(g),
            dataCondition: String(c),
          });
          const fieldBox = selectBox(
            'Field',
            incidentPaths.map((path) => ({ value: path, label: path })),
            condition.path,
          );
          fieldBox.addEventListener('change', () => {
            condition.path = fieldBox.value;
            scheduleRewrite();
          });
          const opBox = selectBox('Operator', operators, condition.op);
          opBox.addEventListener('change', () => {
            condition.op = opBox.value;
            scheduleRewrite();
          });
          const valueBox = el('input', {
            type: 'text',
            'aria-label': 'Value',
            value: writeValueText(condition.value),
          }) as HTMLInputElement;
          valueBox.addEventListener('input', () => {
            condition.value = readValueText(valueBox.value);
            scheduleRewrite();
          });

          const up = button('Move condition up');
          up.addEventListener('click', () => moveCondition(groupIndex, conditionIndex, -1));
          const down = button('Move condition down');
          down.addEventListener('click', () => moveCondition(groupIndex, conditionIndex, 1));
          const remove = button('Remove condition');
          remove.addEventListener('click', () => {
            group.conditions.splice(conditionIndex, 1);
            if (group.conditions.length === 0) {
              render({ group: groupIndex });
            } else {
              render({ group: groupIndex, condition: Math.max(0, conditionIndex - 1) });
            }
            scheduleRewrite();
          });

          row.addEventListener('keydown', (event) => {
            if (!event.altKey) return;
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveCondition(groupIndex, conditionIndex, -1);
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveCondition(groupIndex, conditionIndex, 1);
            }
          });

          row.append(fieldBox, opBox, valueBox, up, down, remove);
          groupNode.append(row);
        });

        const add = button(`Add condition to group ${g}`);
        add.addEventListener('click', () => {
          group.conditions.push({ path: 'state', op: '=', value: '' });
          render({ group: groupIndex, condition: group.conditions.length - 1 });
          scheduleRewrite();
        });
        groupNode.append(add);
        groupsHost.append(groupNode);
      });

      if (focusPath) {
        if ('condition' in focusPath) {
          const target = groupsHost.querySelector<HTMLElement>(
            `[data-group="${focusPath.group + 1}"][data-condition="${focusPath.condition + 1}"] select`,
          );
          focus(target);
        } else {
          const groupNodes = groupsHost.querySelectorAll('[role="group"][aria-label^="Group "]');
          const node = groupNodes[focusPath.group] as HTMLElement | undefined;
          focus(node?.querySelector<HTMLElement>('button') ?? null);
        }
      }
    };

    const moveCondition = (groupIndex: number, conditionIndex: number, step: number): void => {
      const group = builder.groups[groupIndex];
      const to = conditionIndex + step;
      if (to < 0 || to >= group.conditions.length) return;
      const [moved] = group.conditions.splice(conditionIndex, 1);
      group.conditions.splice(to, 0, moved);
      render({ group: groupIndex, condition: to });
      scheduleRewrite();
    };

    const addGroup = button('Add group');
    addGroup.addEventListener('click', () => {
      builder.groups.push({ connector: 'and', conditions: [{ path: 'state', op: '=', value: '' }] });
      render({ group: builder.groups.length - 1, condition: 0 });
      scheduleRewrite();
    });

    const useText = button('Use filter text');
    const rebuild = (): void => {
      void api
        .post<{ builder: Builder; filter: string }>('/api/filters/parse', {
          table: options.table,
          filter: filterText.value,
        })
        .then((response) => {
          builder = response.builder;
          filterText.value = response.filter;
          render();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    };
    useText.addEventListener('click', rebuild);
    filterText.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        rebuild();
      }
    });

    const apply = button('Apply filter', { class: 'block' });
    apply.addEventListener('click', () => {
      void compose().then((text) => {
        dialog.close();
        options.onApply(text);
      });
    });
    const save = button('Save filter');
    save.addEventListener('click', () => {
      void compose().then((text) => options.onSave(text));
    });
    const close = button('Close');
    close.addEventListener('click', () => dialog.close());

    dialog.body.append(
      groupsHost,
      addGroup,
      el('div', { class: 'field' }, [el('label', {}, ['Filter text']), filterText]),
      el('div', { class: 'row' }, [useText, apply, save, close]),
    );

    if (options.filter.trim() !== '') rebuild();
    else render();
    window.setTimeout(() => focus(groupsHost.querySelector<HTMLElement>('select')), 0);
  });
}

function radio(label: string, checked: boolean, onPick: () => void): HTMLElement {
  const input = el('input', { type: 'radio', 'aria-label': label, name: `r-${label}` }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', onPick);
  const id = `o-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return el('div', {}, [input, el('label', { for: id }, [label])]);
}

const typeWords: Record<string, string> = {
  incident: 'Incident',
  problem: 'Problem',
  change: 'Change',
  request_item: 'Request item',
  task: 'Task',
};

interface Option {
  value: string;
  label: string;
}

let referenceOptions: { users: Option[]; cis: Option[]; groups: Option[] } = {
  users: [],
  cis: [],
  groups: [],
};

export async function loadReferenceOptions(): Promise<void> {
  const [users, cis, groups] = await Promise.all([
    api.get<{ users: { username: string; display_name: string }[] }>('/api/users').catch(() => ({ users: [] })),
    api.get<{ cis: { name: string }[] }>('/api/cis').catch(() => ({ cis: [] })),
    api.get<{ groups: { name: string }[] }>('/api/groups').catch(() => ({ groups: [] })),
  ]);
  referenceOptions = {
    users: users.users.map((u) => ({ value: u.username, label: u.display_name })),
    cis: cis.cis.map((c) => ({ value: c.name, label: c.name })),
    groups: groups.groups.map((g) => ({ value: g.name, label: g.name })),
  };
}

const referenceFields: Record<string, 'users' | 'cis' | 'groups'> = {
  caller: 'users',
  affected_person: 'users',
  assigned_to: 'users',
  requested_for: 'users',
  configuration_item: 'cis',
  assignment_group: 'groups',
};

const comboNames: Record<string, string> = {
  assigned_to: 'Assigned to',
  caller: 'Caller',
  configuration_item: 'Service or item',
};

const choiceFields: Record<string, Option[]> = {
  impact: [
    { value: '1', label: '1 High' },
    { value: '2', label: '2 Medium' },
    { value: '3', label: '3 Low' },
  ],
  urgency: [
    { value: '1', label: '1 High' },
    { value: '2', label: '2 Medium' },
    { value: '3', label: '3 Low' },
  ],
  hold_reason: [
    { value: '', label: '' },
    { value: 'awaiting_requester', label: 'Awaiting requester' },
    { value: 'awaiting_supplier', label: 'Awaiting supplier' },
    { value: 'awaiting_change', label: 'Awaiting change' },
  ],
  resolution_code: [
    { value: '', label: '' },
    { value: 'fixed', label: 'Fixed' },
    { value: 'workaround_given', label: 'Workaround given' },
    { value: 'no_fault_found', label: 'No fault found' },
    { value: 'duplicate', label: 'Duplicate' },
  ],
  model: [
    { value: 'normal', label: 'Normal' },
    { value: 'standard', label: 'Standard' },
    { value: 'emergency', label: 'Emergency' },
  ],
  outcome: [
    { value: '', label: '' },
    { value: 'successful', label: 'Successful' },
    { value: 'failed', label: 'Failed' },
    { value: 'backed_out', label: 'Backed out' },
  ],
};

const longFields = ['description', 'resolution_note', 'implementation_plan', 'backout_plan', 'workaround'];

function controlFor(name: string, field: FieldView): HTMLElement {
  const reference = referenceFields[name];
  if (reference) {
    const box = selectBox(
      comboNames[name] ?? field.label,
      [{ value: '', label: '' }, ...referenceOptions[reference]],
      field.value === null ? '' : String(field.value),
      { dataField: name },
    );
    if (field.read_only) box.disabled = true;
    return box;
  }
  const choices = choiceFields[name];
  if (choices) {
    const box = selectBox(field.label, choices, field.value === null ? '' : String(field.value), {
      dataField: name,
    });
    if (field.read_only) box.disabled = true;
    return box;
  }
  if (typeof field.value === 'boolean') {
    const box = el('input', { type: 'checkbox', 'aria-label': field.label, dataField: name }) as HTMLInputElement;
    box.checked = field.value;
    box.disabled = field.read_only;
    return box;
  }
  if (longFields.includes(name)) {
    const box = el('textarea', { 'aria-label': field.label, dataField: name }) as HTMLTextAreaElement;
    box.value = field.value === null ? '' : String(field.value);
    box.readOnly = field.read_only;
    return box;
  }
  const box = el('input', {
    type: 'text',
    'aria-label': field.label,
    dataField: name,
    value: field.value === null ? '' : String(field.value),
  }) as HTMLInputElement;
  box.readOnly = field.read_only;
  return box;
}

function readControl(node: HTMLElement): unknown {
  if (node instanceof HTMLInputElement) {
    if (node.type === 'checkbox') return node.checked;
    return node.value === '' ? null : node.value;
  }
  if (node instanceof HTMLSelectElement) return node.value === '' ? null : node.value;
  if (node instanceof HTMLTextAreaElement) return node.value === '' ? null : node.value;
  return null;
}

export interface RecordFormHandle {
  readonly node: HTMLElement;
  reload(): Promise<void>;
  /**
   * Takes a fresh record from the server. A field this person has edited keeps
   * their value and the version they last saw, so saving it gives the published
   * conflict; every untouched field follows the server.
   */
  applyRemote(fresh: RecordView): void;
  readonly state: string;
}

function controlText(node: HTMLElement): string {
  const value = readControl(node);
  return JSON.stringify(value ?? null);
}

/** The record form, with the published controls, regions and keyboard rules. */
export function renderRecordForm(
  record: RecordView,
  options: { onChanged: () => void; onNavigate: (number: string) => void },
): RecordFormHandle {
  const host = section({ class: 'rest hard-edge', dataRegion: 'form' });
  const slaHost = section();
  const activityHost = section({ class: 'region', role: 'region', 'aria-label': 'Activity', dataRegion: 'activity' });
  const viewingHost = section();
  const errorHost = section();

  const form = el('form', { 'aria-label': record.number, dataForm: record.number });
  form.addEventListener('submit', (event) => event.preventDefault());

  const headingNode = el('h2', { tabindex: '-1' }, [record.number]);
  host.append(headingNode);
  if (record.priority_overridden) host.append(el('p', {}, ['Priority overridden']));

  const controls = new Map<string, HTMLElement>();
  const rendered = new Map<string, string>();
  const fields: Record<string, FieldView> = { ...record.fields };
  for (const [name, field] of Object.entries(fields)) {
    if (!field.visible) continue;
    const control = controlFor(name, field);
    controls.set(name, control);
    rendered.set(name, controlText(control));
    const id = `c-${name}`;
    control.id = id;
    form.append(el('div', { class: 'field' }, [el('label', { for: id }, [field.label]), control]));
  }

  const save = button('Save', { class: 'block' });
  const transitions = section({ class: 'row' });

  const collectChanges = (): Record<string, { value: unknown; version: number }> => {
    const changes: Record<string, { value: unknown; version: number }> = {};
    for (const [name, control] of controls) {
      const field = fields[name];
      if (!field || field.read_only) continue;
      // A control is changed only against what was rendered into it, so a
      // choice shown as text is not mistaken for an edit of its number.
      if (controlText(control) === rendered.get(name)) continue;
      changes[name] = { value: readControl(control), version: field.version };
    }
    return changes;
  };

  const showErrors = (failure: ApiFailure): void => {
    errorHost.replaceChildren();
    const fields = failure.fields;
    const names = Object.keys(fields);
    if (names.length === 0) {
      errorHost.append(el('p', {}, [failure.message]));
      announce(failure.message);
      return;
    }
    const group = el('div', { role: 'group', 'aria-label': 'Problems to fix', tabindex: '-1' });
    for (const name of names) {
      const jump = el('a', { href: '#' }, [fields[name]]);
      jump.addEventListener('click', (event) => {
        event.preventDefault();
        focus(controls.get(name) ?? null);
      });
      group.append(el('p', {}, [jump]));
    }
    errorHost.append(group);
    announce(copy.problems(names.length));
    focus(group);
  };

  const doSave = async (): Promise<void> => {
    const changes = collectChanges();
    if (Object.keys(changes).length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    save.textContent = copy.saving;
    try {
      await api.patch(`/api/records/${record.number}`, { fields: changes });
      for (const name of Object.keys(changes)) {
        const control = controls.get(name);
        if (control) rendered.set(name, controlText(control));
      }
      announce(copy.saved(record.number));
      errorHost.replaceChildren();
      await options.onChanged();
      focus(active);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'field_conflict') {
        openConflictDialog(record, error, controls, async () => {
          await options.onChanged();
        });
        announce(
          copy.conflict(
            error.body.error.conflicts?.[0]?.label ?? '',
            error.body.error.conflicts?.[0]?.theirs_by ?? '',
          ),
        );
      } else if (error instanceof ApiFailure) {
        showErrors(error);
      }
    } finally {
      save.textContent = 'Save';
    }
  };

  save.addEventListener('click', () => void doSave());
  host.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    void doSave();
  });

  for (const move of record.transitions) {
    const moveButton = button(`Move to ${move.label}`);
    moveButton.addEventListener('click', () => {
      moveButton.textContent = copy.moving;
      void api
        .post(`/api/records/${record.number}/transition`, { to: move.to })
        .then(async () => {
          announce(copy.moved(record.number, move.label));
          await options.onChanged();
          focus(document.querySelector<HTMLElement>(`[data-form="${record.number}"]`)?.previousElementSibling as HTMLElement | null);
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) {
            errorHost.replaceChildren(el('p', {}, [error.message]));
            announce(error.message);
          }
        })
        .finally(() => {
          moveButton.textContent = `Move to ${move.label}`;
        });
    });
    transitions.append(moveButton);
  }

  if (hasRole('operator')) {
    const override = button('Override priority');
    override.addEventListener('click', () => openOverrideDialog(record, options.onChanged));
    transitions.append(override);
  }

  slaHost.append(slaRegion(record.slas));

  if (record.workaround) {
    host.append(
      el('div', { class: 'region', role: 'region', 'aria-label': `Workaround from ${record.workaround.problem}` }, [
        el('p', {}, [record.workaround.text]),
      ]),
    );
  }

  const notesHost = section({ class: 'row' });
  if (hasRole('operator', 'technician')) {
    const note = el('textarea', { 'aria-label': 'Work note' }) as HTMLTextAreaElement;
    const addNote = button('Add work note');
    addNote.addEventListener('click', () => {
      if (note.value.trim() === '') return;
      void api.post(`/api/records/${record.number}/work-notes`, { text: note.value }).then(async () => {
        announce(copy.noteAdded);
        note.value = '';
        await refreshActivity();
      });
    });
    notesHost.append(el('div', { class: 'field' }, [el('label', {}, ['Work note']), note]), addNote);
  }
  const comment = el('textarea', { 'aria-label': 'Comment' }) as HTMLTextAreaElement;
  const addComment = button('Add comment');
  addComment.addEventListener('click', () => {
    if (comment.value.trim() === '') return;
    void api.post(`/api/records/${record.number}/comments`, { text: comment.value }).then(async () => {
      announce(copy.noteAdded);
      comment.value = '';
      await refreshActivity();
    });
  });
  notesHost.append(el('div', { class: 'field' }, [el('label', {}, ['Comment']), comment]), addComment);

  const refreshActivity = async (): Promise<void> => {
    const response = await api.get<{
      entries: { at: string; actor: string | null; kind: string; text: string }[];
    }>(`/api/records/${record.number}/activity`);
    activityHost.replaceChildren(
      el('h3', {}, ['Activity']),
      el(
        'ul',
        { class: 'list-plain' },
        response.entries.map((entry) => el('li', {}, [`${entry.kind}: ${entry.text}`])),
      ),
      notesHost,
    );
  };
  void refreshActivity();

  const refreshViewing = async (): Promise<void> => {
    const response = await api.get<{ viewing: { username: string; display_name: string }[] }>(
      `/api/presence/${record.number}`,
    );
    viewingHost.replaceChildren(
      el(
        'ul',
        { class: 'list-plain', 'aria-label': 'Also viewing' },
        response.viewing.map((person) => el('li', {}, [`${person.display_name} is viewing`])),
      ),
    );
  };
  void refreshViewing();

  const attachments = section({ class: 'region', role: 'region', 'aria-label': 'Attachments' });
  const attachButton = button('Attach file');
  const filePicker = el('input', { type: 'file' }) as HTMLInputElement;
  filePicker.style.display = 'none';
  attachButton.addEventListener('click', () => filePicker.click());
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    void api
      .upload<{ attachment: { name: string; status: string } }>(
        `/api/records/${record.number}/attachments`,
        file,
      )
      .then((response) => {
        announce(
          response.attachment.status === 'stored'
            ? copy.attachmentAttached(response.attachment.name)
            : copy.attachmentQueued(response.attachment.name),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
      });
  });
  attachments.append(el('h3', {}, ['Attachments']), attachButton, filePicker);

  const links = section({ class: 'region' });
  const linkRow = (label: string, number: string | null): Node | null => {
    if (!number) return null;
    const anchor = link(`${label}: ${number}`, `/desk/records/${number}`);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      options.onNavigate(number);
    });
    return el('p', {}, [anchor]);
  };
  links.append(
    ...[
      linkRow('Parent', record.links.parent),
      linkRow('Problem', record.links.problem),
      linkRow('Fix change', record.links.fix_change),
      ...record.links.children.map((child) => linkRow('Child', child)),
    ].filter((node): node is Node => node !== null),
  );

  host.append(form, errorHost, el('div', { class: 'row' }, [save]), transitions, slaHost, viewingHost, links, attachments, activityHost);

  let shownState = record.state;

  return {
    node: host,
    get state(): string {
      return shownState;
    },
    reload: async () => {
      await refreshActivity();
      await refreshViewing();
    },
    applyRemote: (fresh) => {
      shownState = fresh.state;
      for (const [name, field] of Object.entries(fresh.fields)) {
        const control = controls.get(name);
        if (!control) continue;
        const edited = controlText(control) !== rendered.get(name);
        if (edited) continue;
        const replacement = controlFor(name, field);
        replacement.id = control.id;
        control.replaceWith(replacement);
        controls.set(name, replacement);
        rendered.set(name, controlText(replacement));
        fields[name] = field;
      }
      slaHost.replaceChildren(slaRegion(fresh.slas));
      void refreshActivity();
      void refreshViewing();
    },
  };
}

/** The conflict dialog, settled by keyboard. */
function openConflictDialog(
  record: RecordView,
  failure: ApiFailure,
  controls: Map<string, HTMLElement>,
  onApplied: () => Promise<void>,
): void {
  const conflicts = failure.body.error.conflicts ?? [];
  openDialog({ label: 'Field conflict' }, (dialog) => {
    const picks = new Map<string, 'mine' | 'theirs'>();
    for (const conflict of conflicts) {
      picks.set(conflict.field, 'mine');
      const group = el('div', { role: 'radiogroup', 'aria-label': conflict.label }, [
        el('p', {}, [`Yours: ${String(conflict.yours ?? '')}`]),
        el('p', {}, [`Theirs: ${String(conflict.theirs ?? '')}, saved by ${conflict.theirs_by}`]),
        radio('Keep mine', true, () => picks.set(conflict.field, 'mine')),
        radio('Use theirs', false, () => picks.set(conflict.field, 'theirs')),
      ]);
      dialog.body.append(group);
    }
    const apply = button('Apply choices', { class: 'block' });
    apply.addEventListener('click', () => {
      const fields: Record<string, { value: unknown; version: number }> = {};
      for (const conflict of conflicts) {
        const pick = picks.get(conflict.field);
        fields[conflict.field] = {
          value: pick === 'theirs' ? conflict.theirs : conflict.yours,
          version: conflict.version,
        };
      }
      void api
        .patch(`/api/records/${record.number}`, { fields })
        .then(async () => {
          dialog.close();
          await onApplied();
          // Focus returns to the first field that was in conflict.
          focus(controls.get(conflicts[0]?.field ?? '') ?? null);
        })
        .catch(() => undefined);
    });
    const cancel = button('Cancel');
    cancel.addEventListener('click', () => dialog.close());
    dialog.body.append(el('div', { class: 'row' }, [apply, cancel]));
  });
}

function openOverrideDialog(record: RecordView, onChanged: () => void): void {
  openDialog({ label: 'Override priority' }, (dialog) => {
    const priority = selectBox(
      'Priority',
      [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
      String(record.fields.priority?.value ?? 3),
    );
    const reason = el('input', { type: 'text', 'aria-label': 'Reason' }) as HTMLInputElement;
    const confirm = button('Override', { class: 'block' });
    confirm.addEventListener('click', () => {
      void api
        .post(`/api/records/${record.number}/priority-override`, {
          priority: Number(priority.value),
          reason: reason.value,
        })
        .then(() => {
          dialog.close();
          onChanged();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    dialog.body.append(
      el('div', { class: 'field' }, [el('label', {}, ['Priority']), priority]),
      el('div', { class: 'field' }, [el('label', {}, ['Reason']), reason]),
      confirm,
    );
  });
}

const gridColumns = [
  { path: 'number', label: 'Number', editable: false },
  { path: 'short_description', label: 'Short description', editable: true },
  { path: 'priority', label: 'Priority', editable: false },
  { path: 'state', label: 'State', editable: false },
  { path: 'assigned_to', label: 'Assigned to', editable: true },
  { path: 'sla', label: 'SLA', editable: false },
];

function isPhone(): boolean {
  return window.innerWidth < 768;
}

interface WorkspaceState {
  table: string;
  filter: string;
  queueName: string;
  page: number;
  groupBy: string;
  selected: Set<string>;
  open: string | null;
  records: RecordSummary[];
  total: number;
  pending: Set<string>;
  /** Records this page created, which are never announced back to it. */
  mine: Set<string>;
}

/** The ticket workspace at its three published viewports. */
export async function renderWorkspace(
  host: HTMLElement,
  path: string,
  search: URLSearchParams,
): Promise<void> {
  const queues = await api
    .get<{ filters: SavedFilter[] }>('/api/filters')
    .then((r) => r.filters.filter((f) => f.shared))
    .catch(() => [] as SavedFilter[]);

  const openMatch = /^\/desk\/records\/([^/]+)$/.exec(path);
  const newMatch = /^\/desk\/records\/new\/([^/]+)$/.exec(path);
  const listMatch = /^\/desk\/lists\/([^/]+)$/.exec(path);

  const ws: WorkspaceState = {
    table: listMatch ? listMatch[1] : 'incident',
    filter: search.get('filter') ?? queues[0]?.filter ?? '',
    queueName: queues[0]?.name ?? 'Open incidents',
    page: 1,
    groupBy: '',
    selected: new Set(),
    open: openMatch ? openMatch[1] : null,
    records: [],
    total: 0,
    pending: new Set(),
    mine: new Set(),
  };
  if (search.get('filter')) ws.queueName = 'Filtered incidents';

  const queueNav = el('nav', { class: 'rest', 'aria-label': 'Queues', dataRegion: 'queues' });
  const listPane = el('div', { class: 'pane pane-list' });
  const formPane = el('div', { class: 'pane pane-form' });
  const pinHost = section();

  const renderQueues = (): void => {
    queueNav.replaceChildren(
      el(
        'ul',
        { class: 'list-plain' },
        queues.map((queue) => {
          const anchor = link(queue.name, `/desk/lists/incident?filter=${encodeURIComponent(queue.filter)}`);
          anchor.addEventListener('click', (event) => {
            event.preventDefault();
            ws.filter = queue.filter;
            ws.queueName = queue.name;
            ws.page = 1;
            void refreshList();
          });
          return el('li', {}, [anchor]);
        }),
      ),
    );
  };

  const subject = (): string => {
    if (newMatch) return `New ${typeWords[newMatch[1]] ?? newMatch[1]}`;
    if (ws.open && isPhone()) return ws.open;
    return ws.queueName;
  };

  const renderPin = (): void => {
    pinHost.replaceChildren(pin(subject()));
  };

  const header = (): HTMLElement => {
    const row = section({ class: 'row' });
    if (hasRole('operator', 'technician')) {
      for (const [label, table] of [
        ['New incident', 'incident'],
        ['New problem', 'problem'],
        ['New task', 'task'],
      ] as const) {
        const create = button(label);
        create.addEventListener('click', () => navigate(`/desk/records/new/${table}`));
        row.append(create);
      }
    }
    if (hasRole('operator')) {
      const create = button('New change');
      create.addEventListener('click', () => navigate('/desk/records/new/change'));
      row.append(create);
    }
    const filterButton = button('Filter');
    filterButton.addEventListener('click', () =>
      openFilterDialog({
        table: ws.table,
        filter: ws.filter,
        sheet: isPhone(),
        onApply: (text) => {
          ws.filter = text;
          ws.page = 1;
          void refreshList().then(() => {
            focus(listPane.querySelector<HTMLElement>('tbody tr, .cards > li'));
          });
        },
        onSave: (text) => {
          void api.post('/api/filters', { name: 'Saved filter', table: ws.table, filter: text, shared: false });
        },
      }),
    );
    row.append(filterButton);

    const groupBy = selectBox(
      'Group by',
      [
        { value: '', label: '' },
        { value: 'priority', label: 'Priority' },
        { value: 'state', label: 'State' },
        { value: 'assigned_to', label: 'Assigned to' },
        { value: 'impact', label: 'Impact' },
        { value: 'urgency', label: 'Urgency' },
      ],
      ws.groupBy,
    );
    groupBy.addEventListener('change', () => {
      ws.groupBy = groupBy.value;
      void refreshList();
    });
    row.append(groupBy);

    row.append(button('Choose columns'));

    const bulk = button('Update selected');
    bulk.addEventListener('click', () => openBulkDialog(ws, refreshList));
    row.append(bulk);

    const exportButton = button('Export');
    exportButton.addEventListener('click', () => {
      void api
        .post('/api/exports', { table: ws.table, filter: ws.filter, columns: ['number', 'short_description', 'state'] })
        .catch(() => undefined);
    });
    row.append(exportButton);

    const previous = button('Previous page');
    previous.addEventListener('click', () => {
      if (ws.page > 1) {
        ws.page -= 1;
        void refreshList();
      }
    });
    const next = button('Next page');
    next.addEventListener('click', () => {
      ws.page += 1;
      void refreshList();
    });
    row.append(previous, next);

    if (ws.pending.size > 0) {
      const notice = button(copy.newRecords(ws.pending.size), { class: 'block' });
      notice.addEventListener('click', () => {
        ws.pending.clear();
        void refreshList().then(() => focus(listPane.querySelector<HTMLElement>('tbody tr, .cards > li')));
      });
      row.append(notice);
    }
    return row;
  };

  let openForm: RecordFormHandle | null = null;
  let presenceOn: string | null = null;

  const openRecord = async (number: string): Promise<void> => {
    ws.open = number;
    history.replaceState({}, '', `/desk/records/${number}`);
    if (presenceOn !== number) {
      presenceOn = number;
      live.subscribe([`record:${number}`, `sla:${number}`, `presence:${number}`]);
      // An open form registers presence every 10 seconds while it is open.
      live.startPresence(number);
    }
    renderPin();
    await refreshForm();
    if (isPhone()) {
      listPane.classList.add('hidden-phone');
      formPane.classList.remove('hidden-phone');
    }
    focus(formPane.querySelector<HTMLElement>('h2'));
  };


  const refreshForm = async (): Promise<void> => {
    if (!ws.open) {
      openForm = null;
      formPane.replaceChildren();
      return;
    }
    try {
      const response = await api.get<{ record: RecordView }>(`/api/records/${ws.open}`);
      const form = renderRecordForm(response.record, {
        onChanged: () => {
          void refreshForm();
          void refreshList();
        },
        onNavigate: (number) => void openRecord(number),
      });
      const back = button('Back');
      back.addEventListener('click', () => {
        listPane.classList.remove('hidden-phone');
        formPane.classList.add('hidden-phone');
        ws.open = null;
        renderPin();
        formPane.replaceChildren();
      });
      openForm = form;
      formPane.replaceChildren(isPhone() ? back : document.createComment('desk'), form.node);
      startTicking(() => response.record.slas);
    } catch {
      formPane.replaceChildren(
        stateScreen(copy.notFound, copy.notFoundButton, () => {
          ws.open = null;
          formPane.replaceChildren();
        }),
      );
    }
  };

  const renderGrid = (response: ListResponse): HTMLElement => {
    if (isPhone()) {
      const cards = el('ul', { class: 'cards', 'aria-label': ws.queueName });
      for (const record of response.records) {
        const item = el('li', { tabindex: '0', 'aria-label': record.label, dataNumber: record.number }, [
          el('p', {}, [record.number]),
          el('p', {}, [record.short_description ?? '']),
          el('p', { class: 'status' }, [record.state_label]),
        ]);
        item.addEventListener('click', () => void openRecord(record.number));
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void openRecord(record.number);
          }
        });
        cards.append(item);
      }
      return cards;
    }

    const table = el('table', { role: 'grid', 'aria-label': ws.queueName });
    const head = el('tr');
    for (const column of gridColumns) head.append(el('th', { scope: 'col' }, [column.label]));
    table.append(el('thead', {}, [head]));
    const body = el('tbody');

    const groups = response.groups ?? null;
    if (groups) {
      for (const group of groups) {
        const row = el('tr', {}, [
          el('td', { colspan: String(gridColumns.length), class: 'group-heading' }, [
            `${group.label} (${group.count})`,
          ]),
        ]);
        body.append(row);
      }
    }

    for (const record of response.records) {
      const row = el('tr', {
        role: 'row',
        'aria-label': record.label,
        dataNumber: record.number,
        'aria-selected': ws.selected.has(record.number) ? 'true' : 'false',
      });
      for (const column of gridColumns) {
        const value =
          column.path === 'number'
            ? record.number
            : column.path === 'short_description'
              ? (record.short_description ?? '')
              : column.path === 'priority'
                ? String(record.priority ?? '')
                : column.path === 'state'
                  ? record.state_label
                  : column.path === 'assigned_to'
                    ? (record.assigned_to ?? '')
                    : record.sla
                      ? countdownText(record.sla, countdown.remaining(record.sla))
                      : '';
        if (record.sla && column.path === 'sla') countdown.record(record.sla);
        const cell = el('td', { tabindex: '-1', dataColumn: column.path }, [value]);
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);

    const firstCell = body.querySelector<HTMLElement>('td');
    if (firstCell) firstCell.tabIndex = 0;

    table.addEventListener('keydown', (event) => {
      const cell = (event.target as HTMLElement).closest('td');
      if (!cell) return;
      const row = cell.parentElement as HTMLTableRowElement | null;
      if (!row) return;
      const rows = [...body.querySelectorAll('tr')].filter((r) => r.hasAttribute('data-number'));
      const rowIndex = rows.indexOf(row);
      const cells = [...row.querySelectorAll('td')];
      const cellIndex = cells.indexOf(cell as HTMLTableCellElement);
      const moveTo = (r: number, c: number): void => {
        const targetRow = rows[r];
        if (!targetRow) return;
        const target = targetRow.querySelectorAll('td')[c] as HTMLElement | undefined;
        if (!target) return;
        for (const other of body.querySelectorAll('td')) (other as HTMLElement).tabIndex = -1;
        target.tabIndex = 0;
        focus(target);
      };
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          moveTo(rowIndex, Math.min(cellIndex + 1, cells.length - 1));
          return;
        case 'ArrowLeft':
          event.preventDefault();
          moveTo(rowIndex, Math.max(cellIndex - 1, 0));
          return;
        case 'ArrowDown':
          event.preventDefault();
          if (event.shiftKey) {
            extendSelection(rows, rowIndex, 1, ws);
            return;
          }
          moveTo(Math.min(rowIndex + 1, rows.length - 1), cellIndex);
          return;
        case 'ArrowUp':
          event.preventDefault();
          if (event.shiftKey) {
            extendSelection(rows, rowIndex, -1, ws);
            return;
          }
          moveTo(Math.max(rowIndex - 1, 0), cellIndex);
          return;
        case 'Enter': {
          event.preventDefault();
          const number = row.getAttribute('data-number');
          if (number) void openRecord(number);
          return;
        }
        case ' ': {
          event.preventDefault();
          const number = row.getAttribute('data-number');
          if (!number) return;
          if (ws.selected.has(number)) ws.selected.delete(number);
          else ws.selected.add(number);
          row.setAttribute('aria-selected', ws.selected.has(number) ? 'true' : 'false');
          return;
        }
        case 'F2': {
          event.preventDefault();
          const column = gridColumns.find((c) => c.path === cell.getAttribute('data-column'));
          if (!column?.editable) return;
          editCell(cell as HTMLElement, row.getAttribute('data-number') ?? '', column.path, refreshList);
          return;
        }
        default:
          if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
            (listPane.querySelector('button') as HTMLElement | null)?.click();
          }
      }
    });

    return el('div', { class: 'scroller' }, [table]);
  };

  const refreshList = async (): Promise<void> => {
    renderPin();
    renderQueues();
    const query = new URLSearchParams();
    if (ws.filter) query.set('filter', ws.filter);
    query.set('page', String(ws.page));
    if (ws.groupBy) query.set('group_by', ws.groupBy);
    try {
      const response = await api.get<ListResponse>(`/api/tables/${ws.table}/records?${query.toString()}`);
      ws.records = [...response.records];
      ws.total = response.total;
      const body = section({ class: 'rest', dataRegion: 'list' });
      body.append(header());
      if (response.records.length === 0) {
        body.append(
          ws.filter.trim() === ''
            ? stateScreen(copy.emptyQueue(ws.queueName), copy.emptyQueueButton, () => {
                ws.filter = 'state in ["new", "assigned", "in_progress", "on_hold"]';
                ws.queueName = 'Open incidents';
                void refreshList();
              })
            : stateScreen(copy.noMatches, copy.noMatchesButton, () => {
                ws.filter = '';
                void refreshList();
              }),
        );
      } else {
        body.append(renderGrid(response));
      }
      listPane.replaceChildren(body);
      startTicking(() => ws.records.map((r) => r.sla).filter((s): s is SlaView => s !== null));
    } catch {
      listPane.replaceChildren(
        stateScreen(copy.loadError, copy.loadErrorButton, () => void refreshList()),
      );
    }
  };

  const workspace = el('div', { class: 'workspace' }, [
    el('div', { class: 'pane pane-queues' }, [queueNav]),
    listPane,
    formPane,
  ]);
  host.replaceChildren(pinHost, workspace);

  await refreshList();
  if (newMatch) {
    renderNewForm(formPane, newMatch[1], async (number) => {
      ws.mine.add(number);
      await openRecord(number);
    });
  }
  else if (ws.open) await openRecord(ws.open);

  // A record someone else creates is announced, not inserted.
  onLive([`list:${ws.table}`], (message: LiveMessage) => {
    if (message.topic === `list:${ws.table}` && message.event === 'created') {
      const numbers = (message.data.numbers as string[] | undefined) ?? [];
      for (const number of numbers) {
        if (ws.mine.has(number)) continue;
        if (!ws.records.some((r) => r.number === number)) ws.pending.add(number);
      }
      if (ws.pending.size > 0) {
        announce(copy.newRecords(ws.pending.size));
        void refreshList();
      }
      return;
    }
    if (ws.open && message.topic === `presence:${ws.open}`) {
      void openForm?.reload();
      return;
    }
    if (ws.open && (message.topic === `record:${ws.open}` || message.topic === `sla:${ws.open}`)) {
      const number = ws.open;
      const form = openForm;
      if (form === null) return;
      void api
        .get<{ record: RecordView }>(`/api/records/${number}`)
        .then((fresh) => {
          // A state change brings new transition buttons, so redraw then.
          if (fresh.record.state !== form.state) {
            void refreshForm();
            return;
          }
          form.applyRemote(fresh.record);
        })
        .catch(() => undefined);
      void refreshList();
    }
  });
}

function extendSelection(
  rows: readonly Element[],
  from: number,
  step: number,
  ws: WorkspaceState,
): void {
  const target = rows[from + step];
  if (!target) return;
  for (const row of [rows[from], target]) {
    const number = row.getAttribute('data-number');
    if (!number) continue;
    ws.selected.add(number);
    row.setAttribute('aria-selected', 'true');
  }
  focus(target.querySelector<HTMLElement>('td'));
}

/** F2 edits one cell; Enter saves that one field with its version. */
function editCell(
  cell: HTMLElement,
  number: string,
  field: string,
  refresh: () => Promise<void>,
): void {
  const before = cell.textContent ?? '';
  const input = el('input', { type: 'text', 'aria-label': field, value: before }) as HTMLInputElement;
  cell.replaceChildren(input);
  focus(input);
  const finish = (): void => {
    cell.replaceChildren(document.createTextNode(before));
    focus(cell);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void api
      .get<{ record: RecordView }>(`/api/records/${number}`)
      .then((response) =>
        api.patch(`/api/records/${number}`, {
          fields: { [field]: { value: input.value, version: response.record.fields[field]?.version ?? 1 } },
        }),
      )
      .then(async () => {
        announce(copy.saved(number));
        await refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) announce(error.message);
        finish();
      });
  });
}

function openBulkDialog(ws: WorkspaceState, refresh: () => Promise<void>): void {
  openDialog({ label: 'Bulk update' }, (dialog) => {
    const field = selectBox(
      'Field',
      [
        { value: 'assigned_to', label: 'Assigned to' },
        { value: 'impact', label: 'Impact' },
        { value: 'urgency', label: 'Urgency' },
        { value: 'short_description', label: 'Short description' },
      ],
      'assigned_to',
    );
    const value = el('input', { type: 'text', 'aria-label': 'Value' }) as HTMLInputElement;
    const update = button('Update', { class: 'block' });
    update.addEventListener('click', () => {
      void api
        .post<{ results: { number: string; ok: boolean; message?: string }[] }>('/api/records/bulk', {
          numbers: [...ws.selected],
          fields: { [field.value]: value.value },
        })
        .then(async (response) => {
          dialog.close();
          const ok = response.results.filter((r) => r.ok).length;
          const failed = response.results.length - ok;
          announce(copy.bulkSummary(ok, failed));
          const report = el('div', { role: 'region', 'aria-label': 'Bulk update report' }, [
            el('h3', { tabindex: '-1' }, ['Bulk update report']),
            el(
              'ul',
              { class: 'list-plain' },
              response.results.map((r) =>
                el('li', {}, [
                  r.ok ? copy.bulkRowOk(r.number) : copy.bulkRowFailed(r.number, r.message ?? ''),
                ]),
              ),
            ),
          ]);
          document.querySelector('.pane-list .rest')?.append(report);
          focus(report.querySelector<HTMLElement>('h3'));
          await refresh();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiFailure) announce(error.message);
        });
    });
    dialog.body.append(
      el('div', { class: 'field' }, [el('label', {}, ['Field']), field]),
      el('div', { class: 'field' }, [el('label', {}, ['Value']), value]),
      update,
    );
  });
}

/** The new-record form: fields start empty apart from published defaults. */
function renderNewForm(
  host: HTMLElement,
  table: string,
  onCreated: (number: string) => Promise<void>,
): void {
  const typeLabel = typeWords[table] ?? table;
  const form = el('form', { 'aria-label': `New ${typeLabel}` });
  form.addEventListener('submit', (event) => event.preventDefault());

  const names =
    table === 'change'
      ? ['title', 'model', 'configuration_item', 'planned_start', 'planned_end', 'implementation_plan', 'backout_plan']
      : table === 'task'
        ? ['short_description', 'description', 'assignment_group', 'assigned_to']
        : ['short_description', 'description', 'caller', 'configuration_item', 'impact', 'urgency'];

  const controls = new Map<string, HTMLElement>();
  for (const name of names) {
    const field: FieldView = {
      value: name === 'impact' ? '3' : name === 'urgency' ? '3' : name === 'model' ? 'normal' : null,
      display: null,
      version: 1,
      label: name === 'title' ? 'Title' : labelOf(name),
      mandatory: false,
      read_only: false,
      visible: true,
    };
    const control = controlFor(name, field);
    controls.set(name, control);
    const id = `n-${name}`;
    control.id = id;
    form.append(el('div', { class: 'field' }, [el('label', { for: id }, [field.label]), control]));
  }

  const priorityLine = el('p', {}, ['Priority 5']);
  const recompute = (): void => {
    const impact = Number((controls.get('impact') as HTMLSelectElement | undefined)?.value ?? 3);
    const urgency = Number((controls.get('urgency') as HTMLSelectElement | undefined)?.value ?? 3);
    const matrix: Record<number, Record<number, number>> = {
      1: { 1: 1, 2: 2, 3: 3 },
      2: { 1: 2, 2: 3, 3: 4 },
      3: { 1: 3, 2: 4, 3: 5 },
    };
    priorityLine.textContent = `Priority ${matrix[impact]?.[urgency] ?? 5}`;
  };
  controls.get('impact')?.addEventListener('change', recompute);
  controls.get('urgency')?.addEventListener('change', recompute);
  recompute();

  const errorHost = section();
  const suggestions = el('ul', { class: 'list-plain', 'aria-label': 'Suggested articles' });
  const short = controls.get('short_description');
  if (short instanceof HTMLInputElement) {
    let timer: number | null = null;
    short.addEventListener('input', () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void api
          .get<{ articles: { number: string; title: string }[] }>(
            `/api/knowledge/suggest?text=${encodeURIComponent(short.value)}`,
          )
          .then((response) => {
            suggestions.replaceChildren(
              ...response.articles.map((article) =>
                el('li', {}, [link(article.title, `/portal/knowledge/${article.number}`)]),
              ),
            );
          })
          .catch(() => undefined);
      }, 300);
    });
  }

  const save = button('Save', { class: 'block' });
  const doSave = (): void => {
    const fields: Record<string, unknown> = {};
    for (const [name, control] of controls) {
      const value = readControl(control);
      if (value !== null) fields[name] = value;
    }
    save.textContent = copy.saving;
    void api
      .post<{ record: RecordView }>(`/api/tables/${table}/records`, { fields })
      .then(async (response) => {
        announce(copy.saved(response.record.number));
        await onCreated(response.record.number);
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        errorHost.replaceChildren();
        const names2 = Object.keys(error.fields);
        if (names2.length === 0) {
          errorHost.append(el('p', {}, [error.message]));
          announce(error.message);
          return;
        }
        const group = el('div', { role: 'group', 'aria-label': 'Problems to fix', tabindex: '-1' });
        for (const name of names2) {
          const jump = el('a', { href: '#' }, [error.fields[name]]);
          jump.addEventListener('click', (event) => {
            event.preventDefault();
            focus(controls.get(name) ?? null);
          });
          group.append(el('p', {}, [jump]));
        }
        errorHost.append(group);
        announce(copy.problems(names2.length));
        focus(group);
      })
      .finally(() => {
        save.textContent = 'Save';
      });
  };
  save.addEventListener('click', doSave);
  form.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      doSave();
    }
  });

  host.replaceChildren(
    el('div', { class: 'rest hard-edge' }, [form, priorityLine, suggestions, errorHost, save]),
  );
  focus(controls.get(table === 'change' ? 'title' : 'short_description') ?? null);
}

const newFormLabels: Record<string, string> = {
  short_description: 'Short description',
  description: 'Description',
  caller: 'Caller',
  configuration_item: 'Service or item',
  impact: 'Impact',
  urgency: 'Urgency',
  assignment_group: 'Assignment group',
  assigned_to: 'Assigned to',
  model: 'Model',
  planned_start: 'Planned start',
  planned_end: 'Planned end',
  implementation_plan: 'Implementation plan',
  backout_plan: 'Backout plan',
};

function labelOf(name: string): string {
  return newFormLabels[name] ?? name;
}
