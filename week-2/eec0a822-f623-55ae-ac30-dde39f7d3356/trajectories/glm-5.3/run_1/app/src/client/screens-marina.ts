import { api, ApiError, errorCopy } from './api.js';
import { h, qs, announce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtMoney, fmtMeasurement, addDays, localDate } from '../shared/bases.js';
import { member } from './shell.js';

// ---------------- berths ----------------

export async function berthsScreen(ws: string): Promise<HTMLElement> {
  const [yachtsData, marinasData] = await Promise.all([
    api<any>(`/api/w/${ws}/yachts`),
    api<any>(`/api/w/${ws}/marinas`),
  ]);
  const yachtSel = h('select', { 'aria-label': 'Yacht' });
  for (const y of [...yachtsData.yachts].sort((a: any, b: any) => a.name.localeCompare(b.name))) {
    yachtSel.append(h('option', { value: y.slug }, y.name));
  }
  const marinaSel = h('select', { 'aria-label': 'Marina' });
  for (const m of marinasData.marinas) {
    marinaSel.append(h('option', { value: m.id }, m.name));
  }
  const setDefaultMarina = () => {
    const yacht = yachtsData.yachts.find((y: any) => y.slug === yachtSel.value);
    if (yacht) marinaSel.value = yacht.base === 'split' ? 'split-marina' : 'lavrio-marina';
  };
  setDefaultMarina();
  yachtSel.addEventListener('change', setDefaultMarina);
  const date = h('input', { type: 'text', 'aria-label': 'Arrival date', value: '' });
  const nights = h('input', { type: 'number', 'aria-label': 'Nights', value: '1', min: '1', max: '14', step: '1' });
  const results = h('ul', { 'aria-label': 'Berths', style: 'list-style:none;padding:0' });
  const msgBox = h('div', {});
  const errBox = h('div', {});

  const search = async () => {
    errBox.textContent = '';
    results.textContent = '';
    try {
      const data = await api<any>(`/api/w/${ws}/marinas/${marinaSel.value}/berths?yachtSlug=${yachtSel.value}&arrivalDate=${date.value}&nights=${nights.value}`);
      for (const b of data.berths) {
        const li = h('li', { class: 'card' },
          h('h3', {}, `Berth ${b.code}`),
          h('p', { class: 'num' }, `${fmtMeasurement(b.lengthM)} × ${fmtMeasurement(b.widthM)} × depth ${fmtMeasurement(b.depthM)}`),
          h('p', {}, `${b.fits ? 'Fits' : 'Doesn\'t fit'} · ${b.available ? 'Available' : 'Booked'}`),
          b.nights && b.nights.length ? h('p', { class: 'num' }, b.nights.map((n: any) => `${n.date}: ${fmtMoney(n.feeMinor, b.currency)}`).join(' · ')) : h('span', {}),
          b.totalMinor !== null ? h('p', { class: 'num' }, `Total ${fmtMoney(b.totalMinor, b.currency)}`) : h('span', {}),
        );
        if (b.fits && b.available) {
          const book = h('button', {}, `Book berth ${b.code}`);
          book.addEventListener('click', () => {
            openDialog('Book berth', (panel, ctrl) => {
              const nightsTable = h('table', { 'aria-label': 'Nights' });
              const tbody = h('tbody', {});
              for (const n of b.nights) {
                tbody.append(h('tr', {}, h('td', {}, n.date), h('td', { class: 'num' }, fmtMoney(n.feeMinor, b.currency))));
              }
              nightsTable.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Night'), h('th', { scope: 'col' }, 'Fee'))), tbody);
              const confirm = h('button', { class: 'primary' }, 'Book berth');
              const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
              const err2 = h('div', {});
              confirm.addEventListener('click', async () => {
                confirm.disabled = true;
                confirm.textContent = 'Booking berth';
                announce('Booking berth');
                try {
                  const res = await api<any>(`/api/w/${ws}/berth-bookings`, {
                    method: 'POST',
                    body: JSON.stringify({ yachtSlug: yachtSel.value, marinaId: marinaSel.value, berthCode: b.code, arrivalDate: date.value, nights: Number(nights.value) }),
                  });
                  const copy = `Berth ${b.code} booked from ${fmtDateOnly('split', date.value)}.`;
                  announce(copy);
                  ctrl.close();
                  location.href = `/w/${ws}/berth-bookings/${res.booking.id}`;
                } catch (err) {
                  const e = err as ApiError;
                  confirm.disabled = false;
                  confirm.textContent = 'Book berth';
                  const copy = errorCopy(e, { yachtName: yachtsData.yachts.find((y: any) => y.slug === yachtSel.value)?.name, berthCode: b.code });
                  err2.textContent = '';
                  err2.append(h('p', { class: 'msg err' }, copy.message));
                  announce(copy.message);
                }
              });
              panel.append(h('h2', {}, `Book berth ${b.code}`), nightsTable, err2, h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, confirm, cancel));
            }, { sheet: window.innerWidth < 1024 });
          });
          li.append(book);
        }
        results.append(li);
      }
      if (data.berths.length === 0) {
        results.append(h('li', { class: 'empty' }, 'No berths match.'));
      }
    } catch (err) {
      const e = err as ApiError;
      const copy = errorCopy(e);
      if (copy.fields) {
        for (const [field, msg] of Object.entries(copy.fields)) {
          errBox.append(h('p', { class: 'msg err' }, `${field}: ${msg}`));
        }
      } else {
        errBox.append(h('p', { class: 'msg err' }, copy.message));
      }
    }
  };
  const searchBtn = h('button', { class: 'primary' }, 'Search berths');
  searchBtn.addEventListener('click', () => void search());
  const form = h('form', { novalidate: true, onsubmit: (e: Event) => { e.preventDefault(); void search(); } },
    h('div', { class: 'field' }, h('label', {}, 'Yacht'), yachtSel),
    h('div', { class: 'field' }, h('label', {}, 'Marina'), marinaSel),
    h('div', { class: 'field' }, h('label', {}, 'Arrival date'), date),
    h('div', { class: 'field' }, h('label', {}, 'Nights'), nights),
    searchBtn,
  );
  await search();
  return h('div', { class: 'two-col left-wide' },
    h('div', {}, h('h1', {}, 'Berths'), form),
    h('div', {}, h('h2', {}, 'Berths'), results, msgBox, errBox),
  );
}

export async function berthBookingScreen(ws: string, id: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/berth-bookings/${id}`);
  const b = data.booking;
  const nightsTable = h('table', { 'aria-label': 'Nights' });
  const tbody = h('tbody', {});
  for (const n of b.nights) {
    tbody.append(h('tr', {}, h('td', {}, n.date), h('td', { class: 'num' }, fmtMoney(n.feeMinor, b.currency))));
  }
  nightsTable.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Night'), h('th', { scope: 'col' }, 'Fee'))), tbody);
  const marina = b.marinaId === 'split-marina' ? 'Split Marina' : 'Lavrio Marina';
  return h('div', {},
    h('h1', {}, `Berth ${b.berthCode}, ${marina}`),
    h('div', { class: 'card' },
      h('p', {}, `Yacht: ${b.yachtSlug}`),
      h('p', { class: 'num' }, `${b.arrivalDate} to ${b.departureDate}`),
      h('p', { class: 'num' }, `Total ${fmtMoney(b.totalMinor, b.currency)}`),
    ),
    h('h2', {}, 'Nights'),
    nightsTable,
  );
}

// ---------------- shore power ----------------

export async function shorePowerScreen(ws: string): Promise<HTMLElement> {
  const [yachtsData, marinasData] = await Promise.all([
    api<any>(`/api/w/${ws}/yachts`),
    api<any>(`/api/w/${ws}/marinas`),
  ]);
  const yachtSel = h('select', { 'aria-label': 'Yacht' });
  for (const y of [...yachtsData.yachts].sort((a: any, b: any) => a.name.localeCompare(b.name))) {
    yachtSel.append(h('option', { value: y.slug }, y.name));
  }
  const marinaSel = h('select', { 'aria-label': 'Marina' });
  const pontoonSel = h('select', { 'aria-label': 'Pontoon' });
  const dateInput = h('input', { type: 'text', 'aria-label': 'Date' });
  const slotsEl = h('ul', { 'aria-label': 'Slots', class: 'slotgrid', style: 'list-style:none;padding:0' });
  const msgBox = h('div', {});

  const fillMarinas = () => {
    marinaSel.textContent = '';
    for (const m of marinasData.marinas) {
      marinaSel.append(h('option', { value: m.id }, m.name));
    }
    marinaSel.value = 'split-marina';
    fillPontoons();
  };
  const fillPontoons = () => {
    pontoonSel.textContent = '';
    const marina = marinasData.marinas.find((m: any) => m.id === marinaSel.value);
    for (const p of marina?.pontoons ?? []) {
      pontoonSel.append(h('option', { value: p.code }, p.code));
    }
    dateInput.value = marina?.today ?? '';
  };
  fillMarinas();
  marinaSel.addEventListener('change', fillPontoons);

  const render = async () => {
    msgBox.textContent = '';
    try {
      const data = await api<any>(`/api/w/${ws}/marinas/${marinaSel.value}/pontoons/${pontoonSel.value}/slots?date=${dateInput.value}`);
      slotsEl.textContent = '';
      for (const slot of data.slots) {
        const startLabel = fmtDateTime(data.base, { ms: Date.parse(slot.startsAt) });
        const [day, hm] = startLabel.split(', ');
        const li = h('li', { class: 'card' },
          h('p', { class: 'num' }, `${hm.replace(' Split time', '').replace(' Lavrio time', '')}–${fmtDateTime(data.base, { ms: Date.parse(slot.endsAt) }).split(', ')[1].replace(' Split time', '').replace(' Lavrio time', '')}`),
          h('span', { class: `status-chip ${slot.status}` }, slot.status === 'open' ? 'Open' : slot.status === 'full' ? 'Full' : 'Past'),
          h('p', { class: 'num' }, `${slot.bookedKw} kW booked of ${data.limitKw} kW`),
        );
        if (slot.status === 'open') {
          const hhmm = hm.replace(' Split time', '').replace(' Lavrio time', '');
          const book = h('button', {}, `Book ${hhmm} slot`);
          book.addEventListener('click', async () => {
            book.disabled = true;
            book.textContent = 'Booking slot';
            announce('Booking slot');
            try {
              await api(`/api/w/${ws}/shore-power-bookings`, {
                method: 'POST',
                body: JSON.stringify({ yachtSlug: yachtSel.value, marinaId: marinaSel.value, pontoonCode: pontoonSel.value, slotStart: slot.startsAt }),
              });
              const copy = `Shore power booked for ${fmtDateTime(data.base, { ms: Date.parse(slot.startsAt) })}.`;
              message('ok', copy, msgBox);
              announce(copy);
              await render();
            } catch (err) {
              const e = err as ApiError;
              book.disabled = false;
              book.textContent = `Book ${hhmm} slot`;
              const copy = errorCopy(e, { takenAt: e.body?.takenAt ? fmtDateTime('split', { ms: Date.parse(e.body.takenAt) }) : undefined });
              message('err', copy.message, msgBox);
              announce(copy.message);
              await render();
            }
          });
          li.append(book);
        }
        slotsEl.append(li);
      }
      if (data.slots.length === 0) {
        slotsEl.append(h('li', { class: 'empty' }, 'No slots.'));
      }
    } catch (err) {
      // leave the board as it is
    }
  };
  await render();
  [marinaSel, pontoonSel, dateInput].forEach((el) => el.addEventListener('change', () => void render()));
  window.setInterval(() => { void render(); }, 10000);

  const pickers = h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Yacht'), yachtSel),
    h('div', { class: 'field' }, h('label', {}, 'Marina'), marinaSel),
    h('div', { class: 'field' }, h('label', {}, 'Pontoon'), pontoonSel),
    h('div', { class: 'field' }, h('label', {}, 'Date'), dateInput),
    h('h2', {}, 'Slots'),
    slotsEl,
  );
  return h('div', { class: 'two-col left-wide' },
    h('div', {}, h('h1', {}, 'Shore power'), pickers),
    h('div', {}, msgBox),
  );
}

function message(kind: 'ok' | 'err', text: string, box: HTMLElement): void {
  box.textContent = '';
  box.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}
