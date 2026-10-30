import { errorBody, get, post, serverNow } from '../api.js';
import { capitalise, clear, el, formatCents, formatLongDateTime } from '../dom.js';
import { loadMe } from '../store.js';
import { announce, applyFieldErrors, field, type FieldHandle } from '../ui.js';
import type { TradeIn } from '../types.js';

const BRANDS = ['Tern Foils', 'Other electric hydrofoil', 'Surf foil board'];

export async function renderTradeIn(main: HTMLElement): Promise<void> {
  const me = await loadMe();
  const heading = el('h1', {}, 'Trade your board for credit toward a Crest.');

  if (!me || me.user.role !== 'customer') {
    main.replaceChildren(
      el('section', { class: 'band wrap stack narrow' }, [
        heading,
        el('p', {}, 'Send us your old board, we quote a credit, and the credit comes off a Crest build at checkout.'),
        el('a', { href: '/login?next=/trade-in', class: 'btn' }, 'Sign in to trade in'),
      ]),
    );
    return;
  }

  const brand = field('Current board', 'select', { options: BRANDS.map((value) => ({ value, label: value })) });
  const modelYear = field('Model year', 'select', {
    options: [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((year) => ({ value: String(year), label: String(year) })),
  });
  const serial = field('Serial number', 'text');
  const note = field('Note', 'textarea');
  const submit = el('button', { class: 'btn', type: 'button' }, 'Submit trade-in');
  const alert = el('div', { class: 'alert-region', role: 'alert' });

  const conditionError = el('p', { class: 'field-error', hidden: true });
  const conditions = ['A', 'B', 'C'].map((grade) => {
    const id = `condition-${grade}`;
    return el('div', { class: 'option' }, [
      el('input', { type: 'radio', name: 'condition', id, value: grade, checked: grade === 'A' }),
      el('label', { for: id, class: 'option-body' }, el('span', { class: 'option-name' }, grade)),
    ]);
  });
  const conditionGroup = el('fieldset', {}, [
    el('legend', {}, 'Condition'),
    el('div', { role: 'radiogroup', 'aria-label': 'Condition' }, conditions),
    conditionError,
  ]);

  const latestBox = el('section', { class: 'stack' });
  const form = el('form', { novalidate: true }, [alert, brand.wrapper, modelYear.wrapper, conditionGroup, serial.wrapper, note.wrapper, submit]);

  main.replaceChildren(
    el('section', { class: 'band wrap stack narrow' }, [
      heading,
      el('p', {}, 'Tell us what you ride now. Support staff quote a credit that holds for fourteen days.'),
      form,
      latestBox,
    ]),
  );

  const handles: Record<string, FieldHandle> = {
    brand,
    model_year: modelYear,
    serial,
    note,
  };

  const paintLatest = async (): Promise<void> => {
    const result = await get<{ trade_ins: TradeIn[] }>('/api/trade-ins/mine');
    clear(latestBox);
    latestBox.appendChild(el('h2', {}, 'Your latest trade-in'));
    const latest = result.ok ? result.body.trade_ins[0] : undefined;
    if (!latest) {
      latestBox.appendChild(el('p', { class: 'muted' }, 'Nothing submitted yet.'));
      return;
    }
    const box = el('div', { class: 'card stack' }, [
      el('p', { class: 'badge', style: 'margin:0' }, capitalise(latest.status)),
      el('p', { class: 'caption', style: 'margin:0' }, `${latest.brand}, ${latest.model_year}, condition ${latest.condition}, serial ${latest.serial}`),
    ]);
    if (latest.quote_cents !== null) box.appendChild(el('p', { style: 'margin:0' }, `Credit ${formatCents(latest.quote_cents)}`));
    if (latest.quote_expires_at !== null && latest.status === 'quoted') {
      box.appendChild(el('p', { style: 'margin:0' }, `Valid until ${formatLongDateTime(latest.quote_expires_at)}`));
    }
    if (latest.status === 'expired' && latest.quote_expires_at) {
      box.appendChild(el('p', {}, `This quote expired on ${formatLongDateTime(latest.quote_expires_at)}.`));
    }
    if (latest.status === 'applied' && latest.order_number) {
      box.appendChild(el('p', {}, `Applied to order ${latest.order_number}`));
    }
    if (latest.status === 'rejected' && latest.reject_reason) {
      box.appendChild(el('p', { class: 'muted' }, latest.reject_reason));
    }

    if (latest.status === 'quoted') {
      const accept = el('button', { class: 'btn', type: 'button' }, 'Accept quote');
      const decline = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Decline');
      const rowAlert = el('div', { class: 'alert-region', role: 'alert' });
      const move = async (action: 'accept' | 'decline', node: HTMLButtonElement, pending: string, done: string): Promise<void> => {
        rowAlert.textContent = '';
        node.disabled = true;
        const label = node.textContent;
        node.textContent = pending;
        const result2 = await post(`/api/trade-ins/${latest.id}/${action}`);
        node.disabled = false;
        node.textContent = label ?? '';
        if (!result2.ok) {
          rowAlert.textContent = errorBody(result2).message;
          await paintLatest();
          return;
        }
        announce(done);
        await paintLatest();
      };
      accept.addEventListener('click', () => void move('accept', accept, 'Accepting...', 'Quote accepted.'));
      decline.addEventListener('click', () => void move('decline', decline, 'Declining...', 'Quote declined.'));
      box.append(rowAlert, el('div', { class: 'row' }, [accept, decline]));

      if (latest.quote_expires_at) {
        const remaining = new Date(latest.quote_expires_at).getTime() - serverNow();
        if (remaining > 0 && remaining < 2147483647) window.setTimeout(() => void paintLatest(), remaining + 500);
      }
    }

    latestBox.appendChild(box);
  };

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    conditionError.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Submitting...';
    const chosen = form.querySelector<HTMLInputElement>('input[name="condition"]:checked');
    const result = await post('/api/trade-ins', {
      brand: brand.control.value,
      model_year: Number(modelYear.control.value),
      condition: chosen?.value ?? '',
      serial: serial.control.value,
      note: note.control.value,
    });
    submit.disabled = false;
    submit.textContent = 'Submit trade-in';
    if (!result.ok) {
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (body.fields?.condition) {
        conditionError.textContent = body.fields.condition;
        conditionError.hidden = false;
      }
      if (!body.fields) alert.textContent = body.message;
      return;
    }
    announce('Trade-in submitted.');
    await paintLatest();
  });

  await paintLatest();
}
