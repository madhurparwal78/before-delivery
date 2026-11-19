import { FIELD_COPY, FIX_RESULT, PLEDGE_RESULT } from '../../shared/copy.js';
import { formatMoney } from '../../shared/money.js';
import type { FixDto } from '../../shared/types.js';
import { ApiFailure, get, post } from '../api.js';
import { el } from '../dom.js';
import { announceText, statusRegion } from '../ui/live.js';
import { Countdown, fieldError, loadingStatus, stateMark } from '../ui/parts.js';
import { renderNotFound } from './notFound.js';

const REFRESH_MS = 30_000;

export function renderFix(main: HTMLElement, code: string): () => void {
  const host = el('div', { class: 'page page--narrow' }, loadingStatus());
  main.replaceChildren(host);

  const result = statusRegion('Fix result', 'live live--result');
  const countdown = new Countdown('Time left to fix');
  const cardField = el('input', {
    type: 'text',
    class: 'input input--figures',
    'aria-label': 'Card number',
    inputmode: 'numeric',
    autocomplete: 'off',
  });
  const cardErrors = el('div', { class: 'field-errors' });
  const update = el('button', { type: 'button', class: 'button' }, 'Update card');
  const stateHost = el('p', { class: 'fix-state' });
  const amountHost = el('p', { class: 'totals-amount' }, el('span', { class: 'figures' }));
  const titleHost = el('p', { class: 'fix-campaign' });
  let disposed = false;

  const paint = (fix: FixDto): void => {
    titleHost.textContent = fix.campaign_title;
    amountHost.replaceChildren(el('span', { class: 'figures' }, formatMoney(fix.amount)));
    stateHost.replaceChildren(stateMark(fix.state));
    countdown.set(fix.fix_seconds_left);
    const closed = fix.fix_seconds_left <= 0 || fix.state !== 'errored';
    cardField.disabled = closed;
    update.disabled = closed;
  };

  const build = (fix: FixDto): void => {
    host.replaceChildren(
      el('h1', { class: 'page-heading' }, 'Fix your payment'),
      titleHost,
      amountHost,
      stateHost,
      countdown.root,
      el(
        'div',
        { class: 'field' },
        el('label', { for: 'fix-card' }, 'Card number'),
        cardField,
        cardErrors,
      ),
      el('div', { class: 'editor-actions' }, update),
      result,
    );
    cardField.setAttribute('id', 'fix-card');
    paint(fix);
  };

  const submit = (amount: number): void => {
    void (async () => {
      cardErrors.replaceChildren();
      update.disabled = true;
      announceText(result, FIX_RESULT.pending(amount));
      try {
        const updated = await post<FixDto>(`/api/fix/${code}`, {
          body: { card_number: cardField.value.trim() },
        });
        paint(updated);
        announceText(result, FIX_RESULT.success(updated.amount));
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        update.disabled = false;
        if (error.status === 402) {
          cardErrors.replaceChildren(fieldError(FIELD_COPY.card_number));
          announceText(result, PLEDGE_RESULT.declined);
          cardField.focus();
          return;
        }
        if (error.status === 422) {
          cardErrors.replaceChildren(
            fieldError(error.fields['card_number'] ?? FIELD_COPY.card_number),
          );
          cardField.focus();
          return;
        }
        if (error.code === 'fix_window_closed') {
          announceText(result, FIX_RESULT.closed);
          void load();
          return;
        }
        announceText(result, PLEDGE_RESULT.paymentsDown);
      }
    })();
  };

  let amountNow = 0;
  const load = async (): Promise<void> => {
    try {
      const fix = await get<FixDto>(`/api/fix/${code}`);
      if (disposed) return;
      amountNow = fix.amount;
      if (host.querySelector('.page-heading') === null) build(fix);
      else paint(fix);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) {
        renderNotFound(main);
        return;
      }
      throw error;
    }
  };

  update.addEventListener('click', () => submit(amountNow));
  cardField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit(amountNow);
  });

  void load();
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  return () => {
    disposed = true;
    countdown.stop();
    window.clearInterval(timer);
  };
}
