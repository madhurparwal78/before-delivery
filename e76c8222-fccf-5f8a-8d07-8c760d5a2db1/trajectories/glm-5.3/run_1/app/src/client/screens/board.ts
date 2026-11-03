// The dispatch board: interpreter rail, request cards with gate pips,
// the match thread, and the detail pane.
import { api, isFailure } from '../lib/api.js';
import { h, clear, statusRegion, reducedMotion } from '../lib/dom.js';
import { copy, statusLabel } from '../lib/copy.js';
import { cardDate, headingDate, agencyTime, agencyStamp } from '../lib/time.js';
import type { BoardData, RequestView, GateResult } from '../lib/types.js';

interface GateState {
  status: 'unchecked' | 'pending' | 'resolved';
  results: GateResult[] | null;
}

interface CardState {
  request: RequestView;
  gates: GateState;
  inline: string | null;
}

const DRY_RUN_TIMEOUT = 5000;

let boardPlayedLoad = false;

export function renderBoard(signal: AbortSignal): HTMLElement {
  const data: { interpreters: BoardData['interpreters']; requests: RequestView[] } = { interpreters: [], requests: [] };
  const cards = new Map<string, CardState>();
  const claimedBefore = new Map<string, number>();
  let selectedId: string | null = null;
  let pickedInterpreter: { id: string; name: string; chipEl: HTMLElement } | null = null;
  let dryRunSeq = 0;

  const gateResultsStatus = statusRegion('Gate results');

  // ----- layout -----

  const skip = h('a', { href: '#requests-region', class: 'skip-link' }, 'Skip to requests');

  const railHeading = h('h2', { class: 'rail-heading', style: 'font-size:1.2rem' }, 'Interpreters');
  const railList = h('ul', { 'aria-label': 'Interpreters', role: 'list', style: 'list-style:none;padding:0;margin:8px 0' });
  const rail = h('aside', { class: 'board-rail', 'aria-label': 'Interpreter rail' }, railHeading, railList);

  const centreRegion = h('section', { class: 'board-centre', id: 'requests-region', role: 'region', 'aria-label': 'Requests, next 72 hours' });
  const detail = h('section', { class: 'board-detail', role: 'region', 'aria-label': 'Request detail' });

  const requestsPanel = h('div', { class: 'panel' });
  const detailPanel = h('div', { class: 'panel' });
  requestsPanel.appendChild(centreRegion);
  detailPanel.appendChild(detail);

  const tabRequests = h('button', { role: 'tab', 'aria-selected': 'true', id: 'tab-requests', onclick: () => switchTab('requests') }, 'Requests');
  const tabDetail = h('button', { role: 'tab', 'aria-selected': 'false', id: 'tab-detail', onclick: () => switchTab('detail') }, 'Detail');
  const tabBar = h('div', { class: 'tab-bar', role: 'tablist', 'aria-label': 'Board views' }, tabRequests, tabDetail);

  function switchTab(which: 'requests' | 'detail'): void {
    tabRequests.setAttribute('aria-selected', String(which === 'requests'));
    tabDetail.setAttribute('aria-selected', String(which === 'detail'));
    requestsPanel.hidden = which !== 'requests';
    detailPanel.hidden = which !== 'detail';
    if (!reducedMotion() && !requestsPanel.hidden) {
      requestsPanel.classList.remove('fade-in');
      void requestsPanel.offsetWidth;
      requestsPanel.classList.add('fade-in');
    }
  }
  requestsPanel.hidden = false;
  detailPanel.hidden = window.innerWidth < 900;

  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const target = e.key === 'ArrowRight' ? tabDetail : tabRequests;
    target.focus();
    switchTab(target === tabRequests ? 'requests' : 'detail');
  });

  const boardShell = h('div', { class: 'board-shell' }, rail, requestsPanel, detailPanel);
  const boardStatus = statusRegion('Board status');
  const root = h('div', { class: 'board-wrap' }, skip, tabBar, boardShell, boardStatus.el, gateResultsStatus.el);

  // ----- thread canvas -----

  const canvasHost = h('div', { class: 'thread-canvas', 'aria-hidden': 'true' });
  const canvas = document.createElement('canvas');
  canvas.className = 'thread-canvas-inner';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvasHost.appendChild(canvas);
  document.body.appendChild(canvasHost);

  let thread: { fromX: number; fromY: number; toX: number; toY: number } | null = null;
  let threadPhase: 'held' | 'recoil' | null = null;
  let threadImage: HTMLElement | null = null;

  function ensureThreadImage(): void {
    if (threadImage || reducedMotion()) return;
    const img = h('img', { class: 'toast-status', src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', alt: 'Match thread', role: 'img' });
    document.body.appendChild(img);
    threadImage = img;
  }
  function removeThreadImage(): void {
    threadImage?.remove();
    threadImage = null;
  }

  function drawThread(): void {
    if (!thread) { canvasHost.style.display = 'none'; return; }
    canvasHost.style.display = 'block';
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, hgt = window.innerHeight;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.strokeStyle = '#221c14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (reducedMotion() || threadPhase === 'recoil') {
      ctx.moveTo(thread.fromX, thread.fromY);
      ctx.lineTo(thread.toX, thread.toY);
    } else {
      const midX = (thread.fromX + thread.toX) / 2;
      const midY = (thread.fromY + thread.toY) / 2 - 40;
      ctx.moveTo(thread.fromX, thread.fromY);
      ctx.quadraticCurveTo(midX, midY, thread.toX, thread.toY);
    }
    ctx.stroke();
  }

  let recoilDone: (() => void) | null = null;

  function animateThread(): void {
    drawThread();
    if (threadPhase === 'recoil' && !reducedMotion()) {
      // Spring back along the path, then remove.
      const start = performance.now();
      const fx = thread!.fromX, fy = thread!.fromY;
      const tx = thread!.toX, ty = thread!.toY;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 420);
        const e = 1 - Math.pow(1 - t, 3);
        thread = {
          fromX: fx, fromY: fy,
          toX: tx + (fx - tx) * e,
          toY: ty + (fy - ty) * e,
        };
        drawThread();
        if (t < 1) requestAnimationFrame(step);
        else { thread = null; threadPhase = null; drawThread(); removeThreadImage(); recoilDone?.(); recoilDone = null; }
      };
      requestAnimationFrame(step);
    } else if (threadPhase === 'recoil') {
      thread = null; threadPhase = null; drawThread(); removeThreadImage(); recoilDone?.(); recoilDone = null;
    } else {
      requestAnimationFrame(animateThread);
    }
  }

  function startRecoil(onDone?: () => void): void {
    if (!thread) { onDone?.(); return; }
    recoilDone = onDone ?? null;
    threadPhase = 'recoil';
    animateThread();
  }

  function setThreadTarget(x: number, y: number): void {
    if (thread) { thread.toX = x; thread.toY = y; }
  }

  // ----- rendering -----

  function pipRow(request: RequestView, card: CardState): HTMLElement {
    const list = h('ul', { class: 'pip-row', 'aria-label': `Gates for ${request.ref}`, role: 'list' });
    const labels = ['Credential', 'Valid on date', 'Schedule', 'Consumer'];
    const states = card.gates.status === 'resolved' && card.gates.results
      ? card.gates.results.map((g) => (g.pass ? 'pass' : 'fail'))
      : ['unchecked', 'unchecked', 'unchecked', 'unchecked'];
    const resolvedAll = card.gates.status === 'resolved';
    labels.forEach((label, i) => {
      const state = states[i]!;
      const item = h('li', {
        class: `pip ${resolvedAll ? state : ''}`,
        'aria-label': `${label}: ${resolvedAll ? state : 'unchecked'}`,
      });
      const mark = resolvedAll ? (state === 'pass' ? '✓' : '✕') : '○';
      item.appendChild(h('span', { class: 'mark', 'aria-hidden': 'true' }, mark));
      item.appendChild(h('span', {}, label));
      if (resolvedAll && state === 'fail') {
        // Stagger: each pip settles a tenth of a second after the one to its left.
        const delay = i * 100;
        item.style.opacity = '0';
        setTimeout(() => { item.style.transition = 'opacity 80ms ease-out'; item.style.opacity = '1'; }, reducedMotion() ? 0 : delay);
      }
      list.appendChild(item);
    });
    return list;
  }

  function counterEl(request: RequestView): HTMLElement {
    return h('span', { class: 'counter', 'aria-label': `${request.seats_claimed} of ${request.seats_total} seats claimed` },
      h('span', { class: 'digit' }, `${request.seats_claimed}`), '/', h('span', { class: 'digit' }, `${request.seats_total}`));
  }

  function seatSockets(request: RequestView): HTMLElement {
    const row = h('div', { class: 'seat-row' });
    request.seats.forEach((seat, i) => {
      const label = `Seat ${i + 1} of ${request.seats_total} for ${request.ref}`;
      const socket = h('button', {
        class: `seat-socket ${seat.status === 'accepted' ? 'filled' : seat.status === 'offered' ? 'offered' : ''}`,
        'aria-label': label,
        'data-seat': seat.id,
        onclick: (e: Event) => { e.stopPropagation(); selectRequest(request.id, true); },
      }, seat.interpreter ? `${i + 1}· ${seat.interpreter.name}` : `${i + 1}· open`);
      row.appendChild(socket);
    });
    row.appendChild(counterEl(request));
    return row;
  }

  function renderCard(card: CardState): HTMLElement {
    const request = card.request;
    const el = h('article', {
      class: `request-card ${request.in_cancellation_window ? 'in-window' : ''}`,
      tabindex: '0',
      'aria-label': `${request.ref} ${request.title}`,
      'data-request-id': request.id,
    });
    const start = new Date(request.start);
    const end = new Date(request.end);
    el.appendChild(h('div', { class: 'refline' },
      h('span', { class: 'mono' }, request.ref),
      h('span', { class: 'mono' }, `${agencyTime(start)}–${agencyTime(end)}`),
    ));
    el.appendChild(h('div', { class: 'title' }, request.title));
    el.appendChild(h('div', { class: 'meta' }, `${request.setting} · ${request.org_name} · ${request.consumer.name}`));
    if (request.in_cancellation_window) {
      el.appendChild(h('div', { class: 'in-window-marker' }, 'In cancellation window'));
    }
    el.appendChild(pipRow(request, card));
    el.appendChild(seatSockets(request));
    const inline = h('div', { class: 'inline-reason', role: 'status' });
    if (card.inline) inline.textContent = card.inline;
    inline.dataset.inlineFor = request.id;
    el.appendChild(inline);
    return el;
  }

  function targetSeatOf(request: RequestView): { seat: RequestView['seats'][number] | null; position: number } {
    const open = request.seats.filter((s) => s.status === 'open');
    if (open.length > 0) {
      const lowest = open.reduce((a, b) => (a.position < b.position ? a : b));
      return { seat: lowest, position: lowest.position };
    }
    const highest = request.seats.reduce((a, b) => (a.position > b.position ? a : b));
    return { seat: highest, position: highest.position };
  }

  function renderCentre(): void {
    const region = centreRegion;
    clear(region);
    region.setAttribute('aria-label', 'Requests, next 72 hours');
    if (data.requests.length === 0) {
      region.appendChild(h('p', { class: 'muted' }, 'No requests in the next 72 hours.'));
      return;
    }
    const groups = new Map<string, RequestView[]>();
    for (const r of data.requests) {
      const key = cardDate(new Date(r.start));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    let index = 0;
    for (const [day, requests] of groups) {
      const group = h('div', { class: 'day-group' });
      group.appendChild(h('h2', { class: 'day-heading' }, headingDate(new Date(requests[0]!.start))));
      for (const r of requests) {
        const card = cards.get(r.id)!;
        const el = renderCard(card);
        el.dataset.index = String(index);
        if (!boardPlayedLoad && !reducedMotion()) {
          el.classList.add('day-load');
          el.style.animationDelay = `${Math.min(index * 90, 540)}ms`;
        }
        bindCardEvents(el, card);
        group.appendChild(el);
        index++;
      }
      region.appendChild(group);
    }
    boardPlayedLoad = true;
  }

  function bindCardEvents(el: HTMLElement, card: CardState): void {
    const request = card.request;
    el.addEventListener('click', () => {
      if (!pickedInterpreter) selectRequest(request.id, false);
    });
    el.addEventListener('focus', () => {
      if (pickedInterpreter) {
        void runDryRun(card, el);
      }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (pickedInterpreter) {
          void commitFromKeyboard(card, el);
        } else {
          selectRequest(request.id, false);
        }
      }
    });
  }

  // ----- dry runs -----

  async function runDryRun(card: CardState, cardEl: HTMLElement): Promise<void> {
    const interp = pickedInterpreter;
    if (!interp) return;
    const target = targetSeatOf(card.request);
    const requestId = card.request.id;
    const seatId = target.seat?.id ?? null;
    const seatPosition = target.position;
    const seq = ++dryRunSeq;
    card.gates = { status: 'pending', results: null };
    renderGatesFor(card.request.id, card.gates, cardEl);
    gateResultsStatus.set(copy.dryRun.pending(card.request.ref, seatPosition), 'pending');
    const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), DRY_RUN_TIMEOUT));
    try {
      const outcome = await Promise.race([
        api.post<{ seat_id: string; interpreter_id: string; gates: GateResult[]; all_pass: boolean }>(`/seats/${seatId}/dry-run`, { interpreter_id: interp.id }).then((r) => ({ kind: 'ok' as const, r })),
        timer.then((t) => ({ kind: t as 'timeout' })),
      ]);
      // Apply only while this interpreter is held and this seat is still the target.
      if (!pickedInterpreter || pickedInterpreter.id !== interp.id) return;
      const nowTarget = targetSeatOf(cards.get(requestId)?.request ?? card.request);
      if (nowTarget.seat?.id !== seatId) return;
      if (outcome.kind === 'timeout') {
        gateResultsStatus.set(copy.dryRun.failure(card.request.ref), 'error');
        card.gates = { status: 'resolved', results: null };
        return;
      }
      if (seq !== dryRunSeq && outcome.kind !== 'ok') return;
      card.gates = { status: 'resolved', results: outcome.kind === 'ok' ? outcome.r.gates : null };
      renderGatesFor(card.request.id, card.gates, cardEl);
      if (outcome.kind === 'ok') gateResultsStatus.set(copy.dryRun.success(card.request.ref, seatPosition, outcome.r.gates), undefined);
    } catch (err) {
      if (!pickedInterpreter || pickedInterpreter.id !== interp.id) return;
      card.gates = { status: 'resolved', results: null };
      if (isFailure(err) && err.code === 'seat_taken' && err.body.holder) {
        gateResultsStatus.set(copy.dryRun.seatTaken(err.body.holder.name), 'error');
      } else {
        gateResultsStatus.set(copy.dryRun.failure(card.request.ref), 'error');
      }
    }
  }

  function renderGatesFor(requestId: string, gates: GateState, cardEl?: HTMLElement): void {
    const el = cardEl ?? centreRegion.querySelector(`article[data-request-id="${requestId}"]`);
    if (!el) return;
    const list = el.querySelector('ul[role="list"]');
    const card = cards.get(requestId);
    if (!card || !list) return;
    const fresh = pipRow(card.request, { request: card.request, gates, inline: card.inline });
    list.replaceWith(fresh);
  }

  // ----- commits -----

  function releaseOverCard(card: CardState, cardEl: HTMLElement): void {
    const interp = pickedInterpreter!;
    const target = targetSeatOf(card.request);
    const seat = target.seat;
    if (!seat || seat.status !== 'open') {
      // Seat taken: recoil and name the holder.
      const holderName = seat?.held_by?.name ?? seat?.interpreter?.name ?? 'another coordinator';
      setInline(card.request.id, copy.pin.seatTaken(holderName));
      gateResultsStatus.set(copy.pin.seatTaken(holderName), 'error');
      startRecoil(() => afterCommit());
      return;
    }
    const gates = card.gates;
    const finish = () => {
      if (gates.status === 'resolved' && gates.results) {
        const failing = gates.results.find((g) => !g.pass);
        if (failing) {
          setInline(card.request.id, failing.reason ?? 'Not offered.');
          gateResultsStatus.set(copy.pin.gateFailed(failing.reason ?? ''), 'error');
          startRecoil(() => afterCommit());
          return;
        }
        void sendPin(card, seat.id, target.position, cardEl);
      } else {
        gateResultsStatus.set(copy.dryRun.failure(card.request.ref), 'error');
        startRecoil(() => afterCommit());
      }
    };
    if (gates.status === 'pending') {
      // Hold the thread at the card until the answer arrives.
      const waitFor = setInterval(() => {
        if (card.gates.status !== 'pending') {
          clearInterval(waitFor);
          card.gates = card.gates;
          finish();
        }
      }, 40);
      setTimeout(() => {
        clearInterval(waitFor);
        if (card.gates.status === 'pending') {
          card.gates = { status: 'resolved', results: null };
          gateResultsStatus.set(copy.dryRun.failure(card.request.ref), 'error');
          startRecoil(() => afterCommit());
        }
      }, DRY_RUN_TIMEOUT);
    } else {
      finish();
    }
  }

  async function sendPin(card: CardState, seatId: string, position: number, cardEl: HTMLElement): Promise<void> {
    const interp = pickedInterpreter!;
    boardStatus.set(copy.pin.pending(card.request.ref, position, interp.name), 'pending');
    try {
      await api.post(`/seats/${seatId}/offers`, { interpreter_id: interp.id });
      boardStatus.set(copy.pin.success(card.request.ref, position, interp.name), undefined);
      pinThreadToSocket(seatId);
      selectRequest(card.request.id, true);
      await refresh();
      afterCommit();
    } catch (err) {
      if (isFailure(err)) {
        if (err.code === 'seat_taken' && err.body.holder) {
          setInline(card.request.id, copy.pin.seatTaken(err.body.holder.name));
          boardStatus.set(copy.pin.seatTaken(err.body.holder.name), 'error');
        } else if (err.code === 'gate_failed') {
          const failing = err.body.gates?.find((g) => !g.pass);
          const reason = failing?.reason ?? 'Not offered.';
          setInline(card.request.id, reason);
          boardStatus.set(copy.pin.gateFailed(reason), 'error');
        } else if (err.code === 'offer_window_closed') {
          setInline(card.request.id, copy.pin.windowClosed);
          boardStatus.set(copy.pin.windowClosed, 'error');
        } else {
          setInline(card.request.id, err.message);
          boardStatus.set(err.message, 'error');
        }
      }
      startRecoil();
      afterCommit();
    }
  }

  function pinThreadToSocket(seatId: string): void {
    const socket = centreRegion.querySelector(`button.seat-socket[data-seat="${seatId}"]`);
    const rect = socket?.getBoundingClientRect();
    if (thread && rect) {
      thread = { fromX: thread.fromX, fromY: thread.fromY, toX: rect.left + rect.width / 2, toY: rect.top + rect.height / 2 };
      drawThread();
      setTimeout(() => { thread = null; threadPhase = null; drawThread(); removeThreadImage(); }, reducedMotion() ? 0 : 250);
    } else {
      thread = null; threadPhase = null; drawThread(); removeThreadImage();
    }
  }

  function setInline(requestId: string, text: string): void {
    const card = cards.get(requestId);
    if (card) card.inline = text;
    const el = centreRegion.querySelector(`div[data-inline-for="${requestId}"]`);
    if (el) {
      clear(el as HTMLElement);
      (el as HTMLElement).appendChild(document.createTextNode(text));
      if (!reducedMotion()) {
        (el as HTMLElement).classList.remove('fade-in');
        void (el as HTMLElement).offsetWidth;
        (el as HTMLElement).classList.add('fade-in');
      }
    }
  }

  // ----- keyboard matching -----

  async function commitFromKeyboard(card: CardState, cardEl: HTMLElement): Promise<void> {
    releaseOverCard(card, cardEl);
  }

  function resetAllGates(): void {
    for (const [id, card] of cards) {
      if (card.gates.status !== 'unchecked') {
        card.gates = { status: 'unchecked', results: null };
        renderGatesFor(id, card.gates);
      }
    }
  }

  function pickInterpreter(id: string, name: string, chipEl: HTMLElement): void {
    if (pickedInterpreter) {
      pickedInterpreter.chipEl.setAttribute('aria-pressed', 'false');
      pickedInterpreter.chipEl.classList.remove('picked');
    }
    pickedInterpreter = { id, name, chipEl };
    chipEl.setAttribute('aria-pressed', 'true');
    chipEl.classList.add('picked');
    resetAllGates();
    ensureThreadImage();
    (chipEl as unknown as HTMLElement).dataset.interpreterId = id;
    const rect = chipEl.getBoundingClientRect();
    thread = { fromX: rect.right, fromY: rect.top + rect.height / 2, toX: rect.right, toY: rect.top + rect.height / 2 };
    threadPhase = 'held';
    animateThread();
    const firstCard = centreRegion.querySelector('article[data-request-id]');
    if (firstCard) (firstCard as HTMLElement).focus();
  }

  function dropInterpreter(): void {
    if (pickedInterpreter) {
      const chip = railList.querySelector<HTMLElement>(`button[data-interpreter-id="${pickedInterpreter.id}"]`);
      chip?.setAttribute('aria-pressed', 'false');
      chip?.classList.remove('picked');
      pickedInterpreter = null;
    }
    startRecoil();
  }

  function afterCommit(): void {
    if (pickedInterpreter) {
      const id = pickedInterpreter.id;
      pickedInterpreter = null;
      // The rail may have re-rendered since the pick; query for the live chip.
      const chip = railList.querySelector<HTMLElement>(`button[data-interpreter-id="${id}"]`);
      chip?.setAttribute('aria-pressed', 'false');
      chip?.classList.remove('picked');
      chip?.focus();
    }
    thread = null; threadPhase = null; drawThread(); removeThreadImage();
  }

  // ----- pointer matching -----

  signal.addEventListener('abort', () => {
    canvasHost.remove();
    removeThreadImage();
    clearInterval(poll);
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('pointerup', pointerUp);
    document.removeEventListener('keydown', boardKeydown);
  });

  // ----- rail -----

  function renderRail(): void {
    clear(railList);
    for (const interp of data.interpreters) {
      const li = h('li', { role: 'listitem', style: 'margin:0' });
      const chip = h('button', {
        class: 'chip',
        'aria-pressed': String(pickedInterpreter?.id === interp.id),
        'aria-label': interp.name,
        'data-interpreter-id': interp.id,
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!pickedInterpreter) pickInterpreter(interp.id, interp.name, chip);
          } else if (e.key === 'Escape' && pickedInterpreter) {
            e.preventDefault();
            dropInterpreter();
            chip.focus();
          }
        },
      });
      chip.appendChild(h('span', {}, interp.name));
      const codes = h('span', { class: 'codes' });
      interp.credentials.forEach((c, i) => {
        if (i > 0) codes.appendChild(document.createTextNode(' '));
        const span = h('span', { class: c.expired ? 'expired-code' : '' }, c.type);
        codes.appendChild(span);
      });
      chip.appendChild(codes);
      li.appendChild(chip);
      railList.appendChild(li);
    }
  }

  // Pointer thread: press a chip, drag to a card, release.
  let dragging = false;

  rail.addEventListener('pointerdown', (e) => {
    const chip = (e.target as HTMLElement).closest('.chip') as HTMLElement | null;
    if (!chip || pickedInterpreter) return;
    e.preventDefault();
    dragging = true;
    const interp = data.interpreters.find((i) => i.name === chip.getAttribute('aria-label'))!;
    pickInterpreter(interp.id, interp.name, chip);
    chip.setPointerCapture(e.pointerId);
  });

  rail.addEventListener('pointermove', (e) => {
    if (!dragging || !pickedInterpreter) return;
    setThreadTarget(e.clientX, e.clientY);
  });

  const pointerMove = (e: PointerEvent) => {
    if (!pickedInterpreter || !dragging) return;
    setThreadTarget(e.clientX, e.clientY);
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('article[data-request-id]') as HTMLElement | null;
    centreRegion.querySelectorAll('article[data-request-id]').forEach((c) => c.classList.remove('focused'));
    if (el) {
      el.classList.add('focused');
      const card = cards.get(el.dataset.requestId ?? '');
      if (card && card.gates.status === 'resolved' && el.dataset.heldFor === pickedInterpreter!.id) return;
      if (card) {
        el.dataset.heldFor = pickedInterpreter!.id;
        void runDryRun(card, el);
      }
    }
  };
  document.addEventListener('pointermove', pointerMove);

  const pointerUp = (e: PointerEvent) => {
    if (!pickedInterpreter) return;
    if (!dragging) { dragging = false; return; }
    dragging = false;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('article[data-request-id]') as HTMLElement | null;
    centreRegion.querySelectorAll('article[data-request-id]').forEach((c) => c.classList.remove('focused'));
    if (el) {
      const card = cards.get(el.dataset.requestId ?? '');
      if (card) {
        releaseOverCard(card, el);
        return;
      }
    }
    startRecoil();
    // A release anywhere else just drops the thread with no message.
    setTimeout(() => {
      if (threadPhase === null && thread) { thread = null; drawThread(); removeThreadImage(); }
      if (pickedInterpreter) {
        const chip = railList.querySelector<HTMLElement>(`button[data-interpreter-id="${pickedInterpreter.id}"]`);
        chip?.setAttribute('aria-pressed', 'false');
        chip?.classList.remove('picked');
        pickedInterpreter = null;
      }
    }, 430);
  };
  document.addEventListener('pointerup', pointerUp);

  const boardKeydown = (e: KeyboardEvent) => {
    if (!pickedInterpreter) return;
    if (e.key === 'Escape') {
      const chip = railList.querySelector<HTMLElement>(`button[data-interpreter-id="${pickedInterpreter.id}"]`);
      dropInterpreter();
      chip?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.dataset.index !== undefined) {
        e.preventDefault();
        const list = [...centreRegion.querySelectorAll('article[data-request-id]')] as HTMLElement[];
        const idx = Number(focused.dataset.index);
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, list.length - 1) : Math.max(idx - 1, 0);
        list[next]?.focus();
      }
    }
  };
  document.addEventListener('keydown', boardKeydown);

  // ----- detail pane -----

  function renderDetail(): void {
    clear(detail);
    const selected = data.requests.find((r) => r.id === selectedId);
    if (!selected) {
      detail.appendChild(h('p', { class: 'muted' }, 'Select a request to see its details.'));
      return;
    }
    const start = new Date(selected.start);
    detail.appendChild(h('h2', {}, `${selected.ref} ${selected.title}`));
    detail.appendChild(h('p', { class: 'muted small', style: 'margin-top:2px' }, statusLabel(selected.status)));
    const seatsList = h('ul', { 'aria-label': 'Seats', role: 'list', class: 'stack' });
    for (const seat of selected.seats) {
      const li = h('li', { role: 'listitem' });
      li.appendChild(h('div', {}, h('strong', {}, `Seat ${seat.position}`), ` — ${seat.status}`));
      if (seat.interpreter) li.appendChild(h('div', { class: 'small' }, `Interpreter: ${seat.interpreter.name}`));
      if (seat.held_by) li.appendChild(h('div', { class: 'small muted' }, `Held by ${seat.held_by.name}`));
      if (seat.offer) {
        li.appendChild(h('div', { class: 'small muted' },
          `Offer ${seat.offer.status} · expires ${agencyStamp(new Date(seat.offer.expires_at))} · email ${seat.offer.email}`));
      }
      if (seat.timesheet) {
        li.appendChild(h('div', { class: 'small muted' }, `Timesheet ${seat.timesheet.status}: ${seat.timesheet.billed_hours} h${seat.timesheet.amount ? ` · $${seat.timesheet.amount}` : ''}`));
      }
      seatsList.appendChild(li);
    }
    const prep = h('ul', { 'aria-label': 'Prep materials', role: 'list', class: 'stack' });
    if (selected.prep_files.length === 0) prep.appendChild(h('li', { role: 'listitem', class: 'muted' }, 'No prep materials.'));
    for (const file of selected.prep_files) {
      prep.appendChild(h('li', { role: 'listitem' }, h('a', { href: `/api/prep/${file.id}` }, file.filename)));
    }
    detail.appendChild(h('h3', { style: 'font-size:1.15rem' }, 'Seats'));
    detail.appendChild(seatsList);
    detail.appendChild(h('h3', { style: 'font-size:1.15rem' }, 'Prep materials'));
    detail.appendChild(prep);
    if (selected.in_cancellation_window) {
      detail.appendChild(h('p', { class: 'in-window-marker' }, 'In cancellation window'));
    }
  }

  function selectRequest(id: string, switchTabOnNarrow: boolean): void {
    selectedId = id;
    renderDetail();
    if (switchTabOnNarrow && window.innerWidth < 900) switchTab('detail');
  }

  // ----- data refresh -----

  async function refresh(): Promise<void> {
    try {
      const fresh = await api.get<BoardData>('/board');
      data.interpreters = fresh.interpreters;
      data.requests = fresh.requests;
      for (const r of fresh.requests) {
        const existing = cards.get(r.id);
        cards.set(r.id, { request: r, gates: { status: 'unchecked', results: null }, inline: existing?.inline ?? null });
      }
      for (const key of [...cards.keys()]) {
        if (!fresh.requests.some((r) => r.id === key)) cards.delete(key);
      }
      renderRail();
      // The refresh replaces the cards; keep the keyboard user's focus.
      const active = document.activeElement as HTMLElement | null;
      const activeRef = active?.dataset.index;
      renderCentre();
      if (activeRef !== undefined && active?.dataset.requestId) {
        const again = centreRegion.querySelector<HTMLElement>(`article[data-request-id="${active.dataset.requestId}"]`);
        again?.focus();
      }
      renderDetail();
    } catch {
      // keep the last data; the next poll will retry
    }
  }

  const poll = setInterval(() => { void refresh(); }, 4000);

  void refresh();
  return root;
}
