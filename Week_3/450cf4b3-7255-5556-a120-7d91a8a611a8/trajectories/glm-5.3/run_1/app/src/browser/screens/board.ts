import { api, state, el, clear, serverClock, durationText, dateKeyKitchen, addDaysKey, longDateFromKey } from '../lib.js';
import { announce } from '../live.js';
import { readKitchen, buildHeader, removeHeader, startClockText } from '../header.js';

// The Board: kitchen date group, hour rail with the cooler strip, the
// isometric floor plan drawn from data, the slab and the ticket or door column.

interface Station {
  id: string; name: string; kind: string; cleanupMinutes: number; col: number; row: number;
  intervals: Array<Record<string, unknown>>;
  occupiedMinutes?: number; bufferMinutes?: number; freeMinutes?: number;
}

interface FloorResponse {
  date: string; from: string | null; to: string | null; now: string;
  spanStatus: 'open' | 'started' | 'beyond_horizon' | null;
  coolerFree: Array<{ time: string; freeShelves: number }>;
  stations: Station[];
}

interface BookingJson {
  id: string; stationId: string; stationName: string; shelfId: string | null; shelfName: string | null;
  start: string; end: string; bufferEnd: string; status: string;
  holdExpiresAt: string | null; packId: string | null; debitedMinutes: number | null;
  refundedMinutes: number | null; cancelReason: string | null; createdAt: string;
  cutoffAt: string; cancelCreditMinutes: number | null; moveCount: number; movable: boolean;
  emails: Array<{ kind: string; status: string; sentAt: string | null }>;
}

interface DoorEntry {
  bookingId: string; tenantId: string; tenantName: string; stationId: string; stationName: string;
  shelfId: string | null; shelfName: string | null; start: string; end: string; status: string;
  cleared: boolean; reason: string | null; checkInOpensAt: string;
  actions: string[]; doorLog: Array<{ action: string; at: string; by: string }>; cleanupNote: string | null;
}

const OPENS = 5 * 60;
const CLOSES = 23 * 60;

let boardZone = 'UTC';
let kitchenHoldSeconds = 90;

export function renderBoard(app: HTMLElement, url: URL): () => void {
  const timers: number[] = [];
  let destroyed = false;

  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    boardZone = kitchen.timeZone;
    kitchenHoldSeconds = kitchen.holdSeconds;

    removeHeader();
    const handle = buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    timers.push(window.setTimeout(() => {}, 0));
    const stopClock = startClockText(handle, boardZone);

    // Date and span, from the URL with the defaults applied.
    let todayKey = kitchen.today;
    let date = url.searchParams.get('date') ?? todayKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      date = todayKey;
    }
    let from = url.searchParams.get('from') ?? '09:00';
    let to = url.searchParams.get('to') ?? '12:00';
    const spanValid = (f: string | null, t: string | null): boolean => {
      const parse = (s: string | null): number | null => {
        const m = /^(\d{2}):(\d{2})$/.exec(s ?? '');
        if (!m) return null;
        const mins = Number(m[1]) * 60 + Number(m[2]);
        if (Number(m[2]) % 30 !== 0) return null;
        if (mins < OPENS || mins > CLOSES) return null;
        return mins;
      };
      if (f === null && t === null) return true;
      if (f === null || t === null) return false;
      const a = parse(f); const b = parse(t);
      if (a === null || b === null) return false;
      return a < b;
    };
    if (!spanValid(url.searchParams.get('from'), url.searchParams.get('to'))) {
      from = '09:00'; to = '12:00';
    }

    const zone = boardZone;
    const root = el('div', { class: 'board' });
    app.appendChild(root);

    const heading = el('h1', { class: 'screen-heading', tabindex: '-1' }, 'Board');
    const dateGroup = el('div', { role: 'group', 'aria-label': 'Kitchen date', class: 'date-group' });
    const dateText = el('span', { class: 'date-text' }, longDateFromKey(date, zone));
    const prevBtn = el('button', { class: 'btn btn-ghost', onclick: () => changeDate(-1) }, 'Previous day');
    const nextBtn = el('button', { class: 'btn btn-ghost', onclick: () => changeDate(1) }, 'Next day');
    const todayBtn = el('button', { class: 'btn btn-ghost', onclick: () => {
      todayKey = dateKeyKitchen(serverClock.now(), zone);
      setDate(todayKey);
    } }, 'Today');
    dateGroup.append(prevBtn, nextBtn, todayBtn, dateText);

    // ---- hour rail ----
    const rail = el('div', { role: 'group', 'aria-label': 'Hour rail', class: 'hour-rail' });
    const sliderStart = slider('Span start', from);
    const sliderEnd = slider('Span end', to);
    const numerals = el('div', { class: 'rail-numerals' });
    for (let h = 5; h <= 23; h++) {
      numerals.appendChild(el('span', { class: 'rail-numeral' }, `${String(h).padStart(2, '0')}`));
    }
    const coolerStrip = el('div', { class: 'cooler-strip', 'aria-label': 'Cooler strip' });
    const shelvesLine = el('span', { class: 'shelves-free-line' }, 'Cooler: — of 3 shelves free all span');
    rail.append(sliderStart.input, sliderEnd.input, numerals, coolerStrip, shelvesLine);

    // ---- floor plan ----
    const floorRegion = el('div', { role: 'region', 'aria-label': 'Floor plan', class: 'floor-plan' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'floor-svg');
    floorRegion.appendChild(svg);

    // ---- ticket column ----
    const ticketsRegion = el('div', { role: 'region', 'aria-label': state.me!.role === 'tenant' ? 'Your tickets' : 'Door list', class: 'ticket-column' });
    const layout = el('div', { class: 'board-layout' },
      el('div', { class: 'board-main' }, floorRegion, rail),
      ticketsRegion,
    );
    root.append(heading, dateGroup, layout);

    const cleanup = () => {
      destroyed = true;
      stopClock();
      for (const t of timers) clearInterval(t);
      removeHeader();
    };

    // Slab and ticket state for tenants.
    const isTenant = state.me!.role === 'tenant';
    let lifted = false;
    let moveLifted: string | null = null;
    let dropTargetId: string | null = null;
    let refusalCopy: { kind: 'slab' | 'move' | 'dialog'; text: string; bookingId?: string } | null = null;
    let spanHint: string | null = null;
    let justTaken: Map<string, number> = new Map();
    let listedCards: BookingJson[] | null = null;
    let floorData: FloorResponse | null = null;
    let pendingClaim = false;
    let pendingConfirm: Set<string> = new Set();
    let pendingCancel: Set<string> = new Set();
    let pendingDoor: Set<string> = new Set();
    let dialogShelf: string = '';
    let confirmNetworkFailed: Set<string> = new Set();

    const stations = (): Station[] => floorData?.stations ?? [];
    const stationName = (id: string): string => stations().find((s) => s.id === id)?.name ?? id;
    const spanMinutes = (): number => (hhmmToMin(to) - hhmmToMin(from));
    const stationLabel = (s: Station): string => {
      if (justTaken.has(s.id)) return 'just taken';
      if (floorData?.from === null || floorData?.to === null) return s.name;
      const free = s.freeMinutes ?? 0;
      if (free <= 0) return 'full';
      return `${durationText(free)} free of ${durationText(spanMinutes())}`;
    };

    // Extrusion rounded to the nearest whole pixel, an exact half rounded up.
    function extrusion(s: Station): number {
      const span = spanMinutes();
      if (span <= 0) return 0;
      const ratio = (s.occupiedMinutes ?? 0) / span;
      const raw = ratio * 96;
      return Math.floor(raw + 0.5);
    }

    function drawFloor(): void {
      const list = stations();
      const cols = Math.max(...list.map((s) => s.col)) + 1;
      const rows = list.length ? Math.max(...list.map((s) => s.row)) + 1 : 1;
      const unit = 64;
      const tileW = unit * 1.1;
      const tileH = unit * 0.55;
      const width = (cols + 2) * tileW + 160;
      const height = (rows + 2) * tileH + 200;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', '100%');
      clear(svg);

      const pos = (s: Station) => ({
        x: 80 + s.col * tileW + s.row * tileW * 0.35,
        y: 60 + s.row * (tileH + 34),
      });

      // The cooler outline groups the shelf row.
      const shelfRow = Math.max(...list.filter((s) => s.kind === 'cooler_shelf').map((s) => s.row), 2);
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      outline.setAttribute('x', '40');
      outline.setAttribute('y', String(40 + shelfRow * (tileH + 34) - 20));
      outline.setAttribute('width', String(width - 80));
      outline.setAttribute('height', String(tileH + 60));
      outline.setAttribute('class', 'cooler-outline');
      svg.appendChild(outline);

      const fragment = document.createDocumentFragment();
      for (const s of list) {
        const { x, y } = pos(s);
        const h = extrusion(s);
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', `station-block kind-${s.kind}${dropTargetId === s.id ? ' drop-target' : ''}`);
        group.dataset.stationId = s.id;
        group.dataset.state = dataStateOf(s);
        group.dataset.extrusion = String(h);

        const top = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        top.setAttribute('points', `${x},${y} ${x + tileW},${y - tileH} ${x + tileW + tileW},${y} ${x + tileW},${y + tileH}`);
        const left = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        left.setAttribute('points', `${x},${y} ${x + tileW},${y + tileH} ${x + tileW},${y + tileH + h} ${x},${y + h}`);
        const right = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        right.setAttribute('points', `${x + tileW},${y + tileH} ${x + tileW + tileW},${y} ${x + tileW + tileW},${y + h} ${x + tileW},${y + tileH + h}`);
        top.classList.add('face-top');
        left.classList.add('face-left');
        right.classList.add('face-right');

        // Cleanup band on the top face.
        const bufferShare = (s.bufferMinutes ?? 0) / Math.max(1, s.occupiedMinutes ?? 1);
        if (h > 4 && bufferShare > 0) {
          const band = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          band.setAttribute('points', `${x},${y + h * (1 - bufferShare)} ${x + tileW},${y + tileH + h * (1 - bufferShare)} ${x + tileW * 2},${y + h * (1 - bufferShare)} ${x + tileW},${y + tileH + h * (1 - bufferShare) - tileH}`);
          band.classList.add('cleanup-band');
          group.appendChild(band);
        }
        if ((s.freeMinutes ?? 1) <= 0) {
          const hatch = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          hatch.setAttribute('points', top.getAttribute('points') ?? '');
          hatch.classList.add('hatch');
          group.appendChild(hatch);
        }
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(x + tileW));
        label.setAttribute('y', String(y + tileH + h + 18));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = `${s.name} · ${stationLabel(s)}`;
        label.classList.add('station-label');
        group.append(top, left, right, label);
        fragment.appendChild(group);
      }
      svg.appendChild(fragment);

      // Station buttons overlay, one per station for accessibility.
      for (const old of [...floorRegion.querySelectorAll('button.station-hook')]) old.remove();
      for (const s of list) {
        const { x, y } = pos(s);
        const btn = el('button', {
          class: 'station-hook',
          'data-station-id': s.id,
          'data-state': dataStateOf(s),
          'data-extrusion': String(extrusion(s)),
          ...(dropTargetId === s.id ? { 'data-drop-target': 'true' } : {}),
          style: `left:${x}px;top:${y}px;width:${tileW * 2}px;height:${tileH * 2}px`,
          onclick: () => openStationDialog(s.id),
        }, `${s.name}, ${stationLabel(s)}`);
        floorRegion.appendChild(btn);
      }
    }

    function dataStateOf(s: Station): string {
      const free = s.freeMinutes ?? 0;
      if (free <= 0) return 'full';
      if (free >= spanMinutes()) return 'free';
      return 'partial';
    }

    function drawCoolerStrip(): void {
      clear(coolerStrip);
      const rows = floorData?.coolerFree ?? [];
      for (const row of rows) {
        const cell = el('div', {
          class: 'cooler-cell',
          'data-cooler-free': String(row.freeShelves),
          'data-cooler-time': row.time,
        });
        for (let i = 0; i < row.freeShelves; i++) {
          cell.appendChild(el('span', { class: 'cooler-tick' }));
        }
        if (row.freeShelves === 0) cell.classList.add('cooler-none');
        coolerStrip.appendChild(cell);
      }
      const total = 3;
      const allFree = rows.filter((r) => r.freeShelves === total).length;
      const spanMins = spanMinutes();
      const freeAll = (floorData?.coolerFree ?? []).filter((r) => {
        const t = hhmmToMin(r.time);
        return t >= hhmmToMin(from) && t + 30 <= hhmmToMin(to) && r.freeShelves === total;
      });
      const n = spanMins > 0 ? freeAll.length : allFree;
      void n;
      const count = (floorData?.coolerFree ?? []).filter((r) => r.freeShelves === total).length;
      void count;
      const shelvesTotal = total;
      const freeFull = new Set((floorData?.coolerFree ?? []).filter((r) => r.freeShelves === shelvesTotal).map((r) => r.time));
      const spanTimes = new Set<string>();
      for (let m = hhmmToMin(from); m < hhmmToMin(to); m += 30) {
        spanTimes.add(minToHhmm(m));
      }
      let freeCount = 0;
      for (const t of spanTimes) if (freeFull.has(t)) freeCount++;
      shelvesLine.textContent = `Cooler: ${freeCount} of ${shelvesTotal} shelves free all span`;
    }

    function spanHintText(): string | null {
      if (spanMinutes() < (kitchen?.minimumBookingMinutes ?? 120)) return 'Pick a span of at least 2 h';
      if (floorData?.spanStatus === 'started') return 'That span has already started. Pick a later span.';
      if (floorData?.spanStatus === 'beyond_horizon') return 'Bookings open up to 60 days ahead. Pick an earlier date.';
      return null;
    }

    // ---- data loading ----
    async function loadFloor(): Promise<void> {
      const params = new URLSearchParams({ date, from, to });
      const r = await api('GET', `/api/floor?${params}`);
      if (destroyed) return;
      if (r.sentUnder !== state.sessionId) return;
      if (r.status !== 200 || !r.ok) return;
      const data = r.ok as FloorResponse;
      if (data.date !== date || data.from !== from || data.to !== to) return;
      serverClock.update(data.now);
      floorData = data;
      spanHint = spanHintText();
      drawFloor();
      drawCoolerStrip();
      updateSpanUi();
      if (isTenant) {
        await loadTickets();
      } else {
        await loadDoor();
      }
    }

    // ---- tenant tickets ----
    const ticketsWrap = el('div', { class: 'tickets' });
    ticketsRegion.appendChild(ticketsWrap);

    async function loadTickets(): Promise<void> {
      const r = await api('GET', `/api/bookings?date=${date}`);
      if (destroyed || r.status !== 200 || !r.ok) return;
      if (r.sentUnder !== state.sessionId) return;
      const data = r.ok as { bookings: BookingJson[] };
      const fresh = data.bookings.filter((b) => b.status === 'held' || b.status === 'confirmed' || b.movable || dateKeyOf(b.start) >= date);
      if (listedCards === null) {
        listedCards = fresh;
      } else {
        // Cards already in the column stay; new ones join; expired holds leave at the next reload.
        const byId = new Map(listedCards!.map((b) => [b.id, b]));
        for (const b of fresh) if (!byId.has(b.id)) byId.set(b.id, b);
        for (const [id, b] of byId) {
          const freshB = fresh.find((x) => x.id === id);
          if (freshB) byId.set(id, { ...b, ...freshB });
        }
        const hasExpiredHold = byId.get('');
        void hasExpiredHold;
        listedCards = [...byId.values()]
          .filter((b) => {
            const freshB = fresh.find((x) => x.id === b.id);
            if (freshB) return true;
            // A card whose hold ran out leaves at the next floor reload.
            return !(b.status === 'cancelled' && b.cancelReason === 'hold_expired');
          })
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      }
      drawTickets();
    }

    function drawTickets(): void {
      clear(ticketsWrap);
      const slab = buildSlab();
      ticketsWrap.appendChild(slab);
      if (spanHint) {
        slab.appendChild(el('p', { class: 'span-hint' }, spanHint));
      }
      if (refusalCopy && refusalCopy.kind === 'slab') {
        slab.appendChild(el('p', { class: 'refusal-copy' }, refusalCopy.text));
      }
      for (const b of listedCards ?? []) {
        ticketsWrap.appendChild(ticketCard(b));
      }
    }

    function buildSlab(): HTMLElement {
      const duration = durationText(spanMinutes());
      const btn = el('button', {
        class: 'slab',
        'aria-pressed': lifted ? 'true' : 'false',
        ...(spanHint ? { 'aria-disabled': 'true' } : {}),
      }, `Slab ${from}–${to}`, el('span', { class: 'slab-duration' }, duration)) as HTMLButtonElement;
      if (spanHint) {
        btn.setAttribute('aria-disabled', 'true');
        btn.addEventListener('click', (e) => e.preventDefault());
      } else {
        btn.addEventListener('click', () => liftSlab());
        btn.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!lifted) liftSlab();
          } else if (lifted) {
            handleArrowKeys(e);
          }
        });
        attachDrag(btn, () => {}, () => {}, (targetId) => {
          if (targetId) void sendClaim(targetId, null);
        });
      }
      return btn;
    }

    function liftSlab(): void {
      lifted = true;
      announce('Slab lifted. Arrow keys pick a station, Enter claims, Escape puts it back.');
      const free = stations().find((s) => dataStateOf(s) === 'free') ?? stations()[0];
      dropTargetId = free?.id ?? null;
      drawFloor();
      drawTickets();
    }

    function returnSlab(copy: string | null): void {
      lifted = false;
      dropTargetId = null;
      drawFloor();
      if (copy) announce(copy);
      drawTickets();
    }

    function handleArrowKeys(e: KeyboardEvent): void {
      const list = stations();
      const idx = list.findIndex((s) => s.id === dropTargetId);
      if (idx === -1) return;
      const current = list[idx];
      let target: Station | null = null;
      if (e.key === 'ArrowRight') target = list.find((s) => s.row === current.row && s.col === current.col + 1) ?? null;
      if (e.key === 'ArrowLeft') target = list.find((s) => s.row === current.row && s.col === current.col - 1) ?? null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const rows = list.filter((s) => s.row === current.row + (e.key === 'ArrowDown' ? 1 : -1));
        if (rows.length) {
          let best = rows[0];
          let bestDist = Math.abs(rows[0].col - current.col);
          for (const cand of rows) {
            const dist = Math.abs(cand.col - current.col);
            if (dist < bestDist || (dist === bestDist && cand.col < best.col)) { best = cand; bestDist = dist; }
          }
          target = best;
        }
      }
      if (e.key === 'Escape') {
        returnSlab('Slab returned. Nothing claimed.');
        return;
      }
      if (target) {
        e.preventDefault();
        dropTargetId = target.id;
        announce(`${target.name}: ${stationLabel(target)}`);
        drawFloor();
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (dropTargetId) void sendClaim(dropTargetId, null);
      }
    }

    async function sendClaim(stationId: string, shelfId: string | null, dialogBtn?: HTMLElement): Promise<void> {
      if (spanHint || pendingClaim) return;
      pendingClaim = true;
      const stationsText = shelfId ? `${stationName(stationId)} and ${stationName(shelfId)}` : stationName(stationId);
      const startEpoch = zoneEpoch(date, hhmmToMin(from));
      const endEpoch = zoneEpoch(date, hhmmToMin(to));
      const key = `claim-${state.me!.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const r = await api('POST', '/api/bookings', {
        body: { stationId, start: iso(startEpoch), end: iso(endEpoch), shelfId },
        idempotencyKey: key,
      });
      pendingClaim = false;
      if (r.sentUnder !== state.sessionId) return;
      if (destroyed) return;
      if (r.status === 201 && r.ok) {
        refusalCopy = null;
        lifted = false;
        dropTargetId = null;
        await loadFloor();
        await loadTickets();
        const booking = r.ok as BookingJson;
        announce(`Held ${stationsText} ${from}–${to}. Confirm within ${holdSecondsLeft(booking)} seconds.`);
        const card = ticketsWrap.querySelector(`[data-booking-id="${booking.id}"]`) as HTMLElement | null;
        if (card) card.focus();
        return;
      }
      const fail = r.fail;
      if (fail && fail.status === 409 && fail.body?.error === 'slot_taken') {
        justTaken.set(stationId, Date.now());
        if (shelfId) justTaken.set(shelfId, Date.now());
        announce(fail.body.message);
        lifted = false;
        dropTargetId = null;
        await loadFloor();
        drawTickets();
        const btn = floorRegion.querySelector(`[data-station-id="${stationId}"]`) as HTMLElement | null;
        if (btn) btn.focus();
        return;
      }
      if (fail) {
        refusalCopy = { kind: dialogBtn ? 'dialog' : 'slab', text: fail.body?.message ?? "Couldn't reach the kitchen. Nothing was booked; try again." };
        lifted = false;
        dropTargetId = null;
        announce(refusalCopy.text);
        drawTickets();
        if (dialogBtn) dialogBtn.focus();
        else {
          const slabBtn = ticketsWrap.querySelector('.slab') as HTMLElement | null;
          slabBtn?.focus();
        }
      }
    }

    // ---- station dialog ----
    const dialogHost = el('div', { class: 'dialog-host' });
    app.appendChild(dialogHost);

    function openStationDialog(stationId: string): void {
      dialogShelf = '';
      const station = stations().find((s) => s.id === stationId);
      if (!station) return;
      const dialog = el('div', { role: 'dialog', 'aria-label': station.name, class: 'modal' });
      const list = el('ul', { 'aria-label': 'Bookings in span', class: 'dialog-bookings' });
      for (const interval of station.intervals as Array<Record<string, string | boolean>>) {
        const startH = hhmmIso(String(interval.start));
        const endH = hhmmIso(String(interval.end));
        const bufferH = hhmmIso(String(interval.bufferEnd));
        list.appendChild(el('li', {}, `Booked ${startH}–${endH}`, interval.mine === true ? ' Yours' : ''));
        list.appendChild(el('li', { class: 'cleanup-row' }, `Cleanup ${endH}–${bufferH}`));
      }
      if ((station.intervals ?? []).length === 0) {
        list.appendChild(el('li', { class: 'empty-row' }, 'No bookings in span'));
      }
      dialog.appendChild(list);

      let shelfSelect: HTMLSelectElement | null = null;
      let claimBtn: HTMLButtonElement | null = null;
      const stationKind = station.kind;
      const stationLabelName = station.name;
      if (isTenant && stationKind !== 'cooler_shelf') {
        shelfSelect = el('select', { 'aria-label': 'Walk-in shelf', class: 'shelf-select' }) as HTMLSelectElement;
        shelfSelect.appendChild(el('option', { value: '' }, 'No shelf'));
        const shelves = stations().filter((s) => s.kind === 'cooler_shelf');
        for (const shelf of shelves) {
          const free = shelf.freeMinutes ?? 0;
          const option = el('option', { value: shelf.id, ...(free < spanMinutes() ? { disabled: '' } : {}) },
            `${shelf.name}, ${stationLabel(shelf)}`) as HTMLOptionElement;
          shelfSelect.appendChild(option);
        }
        shelfSelect.addEventListener('change', () => {
          dialogShelf = shelfSelect!.value;
          updateClaimButton();
        });
        dialog.appendChild(el('label', {}, 'Walk-in shelf')).appendChild(shelfSelect);
        dialog.appendChild(shelfSelect);
      }
      if (isTenant) {
        claimBtn = el('button', { class: 'btn btn-primary dialog-claim' }, claimButtonLabel()) as HTMLButtonElement;
        claimBtn.addEventListener('click', () => {
          void sendClaim(stationId, dialogShelf || null, claimBtn ?? undefined);
        });
        dialog.appendChild(claimBtn);
        if (spanHint) dialog.appendChild(el('p', { class: 'span-hint' }, spanHint));
      }
      const closeBtn = el('button', { class: 'btn btn-ghost' }, 'Close');
      closeBtn.addEventListener('click', () => closeStationDialog(stationId));
      dialog.appendChild(closeBtn);
      clear(dialogHost);
      dialogHost.appendChild(dialog);
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeStationDialog(stationId); }
      });
      const firstBtn = dialog.querySelector('button');
      (firstBtn as HTMLElement | null)?.focus();

      function updateClaimButton(): void {
        if (!claimBtn) return;
        claimBtn.textContent = '';
        claimBtn.append(claimButtonLabel());
        if (spanHint) claimBtn.setAttribute('aria-disabled', 'true');
      }
      function claimButtonLabel(): string {
        const name = stationLabelName;
        if (dialogShelf) {
          const shelf = stations().find((s) => s.id === dialogShelf);
          return `Claim ${name} and ${shelf?.name ?? ''} ${from}–${to}`;
        }
        return `Claim ${name} ${from}–${to}`;
      }
    }

    function closeStationDialog(stationId: string): void {
      clear(dialogHost);
      const btn = floorRegion.querySelector(`[data-station-id="${stationId}"]`) as HTMLElement | null;
      btn?.focus();
    }

    // ---- ticket cards ----
    function ticketCard(b: BookingJson): HTMLElement {
      const statusText = ticketStatusText(b);
      const card = el('article', {
        class: `ticket-card status-${b.status}`,
        'data-booking-id': b.id,
        tabindex: '0',
      }) as HTMLElement;
      card.setAttribute('aria-label', `${b.stationName} ${dateKeyOf(b.start)} ${hhmmIso(b.start)}–${hhmmIso(b.end)}`);
      card.append(el('p', { class: 'ticket-status' }, statusText));
      if (b.shelfName) card.append(el('p', { class: 'ticket-shelf' }, `+ ${b.shelfName}`));
      if (b.status === 'confirmed') {
        card.append(el('p', { class: 'cancel-line' }, cancelLineText(b)));
      }
      if (refusalCopy && refusalCopy.kind === 'move' && refusalCopy.bookingId === b.id) {
        card.append(el('p', { class: 'refusal-copy' }, refusalCopy.text));
      }
      const buttons = el('div', { class: 'ticket-buttons' });
      if (b.status === 'held' && holdSecondsLeft(b) > 0) {
        const confirmBtn = el('button', { class: 'btn btn-primary' }, 'Confirm booking');
        confirmBtn.addEventListener('click', async () => {
          if (pendingConfirm.has(b.id)) return;
          pendingConfirm.add(b.id);
          confirmBtn.setAttribute('aria-disabled', 'true');
          drawTickets();
          const r = await api('POST', `/api/bookings/${b.id}/confirm`);
          pendingConfirm.delete(b.id);
          if (r.sentUnder !== state.sessionId || destroyed) return;
          if (r.status === 200) {
            confirmNetworkFailed.delete(b.id);
            announce(`Booked ${b.stationName}${b.shelfName ? ` and ${b.shelfName}` : ''} ${longDateFromKey(dateKeyOf((r.ok as BookingJson).start), zone)} ${hhmmIso((r.ok as BookingJson).start)}–${hhmmIso((r.ok as BookingJson).end)}. ${durationText((r.ok as BookingJson).debitedMinutes ?? 0)} debited; confirmation email on its way.`);
            await loadFloor();
          } else {
            const fail = r.fail;
            if (fail) announce(fail.body?.message ?? "Couldn't reach the kitchen. Nothing changed; try again.");
            await loadFloor();
          }
          const cardEl = ticketsWrap.querySelector(`[data-booking-id="${b.id}"]`) as HTMLElement | null;
          cardEl?.focus();
        });
        buttons.appendChild(confirmBtn);
      }
      if (b.movable) {
        const moveBtn = el('button', { class: 'btn btn-ghost', 'aria-pressed': moveLifted === b.id ? 'true' : 'false', ...(spanHint ? { 'aria-disabled': 'true' } : {}) }, 'Move booking');
        moveBtn.addEventListener('click', () => liftMove(b.id));
        moveBtn.addEventListener('keydown', (e) => {
          if (moveLifted === b.id) handleArrowKeys(e);
        });
        attachDrag(moveBtn, () => liftMove(b.id), () => {}, (targetId) => {
          if (targetId) void sendMove(b.id, targetId);
        });
        buttons.appendChild(moveBtn);
      }
      if (b.status === 'held' || b.status === 'confirmed') {
        const cancelBtn = el('button', { class: 'btn btn-danger' }, 'Cancel booking');
        cancelBtn.addEventListener('click', () => openCancelStep(b));
        buttons.appendChild(cancelBtn);
      }
      if (b.status !== 'held' && b.status !== 'cancelled') {
        buttons.appendChild(el('a', { href: `/receipt/${b.id}`, class: 'receipt-link' }, 'Receipt'));
      }
      card.appendChild(buttons);
      return card;
    }

    function openCancelStep(b: BookingJson): void {
      const card = ticketsWrap.querySelector(`[data-booking-id="${b.id}"]`) as HTMLElement | null;
      if (!card) return;
      const step = el('div', { role: 'group', 'aria-label': 'Cancel this booking?', class: 'cancel-step' });
      const desc = b.status === 'confirmed'
        ? (b.cancelCreditMinutes && b.cancelCreditMinutes > 0 ? `You'll get ${durationText(b.cancelCreditMinutes)} back.` : 'No hours will be returned.')
        : '';
      step.setAttribute('aria-description', desc);
      const keep = el('button', { class: 'btn btn-ghost' }, 'Keep it');
      const yes = el('button', { class: 'btn btn-danger' }, 'Yes, cancel');
      keep.addEventListener('click', () => { step.remove(); showButtons(card, b); (card.querySelector('.cancel-booking') as HTMLElement)?.focus(); });
      yes.addEventListener('click', async () => {
        if (pendingCancel.has(b.id)) return;
        pendingCancel.add(b.id);
        keep.setAttribute('aria-disabled', 'true');
        yes.setAttribute('aria-disabled', 'true');
        const r = await api('POST', `/api/bookings/${b.id}/cancel`);
        pendingCancel.delete(b.id);
        if (r.sentUnder !== state.sessionId || destroyed) return;
        step.remove();
        if (r.status === 200) {
          const updated = r.ok as BookingJson;
          if (updated.status === 'cancelled' && (updated.refundedMinutes ?? 0) > 0) {
            announce(`Cancelled. ${durationText(updated.refundedMinutes ?? 0)} returned to your pack.`);
          } else if (updated.status === 'cancelled') {
            announce('Hold released.');
          }
        } else {
          announce(r.fail?.body?.message ?? "Couldn't reach the kitchen. Nothing changed; try again.");
        }
        await loadFloor();
        await loadTickets();
        const cardEl = ticketsWrap.querySelector(`[data-booking-id="${b.id}"]`) as HTMLElement | null;
        cardEl?.focus();
      });
      step.append(keep, yes, el('p', { class: 'cancel-desc' }, desc));
      const buttons = card.querySelector('.ticket-buttons');
      if (buttons) { buttons.remove(); }
      card.appendChild(step);
      keep.focus();
    }

    function showButtons(card: HTMLElement, b: BookingJson): void {
      const fresh = ticketCard(b);
      clear(card);
      while (fresh.firstChild) card.appendChild(fresh.firstChild);
    }

    async function sendMove(bookingId: string, targetStationId: string): Promise<void> {
      if (spanHint) return;
      const b = (listedCards ?? []).find((x) => x.id === bookingId);
      if (!b) return;
      const startEpoch = zoneEpoch(date, hhmmToMin(from));
      const endEpoch = zoneEpoch(date, hhmmToMin(to));
      const key = `move-${state.me!.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const r = await api('POST', `/api/bookings/${bookingId}/move`, {
        body: { stationId: targetStationId, start: iso(startEpoch), end: iso(endEpoch), shelfId: b.shelfId },
        idempotencyKey: key,
      });
      if (r.sentUnder !== state.sessionId || destroyed) return;
      moveLifted = null;
      dropTargetId = null;
      if (r.status === 200 && r.ok) {
        refusalCopy = null;
        announce(`Moved to ${(r.ok as BookingJson).stationName} ${longDateFromKey(date, zone)} ${from}–${to}.`);
        await loadFloor();
        await loadTickets();
        const cardEl = ticketsWrap.querySelector(`[data-booking-id="${bookingId}"]`) as HTMLElement | null;
        cardEl?.focus();
        return;
      }
      const fail = r.fail;
      if (fail && fail.status === 409 && fail.body?.error === 'slot_taken') {
        justTaken.set(targetStationId, Date.now());
        announce(fail.body.message);
        await loadFloor();
        const btn = floorRegion.querySelector(`[data-station-id="${targetStationId}"]`) as HTMLElement | null;
        btn?.focus();
        return;
      }
      if (fail) {
        refusalCopy = { kind: 'move', text: fail.body?.message ?? "Couldn't reach the kitchen. Nothing changed; try again.", bookingId };
        announce(refusalCopy.text);
        await loadFloor();
        drawTickets();
        const cardEl = ticketsWrap.querySelector(`[data-booking-id="${bookingId}"]`) as HTMLElement | null;
        cardEl?.focus();
      }
    }

    function liftMove(bookingId: string): void {
      if (spanHint) return;
      moveLifted = bookingId;
      const b = (listedCards ?? []).find((x) => x.id === bookingId);
      announce(`Moving ${b?.stationName ?? ''} ${hhmmIso(b?.start ?? '')}–${hhmmIso(b?.end ?? '')}. Arrow keys pick a station, Enter moves, Escape puts it back.`);
      const free = stations().find((s) => dataStateOf(s) === 'free') ?? stations()[0];
      dropTargetId = free?.id ?? null;
      drawFloor();
      drawTickets();
    }

    // ---- door list for staff ----
    async function loadDoor(): Promise<void> {
      const r = await api('GET', `/api/door?date=${date}`);
      if (destroyed || r.status !== 200 || !r.ok) return;
      if (r.sentUnder !== state.sessionId) return;
      const data = r.ok as { date: string; now: string; entries: DoorEntry[] };
      serverClock.update(data.now);
      drawDoor(data.entries);
    }

    let lastDoorSummaryKey: string | null = null;
    let doorStatuses: Map<string, string> = new Map();

    function drawDoor(entries: DoorEntry[]): void {
      clear(ticketsWrap);
      const summaryKey = date;
      if (lastDoorSummaryKey !== summaryKey) {
        const cleared = entries.filter((e) => e.cleared).length;
        const copy = `Door list for ${longDateFromKey(date, zone)}: ${entries.length === 1 ? '1 booking' : `${entries.length} bookings`}, ${cleared} cleared.`;
        announce(copy);
        lastDoorSummaryKey = summaryKey;
      }
      for (const entry of entries) {
        const previous = doorStatuses.get(entry.bookingId);
        if (previous !== undefined && previous !== entry.status && !pendingDoor.has(entry.bookingId)) {
          announce(`${entry.tenantName} ${entry.stationName} ${hhmmIso(entry.start)}–${hhmmIso(entry.end)}: ${doorStatusText(entry.status)}.`);
        }
        doorStatuses.set(entry.bookingId, entry.status);
        ticketsWrap.appendChild(doorCard(entry));
      }
    }

    function doorCard(entry: DoorEntry): HTMLElement {
      const card = el('article', {
        class: 'door-card',
        tabindex: '0',
        'data-face': 'front',
        'data-booking-id': entry.bookingId,
      });
      card.setAttribute('aria-label', `${entry.tenantName} ${entry.stationName} ${hhmmIso(entry.start)}–${hhmmIso(entry.end)}`);
      card.append(el('p', { class: 'door-status' }, doorStatusText(entry.status)));
      card.append(el('p', { class: 'door-clearance' }, entry.cleared ? 'Cleared' : `Not cleared — ${clearanceText(entry.reason)}`));
      if (entry.shelfName) card.append(el('p', { class: 'ticket-shelf' }, `+ ${entry.shelfName}`));
      for (const log of entry.doorLog) {
        card.append(el('p', { class: 'door-log-line' }, doorLogText(log)));
      }
      if (entry.status === 'confirmed' && Date.parse(entry.checkInOpensAt) > serverClock.now()) {
        card.append(el('p', { class: 'door-opens' }, `Check-in opens ${hhmmIso(entry.checkInOpensAt)}`));
      }
      const buttons = el('div', { class: 'door-buttons' });
      for (const action of entry.actions) {
        const label = action === 'check_in' ? 'Check in' : action === 'check_out' ? 'Check out' : 'Mark no-show';
        const btn = el('button', {
          class: 'btn btn-primary',
          ...(pendingDoor.has(entry.bookingId) ? { 'aria-disabled': 'true' } : {}),
        }, label);
        btn.addEventListener('click', () => void doorAction(entry, action, btn, card));
        buttons.appendChild(btn);
      }
      card.appendChild(buttons);
      return card;
    }

    async function doorAction(entry: DoorEntry, action: string, btn: HTMLElement, card: HTMLElement): Promise<void> {
      if (pendingDoor.has(entry.bookingId)) return;
      pendingDoor.add(entry.bookingId);
      btn.setAttribute('aria-disabled', 'true');
      const r = await api('POST', `/api/bookings/${entry.bookingId}/${action === 'check_in' ? 'check-in' : action === 'check_out' ? 'check-out' : 'no-show'}`,
        action === 'check_out' ? { body: { cleanupDone: true, note: '' } } : {});
      pendingDoor.delete(entry.bookingId);
      if (r.sentUnder !== state.sessionId || destroyed) return;
      if (r.status === 200) {
        const updated = r.ok as BookingJson;
        announce(actionSuccessText(action, entry));
        turnCard(card);
        doorStatuses.set(entry.bookingId, updated.status);
        await loadDoor();
        const cardEl = ticketsWrap.querySelector(`[data-booking-id="${entry.bookingId}"]`) as HTMLElement | null;
        cardEl?.focus();
      } else {
        announce(r.fail?.body?.message ?? "Couldn't reach the kitchen. Nothing changed; try again.");
        await loadDoor();
        const cardEl = ticketsWrap.querySelector(`[data-booking-id="${entry.bookingId}"]`) as HTMLElement | null;
        cardEl?.focus();
      }
    }

    function turnCard(card: HTMLElement): void {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const flip = () => {
        card.setAttribute('data-face', card.getAttribute('data-face') === 'front' ? 'back' : 'front');
      };
      if (reduce) {
        flip();
        return;
      }
      card.animate(
        [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }],
        { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'none' },
      ).addEventListener('finish', flip);
    }

    // ---- span and date plumbing ----
    function updateSpanUi(): void {
      sliderStart.input.value = from;
      sliderEnd.input.value = to;
      sliderStart.input.setAttribute('aria-valuetext', from);
      sliderEnd.input.setAttribute('aria-valuetext', to);
    }

    function setSpan(f: string, t: string, replace: boolean): void {
      from = f; to = t;
      refusalCopy = null;
      rewriteUrl(url, date, from, to, replace);
      spanHint = spanHintText();
      drawTickets();
      void loadFloor();
    }

    function slider(label: string, initial: string): { input: HTMLInputElement } {
      const input = el('input', {
        type: 'range', min: String(OPENS), max: String(CLOSES), step: '30',
        value: String(hhmmToMin(initial)), 'aria-label': label, class: 'rail-slider',
      }) as HTMLInputElement;
      input.addEventListener('keydown', (e) => {
        const value = Number(input.value);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { input.value = String(Math.max(OPENS, value - 30)); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { input.value = String(Math.min(CLOSES, value + 30)); }
        else if (e.key === 'Home') { input.value = String(OPENS); }
        else if (e.key === 'End') { input.value = String(CLOSES); }
        else return;
        e.preventDefault();
        applySlider(label, input);
      });
      input.addEventListener('input', () => applySlider(label, input));
      return { input };
    }

    function applySlider(label: string, input: HTMLInputElement): void {
      const value = Number(input.value);
      // The start always stays at least half an hour before the end.
      if (label === 'Span start') {
        const start = Math.min(value, hhmmToMin(to) - 30);
        setSpan(minToHhmm(start), to, false);
      } else {
        const end = Math.max(value, hhmmToMin(from) + 30);
        setSpan(from, minToHhmm(end), false);
      }
    }

    function setDate(newDate: string): void {
      date = newDate;
      refusalCopy = null;
      listedCards = null;
      justTaken.clear();
      dateText.textContent = longDateFromKey(date, zone);
      rewriteUrl(url, date, from, to, true);
      void loadFloor();
    }

    function changeDate(delta: number): void {
      setDate(addDaysKey(date, zone, delta));
    }

    // ---- rail pointer and touch drag ----
    let dragging = false;
    rail.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList?.contains('rail-slider')) return;
      dragging = true;
      rail.setPointerCapture((e as PointerEvent).pointerId);
    });
    rail.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = numerals.getBoundingClientRect();
      const mins = Math.round((OPENS + ((e as PointerEvent).clientX - rect.left) / rect.width * (CLOSES - OPENS)) / 30) * 30;
      if (dragStart !== null) {
        const end = Math.min(CLOSES, Math.max(OPENS, mins));
        if (end - 60 >= dragStart) {
          setSpan(minToHhmm(dragStart), minToHhmm(end), false);
        }
      }
    });
    rail.addEventListener('pointerup', (e) => {
      dragging = false;
      if (dragStart !== null) return;
      const rect = numerals.getBoundingClientRect();
      const mins = Math.round((OPENS + ((e as PointerEvent).clientX - rect.left) / rect.width * (CLOSES - OPENS)) / 30) * 30;
      const clamped = Math.min(CLOSES, Math.max(OPENS, mins));
      setSpan(minToHhmm(clamped), minToHhmm(Math.min(CLOSES, clamped + 120)), false);
    });
    let dragStart: number | null = null;
    rail.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      const rect = numerals.getBoundingClientRect();
      dragStart = Math.round((OPENS + (t.clientX - rect.left) / rect.width * (CLOSES - OPENS)) / 30) * 30;
      e.preventDefault();
    }, { passive: false });
    rail.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (dragStart === null) return;
      const t = e.touches[0];
      const rect = numerals.getBoundingClientRect();
      const end = Math.min(CLOSES, Math.max(OPENS + 60, Math.round((OPENS + (t.clientX - rect.left) / rect.width * (CLOSES - OPENS)) / 30) * 30));
      setSpan(minToHhmm(dragStart), minToHhmm(end), false);
    }, { passive: false });
    rail.addEventListener('touchend', () => {
      if (dragStart !== null) {
        dragStart = null;
        rewriteUrl(url, date, from, to, true);
      }
    });

    // Pointer drag for the slab and Move booking: dropping on a station claims.
    function attachDrag(handle: HTMLElement, onStart: () => void, onEnd: () => void, onDrop: (stationId: string | null) => void): void {
      let startX = 0; let startY = 0; let active = false; let moved = false;
      handle.addEventListener('pointerdown', (e) => {
        active = true; moved = false;
        startX = (e as PointerEvent).clientX;
        startY = (e as PointerEvent).clientY;
        e.preventDefault();
      });
      handle.addEventListener('pointermove', (e) => {
        if (!active) return;
        const dx = (e as PointerEvent).clientX - startX;
        const dy = (e as PointerEvent).clientY - startY;
        if (!moved && Math.hypot(dx, dy) > 8) {
          moved = true;
          onStart();
        }
      });
      handle.addEventListener('pointerup', (e) => {
        if (!active) return;
        active = false;
        if (moved) {
          const target = document.elementFromPoint((e as PointerEvent).clientX, (e as PointerEvent).clientY) as HTMLElement | null;
          const station = target?.closest('[data-station-id]') as HTMLElement | null;
          onDrop(station?.dataset.stationId ?? null);
          onEnd();
        }
      });
    }

    // ---- timers ----
    timers.push(window.setInterval(() => { void loadFloor(); }, 10_000));
    // The held countdown ticks every second without touching anything else.
    timers.push(window.setInterval(() => {
      for (const b of listedCards ?? []) {
        if (b.status !== 'held' || pendingConfirm.has(b.id)) continue;
        const card = ticketsWrap.querySelector(`[data-booking-id="${b.id}"] .ticket-status`);
        if (card) {
          card.textContent = ticketStatusText(b);
        }
        if (holdSecondsLeft(b) === 0) {
          const confirmBtn = ticketsWrap.querySelector(`[data-booking-id="${b.id}"] .ticket-buttons .btn-primary`);
          confirmBtn?.remove();
          const statusEl = ticketsWrap.querySelector(`[data-booking-id="${b.id}"] .ticket-status`);
          if (statusEl) statusEl.textContent = 'Hold expired';
        }
      }
    }, 1000));
    timers.push(window.setInterval(() => {
      for (const [id, at] of justTaken) {
        if (Date.now() - at > 5000) justTaken.delete(id);
      }
    }, 1000));

    // initial load
    await loadFloor();
    if (isTenant) {
      await loadTickets();
    }
    heading.focus();

    return cleanup;
  };

  const bootPromise = boot();
  void bootPromise;
  return () => { destroyed = true; };
}

// ---- shared formatting helpers ----

function hhmmToMin(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function minToHhmm(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: boardZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
}

function hhmmIso(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: boardZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function iso(epoch: number): string {
  const d = new Date(epoch);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// The epoch of a kitchen-local wall-clock time, resolved through the kitchen's
// zone so daylight-saving changes land on the right instant.
function zoneEpoch(dateKey: string, minutes: number): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const naive = Date.UTC(y, m - 1, d, h, mm, 0);
  let guess = naive - zoneOffsetMinutes(naive) * 60_000;
  guess = naive - zoneOffsetMinutes(guess) * 60_000;
  return guess;
}

function zoneOffsetMinutes(epoch: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: boardZone, timeZoneName: 'longOffset' }).formatToParts(new Date(epoch));
  const text = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const m = /^(?:GMT)?([+-])(\d{1,2}):?(\d{2})?$/.exec(text);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
}

function holdSecondsLeft(b: { holdExpiresAt: string | null }): number {
  if (!b.holdExpiresAt) return 0;
  const left = Math.ceil((Date.parse(b.holdExpiresAt) - serverClock.now()) / 1000);
  return Math.max(0, Math.min(left, kitchenHoldSeconds));
}

function ticketStatusText(b: BookingJson): string {
  if (b.status === 'held') return `Held · ${holdSecondsLeft(b)} s left`;
  if (b.status === 'confirmed') return 'Confirmed';
  if (b.status === 'checked_in') return 'Checked in';
  if (b.status === 'completed') return 'Completed';
  if (b.status === 'cancelled') return b.cancelReason === 'hold_expired' ? 'Hold expired' : 'Cancelled';
  if (b.status === 'no_show') return 'No-show';
  return b.status;
}

function cancelLineText(b: BookingJson): string {
  if ((b.cancelCreditMinutes ?? 0) > 0) {
    return `Free cancellation until ${longDateFromKey(dateKeyOf(b.cutoffAt), boardZone)} ${hhmmIso(b.cutoffAt)}`;
  }
  return 'Past cutoff — cancelling returns no hours';
}

function doorStatusText(status: string): string {
  if (status === 'held') return 'Held';
  if (status === 'confirmed') return 'Booked';
  if (status === 'checked_in') return 'Checked in';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'no_show') return 'No-show';
  return status;
}

function clearanceText(reason: string | null): string {
  if (reason === 'not_approved') return 'not approved yet';
  if (reason === 'insurance_lapsed') return 'certificate of insurance lapsed';
  if (reason === 'food_handler_lapsed') return 'food-handler card lapsed';
  return '';
}

function doorLogText(log: { action: string; at: string; by: string }): string {
  const time = hhmmIso(log.at);
  if (log.action === 'check_in') return `In ${time} · ${log.by}`;
  if (log.action === 'check_out') return `Out ${time} · ${log.by} · cleaned`;
  return `No-show ${time} · ${log.by}`;
}

function actionSuccessText(action: string, entry: DoorEntry): string {
  if (action === 'check_in') return `${entry.tenantName} checked in at ${entry.stationName}.`;
  if (action === 'check_out') return 'Checked out. Cleanup logged.';
  return 'Marked no-show.';
}

function rewriteUrl(url: URL, date: string, from: string, to: string, push: boolean): void {
  const next = new URL(url.pathname, location.origin);
  next.searchParams.set('date', date);
  next.searchParams.set('from', from);
  next.searchParams.set('to', to);
  if (push) history.pushState(null, '', next.toString());
  else history.replaceState(null, '', next.toString());
}
