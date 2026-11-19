import {
  MEDIUM,
  SHORT,
  all,
  announce,
  api,
  clearProblems,
  ddmmyyyyToIso,
  one,
  pageData,
  play,
  showProblems,
  whileWorking,
} from './dom.js';
import { closeDialog } from './dialogs.js';
import { startComboboxes } from './combobox.js';

type DeskData = { screen?: string; hireId?: string; runId?: string; version?: number; week?: string };

function value(id: string): string {
  return one<HTMLInputElement>(`#${id}`)?.value.trim() ?? '';
}

function radioValue(name: string): string {
  return one<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';
}

function reload(): void {
  window.location.reload();
}

/** A session ended by the server leaves what was typed and shows its line with a link back. */
function showSessionLine(holder: ParentNode): void {
  const line =
    one<HTMLElement>('.session-line', holder as ParentNode) ?? one<HTMLElement>('[data-part="session-line"]');
  if (!line) return;
  const back = `${window.location.pathname}${window.location.search}`;
  line.innerHTML = '';
  line.append(
    document.createTextNode('Your session ended. Sign in again to keep going — what you typed is still here. '),
  );
  const link = document.createElement('a');
  link.href = `/sign-in?return=${encodeURIComponent(back)}`;
  link.textContent = 'Sign in again';
  line.append(link);
  line.removeAttribute('hidden');
  announce('Your session ended. Sign in again to keep going — what you typed is still here.');
}

async function send(
  button: HTMLElement,
  path: string,
  options: { method?: string; body?: unknown; raw?: BodyInit; contentType?: string },
  onGood: (body: Record<string, unknown>) => void,
  holder?: ParentNode,
): Promise<void> {
  await whileWorking(button, async () => {
    clearProblems(holder ?? document);
    const answer = await api<Record<string, unknown>>(path, options);
    if (!answer.ok) {
      if (answer.status === 401) {
        showSessionLine(holder ?? document);
        return;
      }
      showProblems(holder ?? document, answer.body.error.fields ?? {}, answer.body.error.message);
      announce(answer.body.error.message);
      return;
    }
    const message = answer.body.announcement;
    if (typeof message === 'string') announce(message);
    onGood(answer.body);
  });
}

function fileOf(id: string): File | null {
  const input = one<HTMLInputElement>(`#${id}`);
  return input?.files?.[0] ?? null;
}

async function textOf(file: File): Promise<string> {
  return file.text();
}

function enquiryBody(): Record<string, unknown> {
  const journey = radioValue('journeyType') || 'oneWay';
  const stops = [
    { text: value('from'), checked: one<HTMLInputElement>('#from')?.dataset.checked === 'true' },
    ...all<HTMLInputElement>('[data-stops] input[role="combobox"]')
      .map((input) => ({ text: input.value.trim(), checked: input.dataset.checked === 'true' }))
      .filter((stop) => stop.text !== ''),
    { text: value('to'), checked: one<HTMLInputElement>('#to')?.dataset.checked === 'true' },
  ];
  const localOf = (prefix: string): Record<string, unknown> | null => {
    const iso = ddmmyyyyToIso(value(`${prefix}-date`));
    const hour = value(`${prefix}-hour`);
    const minutes = value(`${prefix}-minutes`);
    if (!iso || !hour || !minutes) return iso ? { date: iso, time: `${hour}:${minutes}` } : null;
    const repeated = radioValue(`${prefix}RepeatedHour`);
    return { date: iso, time: `${hour}:${minutes}`, ...(repeated ? { repeatedHour: repeated } : {}) };
  };
  return {
    occasion: radioValue('occasion'),
    journeyType: journey,
    stops,
    departAt: localOf('out'),
    returnAt: journey === 'return' || journey === 'sameDayReturn' ? localOf('return') : null,
    party: {
      people: Number(value('people') || '0'),
      large: Number(value('large') || '0'),
      medium: Number(value('medium') || '0'),
      hand: Number(value('hand') || '0'),
      wheelchairs: Number(value('wheelchairs') || '0'),
    },
    details: value('stop-details') === '' ? null : value('stop-details'),
    name: value('name'),
    email: value('email'),
    telephone: value('telephone'),
    language: value('language') || 'en',
  };
}

function totalsFor(hireId: string): void {
  let asked = 0;
  const paint = async (): Promise<void> => {
    asked += 1;
    const mine = asked;
    const vehicles = all<HTMLInputElement>('[id^="margin-"]').map((input, index) => ({
      id: input.id,
      marginPercent: input.value,
      index,
    }));
    const rows = all<HTMLTableRowElement>('.desk-table tbody tr');
    const body = {
      vehicles: vehicles.map((vehicle, index) => ({
        seats: Number(rows[index]?.cells[0]?.textContent?.replace(/\D/g, '') ?? '0'),
        boughtPrice: rows[index]?.dataset.bought ?? '0.00',
        marginPercent: vehicle.marginPercent,
      })),
    };
    const answer = await api<{ total: string; depositTotal: string }>(`/api/hires/${hireId}/quote/preview`, {
      method: 'POST',
      body,
    });
    if (mine !== asked || !answer.ok) return;
    const total = one<HTMLElement>('[data-total]');
    const deposit = one<HTMLElement>('[data-deposit-total]');
    if (total) total.textContent = `£${answer.body.total}`;
    if (deposit) deposit.textContent = `£${answer.body.depositTotal}`;
    announce(`Totals updated: £${answer.body.total}.`);
  };
  for (const input of all<HTMLInputElement>('[id^="margin-"]')) {
    input.addEventListener('input', () => {
      void paint();
    });
  }
}

function startStateBar(hireId: string): void {
  for (const radio of all<HTMLInputElement>('input[name="enquiry-state"]')) {
    radio.addEventListener('change', () => {
      const holder = radio.closest<HTMLElement>('fieldset');
      const held = all<HTMLInputElement>('input[name="enquiry-state"]').find((other) => other.defaultChecked);
      if (holder) holder.dataset.saving = 'Saving…';
      void (async () => {
        const answer = await api(`/api/enquiries/${hireId}`, { method: 'PATCH', body: { state: radio.value } });
        if (holder) delete holder.dataset.saving;
        if (!answer.ok) {
          if (held) held.checked = true;
          announce('That did not save. Try again.');
          radio.focus();
          return;
        }
        announce('State saved.');
      })();
    });
  }
}

function startStopReorder(hireId: string): void {
  const list = one<HTMLElement>('[data-stop-list]');
  if (!list) return;
  const order = (): string[] => all<HTMLElement>('.stop-row', list).map((row) => row.dataset.stop as string);
  const save = async (): Promise<void> => {
    const answer = await api(`/api/enquiries/${hireId}/trip/stops`, { method: 'PUT', body: { order: order() } });
    announce(answer.ok ? 'Route updated.' : 'Route not updated. Showing the last good route.');
  };
  const move = (row: HTMLElement, direction: number): void => {
    const rows = all<HTMLElement>('.stop-row', list);
    const at = rows.indexOf(row);
    const to = at + direction;
    if (to < 0 || to >= rows.length) return;
    if (direction < 0) list.insertBefore(row, rows[to]);
    else list.insertBefore(rows[to], row);
    play(row, [{ transform: `translateY(${-direction * 40}px)` }, { transform: 'translateY(0)' }], SHORT);
    const text = one<HTMLElement>('.stop-text', row)?.textContent ?? '';
    announce(`Stop ${all<HTMLElement>('.stop-row', list).indexOf(row) + 1} of ${rows.length}: ${text}`);
    void save();
  };
  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-move]');
    const row = button?.closest<HTMLElement>('.stop-row');
    if (!button || !row) return;
    move(row, button.getAttribute('data-move') === 'up' ? -1 : 1);
    button.focus();
  });
  let dragged: HTMLElement | null = null;
  list.addEventListener('dragstart', (event) => {
    dragged = (event.target as HTMLElement).closest<HTMLElement>('.stop-row');
  });
  list.addEventListener('dragover', (event) => {
    event.preventDefault();
  });
  list.addEventListener('drop', (event) => {
    event.preventDefault();
    const over = (event.target as HTMLElement).closest<HTMLElement>('.stop-row');
    if (!dragged || !over || dragged === over) return;
    list.insertBefore(dragged, over);
    void save();
    dragged = null;
  });
}

function startSeatGrid(hireId: string): void {
  let picked: string | null = null;
  const place = async (vehicleId: string, seat: string, passengerId: string): Promise<void> => {
    const answer = await api<{ announcement?: string }>(`/api/hires/${hireId}/seats`, {
      method: 'PUT',
      body: { vehicleId, seat, passengerId },
    });
    if (!answer.ok) {
      announce(answer.body.error.message);
      return;
    }
    if (answer.body.announcement) announce(answer.body.announcement);
    reload();
  };
  document.addEventListener('keydown', (event) => {
    const seat = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-part="seat"]');
    if (!seat) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (!picked) {
        picked = seat.dataset.passenger ?? null;
        return;
      }
      const taken = picked;
      picked = null;
      void place(seat.dataset.vehicle as string, seat.dataset.seat as string, taken);
      return;
    }
    const seats = all<HTMLElement>('[data-part="seat"]');
    const at = seats.indexOf(seat);
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = seats[Math.min(seats.length - 1, Math.max(0, at + step))];
    next?.focus();
  });
  let dragging: string | null = null;
  document.addEventListener('dragstart', (event) => {
    const source = (event.target as HTMLElement).closest<HTMLElement>('[data-passenger]');
    dragging = source?.dataset.passenger ?? null;
  });
  document.addEventListener('dragover', (event) => {
    if ((event.target as HTMLElement).closest('[data-part="seat"]')) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    const seat = (event.target as HTMLElement).closest<HTMLElement>('[data-part="seat"]');
    if (!seat || !dragging) return;
    event.preventDefault();
    void place(seat.dataset.vehicle as string, seat.dataset.seat as string, dragging);
    dragging = null;
  });
}

function startDiary(): void {
  const grid = one<HTMLElement>('.diary-grid');
  if (!grid) return;
  const moveRun = async (runId: string, days: number, card: HTMLElement): Promise<void> => {
    const answer = await api<{ announcement?: string; departAt?: { date: string } }>(
      `/api/runs/${runId}/departure`,
      { method: 'PUT', body: { departAt: askedDeparture(card, days) } },
    );
    if (!answer.ok) {
      announce(answer.body.error.message);
      play(card, [{ transform: 'translateX(12px)' }, { transform: 'translateX(0)' }], SHORT);
      card.focus();
      return;
    }
    if (answer.body.announcement) announce(answer.body.announcement);
    reload();
  };
  const askedDeparture = (card: HTMLElement, days: number): { date: string; time: string } => {
    const day = card.closest<HTMLElement>('.diary-day');
    const heading = one<HTMLElement>('.day-heading', day as HTMLElement)?.textContent ?? '';
    const time = card.children[1]?.textContent ?? '08:00';
    const date = new Date(Date.parse(heading));
    date.setUTCDate(date.getUTCDate() + days);
    return { date: date.toISOString().slice(0, 10), time };
  };
  grid.addEventListener('keydown', (event) => {
    const card = (event.target as HTMLElement | null)?.closest<HTMLElement>('.diary-card');
    if (!card) return;
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      void moveRun(card.dataset.run as string, event.key === 'ArrowRight' ? 1 : -1, card);
      return;
    }
    const cards = all<HTMLElement>('.diary-card', grid);
    const at = cards.indexOf(card);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      cards[Math.min(cards.length - 1, at + 1)]?.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      cards[Math.max(0, at - 1)]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      cards[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      cards[cards.length - 1]?.focus();
    }
  });
  for (const card of all<HTMLElement>('.diary-card', grid)) {
    card.tabIndex = card === one('.diary-card', grid) ? 0 : -1;
    let from = 0;
    let dragging = false;
    const putBack = (): void => {
      dragging = false;
      card.style.transform = '';
      play(card, [{ transform: 'translateX(10px)' }, { transform: 'translateX(0)' }], SHORT);
    };
    card.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      from = event.clientX;
      dragging = true;
      card.setPointerCapture(event.pointerId);
    });
    card.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      card.style.transform = `translateX(${event.clientX - from}px)`;
    });
    card.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      card.releasePointerCapture(event.pointerId);
      const moved = event.clientX - from;
      card.style.transform = '';
      const days = moved > 60 ? 1 : moved < -60 ? -1 : 0;
      if (days !== 0) void moveRun(card.dataset.run as string, days, card);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dragging) putBack();
    });
  }
}

/** A break moves by pointer, by touch or by arrows; one CSS pixel is one real minute. */
function startRibbon(runId: string): void {
  const blocks = all<HTMLElement>('[data-part="block"][role="slider"]');
  for (const block of blocks) {
    block.addEventListener('keydown', (event) => {
      const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
      const direction = steps[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      const minutes = (event.shiftKey ? 5 : 15) * direction;
      void moveBreak(runId, Number(block.dataset.blockIndex), minutes);
    });
    let from = 0;
    let held = 0;
    block.addEventListener('pointerdown', (event) => {
      from = event.clientX;
      held = Number.parseFloat(block.style.left || '0');
      block.setPointerCapture(event.pointerId);
      block.dataset.dragging = 'true';
    });
    block.addEventListener('pointermove', (event) => {
      if (block.dataset.dragging !== 'true') return;
      block.style.left = `${held + (event.clientX - from)}px`;
    });
    block.addEventListener('pointerup', (event) => {
      if (block.dataset.dragging !== 'true') return;
      delete block.dataset.dragging;
      block.releasePointerCapture(event.pointerId);
      const minutes = Math.round(event.clientX - from);
      block.style.left = `${held}px`;
      if (minutes !== 0) void moveBreak(runId, Number(block.dataset.blockIndex), minutes);
    });
  }
}

async function moveBreak(runId: string, index: number, minutes: number): Promise<void> {
  const rows = all<HTMLTableRowElement>('table[aria-label="Duty blocks"] tbody tr');
  const blocks = rows.map((row) => ({
    kind: row.cells[0]?.textContent ?? 'drive',
    minutes: Number(row.cells[1]?.textContent ?? '0'),
  }));
  const before = blocks[index - 1];
  const after = blocks[index + 1];
  if (!before || !after) return;
  const moved = Math.max(-before.minutes, Math.min(after.minutes, minutes));
  before.minutes += moved;
  after.minutes -= moved;
  const answer = await api(`/api/runs/${runId}/blocks`, { method: 'PUT', body: { blocks } });
  announce(answer.ok ? 'Break moved.' : 'That did not save. Try again.');
  if (answer.ok) reload();
}

/** `Add a stop` allows up to five stops, with focus moving into the new one. */
function startStopFields(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const add = target?.closest<HTMLElement>('[data-add-stop]');
    if (add) {
      const holder = one<HTMLElement>('[data-stops]', add.closest('[data-dialog]') ?? document);
      if (!holder) return;
      const count = all('[data-stop-row]', holder).length;
      if (count >= 5) return;
      const index = count + 1;
      const row = document.createElement('div');
      row.dataset.stopRow = String(index);
      row.innerHTML = `<div class="field underline-field combobox" data-combobox>
  <label for="stop-${index}">Stop ${index}</label>
  <input id="stop-${index}" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list"
    aria-controls="stop-${index}-list" autocomplete="street-address">
  <ul class="combobox-list" id="stop-${index}-list" role="listbox" aria-label="Stop ${index}" hidden></ul>
</div>
<button type="button" data-remove-stop="${index}">Remove stop</button>`;
      holder.append(row);
      startComboboxes(row);
      one<HTMLInputElement>(`#stop-${index}`)?.focus();
      return;
    }
    const remove = target?.closest<HTMLElement>('[data-remove-stop]');
    if (!remove) return;
    const row = remove.closest<HTMLElement>('[data-stop-row]');
    const next = row?.nextElementSibling?.querySelector<HTMLElement>('[data-remove-stop]');
    row?.remove();
    (next ?? one<HTMLElement>('[data-add-stop]'))?.focus();
  });
}

export function startDeskActions(): void {
  const data = pageData<DeskData>();
  startComboboxes();
  startStopFields();
  if (data.screen === 'enquiry' && data.hireId) startStateBar(data.hireId);
  if (data.screen === 'trip' && data.hireId) startStopReorder(data.hireId);
  if (data.screen === 'quote' && data.hireId) totalsFor(data.hireId);
  if (data.screen === 'seats' && data.hireId) startSeatGrid(data.hireId);
  if (data.screen === 'diary') startDiary();
  if (data.screen === 'hours' && data.runId) startRibbon(data.runId);

  for (const bar of all<HTMLElement>('[role="radiogroup"][aria-label="Filter by state"] input')) {
    bar.addEventListener('change', () => {
      const search = new URLSearchParams(window.location.search);
      search.set('state', (bar as HTMLInputElement).value);
      search.delete('after');
      search.delete('before');
      window.location.assign(`/enquiries?${search.toString()}`);
    });
  }
  const occasionFilter = one<HTMLSelectElement>('#occasion-filter');
  occasionFilter?.addEventListener('change', () => {
    const search = new URLSearchParams(window.location.search);
    search.set('occasion', occasionFilter.value);
    window.location.assign(`/enquiries?${search.toString()}`);
  });
  const searchBox = one<HTMLInputElement>('#search-enquiries');
  if (searchBox) {
    let timer = 0;
    searchBox.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const search = new URLSearchParams(window.location.search);
        search.set('q', searchBox.value);
        window.location.assign(`/enquiries?${search.toString()}`);
      }, 300);
    });
  }
  for (const filter of all<HTMLInputElement>('input[name="customer-filter"]')) {
    filter.addEventListener('change', () => {
      window.location.assign(`/customers?filter=${filter.value}`);
    });
  }
  const runChooser = one<HTMLSelectElement>('#run-chooser');
  runChooser?.addEventListener('change', () => {
    const search = new URLSearchParams(window.location.search);
    search.set('run', runChooser.value);
    window.location.assign(`${window.location.pathname}?${search.toString()}`);
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-action], [data-sign-out]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const holder = button.closest<HTMLElement>('[data-dialog]') ?? document;
    const hireId = data.hireId ?? '';

    if (button.hasAttribute('data-sign-out')) {
      void send(button, '/api/auth/sign-out', { method: 'POST', body: {} }, () => {
        window.location.assign('/sign-in');
      });
      return;
    }

    switch (action) {
      case 'save-password':
        void send(
          button,
          '/api/auth/password',
          { method: 'POST', body: { currentPassword: value('current-password'), newPassword: value('new-password') } },
          () => {
            announce('Password changed.');
            closeDialog('change-password');
          },
          holder,
        );
        return;
      case 'save-enquiry':
        void send(button, '/api/enquiries', { method: 'POST', body: enquiryBody() }, () => {
          announce('Enquiry added.');
          closeDialog('add-enquiry');
          reload();
        }, holder);
        return;
      case 'merge-enquiries': {
        const chosen = all<HTMLInputElement>('[data-dialog="merge-enquiries"] input:checked').map((box) => box.value);
        void send(
          button,
          '/api/enquiries/merge',
          { method: 'POST', body: { enquiryIds: [hireId, ...chosen] } },
          () => {
            announce('Enquiries merged.');
            closeDialog('merge-enquiries');
            reload();
          },
          holder,
        );
        return;
      }
      case 'save-plan': {
        const sizes = value('plan')
          .split(',')
          .map((part) => Number(part.trim()))
          .filter((size) => Number.isFinite(size));
        void send(button, `/api/enquiries/${hireId}/trip/plan`, { method: 'PUT', body: { sizes } }, () => {
          announce('Plan saved.');
          reload();
        });
        return;
      }
      case 'try-route':
        void send(button, `/api/enquiries/${hireId}/trip/route`, { method: 'POST', body: {} }, () => {
          announce('Route updated.');
          reload();
        });
        return;
      case 'refresh-directory':
        void send(button, '/api/operators/refresh', { method: 'POST', body: {} }, () => {
          announce('Directory refreshed.');
          reload();
        });
        return;
      case 'store-paper': {
        const operatorId = one<HTMLElement>('[data-opens="upload-paper"][data-operator]')?.dataset.operator ?? '';
        const file = fileOf('paper-file');
        const iso = ddmmyyyyToIso(value('ends-on'));
        if (!file || !iso) {
          showProblems(holder, { endsOn: 'Enter a date as DD/MM/YYYY.' });
          return;
        }
        const form = new FormData();
        form.append('kind', value('paper-kind'));
        form.append('endsOn', iso);
        form.append('file', file);
        void send(
          button,
          `/api/operators/${operatorId}/papers`,
          { method: 'POST', raw: form },
          () => {
            announce('Paper stored.');
            closeDialog('upload-paper');
            reload();
          },
          holder,
        );
        return;
      }
      case 'save-dbs': {
        const operatorId = one<HTMLElement>('[data-opens="set-dbs"][data-operator]')?.dataset.operator ?? '';
        const iso = ddmmyyyyToIso(value('checked-on'));
        if (!iso) {
          showProblems(holder, { checkedOn: 'Enter a date as DD/MM/YYYY.' });
          return;
        }
        void send(
          button,
          `/api/operators/${operatorId}/dbs`,
          { method: 'PUT', body: { checkedOn: iso } },
          () => {
            closeDialog('set-dbs');
            reload();
          },
          holder,
        );
        return;
      }
      case 'send-asks': {
        const chosen = all<HTMLInputElement>('[data-dialog="ask-operators"] input:checked').map((box) => box.value);
        void send(
          button,
          `/api/enquiries/${hireId}/bids/ask`,
          { method: 'POST', body: { operatorIds: chosen } },
          () => {
            announce('Operators asked.');
            closeDialog('ask-operators');
            reload();
          },
          holder,
        );
        return;
      }
      case 'award':
        void send(
          button,
          `/api/enquiries/${hireId}/award`,
          { method: 'POST', body: { operatorId: button.dataset.operator } },
          () => {
            reload();
          },
        );
        return;
      case 'send-quote':
        void send(button, `/api/hires/${hireId}/quote/send`, { method: 'POST', body: {} }, () => {
          announce('Quote sent.');
          closeDialog('send-quote');
          reload();
        }, holder);
        return;
      case 'reload':
        reload();
        return;
      case 'save-rate-table': {
        const iso = ddmmyyyyToIso(value('takes-effect-on'));
        if (!iso) {
          showProblems(holder, { effectiveFrom: 'Enter a date as DD/MM/YYYY.' });
          return;
        }
        void send(
          button,
          '/api/rates',
          {
            method: 'POST',
            body: {
              effectiveFrom: iso,
              defaultMarginPercent: value('default-margin'),
              waitingRatePerHour: value('waiting-rate'),
              secondDriverCharge: value('second-driver'),
              depositMinibus: value('minibus-deposit'),
              depositMinibusHigher: value('higher-minibus-deposit'),
              depositCoach: value('coach-deposit'),
              depositCoachHigher: value('higher-coach-deposit'),
            },
          },
          () => {
            announce('Rate table added.');
            closeDialog('add-rate-table');
            reload();
          },
          holder,
        );
        return;
      }
      case 'read-file': {
        const file = fileOf('statement-file');
        if (!file) return;
        void whileWorking(button, async () => {
          const text = await textOf(file);
          const answer = await api<{
            previewId: string;
            matched: { row: number; description: string; amount: string }[];
            unmatched: unknown[];
            moneyOut: unknown[];
            alreadySeen: unknown[];
            refused: { row: number; message: string }[];
          }>('/api/payments/statements/preview', { method: 'POST', raw: text, contentType: 'text/csv' });
          const preview = one<HTMLElement>('[data-statement-preview]');
          if (!answer.ok) {
            showProblems(holder, {}, answer.body.error.message);
            announce(answer.body.error.message);
            return;
          }
          const counts = answer.body;
          if (preview) {
            preview.dataset.previewId = counts.previewId;
            preview.innerHTML = `<p>Matched ${counts.matched.length}</p><p>Unmatched ${counts.unmatched.length}</p>
<p>Money out ${counts.moneyOut.length}</p><p>Already seen ${counts.alreadySeen.length}</p>
<ul>${counts.refused.map((row) => `<li>${row.message}</li>`).join('')}</ul>`;
          }
          announce(`Read ${counts.matched.length + counts.unmatched.length + counts.moneyOut.length + counts.alreadySeen.length} rows.`);
        });
        return;
      }
      case 'bring-in': {
        const previewId = one<HTMLElement>('[data-statement-preview]')?.dataset.previewId;
        if (!previewId) return;
        void send(
          button,
          `/api/payments/statements/${previewId}/bring-in`,
          { method: 'POST', body: {} },
          (body) => {
            announce(`Brought in ${String(body.broughtIn)} rows.`);
            closeDialog('bring-in-statement');
            reload();
          },
          holder,
        );
        return;
      }
      case 'tell-driver': {
        const runId = one<HTMLElement>('[data-opens="assign-driver"][data-run]')?.dataset.run ?? data.runId ?? '';
        void send(
          button,
          `/api/runs/${runId}/driver`,
          { method: 'PUT', body: { name: value('driver-name'), telephone: value('driver-telephone') } },
          () => {
            closeDialog('assign-driver');
            reload();
          },
          holder,
        );
        return;
      }
      case 'tell-again':
        void send(button, `/api/runs/${button.dataset.run}/tell`, { method: 'POST', body: {} }, () => {
          reload();
        });
        return;
      case 'confirm-run':
        void send(button, `/api/runs/${data.runId}/confirm`, { method: 'POST', body: {} }, () => {
          announce('Run confirmed.');
          reload();
        });
        return;
      case 'add-charge':
        void send(button, `/api/runs/${data.runId}/second-driver`, { method: 'POST', body: {} }, () => {
          announce('Second driver added.');
          closeDialog('add-second-driver');
          reload();
        }, holder);
        return;
      case 'accept-charges':
        void send(button, `/api/runs/${data.runId}/accept-charges`, { method: 'POST', body: {} }, () => {
          reload();
        });
        return;
      case 'add-name':
        void send(
          button,
          `/api/hires/${hireId}/passengers`,
          {
            method: 'POST',
            body: { name: value('passenger-name'), group: value('passenger-group'), needs: value('passenger-needs') },
          },
          () => {
            announce('Name added.');
            reload();
          },
          holder,
        );
        return;
      case 'bring-in-list': {
        const file = fileOf('passenger-file');
        if (!file) return;
        void whileWorking(button, async () => {
          const text = await textOf(file);
          const answer = await api<{ passengers: unknown[] }>(`/api/hires/${hireId}/passengers/import`, {
            method: 'POST',
            raw: text,
            contentType: 'text/csv',
          });
          if (!answer.ok) {
            showProblems(holder, {}, answer.body.error.message);
            announce(answer.body.error.message);
            return;
          }
          announce(`${answer.body.passengers.length} names brought in.`);
          closeDialog('add-passengers');
          reload();
        });
        return;
      }
      case 'print-plan':
        window.print();
        return;
      case 'save-change': {
        const iso = ddmmyyyyToIso(value('departure-date'));
        const vehicles = all<HTMLInputElement>('[id^="bought-price-"]').map((input, index) => ({
          id: '',
          boughtPrice: input.value,
          marginPercent: one<HTMLInputElement>(`#change-margin-${index + 1}`)?.value ?? '15',
        }));
        void send(
          button,
          `/api/hires/${hireId}/changes`,
          {
            method: 'POST',
            body: {
              departAt: iso ? { date: iso, time: `${value('departure-hour')}:${value('departure-minutes')}` } : null,
              vehicles: [],
            },
          },
          () => {
            announce('Booking changed.');
            closeDialog('change-booking');
            reload();
          },
          holder,
        );
        return;
      }
      case 'cancel-booking': {
        const iso = ddmmyyyyToIso(value('notice-date'));
        if (!iso) {
          showProblems(holder, { noticeAt: 'Enter a date as DD/MM/YYYY.' });
          return;
        }
        void send(
          button,
          `/api/hires/${hireId}/cancel`,
          {
            method: 'POST',
            body: {
              noticeAt: { date: iso, time: `${value('notice-hour')}:${value('notice-minutes')}` },
              by: radioValue('notice-by') || 'customer',
            },
          },
          () => {
            announce('Booking cancelled.');
            closeDialog('cancel-booking');
            reload();
          },
          holder,
        );
        return;
      }
      case 'make-document':
        void send(
          button,
          `/api/hires/${value('document-hire')}/documents`,
          { method: 'POST', body: { kind: value('document-kind') } },
          () => {
            closeDialog('make-document');
            reload();
          },
          holder,
        );
        return;
      case 'save-customer':
        void send(
          button,
          '/api/customers',
          {
            method: 'POST',
            body: {
              name: value('customer-name'),
              email: value('customer-email'),
              telephone: value('customer-telephone'),
              language: value('customer-language'),
            },
          },
          () => {
            announce('Customer saved.');
            closeDialog('add-customer');
            reload();
          },
          holder,
        );
        return;
      case 'save-name': {
        const customerId = one<HTMLElement>('[data-opens="rename-customer"][data-customer]')?.dataset.customer ?? '';
        void send(
          button,
          `/api/customers/${customerId}`,
          { method: 'PATCH', body: { name: value('rename-name') } },
          () => {
            announce('Customer renamed.');
            closeDialog('rename-customer');
            reload();
          },
          holder,
        );
        return;
      }
      case 'confirm-removal': {
        const customerId = one<HTMLElement>('[data-opens="remove-customer"][data-customer]')?.dataset.customer ?? '';
        void send(button, `/api/customers/${customerId}`, { method: 'DELETE', body: {} }, () => {
          announce('Customer removed.');
          closeDialog('remove-customer');
          reload();
        }, holder);
        return;
      }
      case 'close-customer':
        void send(
          button,
          `/api/customers/${button.dataset.customer}/close`,
          { method: 'POST', body: {} },
          () => {
            announce('Customer closed.');
            reload();
          },
        );
        return;
      case 'bring-back':
        void send(
          button,
          `/api/customers/${button.dataset.customer}/bring-back`,
          { method: 'POST', body: {} },
          () => {
            announce('Customer brought back.');
            reload();
          },
        );
        return;
      case 'read-sheet': {
        const file = fileOf('customer-sheet');
        if (!file) return;
        void whileWorking(button, async () => {
          const text = await textOf(file);
          const answer = await api('/api/customers/import', { method: 'POST', raw: text, contentType: 'text/csv' });
          if (!answer.ok) {
            showProblems(holder, {}, answer.body.error.message);
            announce(answer.body.error.message);
            return;
          }
          announce('Sheet brought in.');
          reload();
        });
        return;
      }
      case 'save-complaint': {
        const iso = ddmmyyyyToIso(value('received-date'));
        if (!iso) {
          showProblems(holder, { receivedAt: 'Enter a date as DD/MM/YYYY.' });
          return;
        }
        void send(
          button,
          '/api/complaints',
          {
            method: 'POST',
            body: {
              customerId: value('complaint-customer'),
              summary: value('complaint-summary'),
              receivedAt: { date: iso, time: `${value('received-hour')}:${value('received-minutes')}` },
            },
          },
          () => {
            closeDialog('log-complaint');
            reload();
          },
          holder,
        );
        return;
      }
      case 'save-item': {
        const iso = ddmmyyyyToIso(value('found-on'));
        if (!iso) {
          showProblems(holder, { foundOn: 'Enter a date as DD/MM/YYYY.' });
          return;
        }
        void send(
          button,
          '/api/lost-property',
          { method: 'POST', body: { description: value('item-description'), foundOn: iso } },
          () => {
            closeDialog('log-found-item');
            reload();
          },
          holder,
        );
        return;
      }
      case 'record-return': {
        const itemId = one<HTMLElement>('[data-opens="return-item"][data-item]')?.dataset.item ?? '';
        void send(
          button,
          `/api/lost-property/${itemId}/return`,
          { method: 'POST', body: { ownerDetails: value('owner-details') } },
          () => {
            closeDialog('return-item');
            reload();
          },
          holder,
        );
        return;
      }
      default:
        return;
    }
  });
}

export function startSignInForms(): void {
  const data = pageData<{ returnTo?: string | null }>();
  for (const form of all<HTMLFormElement>('[data-form]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const button = one<HTMLElement>('button[type="submit"]', form);
      if (!button) return;
      const kind = form.getAttribute('data-form');
      const body =
        kind === 'sign-up'
          ? { name: value('desk-name'), email: value('email'), password: value('password') }
          : { email: value('email'), password: value('password') };
      void send(
        button,
        kind === 'sign-up' ? '/api/auth/sign-up' : '/api/auth/sign-in',
        { method: 'POST', body },
        () => {
          const wanted = data.returnTo ?? '';
          const safe = /^\/(?!\/)/.test(wanted) ? wanted : '/enquiries';
          window.location.assign(safe);
        },
        form,
      );
    });
  }
  one<HTMLElement>('h1')?.focus();
}

export { MEDIUM };
