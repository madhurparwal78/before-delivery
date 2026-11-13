import { el, setText } from './dom';
import { formatInstant } from './fmt';
import { HOLD_COPY, holdLabel } from './holdlogic';
import { navigate } from './router';
import { store } from './store';
import { Hold } from './types';

export interface HoldCardActions {
  pay(hold: Hold, button: HTMLButtonElement): void;
  cancel(hold: Hold, button: HTMLButtonElement, link: HTMLElement): void;
}

export interface HoldCardView {
  root: HTMLElement;
  link: HTMLElement;
  update(hold: Hold): void;
  applyBillingState(): void;
}

/**
 * A hold card that refreshes its label, expiry and paused state in place, so a background
 * refresh never moves focus or rebuilds open work.
 */
export function holdCard(hold: Hold, actions: HoldCardActions): HoldCardView {
  let current = hold;
  const link = el('a', {
    class: 'tag mono',
    text: hold.board,
    attrs: { href: `/boards/${hold.board}` },
    on: {
      click: (event) => {
        event.preventDefault();
        navigate(`/boards/${current.board}`);
      }
    }
  });
  const badge = el('span', { class: 'badge' });
  const expiredNote = el('p', { class: 'muted expired-note' });
  const until = el('p', { class: 'mono held-until' });
  const pay = el('button', { class: 'primary', text: 'Pay and cut', attrs: { type: 'button' } });
  const cancel = el('button', { text: 'Cancel hold', attrs: { type: 'button' } });
  const buttons = el('div', { class: 'row hold-actions' }, [pay, cancel]);
  const pausedNote = el('p', { class: 'muted paused-note', text: HOLD_COPY.paused });
  const root = el('article', { class: 'card hold-card', attrs: { 'data-hold': hold.id } }, [
    link,
    badge,
    expiredNote,
    until,
    buttons,
    pausedNote
  ]);

  pay.addEventListener('click', () => {
    if (pay.getAttribute('aria-disabled') === 'true') return;
    actions.pay(current, pay);
  });
  cancel.addEventListener('click', () => {
    if (cancel.getAttribute('aria-disabled') === 'true') return;
    actions.cancel(current, cancel, link);
  });

  function applyBillingState(): void {
    const down = store.services.billing === 'down';
    const live = current.status === 'held';
    for (const button of [pay, cancel]) {
      if (down && live) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
    pausedNote.hidden = !(down && live);
  }

  function update(next: Hold): void {
    current = next;
    const label = holdLabel(next);
    setText(badge, label);
    expiredNote.hidden = label !== 'Expired';
    setText(expiredNote, label === 'Expired' ? HOLD_COPY.expired : '');
    const live = next.status === 'held' && next.expires_at !== null;
    until.hidden = !live;
    setText(until, live && next.expires_at !== null ? `Held until ${formatInstant(next.expires_at)}` : '');
    buttons.hidden = !live;
    applyBillingState();
  }

  update(hold);
  return { root, link, update, applyBillingState };
}
