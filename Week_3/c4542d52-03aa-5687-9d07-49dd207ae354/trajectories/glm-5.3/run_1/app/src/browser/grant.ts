import { h } from './dom.js';
import { get, post } from './api.js';
import type { Grant } from './api.js';
import { shell, page, navigate, announce, onSocketOpen } from './app.js';
import { onEvent } from './socket.js';
import { fmtCountdown, fmtDate, fmtMoney } from './format.js';

const STATE_WORDS: Record<string, string> = {
  draft: 'Draft',
  board_queue: 'With the board',
  approved: 'Approved',
  offered: 'Offered',
  accepted: 'Accepted',
  expired: 'Expired',
};

/** The cells a grant draws: one cliff cell (marks 1-12) then monthly cells, or one per mark. */
function cellsOf(grant: Grant): Array<{ months: number[]; date: string; cumulative: number; state: string; label: string }> {
  const out: Array<{ months: number[]; date: string; cumulative: number; state: string; label: string }> = [];
  const sched = new Map(grant.schedule.map((t) => [t.month, t]));
  if (grant.vesting_type === 'standard') {
    const cliff = sched.get(12)!;
    out.push({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], date: cliff.date, cumulative: cliff.cumulative, state: cliff.state, label: cliff.date });
    for (let m = 13; m <= 48; m++) {
      const t = sched.get(m)!;
      out.push({ months: [m], date: t.date, cumulative: t.cumulative, state: t.state, label: t.date });
    }
  } else {
    for (let m = 1; m <= 48; m++) {
      const t = sched.get(m)!;
      out.push({ months: [m], date: t.date, cumulative: t.cumulative, state: t.state, label: t.date });
    }
  }
  return out;
}

function serverVestedMark(grant: Grant): number {
  let mark = -1;
  for (const t of grant.schedule) {
    if (t.state === 'vested' && t.month > mark) mark = t.month;
  }
  if (mark < 0) {
    // find the latest mark whose date is on or before the server date
    for (const t of grant.schedule) {
      if (t.date <= grant.server_date) mark = Math.max(mark, t.month);
    }
  }
  return mark;
}

page('/grants/:id', ['founder_admin', 'option_holder', 'leaver'], async (root, ctx) => {
  const person = ctx.person;
  const grant = await get<Grant>(`/api/grants/${ctx.params.id}`);
  const isHolder = grant.holder_id === person.id;

  let marker = initialMarker(grant);

  const leftNote = document.getElementById('left-note');
  if (leftNote) leftNote.textContent = `${grant.id} — ${STATE_WORDS[grant.state]}`;

  // Header
  const stateWord = STATE_WORDS[grant.state] ?? grant.state;
  const heading = h('h1', { id: 'grant-heading' }, `${grant.id} — ${stateWord}`);

  // Tranche ribbon
  const ribbonCells = new Map<number, HTMLElement>();
  const track = h('div', { class: 'ribbon-track', role: 'list', 'aria-label': 'Tranches' });
  const cells = cellsOf(grant);
  for (const cell of cells) {
    const li = h('div', { class: `ribbon-cell ${cell.state}`, role: 'listitem' });
    const dateEl = h('div', { class: 'date' }, fmtDate(cell.date));
    const cumEl = h('div', { class: 'cum num' }, cell.cumulative.toLocaleString('en-US'));
    const markEl = h('div', { class: 'mark' });
    li.append(dateEl, cumEl, markEl);
    for (const m of cell.months) ribbonCells.set(m, li);
    track.appendChild(li);
  }

  const exercisableValue = h('span', { class: 'num' }, grant.exercisable.toLocaleString('en-US'));
  const ribbonGroup = h('div', { class: 'ribbon-wrap', role: 'group', 'aria-label': 'Tranche ribbon' },
    isLeaver(person.role) ? leaverBand(grant) : null,
    track,
  );

  // Projection figures
  const figVested = h('span', { class: 'num' }, '0');
  const figCost = h('span', { class: 'num' }, '$0.00');
  const figOwnership = h('span', { class: 'num' }, '0%');
  const figures = h('div', { class: 'figures', role: 'group', 'aria-label': 'Projection figures' },
    h('div', { class: 'value' }, h('div', { class: 'label' }, 'Vested'), h('div', {}, figVested)),
    h('div', { class: 'value' }, h('div', { class: 'label' }, 'Cost to exercise'), h('div', {}, figCost)),
    h('div', { class: 'value' }, h('div', { class: 'label' }, 'Vested ownership'), h('div', {}, figOwnership)),
  );

  if (isLeaver(person.role)) {
    figures.appendChild(h('div', { class: 'value' },
      h('div', { class: 'label' }, 'Exercisable now'),
      h('div', {}, exercisableValue),
    ));
  }

  // Projection marker slider
  const slider = h('div', {
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Projection date',
    'aria-valuemin': '0',
    'aria-valuemax': '48',
    'aria-valuenow': String(marker),
  });

  function cellAt(m: number): HTMLElement | null {
    if (m === 0) return ribbonCells.get(1) ?? null;
    return ribbonCells.get(m) ?? null;
  }

  function initialMarkerFor(grant: Grant): number {
    const mark = serverVestedMark(grant);
    return mark < 0 ? 0 : mark;
  }

  function initialMarker(g: Grant): number {
    const mark = serverVestedMark(g);
    return mark < 0 ? 0 : mark;
  }

  function drawMarker(animate: boolean): void {
    const t = grant.schedule[marker]!;
    figVested.textContent = t.cumulative.toLocaleString('en-US');
    figCost.textContent = `$${fmtMoney(t.cost_at_strike)}`;
    figOwnership.textContent = `${t.vested_ownership}%`;
    const markerDate = fmtDate(t.date);
    slider.setAttribute('aria-valuenow', String(marker));
    slider.setAttribute('aria-valuetext', `${markerDate}${t.date === grant.server_date ? ' (today)' : ''}`);

    // Cells after today up to the marker show as projected; red vested cells never change.
    const serverMark = serverVestedMark(grant);
    for (const cell of cells) {
      const el = ribbonCells.get(cell.months[0]!)!;
      const isAfterToday = cell.months[0]! > serverMark;
      const isProjected = isAfterToday && cell.months[0]! <= marker;
      const projectedNow = cell.state !== 'vested' && cell.state !== 'cancelled' && isProjected;
      el.classList.toggle('projected', projectedNow);
      const markEl = el.querySelector('.mark');
      if (markEl) markEl.textContent = cell.months.includes(marker) ? '·' : '';
    }
    const markerCell = cellAt(marker);
    if (markerCell && marker !== 0) {
      scrollToCell(markerCell, animate);
    } else if (marker === 0) {
      const first = ribbonCells.get(1);
      if (first) scrollToCell(first, animate);
    }
  }

  function scrollToCell(el: HTMLElement, animate: boolean): void {
    const rect = el.getBoundingClientRect();
    const trackRect = track.getBoundingClientRect();
    if (rect.left < trackRect.left || rect.right > trackRect.right) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = !animate || reduce ? 'auto' : 'smooth';
      el.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
    }
  }

  function move(delta: number): void {
    const next = Math.max(0, Math.min(48, marker + delta));
    if (next === marker) return;
    marker = next;
    drawMarker(true);
  }

  slider.addEventListener('keydown', (ev) => {
    const k = ev.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') { ev.preventDefault(); move(1); }
    else if (k === 'ArrowLeft' || k === 'ArrowDown') { ev.preventDefault(); move(-1); }
    else if (k === 'PageDown') { ev.preventDefault(); move(12); }
    else if (k === 'PageUp') { ev.preventDefault(); move(-12); }
    else if (k === 'Home') { ev.preventDefault(); marker = initialMarkerFor(grant); drawMarker(true); }
    else if (k === 'End') { ev.preventDefault(); marker = 48; drawMarker(true); }
  });

  // Pointer drag and tap move the marker to that cell.
  for (const cell of cells) {
    const el = ribbonCells.get(cell.months[0]!)!;
    el.addEventListener('click', () => {
      marker = cell.months[cell.months.length - 1]!;
      drawMarker(true);
    });
  }

  // Offered grant: agreement, accept and decline
  const actions: HTMLElement[] = [];
  let exerciseButton: HTMLButtonElement | null = null;

  if (grant.state === 'offered' && isHolder) {
    const agreement = h('section', { role: 'region', 'aria-label': 'Grant agreement' },
      h('h2', {}, 'Grant agreement'),
      h('p', {}, `${grant.holder_name} is granted ${grant.options.toLocaleString('en-US')} options at a strike price of $${grant.strike}, vesting ${grant.vesting_type === 'standard' ? 'over 4 years with a 1-year cliff' : 'monthly over 4 years with no cliff'} from ${grant.vesting_start}. This agreement is governed by the Tidecraft Robotics, Inc. option plan.`),
    );

    const acceptBtn = h('button', { class: 'primary' }, 'Accept grant');
    const declineBtn = h('button', { class: 'secondary' }, 'Decline grant');
    const retryBtn = h('button', { class: 'primary', style: { display: 'none' } }, 'Retry signing');

    acceptBtn.addEventListener('click', async () => {
      acceptBtn.textContent = 'Sealing your signed agreement in the vault.';
      try {
        await post(`/api/grants/${grant.id}/accept`);
        announce(`Grant ${grant.id} accepted. Your signed agreement is sealed in the vault.`, `accept-${grant.id}`);
        navigate(`/grants/${grant.id}`, true);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code === 'vault_unavailable') {
          acceptBtn.textContent = 'Accept grant';
          retryBtn.style.display = '';
          announce(err.message ?? "The document vault can't be reached.", `vault-${grant.id}`);
          const band = h('section', { class: 'band red', role: 'alert' }, err.message ?? '');
          document.getElementById('content')?.prepend(band);
        } else if (err.code === 'offer_expired') {
          announce(err.message ?? '', `expired-${grant.id}`);
          navigate(`/grants/${grant.id}`, true);
        } else {
          acceptBtn.textContent = 'Accept grant';
          announce(err.message ?? '', `accept-fail-${grant.id}`);
        }
      }
    });

    retryBtn.addEventListener('click', async () => {
      try {
        await post(`/api/grants/${grant.id}/accept`);
        announce(`Grant ${grant.id} accepted. Your signed agreement is sealed in the vault.`, `accept-${grant.id}`);
        navigate(`/grants/${grant.id}`, true);
      } catch (e) {
        const err = e as { message?: string };
        announce(err.message ?? '', `retry-${grant.id}`);
      }
    });

    declineBtn.addEventListener('click', async () => {
      try {
        await post(`/api/grants/${grant.id}/decline`);
        announce(`Grant ${grant.id} declined and returned to the board.`, `decline-${grant.id}`);
        navigate('/', true);
      } catch (e) {
        const err = e as { message?: string };
        announce(err.message ?? '', `decline-fail-${grant.id}`);
      }
    });

    actions.push(agreement, acceptBtn, declineBtn, retryBtn);
  }

  if (grant.state === 'accepted' && (person.role === 'option_holder' || person.role === 'leaver') && isHolder) {
    exerciseButton = h('button', { class: 'primary', id: 'exercise-btn' }, 'Exercise') as HTMLButtonElement;
    exerciseButton.addEventListener('click', () => {
      openExerciseDialog(grant, exerciseButton!);
    });
    actions.push(exerciseButton);
  }

  const content = h('div', {},
    heading,
    h('p', { class: 'side-note' }, `${grant.holder_name} — ${grant.options.toLocaleString('en-US')} options at $${grant.strike}`),
    ribbonGroup,
    slider,
    figures,
    ...actions,
  );

  root.appendChild(shell(person, content));
  drawMarker(false);

  // Live updates: vested tranches, state changes, window end.
  onEvent((ev) => {
    const data = ev.data as Record<string, unknown> | null;
    if (ev.type === 'clock' && isLeaver(person.role)) {
      const band = document.querySelector('[role="timer"]');
      if (band) band.textContent = fmtCountdown(grant.exercise_window_ends_at);
      void data;
    }
    if (ev.type === 'grant_state' && data?.grant_id === grant.id) {
      navigate(`/grants/${grant.id}`, true);
    }
    if (ev.type === 'window_ended' && data) {
      navigate(`/grants/${grant.id}`, true);
      announce(`Your exercise window has closed. ${data.cancelled} unexercised options on grant ${grant.id} were cancelled.`, `window-end-${grant.id}`);
    }
  });

  function openExerciseDialog(grant: Grant, opener: HTMLElement): void {
    const dlg = h('dialog', { 'aria-label': 'Exercise options' },) as HTMLDialogElement;
    const input = h('input', { type: 'text', inputmode: 'numeric', id: 'exercise-amount', 'aria-label': 'Options to exercise' });
    const costEl = h('span', { class: 'num' }, '$0.00');
    const errorEl = h('p', { class: 'field-error', style: { display: 'none' } });
    let previewTimer: number | null = null;

    input.addEventListener('input', () => {
      if (previewTimer) window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(async () => {
        const n = Number((input as HTMLInputElement).value.trim());
        if (!Number.isInteger(n) || n < 1) {
          costEl.textContent = '$0.00';
          return;
        }
        try {
          const q = await post<{ cost: string }>(`/api/grants/${grant.id}/exercise-quote`, { options: n });
          costEl.textContent = `$${fmtMoney(q.cost)}`;
        } catch {
          costEl.textContent = '$0.00';
        }
      }, 200);
    });

    const confirmBtn = h('button', { class: 'primary' }, 'Confirm exercise') as HTMLButtonElement;
    const closeBtn = h('button', { class: 'secondary' }, 'Close');

    confirmBtn.addEventListener('click', async () => {
      const n = Number((input as HTMLInputElement).value.trim());
      confirmBtn.textContent = 'Sending to the provider';
      const key = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      try {
        const order = await post<{ id: string; state: string }>(`/api/grants/${grant.id}/exercises`, { options: n }, key);
        if (order.state === 'issued') {
          announce(`Payment confirmed. ${n} shares issued on grant ${grant.id}.`, `issued-${order.id}`);
        } else {
          announce('Payment pending at the provider. Your shares appear once it confirms.', `pending-${order.id}`);
        }
        dlg.close();
        document.body.removeChild(dlg);
        navigate(`/exercises/${order.id}`);
        window.setTimeout(() => {
          const headingEl = document.querySelector('h1');
          if (headingEl instanceof HTMLElement) headingEl.focus();
        }, 0);
      } catch (e) {
        const err = e as { code?: string; message?: string; fields?: Record<string, string> };
        confirmBtn.textContent = 'Confirm exercise';
        if (err.fields?.options) {
          errorEl.textContent = err.fields.options;
          errorEl.style.display = 'block';
        } else {
          announce(err.message ?? '', `exercise-fail-${grant.id}`);
        }
      }
    });

    closeBtn.addEventListener('click', () => {
      dlg.close();
    });

    dlg.addEventListener('close', () => {
      if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
      opener.focus();
    });

    dlg.append(
      h('h2', {}, 'Exercise options'),
      h('label', { for: 'exercise-amount' }, 'Options to exercise'),
      input,
      h('p', {}, h('span', { class: 'label' }, 'Cost '), h('span', { class: 'num' }, costEl)),
      errorEl,
      h('div', { class: 'dialog-actions' }, confirmBtn, closeBtn),
    );
    document.body.appendChild(dlg);
    dlg.showModal();
    input.focus();

    // Trap Tab inside the dialog.
    dlg.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const focusables = dlg.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])');
      const list = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'));
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    });

    dlg.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        dlg.close();
      }
    });

    // Disable confirm while the socket is not open (nothing sent before the socket is open).
    const setOpen = onSocketOpen((open) => {
      confirmBtn.disabled = !open;
    });
    dlg.addEventListener('close', () => setOpen());
  }
});

function isLeaver(role: string): boolean {
  return role === 'leaver';
}

function leaverBand(grant: Grant): HTMLElement {
  const countdownEl = h('span', { class: 'num', role: 'timer', 'aria-label': 'Exercise window' }, fmtCountdown(grant.exercise_window_ends_at));
  const band = h('div', { class: 'leaver-band' },
    h('span', {}, 'Exercise window'),
    countdownEl,
  );
  onEvent((ev) => {
    if (ev.type === 'clock') {
      countdownEl.textContent = fmtCountdown(grant.exercise_window_ends_at);
    }
  });
  return band;
}
