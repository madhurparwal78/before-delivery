// The Desk: scan field, loan queue, pegboard, item detail, check-in with hangs and grades.

import type { ScreenKit } from './main';
import { el, clear } from './dom';
import { apiJson, apiForm, ApiFailure } from './apiClient';
import { renderBoard, boardOrder } from './pegboard';
import { money, dueLine, overdueLine, loanStatusWord, itemStatusWord } from './format';
import type { Board, HangResponse, Item, Loan, MemberSummary, CheckinResponse, ServiceStatus } from './types';
import { setPending, clearPending, renderProblems } from './ui';
import { renderNewLoanDialog } from './newLoanDialog';

const SNAP_RADIUS = 24;

export function renderDeskScreen(kit: ScreenKit): () => void {
  const { main, app } = kit;
  clear(main);
  const role = app.role();
  if (role !== 'volunteer' && role !== 'coordinator') {
    const nf = el('div', { class: 'not-found' });
    nf.append(el('h1', { text: "We couldn't find that page." }), el('p', {}, el('a', { href: '/', text: 'Back to the pegboard' })));
    main.append(nf);
    return () => {};
  }

  const timers: ReturnType<typeof setTimeout>[] = [];
  const announce = el('div', { role: 'status', 'aria-label': 'Desk announcements', 'aria-live': 'polite', class: 'status-line' });

  const panes = el('div', { class: 'panes' });
  const queuePane = el('section', { class: 'pane pane-left' });
  const boardPane = el('section', { class: 'pane pane-middle' });
  const detailPane = el('section', { class: 'pane pane-right' });
  panes.append(queuePane, boardPane, detailPane);

  const scan = el('input', { type: 'text', id: 'scan', placeholder: 'Scan or find a loan' }) as HTMLInputElement;
  scan.setAttribute('role', 'searchbox');
  scan.setAttribute('aria-label', 'Scan or find a loan');
  const scanHolder = el('div', { class: 'scan-field' }, scan);

  let loans: Loan[] = [];
  let members: MemberSummary[] = [];
  let board: Board | null = null;
  let selectedLoanId: number | null = null;
  let selectedItemId: number | null = null;
  let filterText = '';
  let focusIndex = -1;
  let hungDuringCheckin = new Set<number>();
  let grades: Record<string, 'good' | 'worn' | 'damaged'> = {};
  let pickedPhoto: File | null = null;
  let returnTimeText = '';
  let returnTimeSecondHour = false;


  const queueBody = el('div', { class: 'pane-body' });
  const boardBody = el('div', { class: 'pane-body pegboard-wrap' });
  const detailBody = el('div', { class: 'pane-body' });

  const newLoanButton = el('button', { class: 'primary', text: 'New loan' }) as HTMLButtonElement;
  newLoanButton.addEventListener('click', () => {
    openNewLoan(newLoanButton, null);
  });

  queuePane.append(el('h2', { text: 'Loan queue' }), queueBody, newLoanButton);
  boardPane.append(el('div', { role: 'region', 'aria-label': 'Pegboard' }, el('h2', { text: 'Pegboard' }), boardBody));
  detailPane.append(el('div', { role: 'region', 'aria-label:': '', 'aria-label': 'Item detail' }, el('h2', { text: 'Item detail' }), detailBody));

  main.append(announce, scanHolder, panes);
  scan.focus();

  // '/' moves focus to the scan field from any control except a text field.
  document.addEventListener('keydown', scanShortcut);
  function scanShortcut(event: KeyboardEvent): void {
    if (event.key !== '/') return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    event.preventDefault();
    scan.focus();
  }

  scan.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      void handleScan(scan.value);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveQueueFocus(event.key === 'ArrowDown' ? 1 : -1);
    }
  });

  async function handleScan(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') return;
    // A loan ref selects that loan.
    const loanHit = loans.find((l) => l.ref.toLowerCase() === trimmed.toLowerCase());
    if (loanHit !== undefined) {
      selectLoan(loanHit.id, true);
      return;
    }
    // A tag of an item on an unreturned loan selects that loan.
    const itemHit = (board?.items ?? []).find((i) => i.tag.toLowerCase() === trimmed.toLowerCase());
    if (itemHit !== undefined) {
      const loanForItem = loans.find((l) => l.items.some((i) => i.id === itemHit.id) && l.status !== 'returned-complete');
      if (loanForItem !== undefined) {
        selectLoan(loanForItem.id, true);
        return;
      }
      if (itemHit.status === 'on-wall' || itemHit.status === 'held') {
        openNewLoan(null, itemHit);
        return;
      }
      // otherwise select the tool
      selectedItemId = itemHit.id;
      renderDetail();
      return;
    }
    // Otherwise filter the queue by member name.
    filterText = trimmed;
    renderQueue();
  }

  function moveQueueFocus(delta: number): void {
    const rows = queueBody.querySelectorAll('li');
    if (rows.length === 0) return;
    focusIndex = (focusIndex + delta + rows.length) % rows.length;
    const target = rows[focusIndex] as HTMLElement;
    target.setAttribute('tabindex', '0');
    target.focus();
    target.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveQueueFocus(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveQueueFocus(-1);
      } else if (event.key === 'Enter') {
        const id = Number(target.getAttribute('data-loan-id'));
        selectLoan(id, true);
      }
    });
  }

  function openNewLoan(opener: HTMLButtonElement | null, presetItem: Item | null): void {
    const cleanup = renderNewLoanDialog({
      app,
      members,
      board,
      announce,
      presetItem,
      opener,
      onReserved: (loan) => {
        selectedLoanId = loan.id;
        void refreshAll().then(() => focusFirstControl());
      },
    });
    dialogCleanups.push(cleanup);
  }

  const dialogCleanups: (() => void)[] = [];

  function focusFirstControl(): void {
    const first = detailBody.querySelector('button');
    if (first instanceof HTMLElement) first.focus();
  }

  async function refreshAll(): Promise<void> {
    const [loansResult, boardResult, statusResult] = await Promise.all([
      apiJson<{ loans: Loan[] }>('GET', '/api/loans'),
      apiJson<Board>('GET', '/api/board'),
      apiJson<ServiceStatus>('GET', '/api/status'),
    ]);
    loans = loansResult.loans;
    board = boardResult;
    app.board = boardResult;
    app.status = statusResult;
    renderQueue();
    renderBoardPane();
    renderDetail();
  }

  function visibleLoans(): Loan[] {
    let list = loans.filter((l) => l.status !== 'returned-complete');
    if (filterText.trim() !== '') {
      const needle = filterText.trim().toLowerCase();
      list = list.filter((l) => l.member_name.toLowerCase().includes(needle));
    }
    return list;
  }

  function renderQueue(): void {
    clear(queueBody);
    const list = el('ul', { class: 'queue-list', role: 'list', 'aria-label': 'Open loans' });
    for (const loan of visibleLoans()) {
      const item = el('li', { 'data-loan-id': String(loan.id), tabindex: '-1' });
      item.setAttribute('role', 'listitem');
      const word = loanStatusWord(loan.status);
      const shape = loan.status === 'reserved' ? 'notch' : loan.status === 'pending-photo' ? 'dotted' : loan.status === 'returned-partial' ? 'half' : 'dashed';
      item.append(
        el('div', {}, el('span', { class: 'mono', text: loan.ref }), ' · ', el('span', { text: loan.member_name })),
        el('div', {}, el('span', { class: 'status-chip' }, el('span', { class: `shape shape-${shape}` }), el('span', { text: word }))),
      );
      if (loan.due_date !== null && loan.due_by !== null) {
        const due = el('div', { class: 'due-line', text: dueLine(loan.due_date, loan.due_by) });
        item.append(due);
        if (loan.status === 'out' && (loan.open_days_late ?? 0) > 0) {
          item.append(el('div', { class: 'overdue-line', text: overdueLine(loan.open_days_late!, loan.late_fee_so_far_cents!) }));
        }
      }
      if (loan.id === selectedLoanId) item.classList.add('selected');
      item.addEventListener('click', () => selectLoan(loan.id, false));
      list.append(item);
    }
    queueBody.append(list);
  }

  function selectLoan(loanId: number, fromScan: boolean): void {
    selectedLoanId = loanId;
    hungDuringCheckin = new Set();
    grades = {};
    pickedPhoto = null;
    returnTimeText = '';
    returnTimeSecondHour = false;
    renderQueue();
    renderDetail();
    if (fromScan) {
      const loan = loans.find((l) => l.id === loanId);
      if (loan !== undefined) {
        if (loan.status === 'out' || loan.status === 'returned-partial') {
          const firstCard = detailBody.querySelector('.tag-cards button');
          if (firstCard instanceof HTMLElement) {
            firstCard.focus();
          } else {
            const firstGrade = detailBody.querySelector('input[type="radio"]');
            if (firstGrade instanceof HTMLElement) firstGrade.focus();
            else scan.focus();
          }
        } else {
          const photoButton = detailBody.querySelector('button');
          if (photoButton instanceof HTMLElement) photoButton.focus();
          else scan.focus();
        }
      }
    }
  }

  function selectedLoan(): Loan | null {
    return loans.find((l) => l.id === selectedLoanId) ?? null;
  }

  function renderBoardPane(): void {
    clear(boardBody);
    if (board === null) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pegboard');
    renderBoard(board, svg, (hit) => handleBoardPick(hit), null, hungDuringCheckin);
    boardBody.append(svg);
  }

  function handleBoardPick(hit: { part: { id: number; item_id: number }; item: Item }): void {
    const loan = selectedLoan();
    if (loan !== null && loan.parts.some((p) => p.id === hit.part.id)) {
      // A hung part's outline during the current check-in selects it in item detail.
      selectedItemId = hit.part.item_id;
      renderDetail();
      return;
    }
    const item = board?.items.find((i) => i.id === hit.item.id);
    if (item === undefined) return;
    if (item.status === 'on-wall' || item.status === 'held') {
      selectedItemId = item.id;
      renderDetail();
      return;
    }
    // An outline whose tool is on no unreturned loan selects the tool.
    selectedItemId = item.id;
    renderDetail();
  }

  function renderDetail(): void {
    clear(detailBody);
    const loan = selectedLoan();
    if (loan !== null) {
      renderLoanDetail(loan);
      return;
    }
    const item = board?.items.find((i) => i.id === selectedItemId);
    if (item === undefined) {
      detailBody.append(el('p', { class: 'hint', text: 'Scan a tag or pick a tool.' }));
      return;
    }
    renderItemDetail(item);
  }

  function renderItemDetail(item: Item): void {
    const card = el('div');
    card.append(el('h3', { text: item.name }));
    card.append(el('p', {}, el('span', { class: 'mono', text: item.tag }), ' — ', itemStatusWord(item.status)));
    if (item.due_date !== null) card.append(el('p', { class: 'due-line', text: `Due ${item.due_date}` }));
    if (item.hold_queue_length > 0) {
      card.append(el('p', { class: 'mono', text: `Queued holds ${item.hold_queue_length}` }));
    } else {
      card.append(el('p', { text: 'No one is waiting for this tool.' }));
    }
    detailBody.append(card);
  }

  function renderLoanDetail(loan: Loan): void {
    const card = el('div');
    card.append(el('h3', { text: `${loan.ref} — ${loan.member_name}` }));
    card.append(el('p', {}, loanStatusWord(loan.status)));

    if (loan.due_date !== null && loan.due_by !== null) {
      card.append(el('p', { class: 'due-line', text: dueLine(loan.due_date, loan.due_by) }));
      if (loan.status === 'out' && (loan.open_days_late ?? 0) > 0) {
        card.append(el('p', { class: 'overdue-line', text: overdueLine(loan.open_days_late!, loan.late_fee_so_far_cents!) }));
      }
    }

    // Reserved loan: photo and check out.
    if (loan.status === 'reserved') {
      const photoButton = el('button', { text: 'Take or choose photo' }) as HTMLButtonElement;
      const photoInput = el('input', { type: 'file', accept: 'image/*', id: `checkout-photo-${loan.id}` }) as HTMLInputElement;
      photoButton.setAttribute('aria-controls', photoInput.id);
      photoInput.style.display = 'none';
      photoButton.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', () => {
        pickedPhoto = photoInput.files?.[0] ?? null;
        updatePickedThumb(card, photoButton);
      });
      const checkout = el('button', { class: 'primary', text: `Check out ${loan.ref}` }) as HTMLButtonElement;
      checkout.addEventListener('click', () => void doCheckout(loan, checkout));
      const cancel = el('button', { text: `Cancel loan ${loan.ref}` }) as HTMLButtonElement;
      cancel.addEventListener('click', () => void doCancelLoan(loan, cancel));
      card.append(el('div', { class: 'row' }, photoButton, photoInput), checkout, cancel);
      detailBody.append(card);
      return;
    }

    // Out or returned-partial: tag cards for unhung parts, in board order.
    if (loan.status === 'out' || loan.status === 'returned-partial') {
      const unhungSorted = [...loan.parts].sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
      const cards = el('div', { class: 'tag-cards' });
      for (const part of unhungSorted) {
        if (part.state === 'hung') continue;
        const btn = el('button', { class: 'tag-card-btn', text: part.name }) as HTMLButtonElement;
        btn.setAttribute('aria-label', `Tag card ${part.name}`);
        attachDrag(btn, loan, part);
        attachKeyboardPick(btn, loan, part);
        cards.append(btn);
      }
      if (cards.childElementCount > 0) card.append(el('p', { text: 'Parts to hang' }), cards);

      if (loan.status === 'out') {
        // Grades per item.
        for (const item of loan.items) {
          const group = el('fieldset');
          group.setAttribute('role', 'radiogroup');
          group.setAttribute('aria-label', `Condition of ${item.name}`);
          const legend = el('legend', { text: `Condition of ${item.name}` });
          group.append(legend);
          for (const value of ['good', 'worn', 'damaged'] as const) {
            const input = el('input', { type: 'radio', name: `grade-${item.id}`, value, id: `grade-${item.id}-${value}` }) as HTMLInputElement;
            if (grades[String(item.id)] === value) input.checked = true;
            input.addEventListener('change', () => {
              grades[String(item.id)] = value;
            });
            group.append(el('label', { for: `grade-${item.id}-${value}` }, input, el('span', { text: value[0]!.toUpperCase() + value.slice(1) })));
          }
          card.append(group);
        }

        const photoButton = el('button', { text: 'Take or choose photo' }) as HTMLButtonElement;
        const photoInput = el('input', { type: 'file', accept: 'image/*', id: `checkin-photo-${loan.id}` }) as HTMLInputElement;
        photoButton.setAttribute('aria-controls', photoInput.id);
        photoInput.style.display = 'none';
        photoButton.addEventListener('click', () => photoInput.click());
        photoInput.addEventListener('change', () => {
          pickedPhoto = photoInput.files?.[0] ?? null;
          updatePickedThumb(card, photoButton);
        });
        updatePickedThumb(card, photoButton);

        const returnHolder = el('div', { class: 'field' });
        const returnInput = el('input', { type: 'text', id: `return-time-${loan.id}`, placeholder: 'YYYY-MM-DD HH:MM' }) as HTMLInputElement;
        returnInput.value = returnTimeText;
        returnHolder.append(el('label', { for: `return-time-${loan.id}`, text: 'Return time' }), returnInput);
        returnInput.addEventListener('input', () => {
          returnTimeText = returnInput.value;
          updateSecondHourCheckbox(returnHolder, returnInput.value);
        });
        card.append(photoButton, photoInput, returnHolder);

        const confirm = el('button', { class: 'primary', text: 'Confirm check-in' }) as HTMLButtonElement;
        confirm.addEventListener('click', () => openConfirmDialog(loan, confirm));
        card.append(confirm);
      }
      detailBody.append(card);
      return;
    }

    // Pending-photo: photo and finish.
    if (loan.status === 'pending-photo') {
      const photoButton = el('button', { text: 'Take or choose photo' }) as HTMLButtonElement;
      const photoInput = el('input', { type: 'file', accept: 'image/*', id: `finish-photo-${loan.id}` }) as HTMLInputElement;
      photoButton.setAttribute('aria-controls', photoInput.id);
      photoInput.style.display = 'none';
      photoButton.addEventListener('click', () => photoInput.click());
      photoInput.addEventListener('change', () => {
        pickedPhoto = photoInput.files?.[0] ?? null;
        updatePickedThumb(card, photoButton);
      });
      updatePickedThumb(card, photoButton);
      const finish = el('button', { class: 'primary', text: 'Finish check-in' }) as HTMLButtonElement;
      finish.addEventListener('click', () => void doFinish(loan, finish));
      finish.disabled = app.status.storage === 'down';
      pendingFinishButtons.push(finish);
      card.append(photoButton, photoInput, finish);
      detailBody.append(card);
      return;
    }

    detailBody.append(card);
  }

  const pendingFinishButtons: HTMLButtonElement[] = [];

  function updatePickedThumb(card: HTMLElement, photoButton: HTMLButtonElement): void {
    const existing = card.querySelector('.picked-thumb');
    if (existing !== null) existing.remove();
    if (pickedPhoto === null) return;
    const url = URL.createObjectURL(pickedPhoto);
    const img = el('img', { src: url, alt: 'Picked photo', class: 'picked-thumb' }) as HTMLImageElement;
    img.style.maxWidth = '160px';
    img.style.display = 'block';
    img.style.marginTop = '6px';
    photoButton.after(img);
  }

  /** The second-hour checkbox appears while the return time names a repeated wall-clock time. */
  function updateSecondHourCheckbox(holder: HTMLElement, text: string): void {
    const existing = holder.querySelector('input[type="checkbox"]');
    if (existing !== null) existing.parentElement?.remove();
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
    if (match === null) {
      returnTimeSecondHour = false;
      return;
    }
    const isRepeated = repeatedHour(match[1]!, match[2]!, match[3]!, match[4]!);
    if (!isRepeated) {
      returnTimeSecondHour = false;
      return;
    }
    const input = el('input', { type: 'checkbox', id: 'second-hour' }) as HTMLInputElement;
    input.checked = returnTimeSecondHour;
    const label = el('label', { for: 'second-hour' }, input, el('span', { text: `Second ${Number(match[4])} o'clock hour (${zoneAbbr()})` }));
    input.addEventListener('change', () => {
      returnTimeSecondHour = input.checked;
    });
    holder.append(label);
  }

  function repeatedHour(year: string, month: string, day: string, hour: string): boolean {
    // A repeated hour: the zone offset before it is larger than the offset after it.
    const settings = appSettingsZone;
    const h = Number(hour);
    const before = zoneOffsetAt(Date.UTC(Number(year), Number(month) - 1, Number(day), h - 1), settings);
    const after = zoneOffsetAt(Date.UTC(Number(year), Number(month) - 1, Number(day), h + 1), settings);
    return before !== after && before > after;
  }

  function zoneOffsetAt(utcMillis: number, zone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    const parts = dtf.formatToParts(new Date(utcMillis));
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (m === null) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3]));
  }

  function zoneAbbr(): string {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: appSettingsZone, timeZoneName: 'short' });
    const parts = dtf.formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  }

  let appSettingsZone = 'America/Chicago';

  // --- drag-and-drop hanging ---

  function attachDrag(button: HTMLButtonElement, loan: Loan, part: Loan['parts'][number]): void {
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const card = el('div', { class: 'tag-card', text: part.name });
      document.body.append(card);
      const move = (ev: PointerEvent) => {
        card.style.left = `${ev.clientX + 8}px`;
        card.style.top = `${ev.clientY + 8}px`;
        highlightNear(ev.clientX, ev.clientY, part);
      };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        card.remove();
        clearHighlights();
        void dropAt(ev.clientX, ev.clientY, loan, part);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function highlightNear(x: number, y: number, part: Loan['parts'][number]): void {
    const outline = outlineElement(part.id);
    if (outline === null) return;
    const rect = outline.getBoundingClientRect();
    const inside =
      x >= rect.left - SNAP_RADIUS && x <= rect.right + SNAP_RADIUS && y >= rect.top - SNAP_RADIUS && y <= rect.bottom + SNAP_RADIUS;
    outline.classList.toggle('snap-hot', inside);
  }

  function clearHighlights(): void {
    for (const outline of document.querySelectorAll('.peg-outline.snap-hot')) outline.classList.remove('snap-hot');
  }

  function outlineElement(partId: number): SVGElement | null {
    return document.querySelector(`.peg-outline[data-part-id="${partId}"]`);
  }

  async function dropAt(x: number, y: number, loan: Loan, part: Loan['parts'][number]): Promise<void> {
    // The first outline whose area contains the pointer wins.
    const order = boardOrder(board?.items ?? []);
    for (const { part: target } of order) {
      const element = outlineElement(target.id);
      if (element === null) continue;
      const rect = element.getBoundingClientRect();
      const inside = x >= rect.left - SNAP_RADIUS && x <= rect.right + SNAP_RADIUS && y >= rect.top - SNAP_RADIUS && y <= rect.bottom + SNAP_RADIUS;
      if (!inside) continue;
      if (target.item_id === part.item_id) {
        await hang(loan, part, target.id);
      } else {
        announce.textContent = 'That peg belongs to a different tool.';
        springBack();
      }
      return;
    }
    springBack();
  }

  async function hang(loan: Loan, part: Loan['parts'][number], pegPartId: number): Promise<void> {
    try {
      const result = await apiJson<HangResponse>('POST', `/api/loans/${loan.id}/hang`, { part_id: part.id, peg_part_id: pegPartId });
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reducedMotion) fillOutline(pegPartId);
      hungDuringCheckin.add(part.id);
      const wasPartial = loan.status === 'returned-partial';
      announce.textContent =
        wasPartial && result.loan.status === 'returned-complete'
          ? `${part.name} is on its peg. Returned complete.`
          : `${part.name} is on its peg.`;
      await refreshAll();
      focusNextCard(loan.id, part.id);
    } catch (err) {
      if (err instanceof ApiFailure) {
        announce.textContent = err.error;
        if (err.status === 409) {
          await refreshAll();
          focusFirstControl();
        }
      }
    }
  }

  function fillOutline(pegPartId: number): void {
    const outline = outlineElement(pegPartId);
    if (outline === null) return;
    outline.querySelector('.silhouette')?.setAttribute('fill', 'var(--ink)');
    outline.querySelector('.silhouette')?.setAttribute('stroke', 'none');
  }

  function springBack(): void {
    // The outline keeps its state; the card returns to the loan pane.
    renderDetail();
  }

  function focusNextCard(loanId: number, hungPartId: number): void {
    const loan = loans.find((l) => l.id === loanId);
    if (loan === undefined) return;
    const remaining = [...loan.parts]
      .filter((p) => p.state !== 'hung' && p.id !== hungPartId)
      .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
    if (remaining.length === 0) {
      const firstGrade = detailBody.querySelector('input[type="radio"]');
      if (firstGrade instanceof HTMLElement) firstGrade.focus();
      else scan.focus();
      return;
    }
    const button = detailBody.querySelector(`button[aria-label="Tag card ${remaining[0]!.name}"]`);
    if (button instanceof HTMLElement) button.focus();
    else scan.focus();
  }

  // --- keyboard hanging ---

  function attachKeyboardPick(button: HTMLButtonElement, loan: Loan, part: Loan['parts'][number]): void {
    button.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        startKeyboardHang(button, loan, part);
      }
    });
  }

  function startKeyboardHang(button: HTMLButtonElement, loan: Loan, part: Loan['parts'][number]): void {
    const order = boardOrder(board?.items ?? []);
    let index = order.findIndex((entry) => entry.part.id === part.id);
    if (index === -1) return;
    const card = el('div', { class: 'tag-card', text: part.name });
    document.body.append(card);
    const place = () => {
      const outline = outlineElement(order[index]!.part.id);
      if (outline === null) return;
      const rect = outline.getBoundingClientRect();
      card.style.left = `${rect.left + rect.width / 2}px`;
      card.style.top = `${rect.top + rect.height / 2}px`;
      outline.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      clearHighlights();
      outline.classList.add('snap-hot');
    };
    place();

    const step = (delta: number) => {
      index = (index + delta + order.length) % order.length;
      place();
    };

    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        cleanup();
        void hang(loan, part, order[index]!.part.id);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
        button.focus();
      }
    };

    const cleanup = () => {
      document.removeEventListener('keydown', keydown, true);
      card.remove();
      clearHighlights();
    };
    document.addEventListener('keydown', keydown, true);
  }

  // --- checkout, cancel, confirm, finish ---

  async function doCheckout(loan: Loan, button: HTMLButtonElement): Promise<void> {
    if (pickedPhoto === null) {
      announce.textContent = 'Choose a photo.';
      return;
    }
    setPending(button, 'Checking out...');
    const form = new FormData();
    form.append('photo', pickedPhoto);
    form.append('captured_at', new Date().toISOString());
    try {
      await apiForm('POST', `/api/loans/${loan.id}/checkout`, form);
      announce.textContent = `Loan ${loan.ref} is out. Due ${dueDateOf(loan)} by ${dueByOf(loan)}.`;
      await refreshAll();
      scan.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) {
        announce.textContent = err.error;
        if (err.status === 409) await refreshAll();
      }
    }
  }

  function dueDateOf(loan: Loan): string {
    return loan.due_date ?? '';
  }
  function dueByOf(loan: Loan): string {
    return loan.due_by ?? '';
  }

  async function doCancelLoan(loan: Loan, button: HTMLButtonElement): Promise<void> {
    setPending(button, 'Cancelling...');
    try {
      await apiJson('DELETE', `/api/loans/${loan.id}`);
      announce.textContent = `Loan ${loan.ref} cancelled.`;
      selectedLoanId = null;
      await refreshAll();
      scan.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) announce.textContent = err.error;
    }
  }

  function openConfirmDialog(loan: Loan, opener: HTMLButtonElement): void {
    // Client-side checks first.
    const problems: Record<string, string> = {};
    for (const item of loan.items) {
      if (grades[String(item.id)] === undefined) {
        problems[`grades-${item.id}`] = `Grade ${item.name}.`;
      }
    }
    if (pickedPhoto === null) problems['photo'] = 'Choose a photo.';
    if (returnTimeText.trim() !== '' && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(returnTimeText.trim())) {
      problems['returned_at'] = 'Use YYYY-MM-DD HH:MM in library time.';
    }
    if (returnTimeText.trim() !== '' && skippedHour(returnTimeText.trim())) {
      problems['returned_at'] = 'That time does not exist in library time because the clocks go forward.';
    }
    if (Object.keys(problems).length > 0) {
      const holder = el('div');
      renderProblems(holder, problems, (field) => {
        if (field.startsWith('grades-')) return detailBody.querySelector(`input[name="grade-${field.slice(7)}"]`);
        if (field === 'photo') return detailBody.querySelector('button');
        if (field === 'returned_at') return detailBody.querySelector('input[type="text"]');
        return null;
      });
      opener.parentElement?.append(holder);
      holder.setAttribute('tabindex', '-1');
      holder.focus();
      return;
    }

    const dialog = el('dialog', { 'aria-label': 'Confirm check-in' }) as HTMLDialogElement;
    const confirm = el('button', { class: 'primary', text: 'Confirm' }) as HTMLButtonElement;
    const back = el('button', { text: 'Back' }) as HTMLButtonElement;
    const hungList = el('ul');
    for (const part of loan.parts) {
      if (part.state === 'hung' || hungDuringCheckin.has(part.id)) hungList.append(el('li', { text: part.name }));
    }
    const missingList = el('ul');
    for (const part of [...loan.parts].sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))) {
      if (part.state !== 'hung' && !hungDuringCheckin.has(part.id)) missingList.append(el('li', { text: part.name }));
    }
    dialog.append(
      el('h2', { text: 'Confirm check-in' }),
      el('p', { text: 'Hung parts:' }),
      hungList,
      el('p', { text: 'Parts that will be missing:' }),
      missingList,
      el('p', { text: gradeSummary(loan) }),
      el('div', { class: 'row' }, confirm),
      el('div', { class: 'row' }, back),
    );
    main.append(dialog);
    dialog.showModal();
    confirm.focus();

    const close = () => {
      dialog.close();
      dialog.remove();
      opener.focus();
    };
    back.addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    confirm.addEventListener('click', () => void doCheckin(loan, confirm, dialog, opener));
  }

  function gradeSummary(loan: Loan): string {
    return loan.items.map((item) => `${item.name}: ${grades[String(item.id)] ?? 'ungraded'}`).join(', ');
  }

  function skippedHour(text: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
    if (match === null) return false;
    const settings = appSettingsZone;
    const before = zoneOffsetAt(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 1), settings);
    const after = zoneOffsetAt(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) + 1), settings);
    return before !== after && before < after;
  }

  async function doCheckin(loan: Loan, button: HTMLButtonElement, dialog: HTMLDialogElement, opener: HTMLButtonElement): Promise<void> {
    if (pickedPhoto === null) {
      dialog.close();
      dialog.remove();
      announce.textContent = 'Choose a photo.';
      opener.focus();
      return;
    }
    setPending(button, 'Checking in...');
    const form = new FormData();
    form.append('grades', JSON.stringify(grades));
    form.append('captured_at', new Date().toISOString());
    form.append('photo', pickedPhoto);
    if (returnTimeText.trim() !== '') {
      form.append('returned_at', isoForReturnTime(returnTimeText.trim()));
    }
    try {
      const result = await apiForm<CheckinResponse>('POST', `/api/loans/${loan.id}/checkin`, form);
      dialog.close();
      dialog.remove();
      const missing = result.loan.missing_parts;
      let text: string;
      if (missing.length === 0) text = 'Returned complete.';
      else text = `Returned — partial. Missing: ${missing.join(', ')}.`;
      if (result.fee !== null) text += ` Fee raised: ${money(result.fee.total_cents)}.`;
      if (result.loan.status === 'pending-photo') {
        text = 'Saved as pending photo. Nothing has been charged.';
      }
      announce.textContent = text;
      hungDuringCheckin = new Set();
      pickedPhoto = null;
      returnTimeText = '';
      grades = {};
      await refreshAll();
      scan.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) {
        if (err.status === 409) {
          dialog.close();
          dialog.remove();
          announce.textContent = err.error;
          await refreshAll();
          focusFirstControl();
          return;
        }
        if (err.status === 503) {
          dialog.close();
          dialog.remove();
          announce.textContent = err.error;
          await refreshAll();
          return;
        }
        announce.textContent = err.error;
      }
    }
  }

  async function doFinish(loan: Loan, button: HTMLButtonElement): Promise<void> {
    if (pickedPhoto === null) {
      announce.textContent = 'Choose a photo.';
      return;
    }
    setPending(button, 'Checking in...');
    const form = new FormData();
    form.append('captured_at', new Date().toISOString());
    form.append('photo', pickedPhoto);
    try {
      const result = await apiForm<CheckinResponse>('POST', `/api/loans/${loan.id}/finish`, form);
      const missing = result.loan.missing_parts;
      let text: string;
      if (missing.length === 0) text = 'Returned complete.';
      else text = `Returned — partial. Missing: ${missing.join(', ')}.`;
      if (result.fee !== null) text += ` Fee raised: ${money(result.fee.total_cents)}.`;
      announce.textContent = text;
      pickedPhoto = null;
      await refreshAll();
      scan.focus();
    } catch (err) {
      clearPending(button);
      if (err instanceof ApiFailure) announce.textContent = err.error;
    }
  }

  /** Convert typed library-local time to ISO 8601 with the library zone's offset. */
  function isoForReturnTime(text: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
    if (match === null) return text;
    const [year, month, day, hour, minute] = [match[1]!, match[2]!, match[3]!, match[4]!, match[5]!];
    const pickSecond = returnTimeSecondHour ? 2 : 1;
    const utcGuesses = [0, -60, 60].map((adjust) => {
      const base = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
      const offsetMinutes = zoneOffsetAt(base, appSettingsZone);
      return { instant: base - (offsetMinutes + adjust) * 60000, adjust };
    });
    for (const guess of utcGuesses) {
      if (matchesWallClock(guess.instant, year, month, day, hour, minute)) {
        const hits = utcGuesses.filter((g) => matchesWallClock(g.instant, year, month, day, hour, minute)).map((g) => g.instant).sort((a, b) => a - b);
        const unique = hits.filter((v, i) => i === 0 || v - hits[i - 1]! > 3600000);
        const chosen = pickSecond === 2 && unique.length > 1 ? unique[1]! : unique[0]!;
        const offset = zoneOffsetAt(chosen, appSettingsZone);
        const sign = offset < 0 ? '-' : '+';
        const abs = Math.abs(offset);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        return `${year}-${month}-${day}T${hour}:${minute}:00${sign}${hh}:${mm}`;
      }
    }
    return `${year}-${month}-${day}T${hour}:${minute}:00`;
  }

  function matchesWallClock(instant: number, year: string, month: string, day: string, hour: string, minute: string): boolean {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: appSettingsZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = dtf.formatToParts(new Date(instant));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const hourNum = get('hour') === '24' ? '00' : get('hour');
    return get('year') === year && get('month') === month && get('day') === day && hourNum === hour && get('minute') === minute;
  }

  // --- polls ---

  const boardPoll = setInterval(() => {
    void app.refreshBoard().then(() => {
      board = app.board;
      renderBoardPane();
      renderQueue();
    });
  }, 2000);
  timers.push(boardPoll as unknown as ReturnType<typeof setTimeout>);

  const loanPoll = setInterval(() => {
    const loan = selectedLoan();
    if (loan !== null && (loan.status === 'out' || loan.status === 'returned-partial')) {
      void apiJson<{ loan: Loan }>('GET', `/api/loans/${loan.id}`).then((result) => {
        const idx = loans.findIndex((l) => l.id === loan.id);
        if (idx !== -1) loans[idx] = result.loan;
        renderQueue();
        renderDetail();
      });
    }
  }, 2000);
  timers.push(loanPoll as unknown as ReturnType<typeof setTimeout>);

  const statusPoll = setInterval(() => {
    const loan = selectedLoan();
    if (loan !== null && loan.status === 'pending-photo') {
      void apiJson<ServiceStatus>('GET', '/api/status').then((status) => {
        app.status = status;
        for (const button of pendingFinishButtons) {
          button.disabled = status.storage === 'down';
        }
      });
    }
  }, 1000);
  timers.push(statusPoll as unknown as ReturnType<typeof setTimeout>);

  void refreshAll();
  void apiJson<{ time_zone: string }>('GET', '/api/settings').then((settings) => {
    appSettingsZone = settings.time_zone;
  });
  void apiJson<{ members: MemberSummary[] }>('GET', '/api/members').then((result) => {
    members = result.members;
  });

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    document.removeEventListener('keydown', scanShortcut);
    for (const cleanup of dialogCleanups) cleanup();
  };
}
