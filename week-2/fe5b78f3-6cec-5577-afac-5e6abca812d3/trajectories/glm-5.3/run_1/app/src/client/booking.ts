// The booking page: passengers, options, berth preferences, live fare and pay.

import { api, ApiFail, fetchClock, businessNowMs } from './api.js';
import { el, setAlert, clearAlert, openDialog, setStatus, currentAccount, loadAccount, nextId } from './ui.js';
import { renderShell, setTitle, getStations, stationName } from './shell.js';
import { formatPaise, QUOTA_LABEL, BERTH_POS } from './format.js';
import { drawCoachPlan, coachPageKey, type CoachPlanData } from './coachplan.js';
import type { QuotaCode, ClassCode, BerthPref } from '../types.js';

interface FareQuote {
  lines: { label: string; amount_paise: number }[];
  total_paise: number;
}

interface BookingParams {
  train: string; run_date: string; from: string; to: string;
  cls: ClassCode; quota: QuotaCode;
}

interface PassengerDraft {
  name: string; age: string; gender: string; pref: BerthPref;
}

interface BookingDraft {
  passengers: PassengerDraft[];
  keep_in_one_coach: boolean;
  lower_berth_only: boolean;
  contact_phone: string;
  choosing_for: number;
  coach: string;
}

const GENDERS: [string, string][] = [['M', 'Male'], ['F', 'Female'], ['T', 'Transgender']];
const PREFS: [BerthPref, string][] = [
  ['NONE', 'No preference'], ['LB', 'Lower'], ['MB', 'Middle'], ['UB', 'Upper'],
  ['SL', 'Side lower'], ['SU', 'Side upper'],
];

function draftKey(): string {
  return `pakka-draft:${location.pathname}${location.search}`;
}

function loadDraft(): BookingDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey());
    if (!raw) return null;
    return JSON.parse(raw) as BookingDraft;
  } catch { return null; }
}

function saveDraft(d: BookingDraft): void {
  sessionStorage.setItem(draftKey(), JSON.stringify(d));
}

function clearDraft(): void {
  sessionStorage.removeItem(draftKey());
}

export async function renderBooking(): Promise<void> {
  const account = currentAccount() ?? (await loadAccount());
  if (!account) {
    location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  let windowLabel = 'open';
  setTitle('Book');
  const params = parseBookingParams();
  if (!params) {
    location.href = '/';
    return;
  }
  await fetchClock();
  const stations = await getStations();
  const p: BookingParams = params;

  const restoredFromDraft = loadDraft() !== null;
  const draft: BookingDraft = loadDraft() ?? {
    passengers: [emptyPassenger()],
    keep_in_one_coach: false,
    lower_berth_only: false,
    contact_phone: account.phone,
    choosing_for: 1,
    coach: '',
  };

  const main = el('main', { id: 'main' });
  const ribbon = buildRibbon(stations, p);
  renderShell(main, { ribbon });

  // a draft restored after a session-ended Pay: focus Review and pay
  if (restoredFromDraft) {
    setTimeout(() => document.getElementById('review-btn')?.focus(), 400);
  }

  main.appendChild(el('h1', {}, `Book ${p.train}`));
  const problemHost = el('div', { id: 'problem-host' });
  main.appendChild(problemHost);

  const grid = el('div', { class: 'booking-grid' });
  main.appendChild(grid);

  const leftCol = el('div', { class: 'col-passengers' });
  const planCol = el('div', { class: 'col-plan' });
  const fareCol = el('div', { class: 'col-fare' });
  grid.appendChild(leftCol);
  grid.appendChild(planCol);
  grid.appendChild(fareCol);

  // ----- passengers column -----
  const passengersHost = el('div', { id: 'passengers-host' });
  leftCol.appendChild(passengersHost);

  const addBtn = el('button', { class: 'add-passenger' }, 'Add passenger');
  addBtn.addEventListener('click', () => {
    draft.passengers.push(emptyPassenger());
    saveDraft(draft);
    renderPassengers();
    quoteFare();
  });
  leftCol.appendChild(addBtn);

  const opts = el('fieldset');
  const keepLabel = el('label', { class: 'checkline' });
  const keep = el('input', { type: 'checkbox' });
  keep.id = nextId('keep');
  keep.checked = draft.keep_in_one_coach;
  keep.setAttribute('aria-label', 'Keep party in one coach');
  keep.addEventListener('change', () => {
    draft.keep_in_one_coach = keep.checked;
    saveDraft(draft);
    clearAlert('Booking problem');
    quoteFare();
  });
  keepLabel.appendChild(keep);
  keepLabel.appendChild(document.createTextNode('Keep party in one coach'));
  opts.appendChild(keepLabel);
  const lowerLabel = el('label', { class: 'checkline' });
  const lower = el('input', { type: 'checkbox' });
  lower.id = nextId('lower');
  lower.checked = draft.lower_berth_only;
  lower.setAttribute('aria-label', 'Book only if a lower berth is allotted');
  lower.addEventListener('change', () => {
    draft.lower_berth_only = lower.checked;
    saveDraft(draft);
    clearAlert('Booking problem');
    quoteFare();
  });
  lowerLabel.appendChild(lower);
  lowerLabel.appendChild(document.createTextNode('Book only if a lower berth is allotted'));
  opts.appendChild(lowerLabel);
  leftCol.appendChild(opts);

  const phoneRow = el('div', {});
  const phoneId = nextId('phone');
  const phoneLabel = el('label', { for: phoneId }, 'Mobile number');
  const phone = el('input', { type: 'tel', id: phoneId, value: draft.contact_phone });
  phone.setAttribute('aria-label', 'Mobile number');
  phone.addEventListener('input', () => {
    draft.contact_phone = phone.value;
    saveDraft(draft);
    clearAlert('Booking problem');
  });
  phoneRow.appendChild(phoneLabel);
  phoneRow.appendChild(phone);
  const phoneErr = el('div', { class: 'field-error', 'data-err': 'contact_phone' });
  phoneRow.appendChild(phoneErr);
  leftCol.appendChild(phoneRow);

  // ----- coach plan column -----
  const chooseWrap = el('fieldset');
  const chooseLegend = el('legend', {}, 'Choosing for');
  chooseWrap.appendChild(chooseLegend);
  const chooseGroup = el('div', { role: 'radiogroup', 'aria-label': 'Choosing for', id: 'choosing-for' });
  chooseWrap.appendChild(chooseGroup);
  planCol.appendChild(chooseWrap);
  const coachTabsHost = el('div', { id: 'coach-tabs-host' });
  planCol.appendChild(coachTabsHost);
  const planHost = el('div', { class: 'coach-frame', id: 'plan-host' });
  planCol.appendChild(planHost);
  planCol.appendChild(el('p', { class: 'berth-note' }, 'Preferences guide allotment. The exact berth is allotted when you pay.'));

  // ----- fare column -----
  const farePanel = el('div', { class: 'panel', id: 'fare-panel' });
  const fareTitle = el('h2', {}, 'Fare');
  farePanel.appendChild(fareTitle);
  const fareAvail = el('p', { class: 'mono' });
  farePanel.appendChild(fareAvail);
  const fareLinesHost = el('ul', { 'aria-label': 'Fare lines', class: 'plain' });
  farePanel.appendChild(fareLinesHost);
  const totalP = el('p', { class: 'fare-total', 'data-total': '1' });
  farePanel.appendChild(totalP);
  fareCol.appendChild(farePanel);
  document.getElementById('live-regions')!.appendChild(statusRegionHost('Fare total'));
  document.getElementById('live-regions')!.appendChild(statusRegionHost('Fare availability'));

  const payBar = el('div', { class: 'pay-bar' });
  const reviewBtn = el('button', { class: 'btn-primary', id: 'review-btn' }, 'Review and pay');
  payBar.appendChild(reviewBtn);
  main.appendChild(payBar);

  reviewBtn.addEventListener('click', () => {
    clearAlert('Booking problem');
    clearFormProblems();
    openPayDialog(reviewBtn);
  });

  let coachesData: CoachPlanData | null = null;
  let lastFare: FareQuote | null = null;
  let fareSeq = 0;
  let availLabel = '';
  let fareTimer: number | null = null;

  // ----- data fetch -----
  const coachUrl = `/api/trains/${p.train}/runs/${p.run_date}/coachers?class=${p.cls}&from=${p.from}&to=${p.to}`;
  void coachUrl; // coaches endpoint is /coaches
  const [coachResp, trainResp] = await Promise.all([
    api<CoachPlanData>('GET', `/api/trains/${p.train}/runs/${p.run_date}/coaches?class=${p.cls}&from=${p.from}&to=${p.to}`).catch(() => null),
    api<{ trains: { number: string; classes: { class: string; quota: string; label: string; window: string }[] }[] }>(
      'GET', `/api/trains?from=${p.from}&to=${p.to}&date=${p.run_date}&quota=${p.quota}&class=${p.cls}`,
    ).catch(() => null),
  ]);
  coachesData = coachResp;
  if (trainResp) {
    const t = trainResp.trains.find((x) => x.number === p.train);
    const entry = t?.classes.find((c) => c.class === p.cls && c.quota === p.quota);
    availLabel = entry?.label ?? '';
    windowLabel = entry?.window ?? 'open';
  }
  fareAvail.textContent = availLabel;
  setStatus('Fare availability', availLabel);

  if (coachesData && !draft.coach) {
    draft.coach = coachesData.coaches[0]?.coach ?? '';
  }
  renderCoachTabs();
  renderPlan();

  renderPassengers();
  renderChoosingFor();
  await quoteFare();

  // ----- render helpers -----
  function emptyPassenger(): PassengerDraft {
    return { name: '', age: '', gender: 'M', pref: 'NONE' };
  }

  function statusRegionHost(name: string): HTMLElement {
    const d = el('div', { class: 'status-line' });
    d.setAttribute('role', 'status');
    d.setAttribute('aria-label', name);
    d.setAttribute('data-status', name);
    return d;
  }

  function renderPassengers(): void {
    passengersHost.innerHTML = '';
    for (const [i, pd] of draft.passengers.entries()) {
      const group = el('fieldset', { class: 'passenger-group' });
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', `Passenger ${i + 1}`);

      const grid2 = el('div', { class: 'passenger-grid' });
      const nameId = nextId('pn');
      grid2.appendChild(el('label', { for: nameId }, 'Name'));
      const name = el('input', { type: 'text', id: nameId, value: pd.name });
      name.setAttribute('aria-label', 'Name');
      name.addEventListener('input', () => {
        pd.name = name.value;
        saveDraft(draft);
      });
      grid2.appendChild(name);
      const nameErr = el('div', { class: 'field-error', 'data-err': `passengers[${i}].name` });
      grid2.appendChild(nameErr);

      const ageId = nextId('pa');
      grid2.appendChild(el('label', { for: ageId }, 'Age'));
      const age = el('input', { type: 'number', id: ageId, value: pd.age, min: '0', max: '125' });
      age.setAttribute('aria-label', 'Age');
      age.className = 'age-input';
      age.setAttribute('role', 'spinbutton');
      age.addEventListener('input', () => {
        pd.age = age.value;
        saveDraft(draft);
        clearAlert('Booking problem');
        quoteFare();
      });
      grid2.appendChild(age);
      const ageErr = el('div', { class: 'field-error', 'data-err': `passengers[${i}].age` });
      grid2.appendChild(ageErr);

      const genderId = nextId('pg');
      grid2.appendChild(el('label', { for: genderId }, 'Gender'));
      const gender = el('select', { id: genderId });
      gender.setAttribute('aria-label', 'Gender');
      for (const [code, label] of GENDERS) {
        const opt = el('option', { value: code }, label);
        if (code === pd.gender) opt.selected = true;
        gender.appendChild(opt);
      }
      gender.addEventListener('change', () => {
        pd.gender = (gender as HTMLSelectElement).value;
        saveDraft(draft);
      });
      grid2.appendChild(gender);

      const prefId = nextId('pp');
      grid2.appendChild(el('label', { for: prefId }, 'Berth preference'));
      const pref = el('select', { id: prefId });
      pref.setAttribute('aria-label', 'Berth preference');
      pref.className = 'pref-select';
      for (const [code, label] of PREFS) {
        const opt = el('option', { value: code }, label);
        if (code === pd.pref) opt.selected = true;
        pref.appendChild(opt);
      }
      pref.addEventListener('change', () => {
        pd.pref = (pref as HTMLSelectElement).value as BerthPref;
        draft.choosing_for = i + 1;
        saveDraft(draft);
        renderChoosingFor();
        renderPlan();
      });
      grid2.appendChild(pref);

      group.appendChild(grid2);

      if (draft.passengers.length > 1) {
        const rm = el('button', { class: 'remove-passenger' }, `Remove passenger ${i + 1}`);
        rm.addEventListener('click', () => {
          draft.passengers.splice(i, 1);
          if (draft.choosing_for > draft.passengers.length) draft.choosing_for = draft.passengers.length;
          saveDraft(draft);
          renderPassengers();
          renderChoosingFor();
          renderPlan();
          quoteFare();
        });
        group.appendChild(rm);
      }
      passengersHost.appendChild(group);
    }
  }

  function renderChoosingFor(): void {
    const host = document.getElementById('choosing-for')!;
    host.innerHTML = '';
    for (const [i] of draft.passengers.entries()) {
      const id = nextId('cf');
      const input = el('input', { type: 'radio', id, name: 'choosing-for', value: String(i + 1) });
      input.setAttribute('aria-label', `Passenger ${i + 1}`);
      if (draft.choosing_for === i + 1) input.checked = true;
      input.addEventListener('change', () => {
        draft.choosing_for = i + 1;
        saveDraft(draft);
      });
      const lab = el('label', { for: id }, `Passenger ${i + 1}`);
      host.appendChild(input);
      host.appendChild(lab);
    }
  }

  function renderCoachTabs(): void {
    const host = document.getElementById('coach-tabs-host')!;
    host.innerHTML = '';
    if (!coachesData) return;
    const tabs = el('div', { role: 'tablist', 'aria-label': 'Coaches' });
    for (const c of coachesData.coaches) {
      const tab = el('button', { role: 'tab', 'aria-selected': c.coach === draft.coach ? 'true' : 'false' }, c.coach);
      tab.dataset.coach = c.coach;
      tab.addEventListener('click', () => {
        draft.coach = c.coach;
        saveDraft(draft);
        renderCoachTabs();
        renderPlan();
      });
      tabs.appendChild(tab);
    }
    host.appendChild(tabs);
    coachPageKey(planHost, coachesData.coaches.map((c) => c.coach), () => draft.coach, (coach) => {
      const prevBerth = (document.activeElement as HTMLElement | null)?.dataset?.berth ?? '1';
      draft.coach = coach;
      saveDraft(draft);
      renderCoachTabs();
      renderPlan();
      // focus lands on the same berth number in the new coach
      (document.querySelector(`[data-coach="${coach}"][data-berth="${prevBerth}"]`) as HTMLElement | null)?.focus();
    });
  }

  function renderPlan(): void {
    const host = document.getElementById('plan-host')!;
    if (!coachesData) return;
    const preferred = new Map<string, number[]>();
    for (const [i, pd] of draft.passengers.entries()) {
      if (pd.pref && pd.pref !== 'NONE') {
        for (const c of coachesData.coaches) {
          for (const b of c.berths) {
            if (b.type === pd.pref) {
              const key = `${c.coach}:${b.berth}`;
              const arr = preferred.get(key) ?? [];
              arr.push(i + 1);
              preferred.set(key, arr);
            }
          }
        }
      }
    }
    // Only the chosen passenger's preference marks berths.
    const chosenPreferred = new Map<string, number[]>();
    const pd = draft.passengers[draft.choosing_for - 1];
    if (pd && pd.pref !== 'NONE') {
      for (const c of coachesData.coaches) {
        for (const b of c.berths) {
          if (b.type === pd.pref) {
            chosenPreferred.set(`${c.coach}:${b.berth}`, [draft.choosing_for]);
          }
        }
      }
    }
    const vertical = window.innerWidth < 768;
    drawCoachPlan(host, coachesData, draft.coach, vertical, {
      preferredTags: chosenPreferred,
      onPick: (coach, berth, type) => {
        const p2 = draft.passengers[draft.choosing_for - 1];
        if (p2) {
          p2.pref = type as BerthPref;
          saveDraft(draft);
          renderPassengers();
          renderPlan();
          // keep focus on the berth that was picked
          (document.querySelector(`[data-coach="${coach}"][data-berth="${berth}"]`) as HTMLElement | null)?.focus();
        }
      },
    });
  }

  // ----- fare -----
  function quoteFare(): void {
    if (fareTimer) clearTimeout(fareTimer);
    fareTimer = window.setTimeout(async () => {
      fareSeq += 1;
      const seq = fareSeq;
      const passengers = draft.passengers
        .filter((pd) => pd.age !== '')
        .map((pd) => ({ age: Number(pd.age) }));
      if (passengers.length === 0) return;
      try {
        const q = await api<FareQuote>('POST', '/api/fare-quote', {
          train: p.train, run_date: p.run_date, from: p.from, to: p.to,
          class: p.cls, quota: p.quota, passengers,
        });
        if (seq !== fareSeq) return;
        lastFare = q;
        paintFare(q);
      } catch {
        // keep the last quote
      }
    }, 250);
  }

  function paintFare(q: FareQuote): void {
    fareLinesHost.innerHTML = '';
    for (const line of q.lines) {
      const li = el('li', { class: 'fare-line' });
      li.appendChild(el('span', {}, line.label));
      li.appendChild(el('span', { class: 'num' }, formatPaise(line.amount_paise)));
      fareLinesHost.appendChild(li);
    }
    totalP.textContent = `Total ${formatPaise(q.total_paise)}`;
    totalP.classList.remove('flash');
    void totalP.offsetWidth; // restart the animation
    totalP.classList.add('flash');
    setStatus('Fare total', `Total ${formatPaise(q.total_paise)}`);
  }

  function clearFormProblems(): void {
    document.querySelectorAll('[data-err]').forEach((n) => { n.textContent = ''; });
    clearAlert('Form problems');
  }

  function fieldLinkHref(field: string): string {
    if (field === 'passengers') return '#add';
    if (field === 'contact_phone') return '#phone';
    const m = /^passengers\[(\d+)\]/.exec(field);
    if (m) return `#pax-${Number(m[1]) + 1}`;
    return '#';
  }

  function focusField(field: string): void {
    const m = /^passengers\[(\d+)\]\.(\w+)/.exec(field);
    if (m) {
      const idx = Number(m[1]);
      const kind = m[2];
      const groups = passengersHost.querySelectorAll('.passenger-group');
      const group = groups[idx] as HTMLElement | undefined;
      if (group) {
        const sel = kind === 'name' ? 'input[type="text"]' : kind === 'age' ? '.age-input' : 'select';
        (group.querySelector(sel) as HTMLElement | null)?.focus();
        return;
      }
    }
    if (field === 'passengers') {
      addBtn.focus();
      return;
    }
    if (field === 'contact_phone') {
      phone.focus();
      return;
    }
    phone.focus();
  }

  // ----- accepted status from the availability label -----
  function acceptedStatus(): 'CNF' | 'RAC' | 'WL' {
    const adults = draft.passengers.filter((pd) => Number(pd.age) >= 5).length || 1;
    const m = /AVL (\d+) \/ RAC (\d+) \/ (GNWL|RLWL|PQWL) (\d+)|AVL (\d+) \/ RAC (\d+) \/ REGRET|AVL (\d+) \/ (TQWL) (\d+)|AVL (\d+) \/ REGRET|AVL (\d+)|NOT AVAILABLE|CHART PREPARED/.exec(availLabel) ?? [];
    const gnAvl = Number(m[1] ?? m[5] ?? m[11] ?? m[12] ?? '0');
    const gnRac = Number(m[2] ?? m[6] ?? '0');
    const tqAvl = Number(m[8] ?? '0');
    if (p.quota === 'LD' || p.quota === 'SS') return 'CNF';
    if (p.quota === 'TQ') return tqAvl >= adults ? 'CNF' : 'WL';
    if (availLabel.includes('CHART PREPARED') || availLabel.includes('NOT AVAILABLE')) return 'WL';
    if (gnAvl >= adults) return 'CNF';
    if (gnAvl + gnRac >= adults) return 'RAC';
    return 'WL';
  }

  // ----- pay -----
  async function openPayDialog(opener: HTMLElement): Promise<void> {
    const total = lastFare?.total_paise ?? 0;
    const totalStr = formatPaise(total);
    let payClicked = false;
    const handle = openDialog((dlg) => {
      dlg.setAttribute('aria-label', 'Confirm and pay');
      dlg.appendChild(el('h2', {}, 'Confirm and pay'));
      const ul = el('ul', { class: 'plain' });
      for (const line of lastFare?.lines ?? []) {
        const li = el('li', { class: 'fare-line' });
        li.appendChild(el('span', {}, line.label));
        li.appendChild(el('span', { class: 'num' }, formatPaise(line.amount_paise)));
        ul.appendChild(li);
      }
      dlg.appendChild(ul);
      const tot = el('p', { class: 'fare-total' }, `Total ${totalStr}`);
      dlg.appendChild(tot);
      const actions = el('div', { class: 'dialog-actions' });
      const pay = el('button', { class: 'btn-primary' }, `Pay ${totalStr}`);
      pay.addEventListener('click', async () => {
        if (payClicked) return;
        payClicked = true;
        pay.disabled = true;
        setStatus('Booking result', 'Processing payment');
        await submitBooking(handle, pay);
      });
      const back = el('button', { class: 'back-btn' }, 'Back');
      back.addEventListener('click', () => {
        handle.close();
        opener.focus();
      });
      actions.appendChild(pay);
      actions.appendChild(back);
      dlg.appendChild(actions);
    }, opener, '.btn-primary');
    void payClicked;
  }

  async function submitBooking(handle: { close: () => void; el: HTMLDialogElement }, payBtn: HTMLElement): Promise<void> {
    const key = sessionStorage.getItem('pakka-idem-key') ?? newIdemKey();
    const body = {
      train: p.train, run_date: p.run_date, from: p.from, to: p.to,
      class: p.cls, quota: p.quota,
      passengers: draft.passengers.map((pd) => ({
        name: pd.name, age: Number(pd.age), gender: pd.gender, berth_preference: pd.pref,
      })),
      keep_in_one_coach: draft.keep_in_one_coach,
      lower_berth_only: draft.lower_berth_only,
      accept: acceptedStatus(),
      contact_phone: draft.contact_phone,
    };
    try {
      const booking = await api<{ pnr: string }>('POST', '/api/bookings', body, { idempotencyKey: key });
      sessionStorage.removeItem('pakka-idem-key');
      clearDraft();
      const pnr = booking.pnr;
      handle.close();
      const statusHost = document.createElement('div');
      statusHost.setAttribute('role', 'status');
      statusHost.setAttribute('aria-label', 'Booking result');
      statusHost.setAttribute('data-status', 'Booking result');
      statusHost.textContent = `Booked. PNR ${pnr}. E-ticket saved. Email copy queued.`;
      document.getElementById('live-regions')!.appendChild(statusHost);
      location.href = `/bookings/${pnr}`;
    } catch (err) {
      payBtn.removeAttribute('disabled');
      if (err instanceof ApiFail) {
        sessionStorage.setItem('pakka-idem-key', key);
        handle.close();
        payBtn.focus();
        if (err.status === 401) {
          // nothing was charged; go to sign in with the draft kept
          location.href = `/signin?ended=1&next=${encodeURIComponent(location.pathname + location.search)}`;
          return;
        }
        handleBookingError(err, payBtn);
      }
    }
  }

  function handleBookingError(err: ApiFail, opener: HTMLElement): void {
    const b = err.body;
    if (err.status === 422 && b.errors) {
      renderFormProblems(b.errors);
      return;
    }
    if (b.error === 'availability_changed' && b.offer) {
      setAlert('Booking problem', `<p>Availability changed before you paid. Nothing was charged. Now available: ${b.offer.label}.</p>`);
      offerButton(b.offer.label, b.offer.accept, opener);
    } else if (b.error === 'waitlist_full') {
      setAlert('Booking problem', `<p>The waiting list for this train is full. Nothing was booked or charged.</p>`);
    } else if (b.error === 'party_split') {
      setAlert('Booking problem', `<p>Party could not be kept in one coach. Nothing was booked or charged.</p>`);
    } else if (b.error === 'no_lower_berth') {
      setAlert('Booking problem', `<p>No lower berth could be allotted. Nothing was booked or charged.</p>`);
    } else if (b.error === 'quota_full') {
      const label = QUOTA_LABEL[p.quota];
      setAlert('Booking problem', `<p>Not enough ${label} quota berths are left. Nothing was booked or charged.</p>`);
    } else if (b.error === 'booking_not_open') {
      const d = new Date(b.opens_at!.replace('+05:30', 'Z'));
      const words = `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      setAlert('Booking problem', `<p>Bookings for this train open on ${words}.</p>`);
    } else if (b.error === 'tatkal_not_open') {
      const d = new Date(b.opens_at!.replace('+05:30', 'Z'));
      const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      const words = `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      setAlert('Booking problem', `<p>Tatkal opens at ${time} IST on ${words}.</p>`);
    } else if (b.error === 'chart_prepared') {
      setAlert('Booking problem', `<p>The chart for this train is prepared. Bookings are closed.</p>`);
    } else if (b.error === 'payment_unavailable') {
      setAlert('Booking problem', `<p>Payments are down right now. Nothing was charged and no berth is held. Try again in a few minutes.</p>`);
    } else if (b.error === 'ticket_storage_unavailable') {
      setAlert('Booking problem', `<p>E-tickets can't be saved right now. Nothing was charged and no berth is held. Try again in a few minutes.</p>`);
    }
    // The page reads the train search again and shows the refreshed label.
    refreshAvailLabel();
  }

  async function refreshAvailLabel(): Promise<void> {
    try {
      const d = await api<{ trains: { number: string; classes: { class: string; quota: string; label: string }[] }[] }>(
        'GET', `/api/trains?from=${p.from}&to=${p.to}&date=${p.run_date}&quota=${p.quota}&class=${p.cls}`,
      );
      const t = d.trains.find((x) => x.number === p.train);
      const entry = t?.classes.find((c) => c.class === p.cls && c.quota === p.quota);
      if (entry) {
        availLabel = entry.label;
        windowLabel = 'open';
        fareAvail.textContent = availLabel;
        setStatus('Fare availability', availLabel);
      }
    } catch { /* keep the last label */ }
  }

  function offerButton(offerLabel: string, accept: string, opener: HTMLElement): void {
    const host = document.getElementById('problem-host')!;
    const existing = host.querySelector('.offer-btn-host');
    existing?.remove();
    const div = el('div', { class: 'offer-btn-host' });
    const btn = el('button', { class: 'btn-primary' }, `Book at ${offerLabel}`);
    btn.addEventListener('click', async () => {
      clearAlert('Booking problem');
      div.remove();
      // one step, as a new booking request with a new Idempotency-Key
      const key = newIdemKey();
      const body = {
        train: p.train, run_date: p.run_date, from: p.from, to: p.to,
        class: p.cls, quota: p.quota,
        passengers: draft.passengers.map((pd) => ({
          name: pd.name, age: Number(pd.age), gender: pd.gender, berth_preference: pd.pref,
        })),
        keep_in_one_coach: draft.keep_in_one_coach,
        lower_berth_only: draft.lower_berth_only,
        accept,
        contact_phone: draft.contact_phone,
      };
      setStatus('Booking result', 'Processing payment');
      try {
        const booking = await api<{ pnr: string }>('POST', '/api/bookings', body, { idempotencyKey: key });
        clearDraft();
        location.href = `/bookings/${booking.pnr}`;
      } catch (err) {
        if (err instanceof ApiFail) {
          if (err.status === 401) {
            location.href = `/signin?ended=1&next=${encodeURIComponent(location.pathname + location.search)}`;
            return;
          }
          handleBookingError(err, opener);
        }
      }
    });
    div.appendChild(btn);
    const cs = el('a', { href: `/trains?from=${p.from}&to=${p.to}&date=${p.run_date}&quota=${p.quota}&class=${p.cls}` }, 'Change search');
    div.appendChild(cs);
    host.appendChild(div);
  }

  function renderFormProblems(errors: Record<string, string>): void {
    const links = Object.entries(errors).map(([field, message]) =>
      `<li><a href="${fieldLinkHref(field)}" data-field="${field}">${message}</a></li>`).join('');
    const alertEl = setAlert('Form problems', `<h2>Check these fields</h2><ul>${links}</ul>`);
    for (const [field, message] of Object.entries(errors)) {
      const target = document.querySelector(`[data-err="${field}"]`);
      if (target) target.textContent = message;
    }
    alertEl.querySelector('ul')?.setAttribute('role', 'list');
    for (const a of Array.from(alertEl.querySelectorAll('a'))) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        focusField((a as HTMLElement).dataset.field ?? '');
      });
    }
    alertEl.focus();
  }

  // phone: keep the focused field clear of the pinned Review and pay bar
  main.addEventListener('focusin', () => {
    if (window.innerWidth < 768) {
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT')) {
        setTimeout(() => focused.scrollIntoView({ block: 'center', behavior: 'auto' }), 60);
      }
    }
  });

  void BERTH_POS;
  void windowLabel;
}

function newIdemKey(): string {
  const key = crypto.randomUUID();
  sessionStorage.setItem('pakka-idem-key', key);
  return key;
}

function parseBookingParams(): BookingParams | null {
  const params = new URLSearchParams(location.search);
  const train = params.get('train');
  const run_date = params.get('run_date');
  const from = params.get('from');
  const to = params.get('to');
  const cls = (params.get('class') ?? 'SL') as ClassCode;
  const quota = (params.get('quota') ?? 'GN') as QuotaCode;
  if (!train || !run_date || !from || !to) return null;
  return { train, run_date, from, to, cls, quota };
}

function buildRibbon(stops: { code: string; name: string }[], p: BookingParams): HTMLElement {
  const ribbon = document.createElement('div');
  void stops; void p; void stationName;
  ribbon.className = 'ribbon';
  ribbon.setAttribute('role', 'region');
  ribbon.setAttribute('aria-label', 'Route');
  const strip = el('div', { class: 'strip' });
  const fromStop = el('div', { class: 'stop terminal' });
  fromStop.appendChild(el('span', { class: 'code' }, p.from));
  const toStop = el('div', { class: 'stop terminal' });
  toStop.appendChild(el('span', { class: 'code' }, p.to));
  strip.appendChild(fromStop);
  strip.appendChild(toStop);
  ribbon.appendChild(strip);
  return ribbon;
}
