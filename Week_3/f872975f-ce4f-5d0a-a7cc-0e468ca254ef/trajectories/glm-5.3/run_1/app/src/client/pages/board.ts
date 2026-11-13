import { api, type BoardDetail, type FitResult, type PieceInput, type SessionUser } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';
import { elevationSvg } from '../svg.js';
import { formatLength, formatMoney, readStoredUnit, storeUnit, type Unit } from '../format.js';
import { trapFocus } from './rack.js';

const MAX_PIECES = 20;
const HISTORY_LIMIT = 50;

interface Chip {
  label: string;
  length_mm: number;
  width_mm: number;
  start_mm: number;
  rotated: boolean;
}

export function renderBoardPage(_state: ShellState, tag: string): string {
  return `
  <div id="board-body" data-tag="${escapeHtml(tag)}">
    <p class="live-status" id="board-loading">Loading board ${escapeHtml(tag)}…</p>
  </div>`;
}

export function mountBoardPage(tag: string): void {
  const host = document.getElementById('board-body') as HTMLElement;
  let board: BoardDetail | null = null;
  let unit: Unit = readStoredUnit();
  let chips: Chip[] = [];
  let history: Chip[][] = [];
  let future: Chip[][] = [];
  let fit: FitResult | null = null;
  let fitForChips: string | null = null;
  let selected: number | null = null;
  let holdStatusText = '';
  let fileStatusText = '';
  let fitVerdictText = '';
  let lastImportedFile: Record<string, unknown> | null = null;
  let totalsRequest = 0;
  let holdDialogOpen = false;
  let holdDialogKey = '';
  let dialogCard = '';
  let services: { billing: 'up' | 'down'; storage: 'up' | 'down' } =
    (globalThis as unknown as { kerfwellServices?: { billing: 'up' | 'down'; storage: 'up' | 'down' } }).kerfwellServices
    ?? { billing: 'up', storage: 'down' };
  let sessionUser: SessionUser | null = null;
  let fitPending = false;
  let arrowRunTimer: number | undefined;
  let arrowRunActive = false;

  const storedBoard = sessionStorageGet(`kerfwell-layout-${tag}`);
  const returningFromSignIn = storedBoard !== null;

  void api.session().then((r) => {
    sessionUser = r.user;
    render();
  }).catch(() => {
    sessionUser = null;
    render();
  });

  void api.board(tag).then((result) => {
    board = result.board;
    if (returningFromSignIn && board?.my_hold === null) {
      chips = storedBoard ?? [];
      history = [];
      future = [];
        sessionStorageRemove(`kerfwell-layout-${tag}`);
      render();
      void runFitCheck(true).then(() => {
        if (canHold() && sessionUser?.role === 'maker') {
          openHoldDialog();
        }
      });
      return;
    }
    if (board?.my_hold) {
      chips = board.my_hold.pieces.map((p) => ({ label: p.label, length_mm: p.length_mm, width_mm: p.width_mm, start_mm: p.start_mm, rotated: false }));
    }
    render();
    if (board?.my_hold) {
      void api.fit(tag, board.my_hold.pieces).then((result) => {
        fit = result;
        fitForChips = chipSignature(chips);
            render();
      }).catch(() => undefined);
    }
  }).catch(() => {
    const main = document.querySelector('main');
    if (main) {
      main.innerHTML = notFoundHtml();
      document.getElementById('back-to-rack')?.focus();
    } else {
      host.innerHTML = notFoundHtml();
    }
    return;
  });

  document.addEventListener('kerfwell-services', ((event: CustomEvent) => {
    services = event.detail;
    render();
  }) as EventListener);

  window.setInterval(() => {
    void api.board(tag).then((result) => {
      board = result.board;
      if (!holdDialogOpen && !fitPending) {
        render();
      }
    }).catch(() => undefined);
  }, 5000);

  // ---- rendering ----------------------------------------------------------

  function render(): void {
    if (board === null) {
      return;
    }
    const badge = board.status === 'available' ? 'Available' : board.status === 'held' ? 'Held' : '';
    const isHolder = board.my_hold !== null && (board.my_hold.status === 'held' || board.my_hold.status === 'pending-payment');
    const canExport = sessionUser?.role === 'maker' && chips.length > 0;
    host.innerHTML = `
      <div class="board-head">
        <h1 class="page-title">${escapeHtml(board.tag)}</h1>
        ${badge ? `<span class="badge${board.status === 'held' ? ' held' : ''}" id="board-badge">${badge}</span>` : ''}
      </div>
      <div class="board-meta">
        <span>${escapeHtml(board.species)}${board.grade ? ` · ${board.grade}` : ''}</span>
        <span>${escapeHtml(board.lot.name)} (${escapeHtml(String(board.lot.built_year))})</span>
        ${board.parent_tag ? `<span>Cut from <a href="/boards/${encodeURIComponent(board.parent_tag)}">${escapeHtml(board.parent_tag)}</a></span>` : ''}
        ${board.rate_cents !== null ? `<span>${board.rate_cents} ¢/bd ft</span>` : ''}
        <span class="mono" id="board-dims">${formatLength(board.length_mm, unit)} × ${formatLength(board.width_mm, unit)} × ${formatLength(board.thickness_mm, unit)}</span>
      </div>
      <fieldset style="border:none;padding:0;margin:8px 0">
        <legend class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Units</legend>
        <div role="radiogroup" aria-label="Units" style="display:inline-flex;gap:6px;align-items:center">
          <label style="display:inline-flex;align-items:center;gap:4px;min-height:44px;margin:0"><input type="radio" name="units" value="mm"${unit === 'mm' ? ' checked' : ''}>Millimetres</label>
          <label style="display:inline-flex;align-items:center;gap:4px;min-height:44px;margin:0"><input type="radio" name="units" value="in"${unit === 'in' ? ' checked' : ''}>Inches</label>
        </div>
      </fieldset>
      <div class="board-photos">
        ${board.photos.map((photo, index) => `<img src="${photo.url}" alt="Photo ${index + 1} of ${escapeHtml(board!.tag)}" width="${Math.round(photo.width / 4)}" height="${Math.round(photo.height / 4)}">`).join('')}
      </div>
      <div class="elevation-wrap" id="elevation"></div>
      <div class="layout-region" role="region" aria-label="Layout">
        <div class="chips" id="chips" role="group" aria-label="Cut list"></div>
        <div class="layout-toolbar">
          <button id="undo" ${history.length === 0 ? 'disabled' : ''}>Undo</button>
          <button id="redo" ${future.length === 0 ? 'disabled' : ''}>Redo</button>
        </div>
        <form class="piece-form" id="piece-form">
          <div class="field"><label for="piece-label">Piece label</label><input id="piece-label" maxlength="40" autocomplete="off"></div>
          <div class="field"><label for="piece-length">Piece length</label><input id="piece-length" inputmode="decimal" autocomplete="off"></div>
          <div class="field"><label for="piece-width">Piece width</label><input id="piece-width" inputmode="decimal" autocomplete="off"></div>
          <div class="field"><button type="submit" id="add-piece" ${chips.length >= MAX_PIECES ? 'disabled' : ''}>Add piece</button></div>
        </form>
        <div class="layout-toolbar">
          <button id="fit-check"${fitPending ? ' disabled' : ''}>${fitPending ? 'Checking fit' : 'Fit check'}</button>
        </div>
        <p class="live-status fit-result" id="fit-result" role="status" aria-label="Fit result">${escapeHtml(fitVerdictText)}</p>
        <p class="live-status" id="hold-status" role="status" aria-label="Hold status">${escapeHtml(holdStatusText)}</p>
        <div class="totals${fitPending ? ' dimmed' : ''}" id="layout-totals" role="status" aria-label="Layout totals"></div>
        ${sessionUser?.role === 'maker' ? `
        <div class="layout-toolbar" id="file-controls">
          <button id="export-layout" ${canExport ? '' : 'disabled'}>Export layout</button>
          <button id="import-layout">Import layout</button>
          <input type="file" id="layout-file" accept=".kerf,.json" hidden>
        </div>
        <p class="live-status" id="layout-file-status" role="status" aria-label="Layout file status">${escapeHtml(fileStatusText)}</p>` : ''}
        <div class="layout-toolbar" id="hold-controls">
          ${isHolder && board.my_hold?.status === 'held' ? `
            <button id="pay-and-cut"${services.billing === 'down' ? ' aria-disabled="true"' : ''}>Pay and cut</button>
            <button id="cancel-hold"${services.billing === 'down' ? ' aria-disabled="true"' : ''}>Cancel hold</button>
            ${services.billing === 'down' ? '<span class="mono">Paused while billing is offline.</span>' : ''}` : ''}
          ${!isHolder && board.status === 'available' ? (sessionUser?.role === 'maker'
            ? `<button id="hold-board"${services.billing === 'down' || !canHold() ? ' disabled' : ''}>${services.billing === 'down' ? 'Holds paused' : 'Hold board'}</button>`
            : sessionUser === null ? `<a href="/sign-in?next=${encodeURIComponent(`/boards/${tag}`)}" id="sign-in-to-hold">Sign in to hold</a>` : '') : ''}
        </div>
      </div>
      <div id="hold-dialog-host"></div>
    `;
    if (holdDialogOpen) renderHoldDialog();
    drawElevation();
    drawChips();
    drawTotals();
    wire();
  }

  function notFoundHtml(): string {
    return `<div class="not-found">
      <h1>Not on this rack</h1>
      <p>Check the link, or go back to the rack.</p>
      <p><a href="/" id="back-to-rack">Back to the rack</a></p>
    </div>`;
  }

  function drawElevation(): void {
    const el = document.getElementById('elevation') as HTMLElement;
    if (board === null) return;
    const drawnWidth = Math.min(880, Math.max(320, window.innerWidth - 80));
    const drawn = chips.map((chip, index) => ({
      index,
      label: chip.label,
      start_mm: chip.start_mm,
      length_mm: chip.length_mm,
      width_mm: chip.width_mm,
      status: statusForChip(index),
    }));
    const offcut = fit !== null && fit.sale === 'cut' && fit.offcut_mm !== null
      ? { startMm: (fit.take_mm ?? 0) + 4, lengthMm: fit.offcut_mm }
      : null;
    const label = offcut !== null ? `offcut ${formatLength(offcut.lengthMm, unit)}` : null;
    el.innerHTML = elevationSvg(board.tag, board.length_mm, board.width_mm, board.defects, drawn, fit?.cuts_mm ?? [], offcut, label, drawnWidth);
  }

  function drawChips(): void {
    const el = document.getElementById('chips') as HTMLElement;
    const hadFocus = document.activeElement instanceof HTMLElement && document.activeElement.dataset['chip'] !== undefined;
    const focusIndex = hadFocus ? Number((document.activeElement as HTMLElement).dataset['chip']) : null;
    el.innerHTML = chips.map((chip, index) => {
      const over = statusForChip(index) === 'over defect';
      const name = `${chip.label}, ${formatLength(chip.length_mm, unit)} at ${formatLength(chip.start_mm, unit)}${over ? ', over defect' : ''}`;
      return `<button class="chip${over ? ' over-defect' : ''}" data-chip="${index}" aria-pressed="${selected === index}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    }).join('');
    wireChips();
    if (focusIndex !== null && focusIndex < chips.length) {
      const next = el.querySelector<HTMLElement>(`[data-chip="${focusIndex}"]`);
      next?.focus();
    }
  }

  function wireChips(): void {
    for (const chipEl of document.querySelectorAll<HTMLElement>('[data-chip]')) {
      const index = Number((chipEl as unknown as { dataset: Record<string, string> }).dataset['chip'] ?? '0');
      chipEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selected = index;
          drawChips();
        }
      });
      chipEl.addEventListener('pointerdown', () => {
        selected = index;
      });
      wireDrag(chipEl, index);
    }
  }

  function drawTotals(): void {
    const el = document.getElementById('layout-totals') as HTMLElement;
    if (chips.length === 0) {
      el.textContent = 'Add a piece to see the take and price.';
      return;
    }
    if (fit === null || fit.take_mm === null || fitForChips !== chipSignature(chips) || fit.price_cents === null) {
      el.textContent = 'Fix the layout to see the take and price.';
      return;
    }
    const parts = [
      `Take ${formatLength(fit.take_mm, unit)}`,
      `Board feet ${fit.board_feet} bd ft`,
      `Price $${formatMoney(fit.price_cents)}`,
    ];
    if (fit.sale === 'cut') parts.push(`Clear offcut ${formatLength(fit.clear_offcut_mm ?? 0, unit)}`);
    else parts.push('Clear offcut none');
    el.textContent = parts.join(' · ');
  }

  function statusForChip(index: number): string {
    if (fit !== null && fitForChips === chipSignature(chips)) {
      return fit.pieces[index]?.status ?? '';
    }
    const chip = chips[index];
    if (chip === undefined || board === null) return '';
    const end = chip.start_mm + chip.length_mm;
    if (end > board.length_mm) return 'off board';
    if (chip.width_mm > board.width_mm) return 'too wide';
    for (const zone of board.defects) {
      if (chip.start_mm < zone.end_mm && zone.start_mm < end) return 'over defect';
    }
    return '';
  }

  // ---- history ------------------------------------------------------------

  function chipSignature(list: Chip[]): string {
    return list.map((c) => `${c.label}|${c.length_mm}|${c.width_mm}|${c.start_mm}|${c.rotated ? 1 : 0}`).join(';');
  }

  function pushHistory(): void {
    history.push(chips.map((c) => ({ ...c })));
    if (history.length > HISTORY_LIMIT) history.shift();
    future = [];
  }

  function undo(): void {
    if (history.length === 0) return;
    future.push(chips.map((c) => ({ ...c })));
    chips = history.pop() ?? [];
    if (selected !== null && selected >= chips.length) selected = null;
    fit = null;
    render();
    void refreshTotals();
  }

  function redo(): void {
    if (future.length === 0) return;
    history.push(chips.map((c) => ({ ...c })));
    chips = future.pop() ?? [];
    if (selected !== null && selected >= chips.length) selected = null;
    fit = null;
    render();
    void refreshTotals();
  }

  // ---- totals and fit -----------------------------------------------------

  function piecesOf(list: Chip[]): PieceInput[] {
    return list.map((chip) => ({ label: chip.label, length_mm: chip.length_mm, width_mm: chip.width_mm, start_mm: chip.start_mm }));
  }

  async function refreshTotals(): Promise<void> {
    if (chips.length === 0) {
      drawTotals();
      return;
    }
    const request = ++totalsRequest;
    try {
      await api.fit(tag, piecesOf(chips));
      if (request !== totalsRequest) return;
      drawTotals();
    } catch {
      if (request !== totalsRequest) return;
      drawTotals();
    }
  }


  async function runFitCheck(fromRestore = false): Promise<void> {
    if (chips.length === 0) return;
    fitPending = true;
    const button = document.getElementById('fit-check') as HTMLButtonElement | null;
    if (button) {
      button.disabled = true;
      button.textContent = 'Checking fit';
    }
    document.getElementById('layout-totals')?.classList.add('dimmed');
    try {
      const result = await api.fit(tag, piecesOf(chips));
      fit = result;
      fitForChips = chipSignature(chips);
      fitVerdictText = result.verdict;
      // The server's piece statuses replace the client's flags, then the motion runs.
      drawElevation();
      drawChips();
      drawTotals();
      document.getElementById('fit-result')!.textContent = result.verdict;
      await animateKerf();
      // The hold controls follow the new fit state.
      renderHoldControls();
    } catch {
      fitVerdictText = 'Fit check failed. Try again.';
      document.getElementById('fit-result')!.textContent = fitVerdictText;
      document.getElementById('layout-totals')?.classList.remove('dimmed');
    } finally {
      fitPending = false;
      if (fromRestore) {
        // The restored layout renders once with its figures at full strength.
        render();
      } else {
        const restore = document.getElementById('fit-check') as HTMLButtonElement | null;
        if (restore) {
          restore.disabled = false;
          restore.textContent = 'Fit check';
        }
        // Step 4 of the kerf fit: the figures return to full strength.
        document.getElementById('layout-totals')?.classList.remove('dimmed');
      }
    }
  }

  async function animateKerf(): Promise<void> {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lines = [...document.querySelectorAll<SVGLineElement>('line[data-kerf]')];
    const offcutEl = document.querySelector<SVGRectElement>('[data-offcut]');
    const totals = document.getElementById('layout-totals');
    if (reduced || lines.length === 0) {
      totals?.classList.remove('dimmed');
      return;
    }
    for (const line of lines) {
      line.style.opacity = '0';
    }
    if (offcutEl) offcutEl.style.opacity = '0';
    for (const line of lines) {
      line.style.transition = 'none';
      line.style.strokeDasharray = '0 1000';
      await wait(20);
      line.style.transition = 'stroke-dasharray 125ms linear';
      line.style.strokeDasharray = '1000 0';
      line.style.opacity = '1';
      await wait(125);
    }
    if (offcutEl) {
      offcutEl.style.transition = 'opacity 250ms ease-out';
      offcutEl.style.opacity = '1';
      await wait(250);
    }
    totals?.classList.remove('dimmed');
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function canHold(): boolean {
    return (
      fit !== null &&
      fitForChips === chipSignature(chips) &&
      fit.pieces.every((p) => p.status === 'clear') &&
      fit.price_cents !== null &&
      fit.price_cents > 2500
    );
  }

  // ---- chips editing ------------------------------------------------------

  function addPiece(label: string, lengthMm: number, widthMm: number): void {
    if (chips.length >= MAX_PIECES) return;
    const last = chips[chips.length - 1];
    const start = last ? last.start_mm + last.length_mm + 10 : 0;
    pushHistory();
    chips.push({ label, length_mm: lengthMm, width_mm: widthMm, start_mm: start, rotated: false });
    fit = null;
    render();
    void refreshTotals();
  }

  function removeChip(index: number): void {
    pushHistory();
    chips.splice(index, 1);
    if (selected === index) selected = null;
    else if (selected !== null && selected > index) selected -= 1;
    fit = null;
    render();
    void refreshTotals();
  }

  function rotateChip(index: number): void {
    pushHistory();
    const chip = chips[index];
    const rotated = !chip.rotated;
    chips[index] = { ...chip, length_mm: rotated ? chip.width_mm : chip.length_mm, width_mm: rotated ? chip.length_mm : chip.width_mm, rotated };
    fit = null;
    render();
    void refreshTotals();
  }

  function moveChip(index: number, startMm: number): void {
    const clamped = Math.max(0, startMm);
    chips[index] = { ...chips[index], start_mm: clamped };
    fit = null;
    clearFitVisuals();
    drawElevation();
    drawChips();
    void refreshTotals();
  }

  /** Refresh only the hold controls, keeping the fitted layout and dialogs in place. */
  function renderHoldControls(): void {
    const host = document.getElementById('hold-controls');
    if (host === null || board === null) return;
    const isHolder = board.my_hold !== null && (board.my_hold.status === 'held' || board.my_hold.status === 'pending-payment');
    if (isHolder && board.my_hold?.status === 'held') return;
    if (board.status !== 'available') return;
    if (sessionUser?.role === 'maker') {
      host.innerHTML = `<button id="hold-board"${services.billing === 'down' || !canHold() ? ' disabled' : ''}>${services.billing === 'down' ? 'Holds paused' : 'Hold board'}</button>`;
      document.getElementById('hold-board')?.addEventListener('click', () => {
        void api.session().then(() => {
          openHoldDialog();
        }).catch(() => {
          keepLayout();
          window.location.href = `/sign-in?next=${encodeURIComponent(`/boards/${tag}`)}`;
        });
      });
    } else if (sessionUser === null) {
      host.innerHTML = `<a href="/sign-in?next=${encodeURIComponent(`/boards/${tag}`)}" id="sign-in-to-hold">Sign in to hold</a>`;
    }
  }

  function clearFitVisuals(): void {
    fitVerdictText = '';
    const fitResultEl = document.getElementById('fit-result');
    if (fitResultEl) fitResultEl.textContent = '';
  }

  function snapFor(startMm: number, direction: 1 | -1): number {
    const step = unit === 'mm' ? 10 : 12.7;
    const k = direction === 1 ? Math.ceil((startMm + 0.00001) / step) : Math.floor((startMm - 0.00001) / step);
    const mark = unit === 'mm' ? k * 10 : Math.round(k * 127) / 10;
    return Math.max(0, mark);
  }

  // ---- hold dialog ---------------------------------------------------------

  function openHoldDialog(): void {
    holdDialogOpen = true;
    holdDialogKey = `hold-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    dialogCard = '';
    renderHoldDialog();
  }

  function renderHoldDialog(): void {
    const host = document.getElementById('hold-dialog-host') as HTMLElement;
    host.innerHTML = `<div class="sheet-backdrop centre" id="hold-backdrop"></div>
      <div class="sheet-centre" role="dialog" aria-label="Hold this board" aria-modal="true" id="hold-dialog">
        <h2>Hold this board</h2>
        <div class="field">
          <label for="card-number">Card number</label>
          <input id="card-number" inputmode="numeric" autocomplete="off" value="${escapeHtml(dialogCard)}">
          <div id="card-error" class="error-text"></div>
        </div>
        <div class="sheet-actions">
          <button id="pay-deposit" class="primary">Pay deposit and hold</button>
          <button id="hold-close">Close</button>
        </div>
      </div>`;
    const dialog = document.getElementById('hold-dialog') as HTMLElement;
    const cardInput = document.getElementById('card-number') as HTMLInputElement;
    document.getElementById('hold-backdrop')?.addEventListener('click', closeHoldDialog);
    document.getElementById('hold-close')?.addEventListener('click', closeHoldDialog);
    cardInput.addEventListener('input', () => {
      dialogCard = cardInput.value;
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHoldDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      trapFocus(dialog, event);
    });
    const pay = document.getElementById('pay-deposit') as HTMLButtonElement;
    pay.addEventListener('click', () => void submitHold());
    cardInput.focus();
  }

  function closeHoldDialog(): void {
    holdDialogOpen = false;
    document.getElementById('hold-dialog-host')!.innerHTML = '';
    document.getElementById('hold-board')?.focus();
  }

  async function submitHold(): Promise<void> {
    const pay = document.getElementById('pay-deposit') as HTMLButtonElement | null;
    const cardInput = document.getElementById('card-number') as HTMLInputElement | null;
    const errorEl = document.getElementById('card-error') as HTMLElement | null;
    if (pay === null || cardInput === null || errorEl === null) return;
    const digits = cardInput.value.replace(/\s+/g, '');
    if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) {
      errorEl.textContent = 'Enter a valid card number.';
      return;
    }
    if (pay.disabled) return;
    pay.disabled = true;
    const previous = pay.textContent;
    pay.textContent = 'Holding';
    const statusEl = document.getElementById('hold-status') as HTMLElement | null;
    if (statusEl) statusEl.textContent = 'Waiting for billing to confirm your deposit';
    try {
      await api.hold(tag, piecesOf(chips), digits, holdDialogKey);
      holdDialogOpen = false;
      holdStatusText = 'Board held. Deposit paid.';
      await reloadBoard();
      render();
    } catch (error) {
      const apiError = error as { status?: number; code?: string; message?: string };
      if (apiError.code === 'card_declined') {
        holdDialogOpen = false;
        holdStatusText = 'Your card was declined. The board is still available.';
        await reloadBoard();
        render();
      } else if (apiError.code === 'already_held') {
        renderConflictDialog();
      } else if (apiError.code === 'billing_unavailable') {
        pay.disabled = false;
        pay.textContent = 'Holds paused';
        cardInput.focus();
        if (statusEl) statusEl.textContent = 'Billing is offline. Your card was not charged.';
        await askServices();
      } else if (apiError.status === 401) {
        keepLayout();
        window.location.href = `/sign-in?next=${encodeURIComponent(`/boards/${tag}`)}`;
      } else {
        pay.disabled = false;
        pay.textContent = previous ?? 'Pay deposit and hold';
        if (statusEl) statusEl.textContent = 'Something went wrong. Try again.';
      }
    }
  }

  function renderConflictDialog(): void {
    const host = document.getElementById('hold-dialog-host') as HTMLElement;
    holdDialogOpen = false;
    host.innerHTML = `<div class="sheet-backdrop centre" id="hold-backdrop"></div>
      <div class="sheet-centre" role="dialog" aria-label="Already held by another maker" aria-modal="true">
        <h2>Already held by another maker</h2>
        <p>Someone held this board a moment before you. Your card was not charged.</p>
        <div class="sheet-actions"><button id="conflict-close">Close</button></div>
      </div>`;
    document.getElementById('hold-backdrop')?.addEventListener('click', () => {
      host.innerHTML = '';
    });
    document.getElementById('conflict-close')?.addEventListener('click', () => {
      host.innerHTML = '';
    });
    document.getElementById('conflict-close')?.focus();
  }

  async function askServices(): Promise<void> {
    try {
      services = await api.services();
      const notice = document.getElementById('service-notice');
      if (notice) {
        notice.innerHTML = services.billing === 'down'
          ? `<div class="banner" data-banner="billing">Billing is offline. You can browse and plan cuts, but holds and purchases are paused.</div>`
          : '';
      }
    } catch {
      // leave as is
    }
  }

  async function reloadBoard(): Promise<void> {
    try {
      const result = await api.board(tag);
      board = result.board;
    } catch {
      // board may have changed
    }
  }

  function keepLayout(): void {
    try {
      window.sessionStorage.setItem(`kerfwell-layout-${tag}`, JSON.stringify(chips));
    } catch {
      // storage unavailable: layout cannot survive
    }
  }

  function sessionStorageGet(key: string): Chip[] | null {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Chip[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function sessionStorageRemove(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // nothing to do
    }
  }

  function luhn(digits: string): boolean {
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
      let value = Number(digits[i]);
      if (double) {
        value *= 2;
        if (value > 9) value -= 9;
      }
      sum += value;
      double = !double;
    }
    return sum % 10 === 0;
  }

  // ---- hold actions --------------------------------------------------------

  async function cancelHold(): Promise<void> {
    if (board?.my_hold === null || board === null) return;
    const button = document.getElementById('cancel-hold') as HTMLButtonElement | null;
    if (button === null) return;
    button.disabled = true;
    button.textContent = 'Cancelling';
    try {
      await api.cancelHold(board.my_hold.id);
      holdStatusText = 'Hold released. Deposit refunded.';
      await reloadBoard();
      render();
      document.getElementById('hold-board')?.focus();
    } catch (error) {
      const apiError = error as { code?: string };
      if (apiError.code === 'hold_not_active') {
        await reloadBoard();
        holdStatusText = 'This hold is no longer active.';
        render();
      } else if (apiError.code === 'billing_unavailable') {
        button.disabled = false;
        button.textContent = 'Cancel hold';
        holdStatusText = 'Billing is offline. Your hold is unchanged.';
        render();
        await askServices();
      } else {
        button.disabled = false;
        button.textContent = 'Cancel hold';
        holdStatusText = 'Something went wrong. Try again.';
        render();
      }
    }
  }

  async function payAndCut(): Promise<void> {
    if (board?.my_hold === null || board === null) return;
    const button = document.getElementById('pay-and-cut') as HTMLButtonElement | null;
    if (button === null) return;
    button.disabled = true;
    button.textContent = 'Paying';
    const key = `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const result = await api.purchase(board.my_hold.id, key);
      holdStatusText = `Paid. Cut ticket ${result.sale.ticket} is with the saw.`;
      await reloadBoard();
      render();
    } catch (error) {
      const apiError = error as { code?: string };
      if (apiError.code === 'storage_unavailable') {
        holdStatusText = "Cut tickets can't be saved right now. Your hold is safe and nothing was charged.";
      } else if (apiError.code === 'payment_failed') {
        holdStatusText = 'Billing did not confirm the payment. You were not charged.';
      } else if (apiError.code === 'hold_not_active') {
        await reloadBoard();
        holdStatusText = 'This hold is no longer active.';
      } else if (apiError.code === 'billing_unavailable') {
        holdStatusText = 'Billing is offline. Your hold is safe and nothing was charged.';
        await askServices();
      } else {
        holdStatusText = 'Something went wrong. Try again.';
      }
      render();
    }
  }

  // ---- layout files --------------------------------------------------------

  /** Version 2 export carrying the unknown keys kept from the last import. */
  function buildExportFile(): Record<string, unknown> {
    const known = new Set(['format', 'version', 'board', 'unit', 'pieces']);
    const out: Record<string, unknown> = { format: 'kerf', version: 2, board: tag, unit: 'mm' };
    if (lastImportedFile !== null) {
      for (const key of Object.keys(lastImportedFile)) {
        if (!known.has(key)) out[key] = lastImportedFile[key];
      }
    }
    const imported = (lastImportedFile?.['pieces'] as Array<Record<string, unknown>> | undefined) ?? [];
    out['pieces'] = chips.map((chip, index) => {
      const piece: Record<string, unknown> = {
        label: chip.label,
        length_mm: chip.length_mm,
        width_mm: chip.width_mm,
        start_mm: chip.start_mm,
      };
      const source = imported[index];
      if (source !== undefined) {
        for (const key of Object.keys(source)) {
          if (key !== 'label' && key !== 'length_mm' && key !== 'width_mm' && key !== 'start_mm') {
            piece[key] = source[key];
          }
        }
      }
      return piece;
    });
    return out;
  }

  async function exportLayout(): Promise<void> {
    if (board === null) return;
    const button = document.getElementById('export-layout') as HTMLButtonElement | null;
    if (button === null) return;
    button.disabled = true;
    button.textContent = 'Exporting';
    try {
      const file = buildExportFile();
      await api.importLayout(tag, new TextEncoder().encode(JSON.stringify(file)).buffer as ArrayBuffer);
      const response = await fetch(`/api/boards/${encodeURIComponent(tag)}/layout.kerf`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('export failed');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const blob = new Blob([bytes], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${tag}.kerf`;
      link.click();
      URL.revokeObjectURL(link.href);
      fileStatusText = `Layout exported as ${tag}.kerf.`;
    } catch {
      fileStatusText = 'Something went wrong. Try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Export layout';
      const statusEl = document.getElementById('layout-file-status');
      if (statusEl) statusEl.textContent = fileStatusText;
    }
  }

  async function importLayoutFile(file: File): Promise<void> {
    const button = document.getElementById('import-layout') as HTMLButtonElement | null;
    if (button === null) return;
    button.disabled = true;
    button.textContent = 'Importing';
    try {
      const bytes = await file.arrayBuffer();
      const result = await api.importLayout(tag, bytes);
      const layout = result.layout as { pieces: Array<{ label: string; length_mm: number; width_mm: number; start_mm: number }> };
      lastImportedFile = result.layout as Record<string, unknown>;
      pushHistory();
      chips = layout.pieces.map((p) => ({ label: p.label, length_mm: p.length_mm, width_mm: p.width_mm, start_mm: p.start_mm, rotated: false }));
      fit = null;
      fitVerdictText = '';
      fileStatusText = layout.pieces.length === 1 ? 'Imported 1 piece from the layout file.' : `Imported ${layout.pieces.length} pieces from the layout file.`;
      render();
      void refreshTotals();
    } catch (error) {
      const apiError = error as { code?: string };
      if (apiError.code === 'unsupported_version') {
        fileStatusText = 'This layout file is from a newer version of Kerfwell. Nothing was changed.';
      } else if (apiError.code === 'wrong_board') {
        fileStatusText = 'This layout file is for another board. Nothing was changed.';
      } else {
        fileStatusText = "This layout file can't be read. Nothing was changed.";
      }
      const statusEl = document.getElementById('layout-file-status');
      if (statusEl) statusEl.textContent = fileStatusText;
    } finally {
      button.disabled = false;
      button.textContent = 'Import layout';
    }
  }

  // ---- wiring -------------------------------------------------------------

  function wire(): void {
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="units"]')) {
      radio.addEventListener('change', () => {
        unit = radio.value === 'in' ? 'in' : 'mm';
        storeUnit(unit);
        render();
      });
    }
    const form = document.getElementById('piece-form') as HTMLFormElement | null;
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const label = (document.getElementById('piece-label') as HTMLInputElement).value.trim();
      const lengthText = (document.getElementById('piece-length') as HTMLInputElement).value.trim();
      const widthText = (document.getElementById('piece-width') as HTMLInputElement).value.trim();
      if (label.length < 1 || label.length > 40) return;
      const lengthMm = parseLength(lengthText);
      const widthMm = parseLength(widthText);
      if (lengthMm === null || lengthMm < 1 || lengthMm > 12000) return;
      if (widthMm === null || widthMm < 1 || widthMm > 600) return;
      addPiece(label, lengthMm, widthMm);
      (document.getElementById('piece-label') as HTMLInputElement).value = '';
      document.getElementById('piece-label')?.focus();
    });
    document.getElementById('undo')?.addEventListener('click', () => {
      const focused = document.activeElement;
      undo();
      const undoBtn = document.getElementById('undo') as HTMLButtonElement | null;
      if (undoBtn?.disabled) {
        const redoBtn = document.getElementById('redo') as HTMLButtonElement | null;
        if (redoBtn && !redoBtn.disabled) redoBtn.focus();
        else document.getElementById('piece-label')?.focus();
      } else if (focused === undoBtn) {
        undoBtn?.focus();
      }
    });
    document.getElementById('redo')?.addEventListener('click', () => {
      redo();
      const redoBtn = document.getElementById('redo') as HTMLButtonElement | null;
      if (redoBtn?.disabled) {
        const undoBtn = document.getElementById('undo') as HTMLButtonElement | null;
        if (undoBtn && !undoBtn.disabled) undoBtn.focus();
        else document.getElementById('piece-label')?.focus();
      } else {
        redoBtn?.focus();
      }
    });
    document.getElementById('fit-check')?.addEventListener('click', () => void runFitCheck());
    document.getElementById('hold-board')?.addEventListener('click', () => {
      void api.session().then(() => {
        openHoldDialog();
      }).catch(() => {
        keepLayout();
        window.location.href = `/sign-in?next=${encodeURIComponent(`/boards/${tag}`)}`;
      });
    });
    const signInLink = document.getElementById('sign-in-to-hold');
    signInLink?.addEventListener('click', () => {
      keepLayout();
    });
    document.getElementById('cancel-hold')?.addEventListener('click', () => void cancelHold());
    document.getElementById('pay-and-cut')?.addEventListener('click', () => void payAndCut());
    document.getElementById('export-layout')?.addEventListener('click', () => void exportLayout());
    document.getElementById('import-layout')?.addEventListener('click', () => {
      document.getElementById('layout-file')?.click();
    });
    const fileInput = document.getElementById('layout-file') as HTMLInputElement | null;
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void importLayoutFile(file);
    });

    wireChips();

    const region = document.querySelector('.layout-region') as HTMLElement | null;
    region?.addEventListener('keydown', (event) => {
      const key = event.key;
      const inText = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (!inText && (key === 'f' || key === 'F')) {
        event.preventDefault();
        void runFitCheck();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
        if (inText) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (selected === null || inText) return;
      const chip = chips[selected];
      if (chip === undefined) return;
      const step = event.shiftKey ? 10 : 1;
      if (key === 'ArrowRight') {
        event.preventDefault();
        beginArrowRun(() => {
          let target = chip.start_mm;
          for (let i = 0; i < step; i += 1) target = snapFor(target, 1);
          moveChip(selected as number, target);
        });
      } else if (key === 'ArrowLeft') {
        event.preventDefault();
        beginArrowRun(() => {
          let target = chip.start_mm;
          for (let i = 0; i < step; i += 1) target = snapFor(target, -1);
          moveChip(selected as number, target);
        });
      } else if (key === 'r' || key === 'R') {
        event.preventDefault();
        rotateChip(selected);
      } else if (key === 'Delete' || key === 'Backspace') {
        event.preventDefault();
        const removedIndex = selected;
        selected = null;
        removeChip(removedIndex);
        const remaining = chips.length;
        if (remaining === 0) {
          document.getElementById('piece-label')?.focus();
        } else {
          const focusIndex = Math.min(removedIndex, remaining - 1);
          const next = document.querySelector<HTMLElement>(`[data-chip="${focusIndex}"]`);
          next?.focus();
        }
      } else if (key === 'Escape') {
        selected = null;
        drawChips();
      }
    });
  }

  function beginArrowRun(apply: () => void): void {
    if (!arrowRunActive) {
      pushHistory();
      arrowRunActive = true;
    }
    apply();
    window.clearTimeout(arrowRunTimer);
    arrowRunTimer = window.setTimeout(() => {
      arrowRunActive = false;
    }, 280);
  }

  function parseLength(text: string): number | null {
    const trimmed = text.trim();
    if (unit === 'mm') {
      if (!/^\d+$/.test(trimmed)) return null;
      return Number(trimmed);
    }
    if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '') return null;
    const [wholePart, fracPart = ''] = trimmed.split('.');
    const scale = 10 ** fracPart.length;
    const num = BigInt(wholePart || '0') * BigInt(scale) + (fracPart ? BigInt(fracPart) : 0n);
    const prod = num * 254n;
    const denom = BigInt(scale) * 10n;
    let q = prod / denom;
    const rem = prod % denom;
    if (rem * 2n >= denom) q += 1n;
    return Number(q);
  }

  function wireDrag(chipEl: HTMLElement, index: number): void {
    let dragging = false;
    let startPointerX = 0;
    let startStart = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = true;
      startPointerX = event.clientX;
      startStart = chips[index].start_mm;
      pushHistory();
      chipEl.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const svg = document.querySelector('.elevation-wrap svg');
      const scale = svg ? Number((svg as unknown as { dataset: Record<string, string> }).dataset['scale'] ?? '1') : 1;
      const delta = (event.clientX - startPointerX) / scale;
      chips[index] = { ...chips[index], start_mm: Math.max(0, Math.round(startStart + delta)) };
      drawElevation();
      drawChips();
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      const snapped = snapToNearest(chips[index].start_mm);
      if (snapped !== startStart) {
        moveChip(index, snapped);
      }
    };
    chipEl.addEventListener('pointerdown', onPointerDown);
    chipEl.addEventListener('pointermove', onPointerMove);
    chipEl.addEventListener('pointerup', onPointerUp);
    chipEl.addEventListener('pointercancel', onPointerUp);
    chipEl.addEventListener('touchstart', (event) => {
      if (chips[index] !== undefined) event.preventDefault();
    }, { passive: false });
  }

  function snapToNearest(startMm: number): number {
    const step = unit === 'mm' ? 10 : 12.7;
    const lower = Math.floor(startMm / step) * (unit === 'mm' ? 10 : Math.floor(step));
    void lower;
    if (unit === 'mm') {
      const k = Math.round(startMm / 10);
      return Math.max(0, k * 10);
    }
    // Inches: marks at k*12.7 rounded half up
    const k = Math.floor(startMm / 12.7);
    const markA = Math.round(k * 127) / 10;
    const markB = Math.round((k + 1) * 127) / 10;
    const distanceA = startMm - markA;
    const distanceB = markB - startMm;
    if (distanceA < distanceB) return Math.max(0, markA);
    return Math.max(0, markB);
  }
}
