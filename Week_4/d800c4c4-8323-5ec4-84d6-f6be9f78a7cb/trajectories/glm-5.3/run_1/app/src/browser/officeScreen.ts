// The Office: fee rules, opening calendar, closures, inventory, waiver requests and fees.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, ApiFailure } from './apiClient';
import { money } from './format';
import type { CalendarHours, Fee, Item, Loan, Settings } from './types';
import { renderProblems, setPending, clearPending } from './ui';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export function renderOfficeScreen(kit: ScreenKit): () => void {
  const { main, app } = kit;
  clear(main);
  const role = app.role();
  if (role !== 'coordinator') {
    const nf = el('div', { class: 'not-found' });
    nf.append(el('h1', { text: "We couldn't find that page." }), el('p', {}, el('a', { href: '/', text: 'Back to the pegboard' })));
    main.append(nf);
    return () => {};
  }

  const wrap = el('div', { class: 'single-column office-grid' });
  main.append(wrap);
  const timers: ReturnType<typeof setTimeout>[] = [];

  const announce = el('div', { role: 'status', 'aria-label': 'Desk announcements', 'aria-live': 'polite', class: 'status-line' });
  const feeRulesSection = el('section', { role: 'region', 'aria-label': 'Fee rules', class: 'section' });
  const calendarSection = el('section', { role: 'region', 'aria-label': 'Opening calendar', class: 'section' });
  const inventorySection = el('section', { role: 'region', 'aria-label': 'Inventory', class: 'section' });
  const waiversSection = el('section', { class: 'section' });
  const feesSection = el('section', { class: 'section' });
  wrap.append(announce, feeRulesSection, calendarSection, inventorySection, waiversSection, feesSection);

  interface HourRowState {
    open: boolean;
    opens: string;
    closes: string;
    edited: boolean;
  }
  const hourRows = new Map<string, HourRowState>();
  let feeRulesEdited: Record<string, string> | null = null;

  // --- fee rules ---
  async function loadSettings(): Promise<void> {
    const settings = await apiJson<Settings>('GET', '/api/settings');
    if (feeRulesEdited === null) {
      renderFeeRules(settings);
    }
  }

  function renderFeeRules(settings: Settings): void {
    clear(feeRulesSection);
    feeRulesSection.append(el('h2', { text: 'Fee rules' }));
    const lateHolder = el('div', { class: 'field' });
    const late = el('input', { type: 'text', id: 'late-fee', value: (settings.late_fee_cents / 100).toFixed(2) }) as HTMLInputElement;
    lateHolder.append(el('label', { for: 'late-fee', text: 'Late fee per open day' }), late);
    const damageHolder = el('div', { class: 'field' });
    const damage = el('input', { type: 'text', id: 'damage-fee', value: (settings.damage_fee_cents / 100).toFixed(2) }) as HTMLInputElement;
    damageHolder.append(el('label', { for: 'damage-fee', text: 'Damage fee' }), damage);
    const periodHolder = el('div', { class: 'field' });
    const period = el('input', { type: 'text', id: 'loan-period', value: String(settings.loan_period_days) }) as HTMLInputElement;
    periodHolder.append(el('label', { for: 'loan-period', text: 'Loan period in days' }), period);
    const zoneHolder = el('div', { class: 'field' });
    const zone = el('select', { id: 'time-zone' }) as HTMLSelectElement;
    zone.setAttribute('role', 'combobox');
    for (const name of ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'UTC']) {
      const option = el('option', { value: name, text: name });
      if (name === settings.time_zone) option.setAttribute('selected', 'selected');
      zone.append(option);
    }
    zoneHolder.append(el('label', { for: 'time-zone', text: 'Time zone' }), zone);
    const save = el('button', { class: 'primary', text: 'Save fee rules' }) as HTMLButtonElement;
    const problems = el('div');

    const markEdited = () => {
      feeRulesEdited = { late: late.value, damage: damage.value, period: period.value, zone: zone.value };
    };
    for (const input of [late, damage, period]) input.addEventListener('input', markEdited);
    zone.addEventListener('change', markEdited);

    const fieldsOf = (field: string): HTMLElement | null => {
      if (field === 'late_fee_cents') return late;
      if (field === 'damage_fee_cents') return damage;
      if (field === 'loan_period_days') return period;
      if (field === 'time_zone') return zone;
      return null;
    };

    save.addEventListener('click', () => void saveFeeRules(save, problems, fieldsOf));
    feeRulesSection.append(problems, lateHolder, damageHolder, periodHolder, zoneHolder, save);
  }

  async function saveFeeRules(button: HTMLButtonElement, problems: HTMLElement, fieldsOf: (field: string) => HTMLElement | null): Promise<void> {
    setPending(button, 'Saving...');
    const late = (feeRulesSection.querySelector('#late-fee') as HTMLInputElement).value;
    const damage = (feeRulesSection.querySelector('#damage-fee') as HTMLInputElement).value;
    const period = (feeRulesSection.querySelector('#loan-period') as HTMLInputElement).value;
    const zone = (feeRulesSection.querySelector('#time-zone') as HTMLSelectElement).value;
    try {
      await apiJson('PUT', '/api/settings', {
        time_zone: zone,
        late_fee_cents: Math.round(Number(late) * 100),
        damage_fee_cents: Math.round(Number(damage) * 100),
        loan_period_days: Number(period),
      });
      announce.textContent = 'Fee rules saved. They apply to loans checked out from now on.';
      feeRulesEdited = null;
      await loadSettings();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure && err.status === 422) {
        renderProblems(problems, err.fields ?? {}, fieldsOf);
        problems.setAttribute('tabindex', '-1');
        problems.focus();
      }
    }
  }

  // --- opening hours ---
  async function loadCalendar(): Promise<void> {
    const calendar = await apiJson<{ hours: CalendarHours[]; closures: { date: string; reason: string }[] }>('GET', '/api/calendar');
    const openMap = new Map(calendar.hours.map((h) => [h.weekday, h]));
    for (const weekday of WEEKDAYS) {
      if (!hourRows.has(weekday)) {
        const hours = openMap.get(weekday);
        hourRows.set(weekday, {
          open: hours !== undefined,
          opens: hours?.opens ?? '',
          closes: hours?.closes ?? '',
          edited: false,
        });
      }
    }
    renderHoursTable();
    renderClosures(calendar.closures);
  }

  function renderHoursTable(): void {
    const table = calendarSection.querySelector('table');
    if (table === null) return;
    const body = table.querySelector('tbody');
    if (body === null) return;
    clear(body);
    for (const weekday of WEEKDAYS) {
      const state = hourRows.get(weekday)!;
      const row = el('tr', { class: 'hours-row' });
      const checkboxHolder = el('td');
      const checkbox = el('input', { type: 'checkbox', id: `open-${weekday}` }) as HTMLInputElement;
      checkbox.checked = state.open;
      checkbox.setAttribute('aria-label', `Open on ${WEEKDAY_LABELS[weekday]}`);
      checkbox.addEventListener('change', () => {
        state.open = checkbox.checked;
        state.edited = true;
        renderHoursTable();
      });
      checkboxHolder.append(checkbox, el('span', { text: ` ${WEEKDAY_LABELS[weekday]}` }));
      const opensHolder = el('td');
      const opens = el('input', { type: 'text', id: `${weekday}-opens`, value: state.opens }) as HTMLInputElement;
      opens.disabled = !state.open;
      opensHolder.append(opens);
      const closesHolder = el('td');
      const closes = el('input', { type: 'text', id: `${weekday}-closes`, value: state.closes }) as HTMLInputElement;
      closes.disabled = !state.open;
      closesHolder.append(closes);
      opens.addEventListener('input', () => {
        state.opens = opens.value;
        state.edited = true;
      });
      closes.addEventListener('input', () => {
        state.closes = closes.value;
        state.edited = true;
      });
      opens.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void saveHours();
      });
      closes.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') void saveHours();
      });
      row.append(checkboxHolder, opensHolder, closesHolder);
      body.append(row);
    }
  }

  function buildHoursSkeleton(): void {
    clear(calendarSection);
    calendarSection.append(el('h2', { text: 'Opening calendar' }));
    const table = el('table', { class: 'ledger hours-table', 'aria-label': 'Opening hours' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Open' }), el('th', { text: 'Opens' }), el('th', { text: 'Closes' }))));
    table.append(el('tbody'));
    const problems = el('div');
    const save = el('button', { class: 'primary', text: 'Save hours' }) as HTMLButtonElement;
    save.addEventListener('click', () => void saveHours());
    calendarSection.append(problems, table, save);

    const closureHolder = el('div', { class: 'field' });
    const closureDate = el('input', { type: 'text', id: 'closure-date', placeholder: 'YYYY-MM-DD' }) as HTMLInputElement;
    closureDate.setAttribute('aria-label', 'Closure date');
    const closureReason = el('input', { type: 'text', id: 'closure-reason', placeholder: 'Reason' }) as HTMLInputElement;
    closureReason.setAttribute('aria-label', 'Closure reason');
    closureHolder.append(closureDate, closureReason);
    const declare = el('button', { text: 'Declare closure' }) as HTMLButtonElement;
    const closureProblems = el('div');
    const closuresTable = el('table', { class: 'ledger', 'aria-label': 'Closures' });
    closuresTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Date' }), el('th', { text: 'Reason' }))));
    const closureBody = el('tbody');
    closuresTable.append(closureBody);

    declare.addEventListener('click', () => void declareClosure(declare, closureDate, closureReason, closureProblems));

    calendarSection.append(closureProblems, el('h3', { text: 'Closures' }), closureHolder, declare, closuresTable);
  }

  function fieldHolderFor(field: string): HTMLElement | null {
    const weekday = field.split('.')[1];
    const kind = field.split('.')[2];
    if (weekday === undefined || kind === undefined) return null;
    return calendarSection.querySelector(`#${weekday}-${kind === 'opens' ? 'opens' : 'closes'}`)?.parentElement ?? null;
  }

  async function saveHours(): Promise<void> {
    const button = calendarSection.querySelector('button.primary') as HTMLButtonElement | null;
    if (button === null) return;
    setPending(button, 'Saving...');
    const hours: { weekday: string; opens: string; closes: string }[] = [];
    for (const weekday of WEEKDAYS) {
      const state = hourRows.get(weekday)!;
      if (state.open) hours.push({ weekday, opens: state.opens, closes: state.closes });
    }
    try {
      const result = await apiJson<{ moved_loans: number }>('PUT', '/api/calendar/hours', { hours });
      announce.textContent = `Opening hours saved. ${result.moved_loans} loans moved to the next open day.`;
      for (const state of hourRows.values()) state.edited = false;
      await loadCalendar();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure && err.status === 422) {
        const problems = calendarSection.querySelector('div') as HTMLElement;
        renderProblems(problems, err.fields ?? {}, fieldHolderFor);
        problems.setAttribute('tabindex', '-1');
        problems.focus();
      }
    }
  }

  async function declareClosure(
    button: HTMLButtonElement,
    date: HTMLInputElement,
    reason: HTMLInputElement,
    problems: HTMLElement,
  ): Promise<void> {
    setPending(button, 'Saving...');
    try {
      const result = await apiJson<{ new_due_date: string; moved_loans: number }>('POST', '/api/closures', {
        date: date.value.trim(),
        reason: reason.value.trim(),
      });
      announce.textContent = `Closure saved. ${result.moved_loans} loans now due ${result.new_due_date}.`;
      await loadCalendar();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) {
        if (err.status === 422) {
          renderProblems(problems, err.fields ?? {}, (field) => (field === 'date' ? date : reason));
          problems.setAttribute('tabindex', '-1');
          problems.focus();
        } else {
          announce.textContent = err.error;
        }
      }
    }
  }

  function renderClosures(closures: { date: string; reason: string }[]): void {
    const body = calendarSection.querySelector('table[aria-label="Closures"] tbody');
    if (body === null) return;
    clear(body);
    for (const closure of closures) {
      body.append(el('tr', {}, el('td', { class: 'mono', text: closure.date }), el('td', { text: closure.reason })));
    }
  }

  // --- inventory ---
  async function loadInventory(): Promise<void> {
    const board = await apiJson<{ items: Item[] }>('GET', '/api/board');
    const body = inventorySection.querySelector('tbody');
    if (body === null) return;
    clear(body);
    for (const item of board.items) {
      body.append(
        el('tr', {}, el('td', { class: 'mono', text: item.tag }), el('td', { text: item.name }), el('td', { class: 'mono', text: money(item.replacement_cost_cents) })),
      );
    }
  }

  function buildInventorySkeleton(): void {
    inventorySection.append(el('h2', { text: 'Inventory' }));
    const add = el('button', { class: 'primary', text: 'Add tool' }) as HTMLButtonElement;
    const table = el('table', { class: 'ledger' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Tag' }), el('th', { text: 'Name' }), el('th', { text: 'Replacement cost' }))));
    table.append(el('tbody'));
    inventorySection.append(add, table);
    add.addEventListener('click', () => openAddTool(add));
  }

  function openAddTool(opener: HTMLButtonElement): void {
    const dialog = el('dialog', { 'aria-label': 'Add tool' }) as HTMLDialogElement;
    const tag = el('input', { type: 'text', id: 'add-tag', placeholder: 'PW-123' }) as HTMLInputElement;
    const name = el('input', { type: 'text', id: 'add-name' }) as HTMLInputElement;
    const cost = el('input', { type: 'text', id: 'add-cost', placeholder: '189.00' }) as HTMLInputElement;
    const partName = el('input', { type: 'text', id: 'add-part-name' }) as HTMLInputElement;
    const partShape = el('select', { id: 'add-part-shape' }) as HTMLSelectElement;
    for (const shape of ['generic', 'drill', 'saw', 'ladder', 'hammer', 'wrench', 'case', 'battery', 'cable', 'blade']) {
      partShape.append(el('option', { value: shape, text: shape }));
    }
    const partWidth = el('input', { type: 'text', id: 'add-part-width', value: '2' }) as HTMLInputElement;
    const partHeight = el('input', { type: 'text', id: 'add-part-height', value: '2' }) as HTMLInputElement;
    const problems = el('div');
    const add = el('button', { class: 'primary', text: 'Add tool' }) as HTMLButtonElement;
    dialog.append(
      el('h2', { text: 'Add tool' }),
      problems,
      el('div', { class: 'field' }, el('label', { for: 'add-tag', text: 'Tag' }), tag),
      el('div', { class: 'field' }, el('label', { for: 'add-name', text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { for: 'add-cost', text: 'Replacement cost' }), cost),
      el('div', { class: 'field' }, el('label', { for: 'add-part-name', text: 'Part name' }), partName),
      el('div', { class: 'field' }, el('label', { for: 'add-part-shape', text: 'Part shape' }), partShape),
      el('div', { class: 'field' }, el('label', { for: 'add-part-width', text: 'Part width (holes)' }), partWidth),
      el('div', { class: 'field' }, el('label', { for: 'add-part-height', text: 'Part height (holes)' }), partHeight),
      el('div', { class: 'row' }, add),
    );
    document.body.append(dialog);
    dialog.showModal();
    tag.focus();

    const close = () => {
      dialog.close();
      dialog.remove();
      opener.focus();
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    add.addEventListener('click', () => void doAdd(add, problems));
  }

  async function doAdd(button: HTMLButtonElement, problems: HTMLElement): Promise<void> {
    setPending(button, 'Adding...');
    const tag = (document.getElementById('add-tag') as HTMLInputElement).value.trim().toUpperCase();
    const name = (document.getElementById('add-name') as HTMLInputElement).value.trim();
    const cost = (document.getElementById('add-cost') as HTMLInputElement).value.trim();
    const partName = (document.getElementById('add-part-name') as HTMLInputElement).value.trim();
    const shape = (document.getElementById('add-part-shape') as HTMLSelectElement).value;
    const width = Number((document.getElementById('add-part-width') as HTMLInputElement).value);
    const height = Number((document.getElementById('add-part-height') as HTMLInputElement).value);
    try {
      await apiJson('POST', '/api/items', {
        tag,
        name,
        replacement_cost_cents: Math.round(Number(cost) * 100),
        parts: [{ name: partName, shape, width, height }],
      });
      announce.textContent = `${tag} added to the board.`;
      const dialog = button.closest('dialog');
      dialog?.close();
      dialog?.remove();
      await loadInventory();
      await app.refreshBoard();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure && err.status === 422) {
        renderProblems(problems, err.fields ?? {}, (field) => document.getElementById(`add-${field.replace('_cents', '').replace('tag', 'tag')}`));
        problems.setAttribute('tabindex', '-1');
        problems.focus();
      }
    }
  }

  // --- waivers and fees ---
  async function loadWaiversAndFees(): Promise<void> {
    const [loansResult, feesResult] = await Promise.all([
      apiJson<{ loans: Loan[] }>('GET', '/api/loans'),
      apiJson<{ fees: Fee[] }>('GET', '/api/fees'),
    ]);
    void loansResult;
    renderWaivers(feesResult.fees);
    renderFees(feesResult.fees);
  }

  function renderWaivers(fees: Fee[]): void {
    const table = waiversSection.querySelector('tbody');
    if (table === null) return;
    clear(table);
    for (const fee of fees) {
      if (fee.waiver === null || fee.waiver.status !== 'requested') continue;
      table.append(el('tr', {}, el('td', {}, el('a', { href: `/fees/${fee.id}`, text: `Fee ${fee.id}` })), el('td', { text: fee.loan_ref }), el('td', { text: fee.waiver.reason })));
    }
  }

  function renderFees(fees: Fee[]): void {
    const table = feesSection.querySelector('tbody');
    if (table === null) return;
    clear(table);
    for (const fee of fees) {
      table.append(
        el('tr', {}, el('td', {}, el('a', { href: `/fees/${fee.id}`, text: `Fee ${fee.id}` })), el('td', { text: fee.loan_ref }), el('td', { class: 'mono', text: money(fee.total_cents) }), el('td', { text: fee.status })),
      );
    }
  }

  function buildWaiversSkeleton(): void {
    waiversSection.append(el('h2', { text: 'Waiver requests' }));
    const table = el('table', { class: 'ledger', 'aria-label': 'Waiver requests' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Fee' }), el('th', { text: 'Loan' }), el('th', { text: 'Reason' }))));
    table.append(el('tbody'));
    waiversSection.append(table);
  }

  function buildFeesSkeleton(): void {
    feesSection.append(el('h2', { text: 'Fees' }));
    const table = el('table', { class: 'ledger' });
    table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Fee' }), el('th', { text: 'Loan' }), el('th', { text: 'Total' }), el('th', { text: 'Status' }))));
    table.append(el('tbody'));
    feesSection.append(table);
  }

  buildHoursSkeleton();
  buildInventorySkeleton();
  buildWaiversSkeleton();
  buildFeesSkeleton();

  void loadSettings();
  void loadCalendar();
  void loadInventory();
  void loadWaiversAndFees();

  const refreshPoll = setInterval(() => {
    // Refreshes never disturb typed rows: edited rows keep their text.
    void loadSettings();
    void loadCalendar();
    void loadWaiversAndFees();
  }, 10000);
  timers.push(refreshPoll);

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  };
}
