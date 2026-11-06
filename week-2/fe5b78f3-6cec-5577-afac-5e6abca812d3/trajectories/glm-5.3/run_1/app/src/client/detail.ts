// Booking detail: the PNR page with the coach plan, the queues, the chart,
// polling, the Chart drop and cancellation.

import { api, ApiFail, fetchClock, businessNowStamp } from './api.js';
import { el, setAlert, clearAlert, openDialog, setStatus, currentAccount, loadAccount, prefersReducedMotion } from './ui.js';
import { renderShell, setTitle, renderRibbon, lucideIcon } from './shell.js';
import {
  formatPaise, stampHHMM, stampWords, QUOTA_LABEL, BAND_LABEL, TICKET_KIND_LABEL,
  chipClass, parseStamp,
} from './format.js';
import { drawCoachPlan, coachPageKey, type CoachPlanData } from './coachplan.js';
import type { BookingState } from '../types.js';

interface StatusObj {
  status: string; position: number | null; coach: string | null;
  berth: number | null; berth_type: string | null; label: string;
}

export interface BookingBody {
  pnr: string; version: number; state: BookingState;
  train: { number: string; name: string };
  run_date: string;
  from: { code: string; name: string }; to: { code: string; name: string };
  class: string; quota: string;
  departure_at: string; arrival_at: string; chart_at: string; chart_prepared: boolean;
  keep_in_one_coach: boolean; lower_berth_only: boolean; contact_phone: string;
  total_paise: number;
  fare_lines: { label: string; amount_paise: number }[];
  passengers: {
    number: number; name: string; age: number; gender: string; berth_preference: string;
    fare_paise: number;
    booking_status: StatusObj; current_status: StatusObj;
    history: { at: string; from_label: string; to_label: string }[];
  }[];
  tickets: { version: number; kind: string; created_at: string }[];
  cancellations: {
    number: number; requested_at: string;
    passengers: { number: number; band: string; charge_paise: number; gst_paise: number; deduction_paise: number; refund_paise: number }[];
    refund_paise: number;
  }[];
  refunds: { number: number; reason: string; refund_paise: number; status: string; issued_at: string | null }[];
}

/** What this device last showed for a PNR, so a first visit plays nothing. */
const lastShown = new Map<string, Record<number, string>>();

let paintedVersion = 0;
let pollTimer: number | null = null;
let cancelDialogOpen = false;
let heldBack: { number: number; from: string; to: string }[] = [];
let dropPlaying = false;
let lastGoodStamp: string | null = null;

export async function renderBookingDetail(pnr: string): Promise<void> {
  setTitle(`PNR ${pnr}`);
  const account = currentAccount() ?? (await loadAccount());
  if (!account) {
    location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  await fetchClock();
  let body: BookingBody;
  try {
    body = await api<BookingBody>('GET', `/api/bookings/${pnr}`);
  } catch (e) {
    if (e instanceof ApiFail && e.status === 404) {
      renderNotFound('Booking not found');
      return;
    }
    throw e;
  }
  paintedVersion = body.version;
  const main = el('main', { id: 'main' });

  // route ribbon from the train's stops
  const search = await api<{ trains: { number: string; stops: { code: string; name: string; departure_at: string }[] }[] }>(
    'GET', `/api/trains?from=${body.from.code}&to=${body.to.code}&date=${body.run_date}&quota=GN&class=${body.class}`,
  ).catch(() => null);
  const train = search?.trains.find((t) => t.number === body.train.number);
  const ribbon = train
    ? renderRibbon(train.stops.map((s, i) => ({
        code: s.code, name: s.name, time: stampHHMM(s.departure_at),
        terminal: i === 0 || i === train.stops.length - 1,
      })))
    : renderRibbon([
        { code: body.from.code, name: body.from.name, time: null, terminal: true },
        { code: body.to.code, name: body.to.name, time: null, terminal: true },
      ]);
  renderShell(main, { ribbon });

  // heading
  const h1 = el('h1', {}, `PNR ${pnr}`);
  main.appendChild(h1);

  const live = document.getElementById('live-regions')!;
  for (const name of ['PNR updates', 'Booking result', 'Cancellation result']) {
    const d = el('div', { class: 'status-line' });
    d.setAttribute('role', 'status');
    d.setAttribute('aria-label', name);
    d.setAttribute('data-status', name);
    live.appendChild(d);
  }

  const grid = el('div', { class: 'detail-grid' });
  main.appendChild(grid);
  const col1 = el('div', {});
  const col2 = el('div', {});
  const col3 = el('div', {});
  grid.appendChild(col1);
  grid.appendChild(col2);
  grid.appendChild(col3);

  let coachesData: CoachPlanData | null = null;
  let currentCoach: string | null = null;
  try {
    coachesData = await api<CoachPlanData>(
      'GET',
      `/api/trains/${body.train.number}/runs/${body.run_date}/coaches?class=${body.class}&from=${body.from.code}&to=${body.to.code}`,
    );
    currentCoach = coachesData.coaches[0]?.coach ?? null;
  } catch { /* plan unavailable */ }

  paint(body, true);

  startPolling(pnr);

  // ---------- painting ----------

  function paint(b: BookingBody, isFirst: boolean): void {
    const changed: { number: number; from: string; to: string }[] = [];
    const prev = lastShown.get(b.pnr) ?? {};
    for (const p of b.passengers) {
      const before = prev[p.number];
      if (before !== undefined && before !== p.current_status.label) {
        changed.push({ number: p.number, from: before, to: p.current_status.label });
      }
      prev[p.number] = p.current_status.label;
    }
    lastShown.set(b.pnr, prev);

    // journey summary and chart block
    col1.innerHTML = '';
    const summary = el('div', { class: 'panel' });
    const dl = el('dl', { class: 'kv' });
    const add = (k: string, v: string) => {
      dl.appendChild(el('dt', {}, k));
      dl.appendChild(el('dd', {}, v));
    };
    add('Train', `${b.train.number} ${b.train.name}`);
    add('Run date', stampWords(`${b.run_date}T00:00:00+05:30`));
    add('From', `${b.from.code} ${b.from.name}`);
    add('To', `${b.to.code} ${b.to.name}`);
    add('Class', b.class);
    add('Quota', QUOTA_LABEL[b.quota] ?? b.quota);
    add('Departure', `${stampHHMM(b.departure_at)} IST`);
    add('Arrival', `${stampHHMM(b.arrival_at)} IST`);
    add('Total fare', formatPaise(b.total_paise));
    add('Contact', b.contact_phone);
    summary.appendChild(dl);
    col1.appendChild(summary);

    const chartPanel = el('div', { class: 'panel' });
    if (b.chart_prepared) {
      const h2 = el('h2', {}, 'Chart prepared');
      chartPanel.appendChild(h2);
      chartPanel.appendChild(el('p', {}, 'Statuses are final. Berths no longer move.'));
    } else {
      const t = parseStamp(b.chart_at);
      const hh = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
      const p = el('p', {}, `Chart at ${hh} IST, ${stampWords(b.chart_at)}`);
      p.prepend(lucideIcon('clock'));
      chartPanel.appendChild(p);
    }
    col1.appendChild(chartPanel);

    // passengers
    const passHost = el('ul', { 'aria-label': 'Passengers', class: 'plain' });
    passHost.id = 'passengers-list';
    for (const p of b.passengers) {
      const li = el('li', { class: 'passenger-line' });
      li.dataset.passenger = String(p.number);
      const label = `${p.number} ${p.name} ${p.age} ${p.current_status.label}`;
      li.appendChild(el('span', {}, `Passenger ${p.number}`));
      li.appendChild(el('span', {}, `${p.name}, ${p.age}`));
      const chip = buildChip(p.current_status.label, p.number);
      li.appendChild(chip);
      li.setAttribute('aria-label', label);
      // not-confirmed refund line beside the struck chip
      if (p.current_status.status === 'CHART_NOT_CONFIRMED') {
        const refund = b.refunds.find((r) => r.reason === 'chart');
        const text = refund?.status === 'issued' ? 'Not confirmed — refund issued' : 'Not confirmed — refund pending';
        const span = el('span', { class: 'small' }, text);
        span.setAttribute('data-notcnf', String(p.number));
        li.appendChild(span);
      }
      passHost.appendChild(li);
    }
    col1.appendChild(passHost);

    // coach plan
    col2.innerHTML = '';
    const planPanel = el('div', { class: 'panel' });
    planPanel.appendChild(el('h2', {}, 'Coach plan'));
    if (coachesData) {
      const tabsHost = el('div', {});
      const tabs = el('div', { role: 'tablist', 'aria-label': 'Coaches' });
      for (const c of coachesData.coaches) {
        const tab = el('button', { role: 'tab', 'aria-selected': c.coach === currentCoach ? 'true' : 'false' }, c.coach);
        tab.addEventListener('click', () => {
          currentCoach = c.coach;
          paintPlan();
          tabs.querySelectorAll('[role="tab"]').forEach((x) =>
            x.setAttribute('aria-selected', (x.textContent === c.coach) ? 'true' : 'false'));
        });
        tabs.appendChild(tab);
      }
      tabsHost.appendChild(tabs);
      planPanel.appendChild(tabsHost);
      const planHost = el('div', { class: 'coach-frame', id: 'detail-plan-host' });
      planPanel.appendChild(planHost);
      col2.appendChild(planPanel);
      paintPlan();
    } else {
      planPanel.appendChild(el('p', {}, 'The coach plan is not available.'));
      col2.appendChild(planPanel);
    }

    // What changed, under reduced motion only
    const existingWhat = document.getElementById('what-changed');
    existingWhat?.remove();

    // queue lanes
    const queue = el('div', { role: 'region', 'aria-label': 'Queue' });
    const queueWrap = el('div', { class: 'queue-cols' });
    const wlLane = el('div', { class: 'queue-lane', role: 'region', 'aria-label': 'WL lane' });
    wlLane.appendChild(el('h3', {}, 'WL lane'));
    const wlChips = el('div', { class: 'chips' });
    const racLane = el('div', { class: 'queue-lane', role: 'region', 'aria-label': 'RAC lane' });
    racLane.appendChild(el('h3', {}, 'RAC lane'));
    const racChips = el('div', { class: 'chips' });
    for (const p of b.passengers) {
      const st = p.current_status;
      if (['GNWL', 'RLWL', 'PQWL', 'TQWL'].includes(st.status)) {
        wlChips.appendChild(buildQueueChip(p.number, st.label));
      } else if (st.status === 'RAC') {
        racChips.appendChild(buildQueueChip(p.number, st.label));
      }
    }
    wlLane.appendChild(wlChips);
    racLane.appendChild(racChips);
    queueWrap.appendChild(wlLane);
    queueWrap.appendChild(racLane);
    queue.appendChild(queueWrap);
    if (window.innerWidth < 768) col2.appendChild(queue);
    else col3.appendChild(queue);

    // tickets and refunds
    const panel3 = el('div', { class: 'panel' });
    panel3.appendChild(el('h2', {}, 'Tickets and refunds'));
    const ticketsList = el('ul', { 'aria-label': 'E-tickets', class: 'tickets-list' });
    for (const t of b.tickets) {
      const li = el('li');
      const a = el('a', { href: `/api/bookings/${b.pnr}/tickets/${t.version}` },
        `Download e-ticket v${t.version} (${TICKET_KIND_LABEL[t.kind] ?? t.kind})`);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        downloadTicket(b.pnr, t.version);
      });
      li.appendChild(a);
      ticketsList.appendChild(li);
    }
    panel3.appendChild(ticketsList);
    const refundsList = el('ul', { 'aria-label': 'Refunds', class: 'refunds-list' });
    for (const r of b.refunds) {
      const li = el('li');
      li.appendChild(el('span', { class: 'num' }, `${formatPaise(r.refund_paise)}`));
      li.appendChild(document.createTextNode(' '));
      const state = el('span', { class: 'refund-state' }, r.status === 'issued' ? 'Refund issued' : 'Refund pending');
      li.appendChild(state);
      refundsList.appendChild(li);
    }
    panel3.appendChild(refundsList);

    // cancellations detail
    if (b.cancellations.length > 0) {
      panel3.appendChild(el('h3', {}, 'Cancellations'));
      for (const c of b.cancellations) {
        const ul = el('ul', { class: 'plain' });
        for (const p of c.passengers) {
          const li = el('li', { class: 'small' });
          li.textContent = `Passenger ${p.number}: ${BAND_LABEL[p.band] ?? p.band}, refund ${formatPaise(p.refund_paise)}`;
          ul.appendChild(li);
        }
        panel3.appendChild(ul);
      }
    }

    col3.appendChild(panel3);

    // Cancel passengers
    const cancellable = b.passengers.filter((p) =>
      !['CAN', 'CHART_NOT_CONFIRMED'].includes(p.current_status.status) && b.state !== 'journey_complete');
    if (cancellable.length > 0) {
      const cancelBtn = el('button', { class: 'cancel-btn' }, 'Cancel passengers');
      cancelBtn.addEventListener('click', () => openCancelDialog(cancelBtn, b));
      col3.appendChild(cancelBtn);
    }

    // play the Chart drop for the changes
    if (!isFirst && changed.length > 0) {
      if (cancelDialogOpen) {
        heldBack.push(...changed);
      } else if (prefersReducedMotion()) {
        playReducedMotion(changed);
      } else {
        playChartDrop(changed, b);
      }
    }
    lastGoodStamp = businessNowStamp();
  }

  function paintPlan(): void {
    if (!coachesData || !currentCoach) return;
    const host = document.getElementById('detail-plan-host');
    if (!host) return;
    const occupantTags = new Map<string, { number: number; rac: boolean }[]>();
    for (const p of body.passengers) {
      const st = p.current_status;
      if ((st.status === 'CNF' || st.status === 'RAC') && st.coach && st.berth) {
        const key = `${st.coach}:${st.berth}`;
        const arr = occupantTags.get(key) ?? [];
        arr.push({ number: p.number, rac: st.status === 'RAC' });
        occupantTags.set(key, arr);
      }
    }
    // switch to the coach of a confirmed passenger when the plan is first drawn
    drawCoachPlan(host, coachesData, currentCoach, window.innerWidth < 768, {
      preferredTags: new Map(),
      occupantTags,
    });
    coachPageKey(host, coachesData.coaches.map((c) => c.coach), () => currentCoach ?? coachesData!.coaches[0].coach, (coach) => {
      const prevBerth = (document.activeElement as HTMLElement | null)?.dataset?.berth ?? '1';
      currentCoach = coach;
      const tabs = document.querySelectorAll('#detail-plan-host [role="tab"]');
      void tabs;
      paintPlan();
      // the selected tab follows the coach
      document.querySelectorAll('[role="tab"]').forEach((t) =>
        t.setAttribute('aria-selected', t.textContent === coach ? 'true' : 'false'));
      const focusBack = document.querySelector(`[data-coach="${coach}"][data-berth="${prevBerth}"]`) as HTMLElement | null;
      focusBack?.focus();
    });
  }

  function buildChip(label: string, number: number): HTMLElement {
    const st = label.split(' ')[0];
    const chip = el('span', { class: `chip ${chipClass(st === 'NOT' ? 'CHART_NOT_CONFIRMED' : st)}`, 'data-chip': String(number) });
    const txt = el('span', { class: 'txt' }, label);
    chip.appendChild(txt);
    return chip;
  }

  function buildQueueChip(number: number, label: string): HTMLElement {
    const chip = buildChip(label, number);
    chip.dataset.lane = label.split(' ')[0] === 'RAC' ? 'rac' : 'wl';
    return chip;
  }

  // ---------- polling ----------

  function startPolling(pnrArg: string): void {
    const tick = async () => {
      try {
        const b = await api<BookingBody>('GET', `/api/bookings/${pnrArg}`);
        if (b.version > paintedVersion) {
          paintedVersion = b.version;
          body = b;
          if (cancelDialogOpen) {
            // never redraw the dialog; hold the changes back
            const prev = lastShown.get(b.pnr) ?? {};
            for (const p of b.passengers) {
              const before = prev[p.number];
              if (before !== undefined && before !== p.current_status.label) {
                heldBack.push({ number: p.number, from: before, to: p.current_status.label });
              }
              prev[p.number] = p.current_status.label;
            }
            lastShown.set(b.pnr, prev);
          } else if (dropPlaying) {
            // play after the current sequence finishes
            heldBack.push(...collectChanges(b));
          } else {
            const wasFirst = false;
            paint(b, wasFirst);
          }
        }
        lastGoodStamp = businessNowStamp();
        scheduleNext(b);
      } catch {
        setStatus('PNR updates', `Can't reach Pakka right now. Showing status from ${lastGoodStamp ? stampHHMM(lastGoodStamp) : '--:--'} IST.`);
        scheduleNext(null);
      }
    };
    const scheduleNext = (b: BookingBody | null) => {
      if (pollTimer) clearTimeout(pollTimer);
      const done = b && b.state === 'journey_complete' && b.refunds.every((r) => r.status === 'issued');
      if (done) return;
      pollTimer = window.setTimeout(tick, 20_000);
    };
    pollTimer = window.setTimeout(tick, 20_000);
  }

  function collectChanges(b: BookingBody): { number: number; from: string; to: string }[] {
    const prev = lastShown.get(b.pnr) ?? {};
    const out: { number: number; from: string; to: string }[] = [];
    for (const p of b.passengers) {
      const before = prev[p.number];
      if (before !== undefined && before !== p.current_status.label) {
        out.push({ number: p.number, from: before, to: p.current_status.label });
      }
      prev[p.number] = p.current_status.label;
    }
    lastShown.set(b.pnr, prev);
    return out;
  }

  // ---------- the Chart drop ----------

  async function playChartDrop(changes: { number: number; from: string; to: string }[], b: BookingBody): Promise<void> {
    dropPlaying = true;
    announceLines(changes);
    const sorted = [...changes].sort((x, y) => x.number - y.number);
    for (const ch of sorted) {
      await dropOne(ch, b);
    }
    dropPlaying = false;
    if (heldBack.length > 0) {
      const batch = heldBack;
      heldBack = [];
      paint(body, false);
      await playChartDrop(batch, body);
    }
  }

  function announceLines(changes: { number: number; from: string; to: string }[]): void {
    const lines = changes.map((c) => `Passenger ${c.number}: ${speakLabel(c.from)} to ${speakLabel(c.to)}`);
    setStatus('PNR updates', lines.join('\n'));
  }

  function speakLabel(label: string): string {
    // `CNF S1 25 LB` -> `CNF, S1 berth 25, lower`; queue labels already speak well
    if (label.startsWith('CNF ')) {
      const parts = label.split(' ');
      const pos = { LB: 'lower', MB: 'middle', UB: 'upper', SL: 'side lower', SU: 'side upper' }[parts[3]] ?? 'lower';
      return `CNF, ${parts[1]} berth ${parts[2]}, ${pos}`;
    }
    if (label === 'NOT CNF') return 'not confirmed, refund pending';
    if (label === 'CAN') return 'cancelled';
    return label;
  }

  async function dropOne(ch: { number: number; from: string; to: string }, b: BookingBody): Promise<void> {
    const chip = document.querySelector<HTMLElement>(`[data-chip="${ch.number}"]`);
    if (!chip) return;
    const fromLabel = ch.from;
    const toLabel = ch.to;
    const fromKind = kindOf(fromLabel);
    const toKind = kindOf(toLabel);
    // 1. Count: count down through every integer from the old number.
    const fromNum = Number(fromLabel.split(' ')[1] ?? '0');
    const toNum = toKind === fromKind ? Number(toLabel.split(' ')[1] ?? '0') : 1;
    if (fromKind === 'wl' && fromNum > toNum) {
      const steps = fromNum - toNum;
      const duration = Math.min(420, Math.max(240, steps * 30));
      for (let n = fromNum; n >= toNum; n--) {
        const at = (fromNum - n) / Math.max(1, steps) * duration;
        await sleep(at === 0 ? 0 : Math.max(16, (duration / steps)));
        chip.textContent = `${fromLabel.split(' ')[0]} ${n}`;
      }
    }
    // 2. Lane change into RAC, or 3. berth morph to CNF.
    if (toKind === 'rac' || toKind === 'cnf') {
      const target = findBerthCell(toLabel, b);
      if (target) {
        const fromRect = chip.getBoundingClientRect();
        const toRect = target.getBoundingClientRect();
        const dx = toRect.left - fromRect.left;
        const dy = toRect.top - fromRect.top;
        chip.style.position = 'fixed';
        chip.style.left = `${fromRect.left}px`;
        chip.style.top = `${fromRect.top}px`;
        chip.style.zIndex = '50';
        const duration = toKind === 'rac' ? 320 : 420;
        const anim = chip.animate(
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(${toKind === 'rac' ? 0.6 : 1})`, opacity: 0.9 },
          ],
          { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
        );
        await anim.finished.catch(() => undefined);
      }
    }
    // settle the chip into its final state
    const finalChip = document.querySelector<HTMLElement>(`[data-chip="${ch.number}"]`);
    if (finalChip) {
      finalChip.className = `chip ${chipClass(kindOf(toLabel) === 'cnf' ? 'CNF' : toKind === 'rac' ? 'RAC' : toKind === 'wl' ? 'WL' : toKind === 'can' ? 'CAN' : 'CHART_NOT_CONFIRMED')}`;
      finalChip.style.position = '';
      finalChip.style.left = '';
      finalChip.style.top = '';
      finalChip.style.zIndex = '';
      finalChip.textContent = '';
      const txt = el('span', { class: 'txt' }, toLabel);
      finalChip.appendChild(txt);
    }
    await sleep(120);
  }

  function kindOf(label: string): string {
    if (label.startsWith('CNF')) return 'cnf';
    if (label.startsWith('RAC')) return 'rac';
    if (label === 'CAN') return 'can';
    if (label === 'NOT CNF') return 'notcnf';
    if (label === 'NOSB') return 'nosb';
    return 'wl';
  }

  function findBerthCell(toLabel: string, b: BookingBody): HTMLElement | null {
    const parts = toLabel.split(' ');
    if (kindOf(toLabel) === 'cnf') {
      const coach = parts[1];
      const berth = parts[2];
      return document.querySelector(`[data-coach="${coach}"][data-berth="${berth}"]`) as HTMLElement | null;
    }
    if (kindOf(toLabel) === 'rac') {
      const coach = parts[2];
      const berth = parts[3];
      return document.querySelector(`[data-coach="${coach}"][data-berth="${berth}"]`) as HTMLElement | null;
    }
    return null;
  }

  function playReducedMotion(changes: { number: number; from: string; to: string }[]): void {
    announceLines(changes);
    const host = col2;
    const region = el('div', { class: 'what-changed', role: 'region', 'aria-label': 'What changed', id: 'what-changed' });
    const ul = el('ul');
    for (const c of changes) {
      ul.appendChild(el('li', {}, `Passenger ${c.number}: ${speakLabel(c.from)} to ${speakLabel(c.to)}`));
    }
    region.appendChild(el('h3', {}, 'What changed'));
    region.appendChild(ul);
    host.insertBefore(region, host.firstChild);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---------- tickets ----------

  async function downloadTicket(pnrArg: string, version: number): Promise<void> {
    try {
      const res = await fetch(`/api/bookings/${pnrArg}/tickets/${version}`, { credentials: 'same-origin' });
      if (!res.ok) {
        setAlert('Ticket problem', `<p>E-tickets can't be downloaded right now. Try again in a few minutes.</p>`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `e-ticket-${pnrArg}-v${version}.pdf` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setAlert('Ticket problem', `<p>E-tickets can't be downloaded right now. Try again in a few minutes.</p>`);
    }
  }

  // ---------- cancel dialog ----------

  function openCancelDialog(opener: HTMLElement, b: BookingBody): void {
    cancelDialogOpen = true;
    const selected = new Set<number>();
    let quoteTimer: number | null = null;

    const handle = openDialog((dlg) => {
      dlg.setAttribute('aria-label', 'Cancel passengers');
      dlg.appendChild(el('h2', {}, 'Cancel passengers'));
      const listHost = el('div', { id: 'cancel-list' });
      dlg.appendChild(listHost);
      const previewHost = el('ul', { 'aria-label': 'Refund preview', class: 'plain', id: 'refund-preview' });
      dlg.appendChild(previewHost);
      const actions = el('div', { class: 'dialog-actions' });
      const confirmBtn = el('button', { class: 'btn-primary', id: 'cancel-confirm' }, 'Cancel and refund —');
      confirmBtn.disabled = true;
      const keepBtn = el('button', { id: 'keep-booking' }, 'Keep booking');
      actions.appendChild(confirmBtn);
      actions.appendChild(keepBtn);
      dlg.appendChild(actions);

      const renderList = () => {
        listHost.innerHTML = '';
        const cancellable = body.passengers.filter((p) =>
          !['CAN', 'CHART_NOT_CONFIRMED'].includes(p.current_status.status) && body.state !== 'journey_complete');
        for (const p of cancellable) {
          const id = `cancel-pax-${p.number}`;
          const line = el('div', { class: 'checkline' });
          const input = el('input', { type: 'checkbox', id });
          input.setAttribute('aria-label', `Passenger ${p.number}`);
          if (selected.has(p.number)) input.checked = true;
          input.addEventListener('change', () => {
            if (input.checked) selected.add(p.number);
            else selected.delete(p.number);
            quoteSoon();
          });
          const lab = el('label', { for: id }, `Passenger ${p.number} — ${p.current_status.label}`);
          line.appendChild(input);
          line.appendChild(lab);
          listHost.appendChild(line);
        }
      };

      const quoteSoon = () => {
        if (quoteTimer) clearTimeout(quoteTimer);
        quoteTimer = window.setTimeout(quoteNow, 150);
      };

      const quoteNow = async () => {
        const numbers = [...selected].sort((a, b2) => a - b2);
        if (numbers.length === 0) {
          previewHost.innerHTML = '';
          confirmBtn.textContent = 'Cancel and refund —';
          confirmBtn.disabled = true;
          return;
        }
        try {
          const q = await api<{ passengers: { number: number; band: string; charge_paise: number; gst_paise: number; deduction_paise: number; refund_paise: number }[]; refund_paise: number }>(
            'POST', `/api/bookings/${b.pnr}/cancellation-quote`, { passengers: numbers },
          );
          previewHost.innerHTML = '';
          for (const p of q.passengers) {
            const li = el('li');
            const bandLabel = BAND_LABEL[p.band] ?? p.band;
            const gstPart = p.gst_paise > 0 ? ` incl. GST ${formatPaise(p.gst_paise)}` : '';
            li.textContent = `Passenger ${p.number}: ${bandLabel}, deduction ${formatPaise(p.deduction_paise)}${gstPart}, refund ${formatPaise(p.refund_paise)}`;
            previewHost.appendChild(li);
          }
          confirmBtn.textContent = `Cancel and refund ${formatPaise(q.refund_paise)}`;
          confirmBtn.disabled = false;
        } catch {
          // keep the previous quote
        }
      };

      renderList();
      quoteNow();

      keepBtn.addEventListener('click', () => {
        handle.close();
        cancelDialogOpen = false;
        opener.focus();
        // the held-back batch plays once the dialog closes
        if (heldBack.length > 0 && !prefersReducedMotion()) {
          const batch = heldBack;
          heldBack = [];
          paint(body, false);
          void playChartDrop(batch, body);
        } else if (heldBack.length > 0) {
          const batch = heldBack;
          heldBack = [];
          paint(body, false);
          playReducedMotion(batch);
        }
      });

      confirmBtn.addEventListener('click', async () => {
        const numbers = [...selected].sort((a, b2) => a - b2);
        if (numbers.length === 0) return;
        confirmBtn.disabled = true;
        setStatus('Cancellation result', 'Cancelling');
        try {
          const res = await api<{ cancellation: { refund_paise: number }; refund: { refund_paise: number } | null; booking: BookingBody }>(
            'POST', `/api/bookings/${b.pnr}/cancellations`, { passengers: numbers },
            { idempotencyKey: crypto.randomUUID() },
          );
          paintedVersion = res.booking.version;
          body = res.booking;
          handle.close();
          cancelDialogOpen = false;
          opener.focus();
          const refundTotal = res.cancellation.refund_paise;
          setStatus('Cancellation result', refundTotal > 0
            ? `Cancelled. Refund of ${formatPaise(refundTotal)} recorded.`
            : 'Cancelled. No refund is due.');
          paint(res.booking, false);
        } catch (err) {
          confirmBtn.disabled = false;
          if (err instanceof ApiFail) {
            if (err.body.error === 'already_cancelled') {
              setStatus('Cancellation result', 'That passenger is already cancelled.');
            } else if (err.body.error === 'journey_complete') {
              setStatus('Cancellation result', 'This journey is complete. It can no longer be cancelled.');
            }
            handle.close();
            cancelDialogOpen = false;
            opener.focus();
          }
        }
      });
    }, opener, '#cancel-list input');

    void b;
    const observer = new MutationObserver(() => { /* dialog content is managed above */ });
    observer.disconnect();
  }

  void heldBack;
  void dropPlaying;
}

function renderNotFound(title: string): void {
  setTitle(title);
  const main = el('main', { id: 'main' });
  renderShell(main);
  main.appendChild(el('h1', {}, title));
}
