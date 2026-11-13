import { DEPOSIT_CENTS, MAX_PIECES } from '../../shared/constants';
import { pieceStatus } from '../../shared/geometry';
import { Unit, parseLengthField } from '../../shared/units';
import { getJson, postJson, postRaw } from '../api';
import { clear, el, isTextField, labelled, openDialog, prefersReducedMotion, setText } from '../dom';
import { dimensions, formatAmount, formatInstant, length } from '../fmt';
import { HOLD_COPY, cardNumberLooksValid, newIdempotencyKey } from '../holdlogic';
import { Chip, LayoutHistory, nearestMark, nextMark, previousMark, signatureOf } from '../layoutstate';
import { chipsFromFile, fileFromChips } from '../layoutfileclient';
import { navigate } from '../router';
import { Page } from '../shell';
import { onUnitChange, refreshServices, setUnit, store, unit } from '../store';
import { drawElevation } from '../strip';
import { Board, Fit, Hold, LayoutFile, Sale } from '../types';
import { notFoundPage } from './notfound';

const BOARD_STATUS_LABELS: Record<string, string> = {
  tagged: 'Tagged',
  graded: 'Graded',
  available: 'Available',
  held: 'Held',
  'sold-whole': 'Sold',
  cut: 'Cut'
};

const KERF_STEP_MS = 125;
const OFFCUT_FADE_MS = 250;
const KEPT_LAYOUT_PREFIX = 'kerfwell.layout.';

interface KeptLayout {
  pieces: Chip[];
}

export function keepLayout(tag: string, chips: Chip[]): void {
  window.sessionStorage.setItem(KEPT_LAYOUT_PREFIX + tag, JSON.stringify({ pieces: chips }));
}

function takeKeptLayout(tag: string): Chip[] | null {
  const raw = window.sessionStorage.getItem(KEPT_LAYOUT_PREFIX + tag);
  if (raw === null) return null;
  window.sessionStorage.removeItem(KEPT_LAYOUT_PREFIX + tag);
  try {
    const parsed = JSON.parse(raw) as KeptLayout;
    return parsed.pieces.map((piece) => ({ ...piece, unknown: [] }));
  } catch {
    return null;
  }
}

export async function boardPage(tag: string): Promise<Page> {
  const first = await getJson<{ board: Board }>(`/api/boards/${encodeURIComponent(tag)}`);
  if (!first.ok || first.data === null) return notFoundPage();
  let board = first.data.board;

  let chips: Chip[] = [];
  let topUnknown: Array<[string, unknown]> = [];
  let selected = -1;
  let lastFit: Fit | null = null;
  let fitSignature = '';
  let liveFit: Fit | null = null;
  let showingCuts = false;
  const history = new LayoutHistory(chips);
  const animationTimers: number[] = [];

  const elevationHolder = el('div', { class: 'strip-holder elevation-holder' });
  const chipGroup = el('div', { class: 'chip-group', attrs: { role: 'group', 'aria-label': 'Cut list' } });
  const undoButton = el('button', { text: 'Undo', attrs: { type: 'button' } });
  const redoButton = el('button', { text: 'Redo', attrs: { type: 'button' } });
  const labelField = el('input', { attrs: { type: 'text', maxlength: '40' } });
  const pieceLength = el('input', { attrs: { type: 'text', inputmode: 'decimal' } });
  const pieceWidth = el('input', { attrs: { type: 'text', inputmode: 'decimal' } });
  const addPiece = el('button', { class: 'primary', text: 'Add piece', attrs: { type: 'button' } });
  const fitButton = el('button', { class: 'primary', text: 'Fit check', attrs: { type: 'button' } });
  const fitResult = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Fit result' } });
  const totals = el('div', { class: 'live totals', attrs: { role: 'status', 'aria-label': 'Layout totals' } });
  const exportButton = el('button', { text: 'Export layout', attrs: { type: 'button' } });
  const importButton = el('button', { text: 'Import layout', attrs: { type: 'button' } });
  const importInput = el('input', { class: 'hidden-file', attrs: { type: 'file', accept: '.kerf,.json' } });
  const fileStatus = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Layout file status' } });
  const holdStatus = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Hold status' } });
  const holdControls = el('div', { class: 'row hold-controls' });
  const badge = el('span', { class: 'badge', text: BOARD_STATUS_LABELS[board.status] ?? board.status });
  const photoRow = el('div', { class: 'photos' });
  const headerFacts = el('div', { class: 'board-facts' });

  const isMaker = store.user !== null && store.user.role === 'maker';

  function clearAnimations(): void {
    for (const timer of animationTimers) window.clearTimeout(timer);
    animationTimers.length = 0;
  }

  function currentUnit(): Unit {
    return unit();
  }

  function overDefect(index: number): boolean {
    if (lastFit !== null && signatureOf(chips) === fitSignature) {
      return lastFit.pieces[index]?.status === 'over defect';
    }
    return pieceStatus(index, chips, board) === 'over defect';
  }

  function chipName(chip: Chip, index: number): string {
    const base = `${chip.label}, ${length(chip.length_mm, currentUnit())} at ${length(chip.start_mm, currentUnit())}`;
    return overDefect(index) ? `${base}, over defect` : base;
  }

  function chipButton(index: number): HTMLButtonElement {
    const button = el('button', {
      class: 'chip',
      attrs: { type: 'button', 'aria-pressed': 'false', 'data-chip': String(index) }
    });
    button.appendChild(el('span', { class: 'chip-text' }));
    button.appendChild(el('span', { class: 'chip-start mono' }));
    button.appendChild(el('span', { class: 'chip-flag', text: 'over defect' }));
    attachChipHandlers(button, index);
    return button;
  }

  /** Chip buttons are updated in place so a move or a refresh never takes focus away. */
  function renderChips(): void {
    const existing = [...chipGroup.querySelectorAll<HTMLButtonElement>('button.chip')];
    if (existing.length !== chips.length) {
      clear(chipGroup);
      for (let index = 0; index < chips.length; index += 1) chipGroup.appendChild(chipButton(index));
    }
    const buttons = [...chipGroup.querySelectorAll<HTMLButtonElement>('button.chip')];
    chips.forEach((chip, index) => {
      const button = buttons[index];
      if (button === undefined) return;
      const flagged = overDefect(index);
      button.classList.toggle('over-defect', flagged);
      button.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
      button.setAttribute('aria-label', chipName(chip, index));
      const parts = button.querySelectorAll('span');
      const text = parts[0];
      const start = parts[1];
      const flag = parts[2];
      if (text !== undefined) setText(text, `${chip.label} ${length(chip.length_mm, currentUnit())}`);
      if (start !== undefined) setText(start, `at ${length(chip.start_mm, currentUnit())}`);
      if (flag instanceof HTMLElement) flag.hidden = !flagged;
    });
    addPiece.disabled = chips.length >= MAX_PIECES;
    exportButton.disabled = chips.length === 0;
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
  }

  function renderElevation(): void {
    const width = elevationHolder.clientWidth;
    if (width <= 0) {
      window.requestAnimationFrame(renderElevation);
      return;
    }
    const fit = showingCuts ? lastFit : null;
    const offcut =
      fit !== null && fit.take_mm !== null && fit.offcut_mm !== null
        ? { start_mm: fit.take_mm + 4, length_mm: fit.offcut_mm }
        : null;
    clear(elevationHolder);
    elevationHolder.appendChild(
      drawElevation({
        tag: board.tag,
        widthPx: width,
        lengthMm: board.length_mm,
        defects: board.defects,
        pieces: chips.map((chip, index) => ({ ...chip, status: overDefect(index) ? 'over defect' : 'clear' })),
        cuts: fit === null ? [] : fit.cuts_mm,
        offcut,
        unit: currentUnit()
      })
    );
    attachElevationDrag();
  }

  function renderTotals(): void {
    clear(totals);
    if (chips.length === 0) {
      totals.appendChild(el('span', { text: 'Add a piece to see the take and price.' }));
      return;
    }
    const fit = liveFit;
    if (fit === null || fit.take_mm === null || fit.price_cents === null || fit.board_feet === null) {
      totals.appendChild(el('span', { text: 'Fix the layout to see the take and price.' }));
      return;
    }
    const figures: string[] = [
      `Take ${length(fit.take_mm, currentUnit())}`,
      `Board feet ${fit.board_feet} bd ft`,
      `Price $${formatAmount(fit.price_cents)}`,
      fit.sale === 'whole' ? 'Clear offcut none' : `Clear offcut ${length(fit.clear_offcut_mm ?? 0, currentUnit())}`
    ];
    for (const figure of figures) {
      totals.appendChild(el('span', { class: `figure mono${figuresDimmed ? ' dimmed' : ''}`, text: figure }));
    }
  }

  let figuresDimmed = false;

  function dimFigures(dim: boolean): void {
    figuresDimmed = dim;
    for (const figure of totals.querySelectorAll('.figure')) figure.classList.toggle('dimmed', dim);
  }

  let liveSequence = 0;
  let liveTimer = 0;

  function layoutChanged(): void {
    clearAnimations();
    showingCuts = false;
    renderChips();
    renderElevation();
    updateHoldControls();
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => void runLiveTotals(), 100);
  }

  async function runLiveTotals(): Promise<void> {
    if (chips.length === 0) {
      liveFit = null;
      liveSequence += 1;
      renderTotals();
      return;
    }
    const mine = liveSequence + 1;
    liveSequence = mine;
    const result = await postJson<Fit>(`/api/boards/${board.tag}/fit`, { pieces: piecesFor(chips) });
    if (mine !== liveSequence) return;
    liveFit = result.ok ? result.data : null;
    renderTotals();
  }

  function piecesFor(source: Chip[]): Array<{ label: string; length_mm: number; width_mm: number; start_mm: number }> {
    return source.map((chip) => ({
      label: chip.label,
      length_mm: chip.length_mm,
      width_mm: chip.width_mm,
      start_mm: chip.start_mm
    }));
  }

  async function runFitCheck(): Promise<void> {
    if (chips.length === 0) {
      setText(fitResult, 'Add a piece to see the take and price.');
      return;
    }
    fitButton.disabled = true;
    fitButton.textContent = 'Checking fit';
    dimFigures(true);
    const signature = signatureOf(chips);
    const result = await postJson<Fit>(`/api/boards/${board.tag}/fit`, { pieces: piecesFor(chips) });
    fitButton.disabled = false;
    fitButton.textContent = 'Fit check';
    if (!result.ok || result.data === null) {
      dimFigures(false);
      setText(fitResult, 'Fit check failed. Try again.');
      return;
    }
    if (signatureOf(chips) !== signature) {
      dimFigures(false);
      return;
    }
    lastFit = result.data;
    liveFit = result.data;
    fitSignature = signature;
    showingCuts = true;
    setText(fitResult, result.data.verdict);
    renderChips();
    renderTotals();
    renderElevation();
    playKerfSequence();
    updateHoldControls();
  }

  function playKerfSequence(): void {
    clearAnimations();
    const svg = elevationHolder.querySelector('svg');
    if (svg === null) return;
    const lines = [...svg.querySelectorAll<SVGElement>('[data-kerf]')];
    const offcut = svg.querySelector<SVGElement>('.offcut-group');
    if (prefersReducedMotion()) {
      for (const line of lines) line.classList.add('shown');
      offcut?.classList.add('shown');
      dimFigures(false);
      return;
    }
    lines.forEach((line, index) => {
      line.style.animationDelay = `${index * KERF_STEP_MS}ms`;
      line.classList.add('drawing');
    });
    const afterKerf = lines.length * KERF_STEP_MS;
    if (offcut !== null) {
      offcut.style.animationDelay = `${afterKerf}ms`;
      offcut.classList.add('fading');
    }
    const settleAt = afterKerf + (offcut === null ? 0 : OFFCUT_FADE_MS);
    animationTimers.push(
      window.setTimeout(() => {
        dimFigures(false);
      }, settleAt)
    );
  }

  function moveChip(index: number, to: number): void {
    const chip = chips[index];
    if (chip === undefined) return;
    chips[index] = { ...chip, start_mm: Math.max(0, to) };
    layoutChanged();
  }

  function attachChipHandlers(button: HTMLButtonElement, index: number): void {
    button.addEventListener('click', () => {
      selected = selected === index ? -1 : index;
      renderChips();
      chipGroup.querySelector<HTMLElement>(`[data-chip="${index}"]`)?.focus();
    });
    button.addEventListener('keydown', (event) => onChipKey(event, index));
    let dragging = false;
    let originX = 0;
    let originStart = 0;
    button.addEventListener('pointerdown', (event) => {
      dragging = true;
      originX = event.clientX;
      originStart = chips[index]?.start_mm ?? 0;
      history.begin(chips);
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault();
      const scale = scaleOfElevation();
      if (scale <= 0) return;
      const chip = chips[index];
      if (chip === undefined) return;
      chips[index] = { ...chip, start_mm: Math.max(0, originStart + (event.clientX - originX) / scale) };
      slidePiece(index);
    });
    button.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const chip = chips[index];
      if (chip === undefined) return;
      chips[index] = { ...chip, start_mm: nearestMark(chip.start_mm, currentUnit()) };
      history.commit(chips);
      layoutChanged();
    });
  }

  /** Moves one drawn piece while a drag is in flight, without redrawing the elevation. */
  function slidePiece(index: number): void {
    const chip = chips[index];
    const svg = elevationHolder.querySelector('svg');
    if (chip === undefined || svg === null) return;
    const scale = Number(svg.getAttribute('data-scale') ?? '0');
    const band = svg.querySelector(`[data-piece="${index}"]`);
    const labels = svg.querySelectorAll('.piece-label');
    band?.setAttribute('x', String(chip.start_mm * scale));
    labels[index]?.setAttribute('x', String(chip.start_mm * scale + 4));
  }

  function scaleOfElevation(): number {
    const svg = elevationHolder.querySelector('svg');
    return svg === null ? 0 : Number(svg.getAttribute('data-scale') ?? '0');
  }

  function attachElevationDrag(): void {
    const svg = elevationHolder.querySelector('svg');
    if (svg === null) return;
    for (const band of svg.querySelectorAll<SVGElement>('[data-piece]')) {
      const index = Number(band.getAttribute('data-piece') ?? '-1');
      let dragging = false;
      let originX = 0;
      let originStart = 0;
      band.addEventListener('pointerdown', (event) => {
        const pointer = event as PointerEvent;
        dragging = true;
        originX = pointer.clientX;
        originStart = chips[index]?.start_mm ?? 0;
        history.begin(chips);
        event.preventDefault();
      });
      band.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const pointer = event as PointerEvent;
        const scale = scaleOfElevation();
        const chip = chips[index];
        if (scale <= 0 || chip === undefined) return;
        chips[index] = { ...chip, start_mm: Math.max(0, originStart + (pointer.clientX - originX) / scale) };
        slidePiece(index);
      });
      band.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        const chip = chips[index];
        if (chip === undefined) return;
        chips[index] = { ...chip, start_mm: nearestMark(chip.start_mm, currentUnit()) };
        history.commit(chips);
        layoutChanged();
      });
    }
  }

  function focusAfterRemoval(index: number): void {
    if (chips.length === 0) {
      labelField.focus();
      return;
    }
    const target = index < chips.length ? index : chips.length - 1;
    chipGroup.querySelector<HTMLElement>(`[data-chip="${target}"]`)?.focus();
  }

  function onChipKey(event: Event, index: number): void {
    const key = event as KeyboardEvent;
    const chip = chips[index];
    if (chip === undefined) return;
    if (key.key === 'Enter' || key.key === ' ') {
      key.preventDefault();
      selected = index;
      renderChips();
      chipGroup.querySelector<HTMLElement>(`[data-chip="${index}"]`)?.focus();
      return;
    }
    if (selected !== index) return;
    if (key.key === 'Escape') {
      key.preventDefault();
      selected = -1;
      renderChips();
      chipGroup.querySelector<HTMLElement>(`[data-chip="${index}"]`)?.focus();
      return;
    }
    if (key.key === 'ArrowRight' || key.key === 'ArrowLeft') {
      key.preventDefault();
      history.begin(chips);
      const steps = key.shiftKey ? 10 : 1;
      let start = chip.start_mm;
      for (let step = 0; step < steps; step += 1) {
        start = key.key === 'ArrowRight' ? nextMark(start, currentUnit()) : previousMark(start, currentUnit());
      }
      moveChip(index, start);
      chipGroup.querySelector<HTMLElement>(`[data-chip="${index}"]`)?.focus();
      return;
    }
    if (key.key === 'r' || key.key === 'R') {
      key.preventDefault();
      history.begin(chips);
      chips[index] = { ...chip, length_mm: chip.width_mm, width_mm: chip.length_mm, rotated: !chip.rotated };
      history.commit(chips);
      layoutChanged();
      chipGroup.querySelector<HTMLElement>(`[data-chip="${index}"]`)?.focus();
      return;
    }
    if (key.key === 'Delete' || key.key === 'Backspace') {
      key.preventDefault();
      history.begin(chips);
      chips = chips.filter((_chip, at) => at !== index);
      selected = -1;
      history.commit(chips);
      layoutChanged();
      focusAfterRemoval(index);
    }
  }

  function onChipKeyUp(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    if (!history.hasPending) return;
    history.commit(chips);
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
  }

  addPiece.addEventListener('click', () => {
    const label = labelField.value.trim();
    const lengthMm = parseLengthField(pieceLength.value, currentUnit());
    const widthMm = parseLengthField(pieceWidth.value, currentUnit());
    if (label === '' || label.length > 40 || lengthMm === null || widthMm === null || lengthMm < 1 || widthMm < 1) {
      setText(fitResult, 'Give a label, a length and a width.');
      return;
    }
    const last = chips[chips.length - 1];
    const start = last === undefined ? 0 : last.start_mm + last.length_mm + 10;
    history.begin(chips);
    chips = [...chips, { label, length_mm: lengthMm, width_mm: widthMm, start_mm: start, rotated: false, unknown: [] }];
    history.commit(chips);
    layoutChanged();
    labelField.focus();
  });

  undoButton.addEventListener('click', () => applyHistory(history.undo()));
  redoButton.addEventListener('click', () => applyHistory(history.redo()));

  function applyHistory(next: Chip[] | null): void {
    if (next === null) return;
    const wasOnChip = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('chip');
    chips = next;
    selected = -1;
    layoutChanged();
    if (wasOnChip && !(document.activeElement instanceof HTMLButtonElement && document.activeElement.classList.contains('chip'))) {
      labelField.focus();
    }
    if (document.activeElement === undoButton && undoButton.disabled) {
      (redoButton.disabled ? labelField : redoButton).focus();
    } else if (document.activeElement === redoButton && redoButton.disabled) {
      (undoButton.disabled ? labelField : undoButton).focus();
    }
  }

  fitButton.addEventListener('click', () => void runFitCheck());

  function onPageKey(event: KeyboardEvent): void {
    if (isTextField(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
      if (document.querySelector('.dialog-layer') !== null) return;
      event.preventDefault();
      applyHistory(event.shiftKey ? history.redo() : history.undo());
      return;
    }
    if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey) {
      const target = event.target;
      if (target instanceof HTMLElement && layoutRegion.contains(target)) {
        event.preventDefault();
        void runFitCheck();
      }
    }
  }

  const unitRadios = el('fieldset', { class: 'units', attrs: { role: 'radiogroup', 'aria-label': 'Units' } });
  function buildUnitRadios(): void {
    clear(unitRadios);
    unitRadios.appendChild(el('legend', { text: 'Units' }));
    for (const [value, label] of [
      ['mm', 'Millimetres'],
      ['in', 'Inches']
    ] as Array<[Unit, string]>) {
      const radio = el('input', { attrs: { type: 'radio', name: 'units', value } });
      radio.checked = currentUnit() === value;
      radio.addEventListener('change', () => setUnit(value));
      unitRadios.appendChild(labelled(label, radio, 'check'));
    }
  }

  function renderFacts(): void {
    clear(headerFacts);
    headerFacts.appendChild(el('h2', { text: board.species }));
    headerFacts.appendChild(
      el('p', { text: `${board.lot.name} — ${board.lot.origin} (${board.lot.built_year})` })
    );
    if (board.parent_tag !== null) {
      headerFacts.appendChild(el('p', { class: 'mono', text: `Cut from ${board.parent_tag}` }));
    }
    headerFacts.appendChild(
      el('p', { class: 'row' }, [
        el('span', { text: board.grade ?? 'Not graded' }),
        el('span', {
          class: 'mono',
          text: board.rate_cents === null ? 'no rate' : `${board.rate_cents} ¢/bd ft`
        }),
        badge
      ])
    );
    headerFacts.appendChild(
      el('p', {
        class: 'mono',
        text: dimensions(board.length_mm, board.width_mm, board.thickness_mm, currentUnit())
      })
    );
  }

  function renderPhotos(): void {
    clear(photoRow);
    board.photos.forEach((photo, index) => {
      const image = el('img', {
        class: 'board-photo',
        attrs: { src: photo.url, alt: `Photo ${index + 1} of ${board.tag}`, width: photo.width, height: photo.height }
      });
      image.addEventListener('error', () => {
        image.replaceWith(el('div', { class: 'photo-missing', text: 'Photo unavailable' }));
      });
      photoRow.appendChild(image);
    });
  }

  function holdable(): boolean {
    return (
      lastFit !== null &&
      signatureOf(chips) === fitSignature &&
      lastFit.pieces.every((piece) => piece.status === 'clear') &&
      lastFit.price_cents !== null &&
      lastFit.price_cents > DEPOSIT_CENTS
    );
  }

  let holdPending = false;

  const holdButton = el('button', { class: 'primary', text: 'Hold board', attrs: { type: 'button' } });
  const signInLink = el('a', {
    class: 'button-like',
    text: 'Sign in to hold',
    attrs: { href: `/sign-in?next=/boards/${board.tag}` },
    on: {
      click: (event) => {
        event.preventDefault();
        keepLayout(board.tag, chips);
        navigate(`/sign-in?next=/boards/${board.tag}`);
      }
    }
  });
  const payButton = el('button', { class: 'primary', text: 'Pay and cut', attrs: { type: 'button' } });
  const cancelButton = el('button', { text: 'Cancel hold', attrs: { type: 'button' } });
  const heldUntil = el('span', { class: 'mono held-until' });
  const pausedNote = el('p', { class: 'muted paused-note', text: HOLD_COPY.paused });
  holdControls.appendChild(holdButton);
  holdControls.appendChild(signInLink);
  holdControls.appendChild(payButton);
  holdControls.appendChild(cancelButton);
  holdControls.appendChild(heldUntil);
  holdControls.appendChild(pausedNote);

  holdButton.addEventListener('click', () => void beginHold(holdButton));
  payButton.addEventListener('click', () => {
    if (payButton.getAttribute('aria-disabled') === 'true') return;
    void payForCuts(payButton);
  });
  cancelButton.addEventListener('click', () => {
    if (cancelButton.getAttribute('aria-disabled') === 'true') return;
    void cancelHold(cancelButton);
  });

  /** Only labels, hidden flags and paused states change here, so a refresh never moves focus. */
  function updateHoldControls(): void {
    const mine = board.my_hold;
    const billingDown = store.services.billing === 'down';
    const holdsThis = mine !== null && mine.status === 'held';
    const signedOut = store.user === null;
    const staffViewer = store.user !== null && !isMaker;

    payButton.hidden = !holdsThis;
    cancelButton.hidden = !holdsThis;
    heldUntil.hidden = !holdsThis;
    pausedNote.hidden = !(holdsThis && billingDown);
    signInLink.hidden = holdsThis || !signedOut;
    holdButton.hidden = holdsThis || signedOut || staffViewer;

    if (holdsThis && mine !== null && mine.expires_at !== null) {
      setText(heldUntil, `Held until ${formatInstant(mine.expires_at)}`);
    }
    for (const button of [payButton, cancelButton]) {
      if (billingDown) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
    if (!holdButton.hidden) {
      setText(holdButton, billingDown ? 'Holds paused' : 'Hold board');
      holdButton.disabled = billingDown || holdPending || !holdable();
    }
  }

  async function beginHold(button: HTMLButtonElement): Promise<void> {
    const session = await getJson<{ user: unknown }>('/api/session');
    if (!session.ok) {
      keepLayout(board.tag, chips);
      navigate(`/sign-in?next=/boards/${board.tag}`);
      return;
    }
    openHoldDialog(button);
  }

  function openHoldDialog(opener: HTMLButtonElement): void {
    const key = newIdempotencyKey();
    const card = el('input', { attrs: { type: 'text', inputmode: 'numeric', autocomplete: 'off' } });
    const cardError = el('p', { class: 'field-error' });
    const pay = el('button', { class: 'primary', text: 'Pay deposit and hold', attrs: { type: 'button' } });
    const body = el('div', { class: 'dialog-body' }, [labelled('Card number', card), cardError, pay]);
    let sending = false;

    const dialog = openDialog({
      name: 'Hold this board',
      opener,
      build: (handle) => [
        el('h2', { class: 'dialog-title', text: 'Hold this board' }),
        body,
        el('button', { text: 'Close', attrs: { type: 'button' }, on: { click: () => handle.close() } })
      ]
    });

    function applyBilling(): void {
      if (sending) return;
      const down = store.services.billing === 'down';
      pay.textContent = down ? 'Holds paused' : 'Pay deposit and hold';
      pay.disabled = down;
    }
    applyBilling();
    holdDialogRefresh = applyBilling;

    async function send(): Promise<void> {
      if (sending || pay.disabled) return;
      setText(cardError, '');
      if (!cardNumberLooksValid(card.value)) {
        setText(cardError, 'Enter a valid card number.');
        return;
      }
      sending = true;
      holdPending = true;
      pay.disabled = true;
      pay.textContent = 'Holding';
      setText(holdStatus, HOLD_COPY.waiting);
      const result = await postJson<{ hold: Hold }>(
        '/api/holds',
        { board: board.tag, pieces: piecesFor(chips), card_number: card.value },
        { 'Idempotency-Key': key }
      );
      sending = false;
      holdPending = false;
      pay.textContent = 'Pay deposit and hold';
      pay.disabled = false;
      if (result.ok) {
        dialog.close();
        setText(holdStatus, HOLD_COPY.held);
        await reloadBoard();
        return;
      }
      const code = result.failure?.error;
      if (code === 'already_held') {
        pay.remove();
        clear(body);
        body.appendChild(el('h3', { text: HOLD_COPY.alreadyHeldHeading }));
        body.appendChild(el('p', { text: HOLD_COPY.alreadyHeldText }));
        await reloadBoard();
        return;
      }
      if (code === 'billing_unavailable') {
        setText(holdStatus, HOLD_COPY.billingHold);
        pay.textContent = 'Holds paused';
        pay.disabled = true;
        card.focus();
        void refreshServices();
        return;
      }
      dialog.close();
      if (code === 'card_declined') setText(holdStatus, HOLD_COPY.declined);
      else if (code === 'payment_failed') setText(holdStatus, HOLD_COPY.paymentFailed);
      else setText(holdStatus, HOLD_COPY.generic);
      await reloadBoard();
    }

    pay.addEventListener('click', () => void send());
    card.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        void send();
      }
    });
  }

  let holdDialogRefresh: (() => void) | null = null;
  const purchaseKeys = new Map<string, string>();

  async function cancelHold(button: HTMLButtonElement): Promise<void> {
    const mine = board.my_hold;
    if (mine === null) return;
    button.disabled = true;
    button.textContent = 'Cancelling';
    const result = await postJson<{ hold: Hold }>(`/api/holds/${mine.id}/cancel`, {});
    button.disabled = false;
    button.textContent = 'Cancel hold';
    if (result.ok) {
      setText(holdStatus, HOLD_COPY.released);
      await reloadBoard();
      holdButton.focus();
      return;
    }
    const code = result.failure?.error;
    if (code === 'billing_unavailable') {
      setText(holdStatus, HOLD_COPY.billingCancel);
      void refreshServices();
      return;
    }
    if (code === 'hold_not_active') {
      setText(holdStatus, HOLD_COPY.notActive);
      await reloadBoard();
      return;
    }
    setText(holdStatus, HOLD_COPY.generic);
  }

  async function payForCuts(button: HTMLButtonElement): Promise<void> {
    const mine = board.my_hold;
    if (mine === null) return;
    const key = purchaseKeys.get(mine.id) ?? newIdempotencyKey();
    purchaseKeys.set(mine.id, key);
    button.disabled = true;
    button.textContent = 'Paying';
    const result = await postJson<{ sale: Sale }>(`/api/holds/${mine.id}/purchase`, {}, { 'Idempotency-Key': key });
    button.disabled = false;
    button.textContent = 'Pay and cut';
    if (result.ok && result.data !== null) {
      purchaseKeys.delete(mine.id);
      setText(holdStatus, `Paid. Cut ticket ${result.data.sale.ticket} is with the saw.`);
      await reloadBoard();
      return;
    }
    const code = result.failure?.error;
    if (code === 'billing_unavailable') setText(holdStatus, HOLD_COPY.billingPurchase);
    else if (code === 'storage_unavailable') setText(holdStatus, HOLD_COPY.storage);
    else if (code === 'payment_failed') setText(holdStatus, HOLD_COPY.paymentFailed);
    else if (code === 'hold_not_active') {
      setText(holdStatus, HOLD_COPY.notActive);
      await reloadBoard();
      return;
    } else setText(holdStatus, HOLD_COPY.generic);
    void refreshServices();
  }

  async function reloadBoard(): Promise<void> {
    const result = await getJson<{ board: Board }>(`/api/boards/${board.tag}`);
    if (!result.ok || result.data === null) return;
    board = result.data.board;
    setText(badge, BOARD_STATUS_LABELS[board.status] ?? board.status);
    updateHoldControls();
  }

  exportButton.addEventListener('click', () => void exportLayout());
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => void importLayout());

  async function exportLayout(): Promise<void> {
    exportButton.disabled = true;
    exportButton.textContent = 'Exporting';
    const stored = await postJson<{ layout: LayoutFile }>(
      `/api/boards/${board.tag}/layout`,
      fileFromChips(board.tag, chips, topUnknown)
    );
    exportButton.textContent = 'Export layout';
    exportButton.disabled = chips.length === 0;
    if (!stored.ok) {
      setText(fileStatus, HOLD_COPY.generic);
      return;
    }
    const response = await fetch(`/api/boards/${board.tag}/layout.kerf`, { credentials: 'same-origin' });
    if (!response.ok) {
      setText(fileStatus, HOLD_COPY.generic);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = el('a', { attrs: { href: url, download: `${board.tag}.kerf` } });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setText(fileStatus, `Layout exported as ${board.tag}.kerf.`);
  }

  async function importLayout(): Promise<void> {
    const file = importInput.files?.[0];
    if (file === undefined) return;
    importButton.disabled = true;
    importButton.textContent = 'Importing';
    const bytes = await file.arrayBuffer();
    const result = await postRaw<{ layout: LayoutFile }>(`/api/boards/${board.tag}/layout`, bytes, 'application/json');
    importButton.disabled = false;
    importButton.textContent = 'Import layout';
    importInput.value = '';
    if (result.ok && result.data !== null) {
      const imported = chipsFromFile(result.data.layout);
      history.begin(chips);
      chips = imported.chips;
      topUnknown = imported.topUnknown;
      selected = -1;
      history.commit(chips);
      lastFit = null;
      fitSignature = '';
      setText(fitResult, '');
      layoutChanged();
      setText(
        fileStatus,
        chips.length === 1 ? 'Imported 1 piece from the layout file.' : `Imported ${chips.length} pieces from the layout file.`
      );
      return;
    }
    const code = result.failure?.error;
    if (code === 'unsupported_version') setText(fileStatus, 'This layout file is from a newer version of Kerfwell. Nothing was changed.');
    else if (code === 'wrong_board') setText(fileStatus, 'This layout file is for another board. Nothing was changed.');
    else if (code === 'validation' || code === 'bad_json') setText(fileStatus, "This layout file can't be read. Nothing was changed.");
    else setText(fileStatus, HOLD_COPY.generic);
  }

  const layoutRegion = el('div', { class: 'layout-region', attrs: { role: 'region', 'aria-label': 'Layout' } }, [
    chipGroup,
    el('div', { class: 'row' }, [undoButton, redoButton]),
    el('div', { class: 'piece-form' }, [
      labelled('Piece label', labelField),
      labelled('Piece length', pieceLength),
      labelled('Piece width', pieceWidth),
      addPiece
    ]),
    el('div', { class: 'fit-block' }, [fitButton, fitResult, totals]),
    isMaker ? el('div', { class: 'file-block' }, [exportButton, importButton, importInput, fileStatus]) : null,
    el('div', { class: 'hold-block' }, [holdControls, holdStatus])
  ]);

  buildUnitRadios();
  renderFacts();
  renderPhotos();

  const element = el('section', { class: 'page board' }, [
    el('h1', { class: 'page-title mono', text: board.tag }),
    headerFacts,
    photoRow,
    unitRadios,
    elevationHolder,
    layoutRegion
  ]);

  const kept = takeKeptLayout(board.tag);
  if (kept !== null && kept.length > 0) {
    chips = kept;
    history.reset(chips);
  } else if (board.my_hold !== null && board.my_hold.pieces.length > 0) {
    chips = board.my_hold.pieces.map((piece) => ({ ...piece, rotated: false, unknown: [] }));
    history.reset(chips);
  }

  renderChips();
  renderTotals();
  updateHoldControls();
  window.requestAnimationFrame(() => {
    renderElevation();
    if (chips.length > 0) {
      void runFitCheck().then(() => {
        if (kept !== null && kept.length > 0 && holdable() && !holdButton.hidden && !holdButton.disabled) {
          openHoldDialog(holdButton);
        }
      });
    }
  });

  document.addEventListener('keydown', onPageKey);
  document.addEventListener('keyup', onChipKeyUp);
  let resizeTimer = 0;
  const onResize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderElevation, 120);
  };
  window.addEventListener('resize', onResize);
  const stopUnits = onUnitChange(() => {
    buildUnitRadios();
    renderFacts();
    renderChips();
    renderElevation();
    renderTotals();
  });

  const poll = window.setInterval(() => {
    void reloadBoard();
  }, 4000);

  return {
    element,
    banners: ['billing'],
    onServices: () => {
      updateHoldControls();
      holdDialogRefresh?.();
    },
    destroy: () => {
      document.removeEventListener('keydown', onPageKey);
      document.removeEventListener('keyup', onChipKeyUp);
      window.removeEventListener('resize', onResize);
      window.clearInterval(poll);
      window.clearTimeout(liveTimer);
      clearAnimations();
      stopUnits();
    }
  };
}
