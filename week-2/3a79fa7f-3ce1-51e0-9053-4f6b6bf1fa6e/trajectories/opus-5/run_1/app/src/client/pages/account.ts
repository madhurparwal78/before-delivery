import { errorBody, get, post } from '../api.js';
import { capitalise, clear, el, formatCalendarDate, formatCents, formatLongDate, formatLongDateTime, formatRatePcm, svgIcon, uniqueId } from '../dom.js';
import { loadMe } from '../store.js';
import { announce, applyFieldErrors, field, openDialog, type FieldHandle } from '../ui.js';
import type { BookingItem, Order, Registration, SlotItem, TradeIn } from '../types.js';

interface OrdersPage {
  orders: Order[];
  next_cursor: string | null;
}

function statusTimeline(order: Order, withBy: boolean): HTMLElement {
  return el(
    'ol',
    { class: 'stack', style: 'list-style:none;padding:0' },
    order.events.map((event) =>
      el('li', {}, `${capitalise(event.status)} — ${formatLongDateTime(event.at)}${withBy ? ` by ${event.by}` : ''}`),
    ),
  );
}

function totalsRows(order: Order): HTMLElement[] {
  const discounts = order.discounts.reduce((sum, item) => sum + item.amount_cents, 0);
  const credits = order.credits.reduce((sum, item) => sum + item.amount_cents, 0);
  const rows: HTMLElement[] = [
    el('div', { class: 'totals-row' }, [el('span', {}, 'Discounts'), el('span', {}, `-${formatCents(discounts)}`)]),
    el('div', { class: 'totals-row' }, [el('span', {}, 'Credits'), el('span', {}, `-${formatCents(credits)}`)]),
    el('div', { class: 'totals-row' }, [
      el('span', {}, 'Shipping'),
      el('span', {}, order.shipping_cents === 0 ? 'Free' : formatCents(order.shipping_cents)),
    ]),
  ];
  if (order.dangerous_goods_cents !== 0) {
    rows.push(
      el('div', { class: 'totals-row' }, [
        el('span', {}, 'Dangerous goods handling'),
        el('span', {}, `${formatCents(order.dangerous_goods_cents)} (${order.packed_batteries} packed with a board, ${order.standalone_batteries} shipped alone)`),
      ]),
    );
  }
  for (const tax of order.taxes) {
    rows.push(
      el('div', { class: 'totals-row' }, [
        el('span', {}, `${tax.name} (${formatRatePcm(tax.rate_pcm)})`),
        el('span', {}, formatCents(tax.amount_cents)),
      ]),
    );
  }
  rows.push(
    el('div', { class: 'totals-row' }, [el('span', {}, 'Tax'), el('span', {}, formatCents(order.tax_cents))]),
    el('div', { class: 'totals-row grand' }, [el('span', {}, 'Total'), el('span', {}, formatCents(order.total_cents))]),
    el('div', { class: 'totals-row' }, [
      el('span', {}, 'Delivery'),
      el('span', {}, `Ships ${formatCalendarDate(order.ships_on)}, arrives ${formatCalendarDate(order.arrives_on)}`),
    ]),
  );
  return rows;
}

function ordersSection(path: string, heading: string): { node: HTMLElement; load: () => Promise<void> } {
  const list = el('div', { class: 'stack' });
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const more = el('button', { class: 'btn btn-secondary', type: 'button', hidden: true }, 'Load more orders');
  let cursor: string | null = null;

  const fetchPage = async (): Promise<void> => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    more.disabled = true;
    const label = more.textContent;
    if (cursor) more.textContent = 'Loading...';
    const result = await get<OrdersPage>(`${path}${query}`);
    more.disabled = false;
    more.textContent = label ?? 'Load more orders';
    if (!result.ok) {
      alert.textContent = errorBody(result).message;
      return;
    }
    for (const order of result.body.orders) {
      list.appendChild(
        el('div', { class: 'card stack' }, [
          el('h3', { style: 'margin:0' }, el('a', { href: `/account/orders/${order.number}` }, order.number)),
          el('p', { class: 'caption', style: 'margin:0' }, `${formatLongDate(order.placed_at)} — ${capitalise(order.status)} — ${formatCents(order.total_cents)}`),
        ]),
      );
    }
    if (cursor) announce(`${result.body.orders.length} more orders shown.`);
    cursor = result.body.next_cursor;
    more.hidden = cursor === null;
  };

  more.addEventListener('click', () => void fetchPage());
  return {
    node: el('section', { class: 'stack' }, [el('h2', {}, heading), alert, list, more]),
    load: fetchPage,
  };
}

export async function renderAccount(main: HTMLElement): Promise<void> {
  const me = await loadMe();
  if (!me) {
    window.location.replace('/login?next=/account');
    return;
  }
  if (me.user.role !== 'customer') {
    window.location.replace('/staff');
    return;
  }

  const orders = ordersSection('/api/orders', 'Orders');
  const tradeInSection = el('section', { class: 'stack' }, el('h2', {}, 'Your trade-in'));
  const bookingsSection = el('section', { class: 'stack' }, el('h2', {}, 'Bookings'));
  const callbacksSection = el('section', { class: 'stack' }, [el('h2', {}, 'Callbacks'), el('p', { class: 'muted' }, 'Your callback references arrive by email.')]);
  const boardsSection = el('section', { class: 'stack' }, el('h2', {}, 'Registered boards'));
  const passwordSection = el('section', { class: 'stack' }, el('h2', {}, 'Change password'));

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Your account'),
      el('p', { class: 'caption' }, me.user.email),
      orders.node,
      tradeInSection,
      bookingsSection,
      callbacksSection,
      boardsSection,
      passwordSection,
    ]),
  );

  await orders.load();

  const tradeIns = await get<{ trade_ins: TradeIn[] }>('/api/trade-ins/mine');
  const latest = tradeIns.ok ? tradeIns.body.trade_ins[0] : undefined;
  tradeInSection.appendChild(
    latest
      ? el('div', { class: 'card stack' }, [
          el('p', { class: 'badge', style: 'margin:0' }, capitalise(latest.status)),
          latest.quote_cents === null ? null : el('p', { style: 'margin:0' }, `Credit ${formatCents(latest.quote_cents)}`),
          el('a', { href: '/trade-in' }, 'Manage your trade-in'),
        ])
      : el('p', { class: 'muted' }, 'You have no trade-in yet.'),
  );

  const bookings = await get<{ bookings: BookingItem[] }>('/api/demo-bookings/mine');
  const slotLabels = new Map<number, string>();
  if (bookings.ok) {
    const locations = await get<{ locations: { id: number }[] }>('/api/locations');
    if (locations.ok) {
      for (const location of locations.body.locations) {
        const slots = await get<{ slots: SlotItem[] }>(`/api/locations/${location.id}/slots`);
        if (!slots.ok) continue;
        for (const slot of slots.body.slots) slotLabels.set(slot.id, slot.label);
      }
    }
    const active = bookings.body.bookings.filter((booking) => booking.status !== 'cancelled');
    if (active.length === 0) bookingsSection.appendChild(el('p', { class: 'muted' }, 'You hold no demo seats.'));
    for (const booking of active) {
      const label = slotLabels.get(booking.slot_id) ?? `slot ${booking.slot_id}`;
      const cancel = el('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': `Cancel booking, ${label}` }, 'Cancel booking');
      const row = el('div', { class: 'card row' }, [el('span', {}, `${label} — ${capitalise(booking.status)}`), cancel]);
      cancel.addEventListener('click', async () => {
        cancel.disabled = true;
        cancel.textContent = 'Cancelling...';
        const result = await post(`/api/demo-bookings/${booking.id}/cancel`);
        cancel.disabled = false;
        cancel.textContent = 'Cancel booking';
        if (!result.ok) {
          row.appendChild(el('p', { class: 'field-error' }, errorBody(result).message));
          return;
        }
        announce('Booking cancelled.');
        row.remove();
      });
      bookingsSection.appendChild(row);
    }
  }

  const registrations = await get<{ registrations: Registration[] }>('/api/registrations/mine');
  if (registrations.ok) {
    if (registrations.body.registrations.length === 0) {
      boardsSection.appendChild(el('p', { class: 'muted' }, 'No boards registered yet.'));
    }
    for (const registration of registrations.body.registrations) {
      const transfer = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, `Transfer ${registration.serial}`);
      const row = el('div', { class: 'card stack' }, [
        el('h3', { style: 'margin:0' }, `${registration.board_name} ${registration.serial}`),
        el('p', { style: 'margin:0' }, `Board warranty: ${registration.board_days_left} days left`),
        el('p', { style: 'margin:0' }, `Battery warranty: ${registration.battery_days_left} days left`),
        transfer,
      ]);
      transfer.addEventListener('click', () => {
        const email = field("New owner's email", 'text', { type: 'email' });
        const submit = el('button', { class: 'btn', type: 'button' }, 'Transfer board');
        const dialog = openDialog({
          title: `Transfer ${registration.serial}`,
          opener: transfer,
          content: [email.wrapper, submit],
        });
        submit.addEventListener('click', async () => {
          email.setError(null);
          submit.disabled = true;
          submit.textContent = 'Transferring...';
          const result = await post(`/api/registrations/${registration.serial}/transfer`, { email: email.control.value });
          submit.disabled = false;
          submit.textContent = 'Transfer board';
          if (!result.ok) {
            const body = errorBody(result);
            email.setError(body.fields?.email ?? body.message);
            return;
          }
          dialog.close();
          announce(`Board ${registration.serial} transferred.`);
          row.remove();
        });
      });
      boardsSection.appendChild(row);
    }
  }

  const current = field('Current password', 'text', { type: 'password', autocomplete: 'current-password' });
  const next = field('New password', 'text', { type: 'password', autocomplete: 'new-password' });
  const save = el('button', { class: 'btn', type: 'button' }, 'Save new password');
  const passwordAlert = el('div', { class: 'alert-region', role: 'alert' });
  const handles: Record<string, FieldHandle> = { current_password: current, new_password: next };
  save.addEventListener('click', async () => {
    passwordAlert.textContent = '';
    save.disabled = true;
    save.textContent = 'Saving...';
    const result = await post('/api/auth/password', {
      current_password: current.control.value,
      new_password: next.control.value,
    });
    save.disabled = false;
    save.textContent = 'Save new password';
    if (!result.ok) {
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (!body.fields) passwordAlert.textContent = body.message;
      return;
    }
    current.control.value = '';
    next.control.value = '';
    announce('Password changed. Other devices were signed out.');
  });
  passwordSection.append(passwordAlert, current.wrapper, next.wrapper, save);
}

export async function renderOrderPage(main: HTMLElement): Promise<void> {
  const me = await loadMe();
  const number = window.location.pathname.split('/').pop() ?? '';
  if (!me) {
    window.location.replace(`/login?next=/account/orders/${number}`);
    return;
  }

  const banner = window.sessionStorage.getItem('tf-order-banner');
  window.sessionStorage.removeItem('tf-order-banner');

  const page = el('section', { class: 'band wrap stack' });
  main.replaceChildren(page);

  const paint = async (): Promise<void> => {
    const result = await get<Order>(`/api/orders/${encodeURIComponent(number)}`);
    clear(page);
    if (banner) {
      const warn = banner.startsWith('Sorry');
      page.appendChild(el('div', { class: `banner ${warn ? 'banner-warn' : 'banner-success'}`, role: 'status' }, [svgIcon(warn ? 'warning' : 'tick'), el('span', {}, banner)]));
    }
    if (!result.ok) {
      page.append(el('h1', {}, 'Page not found'), el('a', { href: '/' }, 'Back to home'));
      return;
    }
    const order = result.body;
    const alert = el('div', { class: 'alert-region', role: 'alert' });
    page.append(el('h1', {}, `Order ${order.number}`), alert, el('h2', {}, 'Status'), statusTimeline(order, true));

    const linesBox = el('section', { class: 'stack' }, el('h2', {}, 'Lines'));
    for (const line of order.lines) {
      const row = el('div', { class: 'card stack' }, [
        el('h3', { style: 'margin:0' }, line.name),
        el('p', { style: 'margin:0' }, `${line.quantity} x ${formatCents(line.unit_cents)} = ${formatCents(line.line_cents)}`),
      ]);

      if (line.type === 'build' && order.status !== 'cancelled') {
        if (line.protected_until) {
          row.appendChild(el('p', { style: 'margin:0' }, `Protected until ${formatLongDate(line.protected_until)}`));
        } else {
          const groupName = uniqueId('term');
          const termError = el('p', { class: 'field-error', hidden: true });
          const terms = [2, 3].map((years) => {
            const id = uniqueId('term-option');
            return el('div', { class: 'option' }, [
              el('input', { type: 'radio', name: groupName, id, value: String(years), checked: years === 2 }),
              el('label', { for: id, class: 'option-body' }, el('span', { class: 'option-name' }, `${years} years`)),
            ]);
          });
          const addProtection = el('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': `Add protection to ${line.name}` }, 'Add protection');
          addProtection.addEventListener('click', async () => {
            termError.hidden = true;
            addProtection.disabled = true;
            addProtection.textContent = 'Adding...';
            const chosen = row.querySelector<HTMLInputElement>(`input[name="${groupName}"]:checked`);
            const result2 = await post(`/api/orders/${order.number}/protection`, {
              line_id: line.id,
              term_years: Number(chosen?.value ?? 2),
            });
            addProtection.disabled = false;
            addProtection.textContent = 'Add protection';
            if (!result2.ok) {
              const body = errorBody(result2);
              termError.textContent = body.fields?.term_years ?? body.message;
              termError.hidden = false;
              return;
            }
            await paint();
          });
          row.append(
            el('div', { role: 'radiogroup', 'aria-label': `Term for ${line.name}` }, terms),
            termError,
            addProtection,
          );
        }
      }

      if (line.type === 'build' && order.status === 'delivered') {
        const register = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, `Register ${line.name}`);
        register.addEventListener('click', () => {
          const serial = field('Serial number', 'text');
          const submit = el('button', { class: 'btn', type: 'button' }, 'Register board');
          const dialog = openDialog({ title: 'Register your board', opener: register, content: [serial.wrapper, submit] });
          submit.addEventListener('click', async () => {
            serial.setError(null);
            submit.disabled = true;
            submit.textContent = 'Registering...';
            const result2 = await post('/api/registrations', {
              order_number: order.number,
              line_id: line.id,
              serial: serial.control.value,
            });
            submit.disabled = false;
            submit.textContent = 'Register board';
            if (!result2.ok) {
              const body = errorBody(result2);
              serial.setError(
                body.error === 'already_registered' ? 'This board is already registered.' : body.fields?.serial ?? body.message,
              );
              return;
            }
            dialog.close();
            announce(`Board ${serial.control.value} registered.`);
          });
        });
        row.appendChild(register);
      }

      linesBox.appendChild(row);
    }
    page.appendChild(linesBox);
    page.append(el('section', { class: 'stack' }, [el('h2', {}, 'Totals'), ...totalsRows(order)]));
    page.appendChild(el('p', { class: 'caption' }, `Billing account ${order.billing_account_key ?? ''}`));

    if (order.status === 'placed') {
      const cancel = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Cancel order');
      cancel.addEventListener('click', () => {
        const confirm = el('button', { class: 'btn', type: 'button' }, 'Yes, cancel order');
        const keep = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Keep order');
        const dialogAlert = el('div', { class: 'alert-region', role: 'alert' });
        const dialog = openDialog({
          title: 'Cancel this order?',
          opener: cancel,
          content: [dialogAlert, el('div', { class: 'row' }, [confirm, keep])],
        });
        keep.addEventListener('click', () => dialog.close());
        confirm.addEventListener('click', async () => {
          dialogAlert.textContent = '';
          confirm.disabled = true;
          confirm.textContent = 'Cancelling...';
          const result2 = await post(`/api/orders/${order.number}/cancel`);
          confirm.disabled = false;
          confirm.textContent = 'Yes, cancel order';
          if (!result2.ok) {
            dialogAlert.textContent = errorBody(result2).message;
            return;
          }
          dialog.close();
          window.sessionStorage.setItem('tf-order-banner', `Order ${order.number} cancelled.`);
          window.location.reload();
        });
      });
      page.appendChild(cancel);
    }
  };

  await paint();
}
