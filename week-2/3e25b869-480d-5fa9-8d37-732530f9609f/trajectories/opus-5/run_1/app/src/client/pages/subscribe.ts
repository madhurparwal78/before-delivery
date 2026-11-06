import { moneyText } from '../../shared/bilingual.js';
import { CADENCE_LABELS, CADENCES, TRIO_SCENTS, scentName } from '../../shared/catalog.js';
import { ACCOUNT, UI } from '../../shared/copy.js';
import { trioPrice } from '../../shared/money.js';
import type { Cadence, Money, ProvinceCode, Subscription } from '../../shared/types.js';
import { api, ApiFailure, newIdempotencyKey } from '../api.js';
import { locale } from '../i18n.js';
import { announce, clearRegion, regionText } from '../live.js';
import { navigate } from '../router.js';
import { everyPoll, loadStatus, store } from '../store.js';
import { bind, el, refresh, say } from '../ui.js';
import {
  codeRequestedMessage,
  emailStep,
  FieldSet,
  moneyRegion,
  provincePicker,
  shippingForm,
} from './forms.js';

export type CadenceMenu = { element: HTMLElement; value: () => Cadence | null; set: (next: Cadence) => void };

export function cadenceMenu(onChoose: (cadence: Cadence) => void): CadenceMenu {
  const opener = el('button', {
    type: 'button',
    class: 'button secondary cadence-opener',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
  });
  const listbox = el('ul', { role: 'listbox', class: 'cadence-listbox', hidden: true });
  const wrapper = el('div', { class: 'cadence-menu' }, [opener, listbox]);
  let chosen: Cadence | null = null;
  let open = false;

  const options = CADENCES.map((cadence) => {
    const option = el('li', {
      role: 'option',
      class: 'cadence-option',
      tabindex: '-1',
      'aria-selected': 'false',
      'data-cadence': cadence,
    });
    option.addEventListener('click', () => choose(cadence));
    option.addEventListener('keydown', (event) => handleKey(event, cadence));
    listbox.append(option);
    return option;
  });

  const paint = (): void => {
    opener.setAttribute('aria-label', say(UI.cadence));
    opener.textContent = chosen ? say(CADENCE_LABELS[chosen]) : say(UI.cadenceChoose);
    opener.setAttribute('aria-expanded', open ? 'true' : 'false');
    listbox.setAttribute('aria-label', say(UI.cadence));
    listbox.hidden = !open;
    options.forEach((option, index) => {
      const cadence = CADENCES[index] as Cadence;
      option.textContent = say(CADENCE_LABELS[cadence]);
      option.setAttribute('aria-selected', chosen === cadence ? 'true' : 'false');
    });
  };

  const setOpen = (next: boolean): void => {
    open = next;
    paint();
    if (!open) return;
    const target =
      options.find((option) => option.getAttribute('aria-selected') === 'true') ?? options[0];
    target?.focus();
  };

  const choose = (cadence: Cadence): void => {
    chosen = cadence;
    open = false;
    paint();
    opener.focus();
    onChoose(cadence);
    refresh();
  };

  function handleKey(event: KeyboardEvent, cadence: Cadence): void {
    const index = CADENCES.indexOf(cadence);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[Math.min(options.length - 1, Math.max(0, index + step))]?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(cadence);
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      setOpen(false);
      opener.focus();
    }
  }

  opener.addEventListener('click', () => setOpen(!open));
  opener.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  });
  bind(paint);
  return { element: wrapper, value: () => chosen, set: (next) => choose(next) };
}

function scentRadios(label: typeof UI.trioScentGroup, onChange: () => void): {
  element: HTMLElement;
  value: () => string | null;
} {
  const group = el('div', { role: 'radiogroup', class: 'scent-chips' });
  let chosen: string | null = null;
  const radios = TRIO_SCENTS.map((scent, index) => {
    const radio = el('button', {
      type: 'button',
      role: 'radio',
      class: 'scent-chip',
      'aria-checked': 'false',
      tabindex: index === 0 ? '0' : '-1',
      'data-scent': scent.slug,
    });
    radio.addEventListener('click', () => select(scent.slug));
    radio.addEventListener('keydown', (event) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = TRIO_SCENTS[(index + step + TRIO_SCENTS.length) % TRIO_SCENTS.length];
      if (next) select(next.slug);
    });
    group.append(radio);
    return radio;
  });

  const select = (slug: string): void => {
    chosen = slug;
    paint();
    group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    onChange();
  };

  const paint = (): void => {
    group.setAttribute('aria-label', say(label));
    radios.forEach((radio, index) => {
      const scent = TRIO_SCENTS[index];
      if (!scent) return;
      radio.textContent = scentName(scent.slug, locale());
      const selected = chosen === scent.slug;
      radio.setAttribute('aria-checked', selected ? 'true' : 'false');
      radio.tabIndex = selected || (chosen === null && index === 0) ? 0 : -1;
    });
  };

  bind(paint);
  return { element: group, value: () => chosen };
}

export function renderSubscribe(main: HTMLElement): void {
  const heading = el('h1', { class: 'page-heading' });
  const description = el('p', { class: 'trio-description' });
  const fields = new FieldSet();
  const accountRegion = el('p', { role: 'status', class: 'live-region' });
  const scents = scentRadios(UI.trioScentGroup, () => refresh());
  const menu = cadenceMenu(() => refresh());
  const province = provincePicker((next: ProvinceCode) => {
    store.province = next;
    refresh();
  }, store.province);

  const price = moneyRegion(UI.trioPrice, () => {
    const breakdown = trioPrice(store.province);
    return {
      subtotal: breakdown.subtotal,
      shipping: null,
      discount: breakdown.discount,
      taxes: breakdown.taxes,
      total: breakdown.total,
      chargedToday: breakdown.total,
    };
  });

  const shipping = shippingForm(fields);
  const step = emailStep({
    purpose: 'checkout',
    fields,
    onCodeRequested: (email) => announce('account', codeRequestedMessage(email)),
    onVerified: () => {
      refresh();
      shipping.focusName();
    },
  });

  const startButton = el('button', { type: 'button', class: 'button primary' });
  let starting = false;

  const startState = (): { name: string; enabled: boolean } => {
    if (starting) return { name: say(UI.startingPending), enabled: false };
    if (store.status?.billing === 'down') return { name: say(UI.subscriptionsPaused), enabled: false };
    if (step.verified() === null) return { name: say(UI.verifyFirst), enabled: false };
    return { name: say(UI.startSubscription), enabled: true };
  };

  const start = async (): Promise<void> => {
    if (starting) return;
    const cadence = menu.value();
    const scent = scents.value();
    starting = true;
    refresh();
    try {
      const body: Record<string, unknown> = {
        shipping: { ...shipping.read(), province: store.province },
      };
      if (scent !== null) body['scent'] = scent;
      if (cadence !== null) body['cadence'] = cadence;
      const result = await api.post<{ subscription: Subscription; charged_today: Money }>(
        '/api/subscriptions',
        body,
        { idempotencyKey: newIdempotencyKey() },
      );
      announce('account', ACCOUNT.subscriptionStarted(moneyText(result.charged_today)));
      navigate(`/account/subscriptions/${result.subscription.number}`);
      return;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'subscription_exists') announce('account', ACCOUNT.subscriptionExists);
      else if (error.status === 422) fields.show(error.fields);
    } finally {
      starting = false;
      refresh();
    }
  };

  startButton.addEventListener('click', () => void start());

  bind(() => {
    heading.textContent = say(UI.trioHeading);
    description.textContent = say(UI.trioDescription);
    accountRegion.setAttribute('aria-label', say(UI.accountUpdates));
    accountRegion.textContent = regionText('account');
    const state = startState();
    startButton.textContent = state.name;
    startButton.disabled = !state.enabled;
    startButton.setAttribute('aria-busy', starting ? 'true' : 'false');
  });

  main.append(
    heading,
    el('div', { class: 'grid checkout-grid' }, [
      description,
      scents.element,
      menu.element,
      province,
      el('aside', { class: 'checkout-total' }, [price]),
      fields.summary,
      step.alerts,
      step.element,
      shipping.element,
      startButton,
      accountRegion,
    ]),
  );

  void loadStatus().then(refresh);
  everyPoll(async () => {
    await loadStatus();
    refresh();
  });
  clearRegion('account');
}
