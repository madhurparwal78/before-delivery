import { request } from '../api';
import { el, focusElement, prefersReducedMotion, setAttr, setText } from '../dom';
import { serverNowMs } from '../clock';
import { announce } from '../shell';
import * as copy from '../copy';
import { isoTime } from '../../shared/format';
import type { Booking, DoorAction, DoorEntry, DoorResponse } from '../../shared/types';

const FLIP_MS = 420;

interface Face {
  node: HTMLElement;
  status: HTMLElement;
  clearance: HTMLElement;
  opensLine: HTMLElement;
  log: HTMLElement;
  buttons: HTMLElement;
  outcome: HTMLElement;
}

interface DoorCard {
  entry: DoorEntry;
  article: HTMLElement;
  front: Face;
  back: Face;
  showing: 'front' | 'back';
  pending: DoorAction | null;
  flipping: boolean;
  outcome: string;
  drawnStatus: string;
}

export interface DoorColumn {
  node: HTMLElement;
  load(date: string, kind: 'settle' | 'refresh'): Promise<void>;
}

function createFace(): Face {
  const node = el('div', { className: 'door-face' });
  const status = el('p', { className: 'door-status' });
  const clearance = el('p', { className: 'door-clearance' });
  const opensLine = el('p', { className: 'door-opens' });
  const log = el('div', { className: 'door-log' });
  const buttons = el('div', { className: 'door-buttons' });
  const outcome = el('p', { className: 'outcome-copy' });
  node.append(status, clearance, opensLine, log, buttons, outcome);
  return { node, status, clearance, opensLine, log, buttons, outcome };
}

export function createDoorColumn(): DoorColumn {
  const node = el('section', {
    className: 'ticket-column door-column',
    attrs: { role: 'region', 'aria-label': 'Door list' },
  });
  const list = el('div', { className: 'card-grid' });
  node.append(list);

  const cards = new Map<string, DoorCard>();
  let shownDate = '';

  const checkOutDialog = el('dialog', { className: 'dialog', attrs: { 'aria-label': 'Check out' } });
  const cleanupId = 'checkout-cleanup';
  const cleanupError = el('p', { className: 'field-error', attrs: { id: 'checkout-cleanup-error' } });
  const cleanupBox = el('input', {
    className: 'field-checkbox',
    attrs: {
      id: cleanupId,
      type: 'checkbox',
      'aria-label': 'Station cleaned and sanitised',
    },
  });
  const cleanupLabel = el('label', {
    text: 'Station cleaned and sanitised',
    className: 'checkbox-label',
    attrs: { for: cleanupId },
  });
  const noteId = 'checkout-note';
  const noteLabel = el('label', {
    text: 'Cleanup note',
    className: 'field-label',
    attrs: { for: noteId },
  });
  const note = el('textarea', {
    className: 'field-input',
    attrs: { id: noteId, 'aria-label': 'Cleanup note', rows: '3' },
  });
  const submitButton = el('button', {
    text: 'Log cleanup and check out',
    className: 'button primary',
    attrs: { type: 'button' },
  });
  const closeButton = el('button', { text: 'Close', className: 'button quiet', attrs: { type: 'button' } });
  checkOutDialog.append(cleanupBox, cleanupLabel, cleanupError, noteLabel, note, submitButton, closeButton);
  node.append(checkOutDialog);

  let dialogCard: DoorCard | null = null;

  const activeFace = (card: DoorCard): Face => (card.showing === 'front' ? card.front : card.back);
  const hiddenFace = (card: DoorCard): Face => (card.showing === 'front' ? card.back : card.front);

  const paintFace = (card: DoorCard, face: Face, entry: DoorEntry): void => {
    if (card.pending !== null) {
      const pendingCopy =
        card.pending === 'check_in'
          ? copy.checkIn.pending
          : card.pending === 'check_out'
            ? copy.checkOut.pending
            : copy.noShow.pending;
      setText(face.status, pendingCopy);
    } else {
      setText(face.status, copy.doorStatusText(entry.status));
    }
    setText(face.clearance, copy.clearanceText(entry));
    const showOpens =
      entry.status === 'confirmed' && serverNowMs() < Date.parse(entry.checkInOpensAt);
    setText(face.opensLine, showOpens ? copy.checkInOpensLine(entry.checkInOpensAt) : '');

    face.log.textContent = '';
    for (const line of entry.doorLog) {
      face.log.append(el('p', { text: copy.doorLogLine(line), className: 'door-log-line' }));
    }

    const focusedLabel =
      face.buttons.contains(document.activeElement) && document.activeElement !== null
        ? document.activeElement.textContent
        : null;
    face.buttons.textContent = '';
    const labels: Record<DoorAction, string> = {
      check_in: 'Check in',
      check_out: 'Check out',
      no_show: 'Mark no-show',
    };
    for (const action of entry.actions) {
      const button = el('button', {
        text: labels[action],
        className: 'button',
        attrs: { type: 'button' },
      });
      if (card.pending !== null) button.setAttribute('aria-disabled', 'true');
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') === 'true') return;
        if (action === 'check_out') openCheckOut(card);
        else void runAction(card, action);
      });
      face.buttons.append(button);
    }
    if (focusedLabel !== null) {
      const again = [...face.buttons.children].find((child) => child.textContent === focusedLabel);
      if (again instanceof HTMLElement) again.focus({ preventScroll: true });
    }
    setText(face.outcome, card.outcome);
  };

  const paint = (card: DoorCard): void => {
    paintFace(card, activeFace(card), card.entry);
    setAttr(card.article, 'data-face', card.showing);
    setAttr(
      card.article,
      'aria-label',
      `${card.entry.tenantName} ${card.entry.stationName} ${isoTime(card.entry.start)}${copy.DASH}${isoTime(card.entry.end)}`,
    );
  };

  const flip = (card: DoorCard): void => {
    const incoming = hiddenFace(card);
    paintFace(card, incoming, card.entry);
    const settle = (): void => {
      card.showing = card.showing === 'front' ? 'back' : 'front';
      activeFace(card).node.removeAttribute('hidden');
      hiddenFace(card).node.setAttribute('hidden', '');
      setAttr(card.article, 'data-face', card.showing);
      card.flipping = false;
      paint(card);
    };
    if (prefersReducedMotion()) {
      settle();
      return;
    }
    const animation = card.article.animate(
      [
        { transform: 'perspective(800px) rotateY(0deg)' },
        { transform: 'perspective(800px) rotateY(180deg)' },
      ],
      { duration: FLIP_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'none' },
    );
    animation.addEventListener('finish', settle, { once: true });
  };

  async function runAction(card: DoorCard, action: DoorAction, body?: unknown): Promise<void> {
    if (card.pending !== null) return;
    card.pending = action;
    card.outcome = '';
    paint(card);
    const path =
      action === 'check_in'
        ? `/api/bookings/${card.entry.bookingId}/check-in`
        : action === 'check_out'
          ? `/api/bookings/${card.entry.bookingId}/check-out`
          : `/api/bookings/${card.entry.bookingId}/no-show`;
    const result = await request<Booking>('POST', path, body === undefined ? {} : { body });
    if (result.kind === 'stale') return;
    card.pending = null;

    if (result.kind === 'ok') {
      card.flipping = true;
      card.entry = {
        ...card.entry,
        status: result.body.status,
        doorLog: result.body.doorLog ?? card.entry.doorLog,
        cleanupNote: result.body.cleanupNote ?? card.entry.cleanupNote,
      };
      card.outcome =
        action === 'check_in'
          ? copy.checkIn.success(card.entry.tenantName, card.entry.stationName)
          : action === 'check_out'
            ? copy.checkOut.success
            : copy.noShow.success;
      card.drawnStatus = card.entry.status;
      await load(shownDate, 'refresh');
      flip(card);
      announce(card.outcome);
      focusElement(card.article);
      return;
    }

    if (result.kind === 'network') {
      card.outcome = copy.generic;
      paint(card);
      announce(copy.generic);
      focusElement(card.article);
      return;
    }

    if (result.status === 422 && action === 'check_out') {
      const message = result.fields.cleanupDone ?? copy.checkOut.cleanupBox;
      cleanupError.textContent = message;
      cleanupBox.setAttribute('aria-describedby', 'checkout-cleanup-error');
      announce(message);
      focusElement(cleanupBox);
      paint(card);
      return;
    }

    let message = copy.generic;
    if (action === 'check_in') {
      if (result.error === 'not_cleared') message = copy.checkIn.notCleared(card.entry.reason ?? 'not_approved');
      else if (result.error === 'outside_check_in_window') message = copy.checkIn.window;
      else message = copy.checkIn.other;
    } else if (action === 'check_out') {
      message = copy.checkOut.other;
    } else {
      message = result.error === 'too_early' ? copy.noShow.tooEarly : copy.noShow.other;
    }
    card.outcome = message;
    await load(shownDate, 'refresh');
    const reread = cards.get(card.entry.bookingId) ?? card;
    reread.outcome = message;
    paint(reread);
    announce(message);
    focusElement(reread.article);
  }

  function openCheckOut(card: DoorCard): void {
    dialogCard = card;
    cleanupError.textContent = '';
    cleanupBox.removeAttribute('aria-describedby');
    cleanupBox.checked = false;
    note.value = '';
    checkOutDialog.showModal();
    focusElement(cleanupBox);
  }

  const closeDialog = (returnFocus: boolean): void => {
    const card = dialogCard;
    checkOutDialog.close();
    dialogCard = null;
    if (returnFocus && card !== null) {
      const button = [...activeFace(card).buttons.children].find(
        (child) => child.textContent === 'Check out',
      );
      focusElement(button instanceof HTMLElement ? button : card.article);
    }
  };

  submitButton.addEventListener('click', () => {
    const card = dialogCard;
    if (card === null) return;
    void (async () => {
      const noteValue = note.value;
      const before = card.entry.status;
      await runAction(card, 'check_out', { cleanupDone: cleanupBox.checked, note: noteValue });
      const current = cards.get(card.entry.bookingId);
      if (current !== undefined && current.entry.status !== before) closeDialog(false);
      else if (cleanupError.textContent === '') closeDialog(false);
    })();
  });
  closeButton.addEventListener('click', () => closeDialog(true));
  checkOutDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog(true);
  });

  const cardFor = (entry: DoorEntry): DoorCard => {
    let card = cards.get(entry.bookingId);
    if (card === undefined) {
      const article = el('article', {
        className: 'ticket-card door-card',
        attrs: { tabindex: '0', 'data-face': 'front' },
      });
      const front = createFace();
      const back = createFace();
      back.node.setAttribute('hidden', '');
      article.append(front.node, back.node);
      list.append(article);
      card = {
        entry,
        article,
        front,
        back,
        showing: 'front',
        pending: null,
        flipping: false,
        outcome: '',
        drawnStatus: entry.status,
      };
      cards.set(entry.bookingId, card);
    }
    return card;
  };

  async function load(date: string, kind: 'settle' | 'refresh'): Promise<void> {
    shownDate = date;
    const result = await request<DoorResponse>('GET', `/api/door?date=${date}`);
    if (result.kind !== 'ok') return;
    if (result.body.date !== shownDate) return;

    const seen = new Set<string>();
    for (const entry of result.body.entries) {
      const card = cardFor(entry);
      seen.add(entry.bookingId);
      const changedByOthers =
        kind === 'refresh' &&
        card.pending === null &&
        !card.flipping &&
        card.drawnStatus !== entry.status;
      card.entry = entry;
      if (card.pending === null && !card.flipping) {
        card.drawnStatus = entry.status;
        paint(card);
      }
      if (changedByOthers) announce(copy.doorChange(entry));
    }
    for (const [id, card] of cards) {
      if (!seen.has(id) && card.pending === null && !card.flipping) {
        card.article.remove();
        cards.delete(id);
      }
    }
    for (const [index, entry] of result.body.entries.entries()) {
      const card = cards.get(entry.bookingId);
      if (card !== undefined && list.children[index] !== card.article) list.append(card.article);
    }
    if (kind === 'settle') {
      announce(
        copy.doorSummary(
          result.body.date,
          result.body.entries.length,
          result.body.entries.filter((entry) => entry.cleared).length,
        ),
      );
    }
  }

  return { node, load };
}
