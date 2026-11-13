import { api, failureOf } from '../api';
import { Route, navigate, onEvent, outage, toast } from '../app';
import { clear, el, money, openDialog } from '../dom';
import { amount, isRtl, longDate, m, monthYear, t, weekdays } from '../i18n';
import { state } from '../state';
import { spinbutton } from '../components/controls';
import { Problem, problemsRegion } from '../components/problems';

interface CalendarCell {
  room_type: string;
  date: string;
  rate_minor: number;
  allotment: number;
  left: number;
  min_stay: number;
  max_stay: number;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
  release_days: number;
}

interface CalendarData {
  room_types: { code: string; name: string }[];
  cells: CalendarCell[];
}

function managerNav(code: string, current: string): HTMLElement {
  const links: [string, string][] = [
    [`/manage/${code}/calendar`, t('ui.calendar_grid')],
    [`/manage/${code}/reservations`, t('ui.reservations')],
    [`/manage/${code}/import`, t('ui.rate_file')],
    [`/manage/${code}/statements`, t('ui.statement')],
  ];
  const nav = el('nav', { class: 'manager-nav' });
  for (const [href, label] of links) {
    const link = el('a', { href, 'aria-current': href.endsWith(current) ? 'page' : null }, [label]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(href);
    });
    nav.append(link);
  }
  return nav;
}

function addDays(iso: string, n: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export async function calendarPage(main: HTMLElement, route: Route): Promise<void> {
  const code = route.path.split('/')[2];
  main.append(managerNav(code, 'calendar'));
  const holder = el('div', { class: 'calendar-holder' });
  main.append(holder);

  let from: string | null = null;
  let data: CalendarData = { room_types: [], cells: [] };
  let anchor: { row: number; column: number } | null = null;
  let active = { row: 0, column: 0 };
  let selection = new Set<string>();

  const load = async (): Promise<void> => {
    const query = new URLSearchParams({ days: '28' });
    if (from) query.set('from', from);
    data = await api<CalendarData>(`/api/manage/${code}/calendar?${query.toString()}`);
    if (!from && data.cells.length > 0) from = data.cells[0].date;
    paint();
  };

  const dates = (): string[] => {
    if (!from) return [];
    return Array.from({ length: 28 }, (_, index) => addDays(from as string, index));
  };

  const cellOf = (roomType: string, date: string): CalendarCell | undefined =>
    data.cells.find((cell) => cell.room_type === roomType && cell.date === date);

  const keyOf = (row: number, column: number): string => `${row}:${column}`;

  const paint = (): void => {
    clear(holder);
    const earlier = el('button', { type: 'button', 'data-focus-key': 'calendar:earlier' }, [t('ui.earlier_dates')]);
    const later = el('button', { type: 'button', 'data-focus-key': 'calendar:later' }, [t('ui.later_dates')]);
    earlier.addEventListener('click', () => {
      from = addDays(from as string, -28);
      void load();
    });
    later.addEventListener('click', () => {
      from = addDays(from as string, 28);
      void load();
    });
    const table = el('table', { role: 'grid', 'aria-label': t('ui.calendar_grid'), class: 'calendar' });
    const columns = dates();
    table.append(
      el('thead', {}, [
        el('tr', { role: 'row' }, [
          el('th', { scope: 'col' }, ['']),
          ...columns.map((date) => el('th', { scope: 'col' }, [date.slice(8)])),
        ]),
      ]),
    );
    const rows = data.room_types.map((roomType, rowIndex) =>
      el('tr', { role: 'row' }, [
        el('th', { role: 'rowheader', scope: 'row' }, [roomType.name]),
        ...columns.map((date, columnIndex) => {
          const cell = cellOf(roomType.code, date);
          const key = keyOf(rowIndex, columnIndex);
          const selected = selection.has(key);
          const td = el(
            'td',
            {
              role: 'gridcell',
              'data-date': date,
              'data-room-type': roomType.code,
              'data-rate-minor': cell?.rate_minor ?? 0,
              'data-allotment': cell?.allotment ?? 0,
              'data-left': cell?.left ?? 0,
              'aria-selected': selected ? 'true' : null,
              tabindex: active.row === rowIndex && active.column === columnIndex ? '0' : '-1',
              class: cell?.stop_sell ? 'cell closed' : 'cell',
            },
            [
              money(cell?.rate_minor ?? 0, 'EUR', String(Math.round((cell?.rate_minor ?? 0) / 100)), {
                class: 'cell-rate',
              }),
              el('span', { class: 'cell-left' }, [String(cell?.left ?? 0)]),
            ],
          );
          td.addEventListener('click', () => {
            active = { row: rowIndex, column: columnIndex };
            anchor = { ...active };
            selection = new Set([key]);
            paint();
            focusActive();
          });
          td.addEventListener('keydown', (event) => onKeyDown(event, rowIndex, columnIndex));
          return td;
        }),
      ]),
    );
    table.append(el('tbody', {}, rows));
    holder.append(el('div', { class: 'calendar-nav' }, [earlier, later]), el('div', { class: 'calendar-scroll' }, [table]));
  };

  const focusActive = (): void => {
    const cells = holder.querySelectorAll<HTMLElement>('td.cell');
    const columns = dates().length;
    const target = cells[active.row * columns + active.column];
    target?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, row: number, column: number): void => {
    const columns = dates().length;
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    let next = { row, column };
    if (event.key === forward) next = { row, column: Math.min(columns - 1, column + 1) };
    else if (event.key === back) next = { row, column: Math.max(0, column - 1) };
    else if (event.key === 'ArrowDown') next = { row: Math.min(data.room_types.length - 1, row + 1), column };
    else if (event.key === 'ArrowUp') next = { row: Math.max(0, row - 1), column };
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (selection.size === 0) selection = new Set([keyOf(row, column)]);
      openEditDialog();
      return;
    } else return;
    event.preventDefault();
    if (event.shiftKey) {
      if (!anchor) anchor = { row, column };
      selection = new Set<string>();
      const rowFrom = Math.min(anchor.row, next.row);
      const rowTo = Math.max(anchor.row, next.row);
      const colFrom = Math.min(anchor.column, next.column);
      const colTo = Math.max(anchor.column, next.column);
      for (let r = rowFrom; r <= rowTo; r++) {
        for (let c = colFrom; c <= colTo; c++) selection.add(keyOf(r, c));
      }
    } else {
      anchor = { ...next };
      selection = new Set([keyOf(next.row, next.column)]);
    }
    active = next;
    paint();
    focusActive();
  };

  const openEditDialog = (): void => {
    const columns = dates();
    const picked = [...selection].map((key) => {
      const [row, column] = key.split(':').map(Number);
      return { roomType: data.room_types[row].code, date: columns[column] };
    });
    const roomTypes = [...new Set(picked.map((entry) => entry.roomType))];
    const pickedDates = picked.map((entry) => entry.date).sort();
    const activeCell = cellOf(data.room_types[active.row].code, columns[active.column]);
    const opener = holder.querySelectorAll<HTMLElement>('td.cell')[active.row * columns.length + active.column];

    openDialog({ name: t('ui.edit_nights'), opener, className: 'edit-nights' }, (body, handle) => {
      let rate = Math.round((activeCell?.rate_minor ?? 0) / 100);
      let rooms = activeCell?.allotment ?? 0;
      let minStay = activeCell?.min_stay ?? 1;
      let maxStay = activeCell?.max_stay ?? 30;
      let closedArrival = activeCell?.closed_to_arrival ?? false;
      let closedDeparture = activeCell?.closed_to_departure ?? false;
      let stopSell = activeCell?.stop_sell ?? false;
      const weekdaySet = new Set<number>(weekdays().map((day) => day.iso));
      const problemsHolder = el('div', {});
      const seasonName = el('input', { type: 'text', 'aria-label': t('ui.season_name'), class: 'field' });

      body.append(
        spinbutton({ label: t('ui.rate'), min: 0, max: 100000, value: rate, onChange: (value) => (rate = value) }),
        spinbutton({ label: t('ui.rooms_spin'), min: 0, max: 99, value: rooms, onChange: (value) => (rooms = value) }),
        spinbutton({
          label: t('ui.min_stay'),
          min: 1,
          max: 30,
          value: minStay,
          onChange: (value) => (minStay = value),
        }),
        spinbutton({
          label: t('ui.max_stay'),
          min: 1,
          max: 30,
          value: maxStay,
          onChange: (value) => (maxStay = value),
        }),
      );

      const checkbox = (label: string, checked: boolean, onToggle: (next: boolean) => void): HTMLElement => {
        const button = el('button', { type: 'button', role: 'checkbox', 'aria-checked': checked ? 'true' : 'false' }, [
          label,
        ]);
        button.addEventListener('click', () => {
          const next = button.getAttribute('aria-checked') !== 'true';
          button.setAttribute('aria-checked', next ? 'true' : 'false');
          onToggle(next);
        });
        return button;
      };

      body.append(
        checkbox(t('ui.closed_to_arrival'), closedArrival, (next) => (closedArrival = next)),
        checkbox(t('ui.closed_to_departure'), closedDeparture, (next) => (closedDeparture = next)),
        checkbox(t('ui.stop_sell'), stopSell, (next) => (stopSell = next)),
      );

      const weekdayGroup = el('div', { role: 'group', 'aria-label': t('ui.weekdays') });
      for (const day of weekdays()) {
        weekdayGroup.append(
          checkbox(day.name, true, (next) => {
            if (next) weekdaySet.add(day.iso);
            else weekdaySet.delete(day.iso);
          }),
        );
      }
      body.append(weekdayGroup, seasonName, problemsHolder);

      const apply = el('button', { type: 'button' }, [t('ui.apply')]);
      const send = async (replace?: string): Promise<void> => {
        clear(problemsHolder);
        try {
          await api(`/api/manage/${code}/nights`, {
            method: 'PATCH',
            busy: apply,
            body: {
              room_types: roomTypes,
              from: pickedDates[0],
              to: pickedDates[pickedDates.length - 1],
              weekdays: [...weekdaySet].sort((a, b) => a - b),
              rate_minor: rate * 100,
              rooms,
              min_stay: minStay,
              max_stay: maxStay,
              closed_to_arrival: closedArrival,
              closed_to_departure: closedDeparture,
              stop_sell: stopSell,
              ...(seasonName.value.trim() !== '' ? { season_name: seasonName.value.trim() } : {}),
              ...(replace ? { replace } : {}),
            },
          });
          handle.close();
          toast(m('toast.nights_saved'));
          await load();
          focusActive();
        } catch (err) {
          const failure = failureOf(err);
          if (failure?.body.error === 'season_overlap') {
            const other = String(failure.body.other);
            const message = m('season.overlap', {
              a: String(failure.body.season),
              b: other,
              from: longDate(String(failure.body.from), 'UTC'),
              to: longDate(String(failure.body.to), 'UTC'),
            });
            const region = problemsRegion([
              { label: t('ui.season_name'), message, focus: () => seasonName.focus() },
            ]);
            problemsHolder.append(region);
            const replaceButton = el('button', { type: 'button' }, [t('ui.replace_season', { season: other })]);
            replaceButton.addEventListener('click', () => void send(other));
            problemsHolder.append(replaceButton);
            region.focus();
            return;
          }
          const fields = (failure?.body.fields ?? {}) as Record<string, string>;
          const labels: Record<string, string> = {
            rate_minor: t('ui.rate'),
            rooms: t('ui.rooms_spin'),
            max_stay: t('ui.max_stay'),
            season_name: t('ui.season_name'),
          };
          const list: Problem[] = Object.entries(fields).map(([field, key]) => ({
            label: labels[field] ?? field,
            message: m(key, { n: Number(failure?.body.n ?? 0) }),
            focus: () => seasonName.focus(),
          }));
          if (list.length > 0) {
            const region = problemsRegion(list);
            problemsHolder.append(region);
            region.focus();
          }
        }
      };
      apply.addEventListener('click', () => void send());
      body.append(apply);
    });
  };

  await load();
  onEvent('availability', (data2) => {
    if (data2.property === code) void load();
  });
}

export async function reservationsPage(main: HTMLElement, route: Route): Promise<void> {
  const code = route.path.split('/')[2];
  main.append(managerNav(code, 'reservations'));
  const rows = await api<
    { code: string; surname: string; arrival: string; departure: string; rooms: number; total_minor: number }[]
  >(`/api/manage/${code}/reservations`);
  const table = el('table', { 'aria-label': t('ui.reservations'), class: 'reservations' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, [t('ui.col.code')]),
        el('th', { scope: 'col' }, [t('ui.col.surname')]),
        el('th', { scope: 'col' }, [t('ui.col.arrival')]),
        el('th', { scope: 'col' }, [t('ui.col.departure')]),
        el('th', { scope: 'col' }, [t('ui.col.rooms')]),
        el('th', { scope: 'col' }, [t('ui.col.total')]),
      ]),
    ]),
  );
  table.append(
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', {}, [
          el('td', {}, [row.code]),
          el('td', {}, [row.surname]),
          el('td', {}, [row.arrival]),
          el('td', {}, [row.departure]),
          el('td', {}, [String(row.rooms)]),
          el('td', { 'data-minor': row.total_minor, 'data-currency': 'EUR' }, [amount(row.total_minor, 'EUR')]),
        ]),
      ),
    ),
  );
  const link = el('a', { href: `/api/manage/${code}/reservations.csv`, download: '' }, [t('ui.export_csv')]);
  main.append(table, link);
}

export async function importPage(main: HTMLElement, route: Route): Promise<void> {
  const code = route.path.split('/')[2];
  main.append(managerNav(code, 'import'));
  const file = el('input', { type: 'file', 'aria-label': t('ui.rate_file'), class: 'field' });
  const previewButton = el('button', { type: 'button' }, [t('ui.preview')]);
  const applyButton = el('button', { type: 'button', disabled: true }, [t('ui.apply')]);
  const errorList = el('ul', { 'aria-label': t('ui.import_errors'), class: 'import-errors', hidden: true });
  const previewTable = el('table', { 'aria-label': t('ui.import_preview'), class: 'import-preview', hidden: true });
  const countLine = el('p', {});
  let bytes: ArrayBuffer | null = null;

  const read = async (): Promise<ArrayBuffer | null> => {
    const chosen = file.files?.[0];
    if (!chosen) return null;
    return chosen.arrayBuffer();
  };

  previewButton.addEventListener('click', () => {
    void (async () => {
      outage(null);
      bytes = await read();
      if (!bytes) return;
      errorList.hidden = true;
      previewTable.hidden = true;
      clear(errorList);
      clear(previewTable);
      if (bytes.byteLength > state.settings.importMaxBytes) {
        errorList.hidden = false;
        errorList.append(el('li', {}, [m('import.too_large', { n: state.settings.importMaxBytes })]));
        return;
      }
      try {
        const result = await api<{
          sha256: string;
          changes: { room: string; date: string; old_minor: number; new_minor: number }[];
          count: number;
        }>(`/api/manage/${code}/imports/preview`, {
          method: 'POST',
          busy: previewButton,
          raw: { bytes, contentType: 'text/plain' },
        });
        previewTable.hidden = false;
        previewTable.append(
          el(
            'tbody',
            {},
            result.changes.map((change) =>
              el('tr', {}, [
                el('td', {}, [
                  m('import.row', {
                    room: change.room,
                    'iso date': change.date,
                    old: amount(change.old_minor, 'EUR'),
                    new: amount(change.new_minor, 'EUR'),
                  }),
                ]),
              ]),
            ),
          ),
        );
        countLine.textContent = m('import.count', { n: result.count, count: result.count });
        applyButton.disabled = false;
      } catch (err) {
        const failure = failureOf(err);
        applyButton.disabled = true;
        if (failure?.status === 413) {
          errorList.hidden = false;
          errorList.append(el('li', {}, [m('import.too_large', { n: state.settings.importMaxBytes })]));
          return;
        }
        const lines = (failure?.body.lines ?? []) as { line: number; key: string; params: Record<string, never> }[];
        errorList.hidden = false;
        for (const line of lines) errorList.append(el('li', {}, [m(line.key, line.params)]));
      }
    })();
  });

  applyButton.addEventListener('click', () => {
    void (async () => {
      if (!bytes) return;
      outage(null);
      try {
        await api(`/api/manage/${code}/imports`, {
          method: 'POST',
          busy: applyButton,
          raw: { bytes, contentType: 'text/plain' },
        });
        toast(m('toast.imported'));
      } catch (err) {
        const failure = failureOf(err);
        if (failure?.status === 503) outage(m('storage.import'));
      }
    })();
  });

  main.append(file, previewButton, applyButton, errorList, previewTable, countLine);
}

export async function statementsPage(main: HTMLElement, route: Route): Promise<void> {
  const code = route.path.split('/')[2];
  main.append(managerNav(code, 'statements'));
  const holder = el('div', {});
  const select = el('select', { 'aria-label': t('ui.month') });
  main.append(select, holder);

  const paint = async (month?: string): Promise<void> => {
    const target = month ?? new Date(state.serverNowMs).toISOString().slice(0, 7);
    const statement = await api<{
      month: string;
      lines: { code: string; kind: string; base_minor: number; commission_minor: number }[];
      total_base_minor: number;
      total_commission_minor: number;
      downloadable: boolean;
      months: string[];
    }>(`/api/manage/${code}/statements/${target}`);
    if (select.options.length === 0) {
      for (const option of statement.months) {
        select.append(
          el('option', { value: option, selected: option === statement.month }, [monthYear(`${option}-01`, 'UTC')]),
        );
      }
    }
    clear(holder);
    const table = el('table', { 'aria-label': t('ui.statement'), class: 'statement' });
    table.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, [t('ui.col.code')]),
          el('th', { scope: 'col' }, [t('ui.col.kind')]),
          el('th', { scope: 'col' }, [t('ui.col.base')]),
          el('th', { scope: 'col' }, [t('ui.col.commission')]),
        ]),
      ]),
    );
    table.append(
      el(
        'tbody',
        {},
        [
          ...statement.lines.map((line) =>
            el('tr', {}, [
              el('td', {}, [line.code]),
              el('td', {}, [t(`ui.kind.${line.kind}`)]),
              el('td', { 'data-minor': line.base_minor, 'data-currency': 'EUR' }, [amount(line.base_minor, 'EUR')]),
              el('td', { 'data-minor': line.commission_minor, 'data-currency': 'EUR' }, [
                amount(line.commission_minor, 'EUR'),
              ]),
            ]),
          ),
          el('tr', {}, [
            el('td', {}, [t('ui.total_row')]),
            el('td', {}, ['']),
            el('td', { 'data-minor': statement.total_base_minor, 'data-currency': 'EUR' }, [
              amount(statement.total_base_minor, 'EUR'),
            ]),
            el('td', { 'data-minor': statement.total_commission_minor, 'data-currency': 'EUR' }, [
              amount(statement.total_commission_minor, 'EUR'),
            ]),
          ]),
        ],
      ),
    );
    holder.append(table);
    if (statement.downloadable) {
      const link = el('a', { href: `/api/manage/${code}/statements/${statement.month}.csv`, download: '' }, [
        t('ui.download_statement'),
      ]);
      link.addEventListener('click', () => {
        void api(`/api/manage/${code}/statements/${statement.month}.csv`, { busy: link }).catch((err) => {
          const failure = failureOf(err);
          if (failure?.status === 503) outage(m('storage.doc'));
        });
      });
      holder.append(link);
    }
  };

  select.addEventListener('change', () => void paint(select.value));
  await paint();
}
