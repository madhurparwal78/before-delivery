// The drop planner: the embargo dial with the countdown in its centre, the ruled
// Market times ledger, Save time, Schedule drop, Withdraw drop, Add VIP members
// and the Weekly restock panel with the Next restocks table.
import { api, apiOk, failOf, MARKETS, type DropStaff, type RestockOut } from './api.js';
import { el, buttonEl, liveRegion, announce, pending, openDialog, nightMark, clearFieldErrors, showProblems, fieldError } from './ui.js';
import { route } from './router.js';
import { buildDial, updateDial, localPartsOf, nightOf, type DialParts, type DialUpdate } from './dial.js';
import { cphParts, partsIn, pad2, marketTimeWords, parseInstant, dateWords, countdown } from './format.js';

// Copenhagen local time from a UTC instant.
function cphLocalOf(instant: Date): { iso: string; hh: number; mm: number } {
  const p = cphParts(instant);
  return { iso: p.iso, hh: p.hh, mm: p.mm };
}

// The Copenhagen local date-time becomes a UTC instant, refusing spring-forward
// gap times (the client mirrors the server's single rule).
function cphToInstant(iso: string, hh: number, mm: number): Date | null {
  const probe = new Date(`${iso}T${pad2(hh)}:${pad2(mm)}:00Z`);
  void probe;
  // Resolve via a known offset: Copenhagen is UTC+1 in winter, +2 in summer.
  const winter = new Date(`${iso}T01:00:00Z`);
  const summer = new Date(`${iso}T02:00:00Z`);
  for (const base of [summer, winter]) {
    const inst = new Date(base.getTime() + hh * 3600000 - (base === summer ? 2 : 1) * 3600000 + mm * 60000);
    const check = cphLocalOf(inst);
    if (check.iso === iso && check.hh === hh && check.mm === mm) return inst;
  }
  // Both attempts missed: the time sits in the spring-forward gap or is ambiguous;
  // the first occurrence wins, so prefer the winter offset.
  const inst = new Date(winter.getTime() + hh * 3600000 - 3600000 + mm * 60000);
  const check = cphLocalOf(inst);
  if (check.iso === iso && check.hh === hh) return inst;
  return null;
}

interface PlannerState {
  date: string;
  hour: number;
  minute: number;
  type: 'simultaneous' | 'rolling';
}

export function registerPlannerRoute(): void {
  route('/studio/drops/:id', (root, p) => renderPlanner(root, p.id));
}

async function renderPlanner(root: HTMLElement, dropId: string): Promise<HTMLElement | null> {
  let currentDrop: DropStaff | null = null;
  try {
    currentDrop = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`);
  } catch (err) {
    const fail = failOf(err);
    if (fail.status === 401) {
      const { renderAuthNeeded } = await import('./staff.js');
      return renderAuthNeeded(root, '/studio/drops/' + dropId);
    }
    if (fail.status === 403) {
      const { renderForbidden } = await import('./staff.js');
      return renderForbidden(root);
    }
    const { renderNotFoundScreen } = await import('./staff.js');
    return renderNotFoundScreen(root);
  }
  if (!currentDrop) return null;

  const drop: DropStaff = currentDrop;
  const h = el('h1', {}, `Plan ${drop.name}`);
  const plannerStatus = liveRegion('Planner status');
  const state: PlannerState = { date: '', hour: 10, minute: 0, type: drop.type };

  // Defaults: the saved Copenhagen go-live date, else Copenhagen's tomorrow; the
  // slider's default when no time is saved is 10:00.
  const savedInstant = drop.markets.find(m => m.market === 'copenhagen')?.goLiveAt ?? null;
  if (savedInstant) {
    const local = cphLocalOf(parseInstant(savedInstant));
    state.date = local.iso;
    state.hour = local.hh;
    state.minute = Math.floor(local.mm / 15) * 15;
  } else {
    const now = new Date();
    const today = cphParts(now);
    const tomorrow = new Date(now.getTime() + 86400000);
    state.date = savedInstant ? cphLocalOf(parseInstant(savedInstant)).iso : cphParts(tomorrow).iso;
    void today;
  }

  const dial = buildDial((hour, minute) => {
    state.hour = hour; state.minute = minute;
    refreshAll(false);
  });

  const dateInput = el('input', { type: 'text', name: 'drop-date', 'aria-label': 'Drop date', value: state.date, class: 'mono' }) as HTMLInputElement;
  dateInput.addEventListener('change', () => {
    state.date = dateInput.value;
    refreshAll(true);
  });

  const typeRadios = el('div', { role: 'radiogroup', 'aria-label': 'Drop type' });
  const sim = el('input', { type: 'radio', name: 'drop-type', value: 'simultaneous', ...(state.type === 'simultaneous' ? { checked: true } : {}) }) as HTMLInputElement;
  const roll = el('input', { type: 'radio', name: 'drop-type', value: 'rolling', ...(state.type === 'rolling' ? { checked: true } : {}) }) as HTMLInputElement;
  typeRadios.append(
    el('label', { class: 'check' }, sim, el('span', { text: 'Simultaneous' })),
    el('label', { class: 'check' }, roll, el('span', { text: 'Rolling' }))
  );
  sim.addEventListener('change', () => { state.type = 'simultaneous'; refreshAll(true); });
  roll.addEventListener('change', () => { state.type = 'rolling'; refreshAll(true); });

  const note = el('p', { class: 'dial-note', 'aria-hidden': 'true' });

  // Market times ledger.
  const ledger = el('table', {});
  ledger.append(el('caption', { text: 'Market times' }));
  ledger.append(el('thead', {}, el('tr', {}, el('th', { text: 'Market' }), el('th', { text: 'Local time' }), el('th', { text: 'Night' }), el('th', { text: 'Opens' }), el('th', { text: 'UTC' }))));
  const ledgerBody = el('tbody');
  ledger.append(ledgerBody);

  const saveBtn = buttonEl({ class: 'btn btn-primary', text: 'Save time', onclick: async () => {
    const restore = pending(saveBtn, 'Saving time…');
    const body: Record<string, unknown> = state.type === 'simultaneous'
      ? { copenhagenGoLive: `${state.date}T${pad2(state.hour)}:${pad2(state.minute)}` }
      : { localGoLive: `${state.date}T${pad2(state.hour)}:${pad2(state.minute)}` };
    try {
      const res = await api<DropStaff>('PATCH', `/api/drops/${dropId}`, body);
      const saved = res.data!;
      const inst = saved.goLiveAt ? parseInstant(saved.goLiveAt) : null;
      announce(plannerStatus, `Go-live saved: ${inst ? marketTimeWords(inst, 'copenhagen', 'Copenhagen') : ''}`);
    } catch (err) {
      const fail = failOf(err);
      if (fail.status === 412) announce(plannerStatus, `Not saved: ${fail.savedBy} saved a newer version at ${fail.savedAt}.`, true);
      else if (fail.fields) {
        for (const [p, msg] of Object.entries(fail.fields)) note.textContent = msg;
        announce(plannerStatus, fail.fields.copenhagenGoLive ?? fail.message, true);
      } else announce(plannerStatus, fail.message, true);
    } finally { restore(); }
  } });

  const scheduleBtn = buttonEl({ class: 'btn', text: 'Schedule drop', onclick: async () => {
    const restore = pending(scheduleBtn, 'Scheduling…');
    try {
      await api('POST', `/api/drops/${dropId}/schedule`);
      announce(plannerStatus, 'Drop scheduled.');
    } catch (err) {
      const fail = failOf(err);
      announce(plannerStatus, fail.code === 'drop_not_draft' ? 'This drop is already scheduled.' : fail.message, true);
    } finally { restore(); }
  } });

  const withdrawBtn = buttonEl({ class: 'btn btn-danger', text: 'Withdraw drop', onclick: () => {
    openDialog({
      label: 'Withdraw drop', opener: withdrawBtn, successFocus: h,
      body: (dlg) => {
        const reason = el('input', { type: 'text', 'aria-label': 'Reason' }) as HTMLInputElement;
        const confirmBtn = buttonEl({ class: 'btn btn-danger', text: 'Withdraw drop', onclick: () => {
          dlg.onResult(api('POST', `/api/drops/${dropId}/withdraw`, { reason: reason.value }), (_ok, fail) => {
            if (fail) announce(plannerStatus, fail.message, true);
            else announce(plannerStatus, 'Drop withdrawn. Its public page now shows it as withdrawn.');
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, el('label', { class: 'field' }, el('span', { class: 'label', text: 'Reason' }), reason), el('div', { class: 'btn-row' }, confirmBtn, cancel));
      }
    });
  } });

  const vipBtn = buttonEl({ class: 'btn', text: 'Add VIP members', onclick: () => {
    openDialog({
      label: 'Add VIP members', opener: vipBtn,
      body: (dlg) => {
        const market = el('select', { 'aria-label': 'Market' }) as HTMLSelectElement;
        for (const m of MARKETS) market.append(el('option', { value: m.market, text: m.city, ...(m.market === 'copenhagen' ? { selected: true } : {}) }));
        const list = el('textarea', { 'aria-label': 'VIP list', placeholder: 'Name <email>' }) as HTMLTextAreaElement;
        const addBtn = buttonEl({ class: 'btn btn-primary', text: 'Add members', onclick: () => {
          const members = list.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
            const m = /^(.*?)\s*<(.+)>$/.exec(line);
            return m ? { name: m[1], email: m[2] } : null;
          }).filter((x): x is { name: string; email: string } => x !== null);
          dlg.onResult(api<{ items: unknown[] }>('POST', `/api/drops/${dropId}/waitlist/vip`, { market: market.value, members }), (ok, fail) => {
            if (ok) announce(plannerStatus, `${members.length === 1 ? '1 VIP member' : `${members.length} VIP members`} added to the ${MARKETS.find(x => x.market === market.value)?.city} waitlist.`);
            else announce(plannerStatus, fail?.message ?? 'Adding failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Market' }), market),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'VIP list (one "Name <email>" per line)' }), list),
          el('div', { class: 'btn-row' }, addBtn, cancel));
      }
    });
  } });

  // Weekly restock panel.
  const restockPanel = el('section', { class: 'panel', 'aria-labelledby': 'restock-h' });
  const restockH = el('h2', { id: 'restock-h' }, 'Weekly restock');
  const restockForm = el('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    clearFieldErrors(restockForm);
    const body = {
      firstRestock: `${firstDate.value}T${restockTime.value}`,
      pieces: Object.fromEntries(MARKETS.map(m => [m.market, Number(piecesInputs[m.market].value || '0')]))
    };
    const restore = pending(restockBtn, 'Saving restock…');
    try {
      await api('POST', `/api/drops/${dropId}/restocks`, body);
      const weekday = weekdayWords(firstDate.value);
      announce(plannerStatus, `Weekly restock saved: every ${weekday} at ${restockTime.value} Copenhagen time.`);
      await refreshRestocks();
    } catch (err) {
      const fail = failOf(err);
      if (fail.fields) {
        showProblems(restockForm, fail, { firstRestock: 'First restock date' });
        for (const [p, msg] of Object.entries(fail.fields)) fieldError(restockForm, p.replace('pieces.', ''), msg, p);
      } else announce(plannerStatus, fail.message, true);
    } finally { restore(); }
  } });
  const tomorrow = cphLocalOf(new Date(Date.now() + 86400000)).iso;
  const firstDate = el('input', { type: 'text', 'aria-label': 'First restock date', value: tomorrow, class: 'mono' }) as HTMLInputElement;
  const restockTime = el('input', { type: 'text', 'aria-label': 'Restock time', value: '18:00', class: 'mono' }) as HTMLInputElement;
  const piecesInputs: Record<string, HTMLInputElement> = {};
  for (const m of MARKETS) {
    piecesInputs[m.market] = el('input', { type: 'number', min: '0', 'aria-label': `${m.city} restock pieces`, value: '0', class: 'mono' }) as HTMLInputElement;
  }
  const restockBtn = buttonEl({ class: 'btn btn-primary', type: 'submit', text: 'Save restock' });
  restockForm.append(
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'First restock date' }), firstDate),
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Restock time (Copenhagen)' }), restockTime),
    ...MARKETS.map(m => el('label', { class: 'field' }, el('span', { class: 'label', text: `${m.city} restock pieces` }), piecesInputs[m.market])),
    restockBtn
  );
  restockPanel.append(restockH, restockForm);

  const nextRestocks = el('table', {});
  nextRestocks.append(el('caption', { text: 'Next restocks' }));
  nextRestocks.append(el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Copenhagen' }), el('th', { text: 'London' }), el('th', { text: 'New York' }), el('th', { text: 'UTC' }))));
  const restocksBody = el('tbody');
  nextRestocks.append(restocksBody);

  async function refreshRestocks(): Promise<void> {
    restocksBody.replaceChildren();
    let restocks: RestockOut[] = [];
    try {
      const res = await apiOk<{ items: RestockOut[] }>('GET', `/api/drops/${dropId}/restocks`);
      restocks = res.items ?? [];
    } catch { restocks = []; }
    const series = restocks[0];
    if (!series) { restocksBody.append(el('tr', { class: 'empty-row' }, el('td', { colspan: '5' }, 'Nothing here yet.'))); return; }
    series.nextInstants.forEach((instant, i) => {
      const inst = parseInstant(instant);
      const cph = cphParts(inst);
      const london = partsIn(inst, 'Europe/London');
      const ny = partsIn(inst, 'America/New_York');
      restocksBody.append(el('tr', {},
        el('td', { class: 'mono', text: String(i + 1) }),
        el('td', { class: 'mono', text: `${cph.iso} ${pad2(cph.hh)}:${pad2(cph.mm)}` }),
        el('td', { class: 'mono', text: `${pad2(london.hh)}:${pad2(london.mm)}` }),
        el('td', { class: 'mono', text: `${pad2(ny.hh)}:${pad2(ny.mm)}` }),
        el('td', { class: 'mono', text: instant })
      ));
    });
  }

  // Recompute everything on any dial change.
  let serverNow = new Date();
  function refreshAll(fromControls: boolean): void {
    void fromControls;
    dateInput.value = state.date;
    sim.checked = state.type === 'simultaneous';
    roll.checked = state.type === 'rolling';

    let gap = false;
    let gapDate = '';
    const pins = MARKETS.map(m => {
      if (state.type === 'simultaneous') {
        const inst = cphToInstant(state.date, state.hour, state.minute);
        if (!inst) { gap = true; gapDate = state.date; return { market: m.market, city: m.city, localParts: null, night: false, utc: null }; }
        return { market: m.market, city: m.city, localParts: localPartsOf(inst, m.market), night: nightOf(inst, m.market), utc: inst.toISOString().replace(/\.\d{3}Z$/, 'Z') };
      }
      // Rolling: the same local time in each market.
      const inst = rollingInstant(m.market, state.date, state.hour, state.minute);
      return { market: m.market, city: m.city, localParts: inst ? localPartsOf(inst, m.market) : null, night: inst ? nightOf(inst, m.market) : false, utc: inst ? inst.toISOString().replace(/\.\d{3}Z$/, 'Z') : null };
    });

    if (gap) {
      note.textContent = `Copenhagen skips from 02:00 to 03:00 on ${weekdayWords(state.date)}. Choose another time.`;
      saveBtn.disabled = true;
    } else {
      const shiftPin = pins.find(p => p.localParts && (p.localParts.hh !== state.hour || p.localParts.mm !== state.minute));
      if (state.type === 'rolling' && shiftPin) {
        note.textContent = `${shiftPin.city} skips an hour that night, so it opens at ${pad2(shiftPin.localParts!.hh)}:${pad2(shiftPin.localParts!.mm)}.`;
      } else {
        note.textContent = '';
      }
      saveBtn.disabled = current.value.status !== 'draft' && current.value.status !== 'scheduled';
    }

    const cphPin = pins[0];
    const update: DialUpdate = { date: state.date, hour: state.hour, minute: state.minute, type: state.type, utc: cphPin.utc };
    updateDial(dial, update, pins, `T-${pad2(state.hour)}:${pad2(state.minute)}`);

    ledgerBody.replaceChildren();
    for (const p of pins) {
      const row = el('tr', {});
      row.append(el('td', { text: p.city }));
      if (p.localParts) {
        row.append(el('td', { class: 'mono', text: `${pad2(p.localParts.hh)}:${pad2(p.localParts.mm)}` }));
        const nightCell = el('td', {});
        if (p.night) nightCell.append(nightMark());
        row.append(nightCell);
        const inst = parseInstant(p.utc!);
        row.append(el('td', { class: 'mono', text: `${dateWords(state.date)} ${pad2(p.localParts.hh)}:${pad2(p.localParts.mm)}` }));
        row.append(el('td', { class: 'mono', text: p.utc! }));
        void inst;
      } else {
        row.append(el('td', { text: '—' }), el('td', { text: '—' }), el('td', { text: '—' }), el('td', { text: '—' }));
      }
      ledgerBody.append(row);
    }
  }

  const current: { value: DropStaff } = { value: drop };
  async function tick(): Promise<void> {
    try {
      const res = await api<DropStaff>('GET', `/api/drops/${dropId}`);
      serverNow = res.date;
      if (res.data) current.value = res.data;
    } catch { /* keep last */ }
    const goLive = current.value.goLiveAt ? parseInstant(current.value.goLiveAt) : null;
    const remain = goLive ? goLive.getTime() - serverNow.getTime() : 0;
    dial.centreText.textContent = countdown(remain);
  }

  const dialPanel = el('section', { class: 'panel col-7' });
  dialPanel.append(el('div', { class: 'dial-controls' },
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Drop date' }), dateInput),
    el('div', { class: 'field' }, el('span', { class: 'label', text: 'Drop type' }), typeRadios)
  ));
  dialPanel.append(dial.group, note, el('p', { class: 'note', text: 'Move the slider or press the ring to set the time.' }));

  const ledgerPanel = el('section', { class: 'panel col-5' });
  ledgerPanel.append(ledger, el('div', { class: 'btn-row', style: 'margin: 14px 0;' }, saveBtn, scheduleBtn), el('div', { class: 'btn-row' }, withdrawBtn, vipBtn), plannerStatus);

  const grid = el('div', { class: 'grid12' });
  grid.append(dialPanel, ledgerPanel, el('section', { class: 'panel col-5' }, restockPanel), el('section', { class: 'panel col-7' }, nextRestocks));

  // Phone: the Markets bottom sheet below the dial.
  const marketsSheet = el('section', { class: 'panel', 'aria-label': 'Markets', 'data-phone-only': 'true' });
  marketsSheet.append(el('h2', {}, 'Markets'));
  for (const m of MARKETS) marketsSheet.append(el('p', { class: 'mono', text: m.city }));

  const stickyBar = el('div', { class: 'sticky-bar' }, saveBtn.cloneNode(true));
  void stickyBar;

  root.append(h, grid, marketsSheet);
  refreshAll(true);
  await refreshRestocks();
  await tick();
  const timer = setInterval(() => { void tick(); }, 1000);
  new MutationObserver(() => { if (!document.contains(h)) { clearInterval(timer); } }).observe(document.body, { childList: true, subtree: true });
  return h;
}

function weekdayWords(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return names[dow];
}

// A rolling drop applies the local time in the market's own zone, shifted forward
// when it lands inside that zone's spring-forward gap.
function rollingInstant(market: string, iso: string, hh: number, mm: number): Date | null {
  const tz: Record<string, string> = {
    copenhagen: 'Europe/Copenhagen', stockholm: 'Europe/Stockholm', paris: 'Europe/Paris',
    london: 'Europe/London', new_york: 'America/New_York', tokyo: 'Asia/Tokyo'
  };
  const zone = tz[market] ?? tz.copenhagen;
  for (const extra of [0, 1]) {
    const guess = new Date(`${iso}T${pad2(hh)}:${pad2(mm)}:00Z`).getTime() - offsetSecondsFor(iso, zone, hh, extra) * 1000;
    const inst = new Date(guess);
    const p = partsIn(inst, zone);
    if (p.iso === iso && (p.hh === hh || p.hh === (hh + 1) % 24) && p.mm === mm) return inst;
  }
  return null;
}

function offsetSecondsFor(iso: string, zone: string, hh: number, extra: number): number {
  const p = partsIn(new Date(`${iso}T${pad2(hh)}:${pad2(0)}:00Z`), zone);
  void extra;
  void p;
  // Approximate by probing: find the UTC instant whose local time is hh:00.
  for (let off = -720; off <= 840; off += 30) {
    const probe = new Date(`${iso}T${pad2(hh)}:00:00Z`).getTime() - off * 60000;
    const q = partsIn(new Date(probe), zone);
    if (q.iso === iso && q.hh === hh && q.mm === 0) return off * 60;
  }
  return 3600;
}

