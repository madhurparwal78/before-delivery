import { Booking, Quote } from '../../shared/types';
import { roundDiv } from '../../shared/money';
import { sumLines } from '../../shared/lines';
import { api, failureOf, newIdempotencyKey } from '../api';
import { Route, frame, navigate, onCleanup, onEvent } from '../app';
import { DialogHandle, clear, el, money, openDialog } from '../dom';
import { amount, m, t } from '../i18n';
import { serverNow, setServerNow, state } from '../state';
import { displayControls } from '../components/display';
import { StripNight, nightStrip } from '../components/nightstrip';
import { Problem, problemsRegion } from '../components/problems';

interface Fields {
  given: HTMLInputElement;
  surname: HTMLInputElement;
  card: HTMLInputElement;
  expiry: HTMLInputElement;
  code: HTMLInputElement;
}

export async function checkoutPage(main: HTMLElement, route: Route): Promise<void> {
  const quoteId = route.path.split('/')[2];
  const params = new URLSearchParams(route.query);
  let quote = await api<Quote>(`/api/quotes/${quoteId}`);
  let holdId: string | null = quote.hold_id;
  let holdExpiresAt: string | null = null;
  const withTax = params.get('tax') !== '0';
  const display = (params.get('display') ?? 'total') as 'total' | 'night';
  const searchHref = (): string => {
    const query = new URLSearchParams();
    query.set('dest', params.get('dest') ?? '');
    query.set('in', quote.in);
    query.set('out', quote.out);
    if (params.get('adults')) query.set('adults', params.get('adults') as string);
    if (params.get('ages')) query.set('ages', params.get('ages') as string);
    query.set('lang', state.lang);
    query.set('cur', quote.currency);
    return `/search?${query.toString()}`;
  };

  const stripHolder = el('div', { class: 'strip-holder' });
  const roomsSummary = el('div', { class: 'rooms-summary' });
  const holdBand = el('div', { class: 'hold-band', hidden: true });
  const timer = el('div', { role: 'timer', 'aria-label': t('ui.time_left'), class: 'hold-timer' }, ['--:--']);
  holdBand.append(timer);
  const problemsHolder = el('div', {});
  const priceRegion = el('div', { role: 'region', 'aria-label': t('ui.price_and_reserve'), class: 'price-reserve' });

  const field = (label: string, key: string): HTMLInputElement =>
    el('input', {
      type: 'text',
      'aria-label': label,
      'data-focus-key': `checkout:${key}`,
      disabled: true,
      class: 'field',
    });

  const fields: Fields = {
    given: field(t('ui.given_name'), 'given'),
    surname: field(t('ui.surname'), 'surname'),
    card: field(t('ui.card_number'), 'card'),
    expiry: field(t('ui.expiry'), 'expiry'),
    code: field(t('ui.security_code'), 'code'),
  };
  const payButton = el('button', { type: 'button', disabled: true, class: 'pay', 'data-focus-key': 'checkout:pay' }, [
    t('ui.pay'),
  ]);

  const paint = (): void => {
    clear(stripHolder);
    const strip: StripNight[] = quote.nights.map((night, index) => ({
      date: night.date,
      minor: withTax ? night.converted_minor : night.converted_taxable_minor,
      currency: quote.currency,
      state: night.state,
      lines: sumLines(quote.rooms.map((room) => room.nights[index].lines)),
    }));
    stripHolder.append(nightStrip(strip, quote.property ? zoneOf() : 'UTC'));

    clear(roomsSummary);
    quote.rooms.forEach((room, index) => {
      roomsSummary.append(
        el('p', {}, [
          `${index + 1}. ${room.room_type} — ${room.plan === 'refundable' ? t('ui.flexible') : t('ui.nonrefundable')}`,
        ]),
      );
    });

    clear(priceRegion);
    const totalMinor = withTax ? quote.converted_total_minor : quote.converted_taxable_minor;
    const shown = display === 'night' ? roundDiv(totalMinor, quote.nights.length) : totalMinor;
    priceRegion.append(money(shown, quote.currency, amount(shown, quote.currency), { class: 'total' }));
    if (!holdId) priceRegion.append(reserveButton);
  };

  let propertyZone = 'UTC';
  const zoneOf = (): string => propertyZone;

  const reserveButton = el('button', { type: 'button', 'data-focus-key': 'checkout:reserve' }, [t('ui.reserve')]);
  reserveButton.addEventListener('click', () => void placeHold());

  const enableFields = (enabled: boolean): void => {
    for (const input of Object.values(fields)) input.disabled = !enabled;
    payButton.disabled = !enabled;
  };

  let announced = new Set<number>();
  let interval = 0;

  const paintTimer = (): void => {
    if (!holdExpiresAt) return;
    const remaining = new Date(holdExpiresAt).getTime() - serverNow();
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    const minutes = Math.floor(seconds / 60);
    timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    for (const threshold of [5, 2, 1]) {
      if (remaining <= threshold * 60000 && !announced.has(threshold)) {
        announced.add(threshold);
        frame.regions.hold.textContent = m('hold.minutes', { n: threshold, count: threshold });
        break;
      }
    }
  };

  const startCountdown = (expiresAt: string): void => {
    holdExpiresAt = expiresAt;
    announced = new Set<number>();
    holdBand.hidden = false;
    paintTimer();
    window.clearInterval(interval);
    interval = window.setInterval(paintTimer, 1000);
    onCleanup(() => window.clearInterval(interval));
  };

  const placeHold = async (): Promise<void> => {
    try {
      const hold = await api<{ id: string; expires_at: string }>('/api/holds', {
        method: 'POST',
        body: { quote_id: quote.id },
        busy: reserveButton,
      });
      holdId = hold.id;
      const time = await api<{ now: string }>('/api/time');
      setServerNow(time.now);
      startCountdown(hold.expires_at);
      enableFields(true);
      quote = await api<Quote>(`/api/quotes/${quote.id}`);
      paint();
      fields.given.focus();
    } catch (err) {
      const failure = failureOf(err);
      if (failure?.status === 409 && failure.body.error === 'sold_out') {
        justTakenDialog();
        return;
      }
      const reason = failure?.body.reason as { code: string; date?: string; n?: number } | undefined;
      if (reason) {
        frame.regions.roomAdvice.textContent = m(`reason.${reason.code}`, {
          date: reason.date ?? '',
          n: reason.n ?? 0,
        });
      }
      if (failure?.status === 410) holdEndedDialog();
    }
  };

  let openAlert: DialogHandle | null = null;
  let holdEnded = false;

  const showProblems = (list: Problem[]): void => {
    clear(problemsHolder);
    if (list.length === 0) return;
    const region = problemsRegion(list);
    problemsHolder.append(region);
    region.focus();
  };

  const clientProblems = (): Problem[] => {
    const list: Problem[] = [];
    if (fields.given.value.trim() === '')
      list.push({ label: t('ui.given_name'), message: m('field.given'), focus: () => fields.given.focus() });
    if (fields.surname.value.trim() === '')
      list.push({ label: t('ui.surname'), message: m('field.surname'), focus: () => fields.surname.focus() });
    if (!/^\d{16}$/.test(fields.card.value.replace(/ /g, '')))
      list.push({ label: t('ui.card_number'), message: m('field.card'), focus: () => fields.card.focus() });
    const expiry = /^(\d{2})\/(\d{2})$/.exec(fields.expiry.value.trim());
    if (!expiry || Number(expiry[1]) < 1 || Number(expiry[1]) > 12)
      list.push({ label: t('ui.expiry'), message: m('field.expiry'), focus: () => fields.expiry.focus() });
    if (!/^\d{3}$/.test(fields.code.value.trim()))
      list.push({ label: t('ui.security_code'), message: m('field.code'), focus: () => fields.code.focus() });
    return list;
  };

  const pay = async (stepUpCode?: string, dialogClose?: () => void, wrongCode?: (text: string) => void): Promise<void> => {
    const problems = clientProblems();
    if (problems.length > 0) {
      showProblems(problems);
      return;
    }
    clear(problemsHolder);
    try {
      const booking = await api<Booking>('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        busy: payButton,
        body: {
          hold_id: holdId,
          quote_id: quote.id,
          given_name: fields.given.value.trim(),
          surname: fields.surname.value.trim(),
          card_number: fields.card.value,
          expiry: fields.expiry.value.trim(),
          security_code: fields.code.value.trim(),
          ...(stepUpCode ? { step_up_code: stepUpCode } : {}),
        },
      });
      dialogClose?.();
      await navigate(`/bookings/${booking.code}?lang=${state.lang}&cur=${state.cur}`);
    } catch (err) {
      const failure = failureOf(err);
      if (!failure) return;
      if (failure.status === 410) {
        holdEndedDialog();
        return;
      }
      if (failure.status === 409 && failure.body.error === 'price_changed') {
        priceChangedDialog(Number(failure.body.old_total_minor), Number(failure.body.new_total_minor));
        return;
      }
      if (failure.status === 402) {
        const outcome = String(failure.body.outcome);
        if (outcome === 'step_up') {
          stepUpDialog();
          return;
        }
        if (outcome === 'wrong_code') {
          wrongCode?.(m('card.wrong_code'));
          return;
        }
        showProblems([
          {
            label: t('ui.card_number'),
            message: m(`card.${outcome}`),
            focus: () => fields.card.focus(),
          },
        ]);
        return;
      }
      if (failure.status === 422 && failure.body.error === 'restricted') {
        const reason = failure.body.reason as { code: string; date?: string; n?: number };
        showProblems([
          {
            label: t('ui.dates'),
            message: m(`reason.${reason.code}`, { date: reason.date ?? '', n: reason.n ?? 0 }),
            focus: () => stripHolder.querySelector<HTMLElement>('button.night')?.focus(),
          },
        ]);
        return;
      }
      if (failure.status === 422 && failure.body.fields) {
        const map = failure.body.fields as Record<string, string>;
        const labels: Record<string, string> = {
          given_name: t('ui.given_name'),
          surname: t('ui.surname'),
          card_number: t('ui.card_number'),
          expiry: t('ui.expiry'),
          security_code: t('ui.security_code'),
        };
        showProblems(
          Object.entries(map).map(([key, value]) => ({
            label: labels[key] ?? key,
            message: m(value),
            focus: () => fields.card.focus(),
          })),
        );
      }
    }
  };

  payButton.addEventListener('click', () => void pay());

  const stepUpDialog = (): void => {
    openDialog({ name: t('ui.confirm_payment'), opener: payButton }, (body, handle) => {
      const codeInput = el('input', { type: 'text', 'aria-label': t('ui.code'), class: 'field' });
      const message = el('p', { class: 'field-message' });
      const confirm = el('button', { type: 'button' }, [t('ui.confirm')]);
      confirm.addEventListener('click', () => {
        void pay(codeInput.value.trim(), handle.close, (text) => {
          message.textContent = text;
        });
      });
      body.append(codeInput, message, confirm);
      codeInput.focus();
    });
  };

  const holdEndedDialog = (): void => {
    holdBand.hidden = true;
    enableFields(false);
    holdEnded = true;
    openAlert?.close();
    openAlert = openDialog(
      { name: t('ui.hold_ended_title'), role: 'alertdialog', opener: null, escapes: false },
      (body) => {
        const again = el('button', { type: 'button' }, [t('ui.search_again')]);
        again.addEventListener('click', () => void navigate(searchHref()));
        body.append(el('p', {}, [m('hold.ended')]), again);
      },
    );
  };

  const priceChangedDialog = (oldMinor: number, newMinor: number): void => {
    if (holdEnded) return;
    const text =
      oldMinor === newMinor
        ? m('price.refreshed', { new: amount(newMinor, quote.currency) })
        : m('price.changed', {
            old: amount(oldMinor, quote.currency),
            new: amount(newMinor, quote.currency),
          });
    openAlert?.close();
    openAlert = openDialog(
      { name: t('ui.price_changed_title'), role: 'alertdialog', opener: null, escapes: false },
      (body, handle) => {
        const accept = el('button', { type: 'button' }, [t('ui.accept_new_price')]);
        accept.addEventListener('click', () => {
          void (async () => {
            quote = await api<Quote>('/api/quotes', {
              method: 'POST',
              body: {
                property: quote.property,
                in: quote.in,
                out: quote.out,
                currency: quote.currency,
                rooms: quote.rooms.map((room) => ({
                  room_type: room.room_type,
                  plan: room.plan,
                  breakfast: room.breakfast,
                  adults: room.adults,
                  ages: room.ages,
                })),
                hold_id: holdId,
              },
              busy: accept,
            });
            paint();
            handle.close();
            payButton.focus();
          })();
        });
        const keep = el('button', { type: 'button' }, [t('ui.keep_searching')]);
        keep.addEventListener('click', () => {
          void (async () => {
            if (holdId) await api(`/api/holds/${holdId}`, { method: 'DELETE' }).catch(() => undefined);
            handle.close();
            await navigate(searchHref());
          })();
        });
        body.append(el('p', {}, [text]), accept, keep);
      },
    );
  };

  const justTakenDialog = (): void => {
    if (holdEnded) return;
    openAlert?.close();
    openAlert = openDialog({ name: t('ui.just_taken_title'), role: 'alertdialog', opener: null, escapes: false }, (body) => {
      const again = el('button', { type: 'button' }, [t('ui.search_again')]);
      again.addEventListener('click', () => void navigate(searchHref()));
      body.append(el('p', {}, [m('just.taken')]), again);
    });
  };

  const info = await api<{ zone: string }>(
    `/api/properties/${quote.property}?in=${quote.in}&out=${quote.out}&adults=1&ages=&cur=${quote.currency}`,
  );
  propertyZone = info.zone;

  main.append(
    stripHolder,
    displayControls(params, (next) => void navigate(`/checkout/${quote.id}?${next.toString()}`)),
    roomsSummary,
    holdBand,
    problemsHolder,
    el('div', { class: 'checkout-fields' }, [
      fields.given,
      fields.surname,
      fields.card,
      fields.expiry,
      fields.code,
    ]),
    payButton,
    priceRegion,
  );
  paint();

  if (holdId && quote.hold_expires_at) {
    startCountdown(quote.hold_expires_at);
    enableFields(true);
  }

  onEvent('hold.expired', (data) => {
    if (data.hold_id === holdId) {
      holdId = null;
      holdEndedDialog();
    }
  });
  onEvent('quote.changed', (data) => {
    if (data.quote_id === quote.id) {
      priceChangedDialog(Number(data.old_total_minor), Number(data.new_total_minor));
    }
  });
  onEvent('availability', (data) => {
    if (holdId || data.property !== quote.property) return;
    void (async () => {
      const fresh = await api<Quote>(`/api/quotes/${quote.id}`);
      quote = fresh;
      paint();
      if (fresh.nights.some((night) => night.state === 'closed')) justTakenDialog();
    })();
  });
}

