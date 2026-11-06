import { errorBody, get, post } from '../api.js';
import { capitalise, clear, el, formatCents, formatLongDateTime, uniqueId } from '../dom.js';
import { loadMe } from '../store.js';
import { announce, field, openDialog } from '../ui.js';
import type { BookingItem, LocationItem, Notice, Order, SlotItem, TradeIn } from '../types.js';

type TabName = 'Trade-ins' | 'Demo days' | 'Orders' | 'Outbox';

const TABS_BY_ROLE: Record<string, TabName[]> = {
  admin: ['Trade-ins', 'Demo days', 'Orders', 'Outbox'],
  dealer: ['Demo days'],
  support: ['Trade-ins', 'Outbox'],
};

async function tradeInsPanel(host: HTMLElement): Promise<void> {
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const list = el('div', { class: 'stack' });
  host.replaceChildren(el('h2', {}, 'Submitted trade-ins'), alert, list);

  const paint = async (): Promise<void> => {
    const result = await get<{ trade_ins: TradeIn[] }>('/api/staff/trade-ins?status=submitted');
    clear(list);
    if (!result.ok) {
      alert.textContent = errorBody(result).message;
      return;
    }
    if (result.body.trade_ins.length === 0) list.appendChild(el('p', { class: 'muted' }, 'No trade-ins waiting.'));
    for (const tradeIn of result.body.trade_ins) {
      const quote = el('button', { class: 'btn btn-small', type: 'button' }, `Quote ${tradeIn.id}`);
      const reject = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, `Reject ${tradeIn.id}`);

      quote.addEventListener('click', () => {
        const amount = field('Amount in dollars', 'text', { inputmode: 'decimal' });
        const save = el('button', { class: 'btn', type: 'button' }, 'Save quote');
        const dialogAlert = el('div', { class: 'alert-region', role: 'alert' });
        const dialog = openDialog({ title: `Quote ${tradeIn.id}`, opener: quote, content: [dialogAlert, amount.wrapper, save] });
        save.addEventListener('click', async () => {
          amount.setError(null);
          dialogAlert.textContent = '';
          save.disabled = true;
          const cents = Math.round(Number(amount.control.value) * 100);
          const result2 = await post(`/api/staff/trade-ins/${tradeIn.id}/quote`, { amount_cents: cents });
          save.disabled = false;
          if (!result2.ok) {
            const body = errorBody(result2);
            if (body.fields?.amount_cents) amount.setError(body.fields.amount_cents);
            else dialogAlert.textContent = body.message;
            return;
          }
          dialog.close();
          announce('Quote saved.');
          await paint();
        });
      });

      reject.addEventListener('click', () => {
        const reason = field('Reason', 'textarea');
        const save = el('button', { class: 'btn', type: 'button' }, 'Reject trade-in');
        const dialogAlert = el('div', { class: 'alert-region', role: 'alert' });
        const dialog = openDialog({ title: `Reject ${tradeIn.id}`, opener: reject, content: [dialogAlert, reason.wrapper, save] });
        save.addEventListener('click', async () => {
          reason.setError(null);
          dialogAlert.textContent = '';
          save.disabled = true;
          const result2 = await post(`/api/staff/trade-ins/${tradeIn.id}/reject`, { reason: reason.control.value });
          save.disabled = false;
          if (!result2.ok) {
            const body = errorBody(result2);
            if (body.fields?.reason) reason.setError(body.fields.reason);
            else dialogAlert.textContent = body.message;
            return;
          }
          dialog.close();
          announce('Trade-in rejected.');
          await paint();
        });
      });

      list.appendChild(
        el('div', { class: 'card stack' }, [
          el('h3', { style: 'margin:0' }, `Trade-in ${tradeIn.id}`),
          el('p', { class: 'caption', style: 'margin:0' }, `${tradeIn.brand}, ${tradeIn.model_year}, condition ${tradeIn.condition}, serial ${tradeIn.serial}`),
          tradeIn.note ? el('p', { style: 'margin:0' }, tradeIn.note) : null,
          el('div', { class: 'row' }, [quote, reject]),
        ]),
      );
    }
  };

  await paint();
}

async function demoDaysPanel(host: HTMLElement): Promise<void> {
  const locations = await get<{ locations: LocationItem[] }>('/api/locations');
  const options = locations.ok ? locations.body.locations.map((item) => ({ value: String(item.id), label: item.name })) : [];
  const chooser = field('Location', 'select', { options });
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const slotsBox = el('div', { class: 'stack' });
  const bookingsBox = el('div', { class: 'stack' });

  const starts = field('Starts (UTC)', 'text', { helper: 'ISO 8601, like 2030-06-15T10:00:00Z' });
  const ends = field('Ends (UTC)', 'text', { helper: 'ISO 8601, like 2030-06-15T12:00:00Z' });
  const capacity = field('Capacity', 'text', { type: 'number', min: '1', max: '20', value: '4' });
  const addSlot = el('button', { class: 'btn', type: 'button' }, 'Add slot');

  host.replaceChildren(
    el('h2', {}, 'Demo days'),
    alert,
    chooser.wrapper,
    el('section', { class: 'card stack' }, [el('h3', {}, 'Add slot'), starts.wrapper, ends.wrapper, capacity.wrapper, addSlot]),
    el('section', { class: 'stack' }, [el('h3', {}, 'Slots'), slotsBox]),
    el('section', { class: 'stack' }, [el('h3', {}, 'Bookings'), bookingsBox]),
  );

  const paint = async (): Promise<void> => {
    const locationId = chooser.control.value;
    if (!locationId) return;
    const slots = await get<{ slots: SlotItem[] }>(`/api/locations/${locationId}/slots`);
    clear(slotsBox);
    if (slots.ok) {
      for (const slot of slots.body.slots) {
        slotsBox.appendChild(el('p', { style: 'margin:0' }, `${slot.label} — ${slot.seats_left} of ${slot.capacity} seats left`));
      }
      if (slots.body.slots.length === 0) slotsBox.appendChild(el('p', { class: 'muted' }, 'No upcoming slots.'));
    }

    const bookings = await get<{ bookings: BookingItem[] }>(`/api/staff/locations/${locationId}/bookings`);
    clear(bookingsBox);
    if (!bookings.ok) {
      alert.textContent = errorBody(bookings).message;
      return;
    }
    const labels = new Map((slots.ok ? slots.body.slots : []).map((slot) => [slot.id, slot.label]));
    if (bookings.body.bookings.length === 0) bookingsBox.appendChild(el('p', { class: 'muted' }, 'No bookings yet.'));
    for (const booking of bookings.body.bookings) {
      const mark = el('button', { class: 'btn btn-small', type: 'button' }, `Mark attended ${booking.id}`);
      const row = el('div', { class: 'card row' }, [
        el('span', {}, `${labels.get(booking.slot_id) ?? `slot ${booking.slot_id}`} — ${booking.customer_email} — ${capitalise(booking.status)}`),
        booking.status === 'booked' ? mark : null,
      ]);
      mark.addEventListener('click', async () => {
        alert.textContent = '';
        mark.disabled = true;
        const result = await post(`/api/staff/demo-bookings/${booking.id}/attended`);
        mark.disabled = false;
        if (!result.ok) {
          alert.textContent = errorBody(result).message;
          return;
        }
        announce('Marked attended.');
        await paint();
      });
      bookingsBox.appendChild(row);
    }
  };

  addSlot.addEventListener('click', async () => {
    alert.textContent = '';
    for (const handle of [starts, ends, capacity]) handle.setError(null);
    addSlot.disabled = true;
    const result = await post(`/api/staff/locations/${chooser.control.value}/slots`, {
      starts_at: starts.control.value,
      ends_at: ends.control.value,
      capacity: Number(capacity.control.value),
    });
    addSlot.disabled = false;
    if (!result.ok) {
      const body = errorBody(result);
      if (body.fields?.starts_at) starts.setError(body.fields.starts_at);
      if (body.fields?.ends_at) ends.setError(body.fields.ends_at);
      if (body.fields?.capacity) capacity.setError(body.fields.capacity);
      if (!body.fields) alert.textContent = body.message;
      return;
    }
    announce('Slot added.');
    await paint();
  });

  chooser.control.addEventListener('change', () => void paint());
  await paint();
}

async function ordersPanel(host: HTMLElement): Promise<void> {
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const list = el('div', { class: 'stack' });
  const more = el('button', { class: 'btn btn-secondary', type: 'button', hidden: true }, 'Load more orders');
  host.replaceChildren(el('h2', {}, 'Orders'), alert, list, more);
  let cursor: string | null = null;

  const appendOrders = (orders: Order[]): void => {
    for (const order of orders) {
      const next = order.status === 'placed' ? 'ship' : order.status === 'shipped' ? 'deliver' : null;
      const action = next
        ? el('button', { class: 'btn btn-small', type: 'button' }, `Mark ${next === 'ship' ? 'shipped' : 'delivered'} ${order.number}`)
        : null;
      const row = el('div', { class: 'card row' }, [
        el('span', {}, `${order.number} — ${capitalise(order.status)} — ${formatCents(order.total_cents)} — ${order.country}`),
        action,
      ]);
      action?.addEventListener('click', async () => {
        alert.textContent = '';
        action.disabled = true;
        const result = await post(`/api/staff/orders/${order.number}/${next}`);
        action.disabled = false;
        if (!result.ok) {
          alert.textContent = errorBody(result).message;
          return;
        }
        announce(`Order ${order.number} marked ${next === 'ship' ? 'shipped' : 'delivered'}.`);
        cursor = null;
        clear(list);
        await load();
      });
      list.appendChild(row);
    }
  };

  async function load(): Promise<void> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const label = more.textContent;
    if (cursor) more.textContent = 'Loading...';
    more.disabled = true;
    const result = await get<{ orders: Order[]; next_cursor: string | null }>(`/api/staff/orders${query}`);
    more.disabled = false;
    more.textContent = label ?? 'Load more orders';
    if (!result.ok) {
      alert.textContent = errorBody(result).message;
      return;
    }
    appendOrders(result.body.orders);
    if (cursor) announce(`${result.body.orders.length} more orders shown.`);
    cursor = result.body.next_cursor;
    more.hidden = cursor === null;
  }

  more.addEventListener('click', () => void load());
  await load();
}

async function outboxPanel(host: HTMLElement): Promise<void> {
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const list = el('div', { class: 'stack' });
  host.replaceChildren(el('h2', {}, 'Notice outbox'), alert, list);

  const paint = async (): Promise<void> => {
    const result = await get<{ notices: Notice[] }>('/api/staff/outbox');
    if (!result.ok) {
      alert.textContent = errorBody(result).message;
      return;
    }
    clear(list);
    if (result.body.notices.length === 0) list.appendChild(el('p', { class: 'muted' }, 'The outbox is empty.'));
    for (const notice of result.body.notices) {
      list.appendChild(
        el('div', { class: 'card stack' }, [
          el('p', { style: 'margin:0;font-weight:600' }, notice.subject),
          el('p', { class: 'caption', style: 'margin:0' }, `To ${notice.to}`),
          el('p', { style: 'margin:0' }, notice.status === 'sent' ? 'Sent' : `Pending (attempt ${notice.attempts})`),
          el('p', { class: 'caption', style: 'margin:0' }, formatLongDateTime(notice.created_at)),
        ]),
      );
    }
  };

  await paint();
  const timer = window.setInterval(() => {
    if (!host.isConnected || host.hidden) {
      window.clearInterval(timer);
      return;
    }
    void paint();
  }, 5000);
}

export async function renderStaff(main: HTMLElement): Promise<void> {
  const me = await loadMe();
  if (!me) {
    window.location.replace('/login?next=/staff');
    return;
  }
  if (me.user.role === 'customer') {
    main.replaceChildren(
      el('section', { class: 'band wrap stack' }, [
        el('h1', {}, 'Staff console'),
        el('p', {}, 'You do not have access to this page.'),
      ]),
    );
    return;
  }

  const tabs = TABS_BY_ROLE[me.user.role] ?? [];
  const tablist = el('div', { class: 'tablist', role: 'tablist', 'aria-label': 'Staff console' });
  const panels = new Map<TabName, HTMLElement>();
  const loaders: Record<TabName, (host: HTMLElement) => Promise<void>> = {
    'Trade-ins': tradeInsPanel,
    'Demo days': demoDaysPanel,
    Orders: ordersPanel,
    Outbox: outboxPanel,
  };

  const buttons = new Map<TabName, HTMLButtonElement>();
  const loaded = new Set<TabName>();

  const select = async (name: TabName): Promise<void> => {
    for (const [tab, node] of panels) node.hidden = tab !== name;
    for (const [tab, node] of buttons) {
      node.setAttribute('aria-selected', String(tab === name));
      node.tabIndex = tab === name ? 0 : -1;
    }
    const host = panels.get(name);
    if (host && !loaded.has(name)) {
      loaded.add(name);
      await loaders[name](host);
    }
  };

  for (const name of tabs) {
    const panelId = uniqueId('panel');
    const tabId = uniqueId('tab');
    const node = el('button', { type: 'button', role: 'tab', id: tabId, 'aria-controls': panelId, 'aria-selected': 'false' }, name);
    const panel = el('div', { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, hidden: true, class: 'stack' });
    node.addEventListener('click', () => void select(name));
    buttons.set(name, node);
    panels.set(name, panel);
    tablist.appendChild(node);
  }

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Staff console'),
      el('p', { class: 'caption' }, `${me.user.email} — ${me.user.role}`),
      tablist,
      ...panels.values(),
    ]),
  );

  const first = tabs[0];
  if (first) await select(first);
}
