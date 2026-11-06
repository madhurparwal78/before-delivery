import { api, announceStatus, dollars, el, provinceName, type OrderView, type User } from '../api.js';

interface ServicesStatus {
  killbill: 'up' | 'down';
  postgres: 'up' | 'down';
  pocketbase: 'up' | 'down';
  minio: 'up' | 'down';
  mailpit: 'up' | 'down';
}

const OUTAGE_COPY: Record<keyof ServicesStatus, string> = {
  killbill: 'Billing is unreachable. Refunds and subscription changes are paused; packing continues.',
  minio: 'File storage is unreachable. Packing slips and invoices can\u2019t be opened until it returns.',
  postgres: 'The orders database is unreachable. The queue can\u2019t load until it returns.',
  pocketbase: 'Accounts are unreachable. Staff already signed in can keep working.',
  mailpit: 'Email is delayed. Messages are queued and will send when it returns.',
};

let services: ServicesStatus | null = null;
let officeUser: User | null = null;

const NAV_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  fulfilment: [
    { href: '/office/queue', label: 'Queue' },
    { href: '/office/stock', label: 'Stock' },
    { href: '/office/search', label: 'Search' },
  ],
  support: [
    { href: '/office/queue', label: 'Queue' },
    { href: '/office/stock', label: 'Stock' },
    { href: '/office/search', label: 'Search' },
  ],
  owner: [
    { href: '/office/queue', label: 'Queue' },
    { href: '/office/stock', label: 'Stock' },
    { href: '/office/search', label: 'Search' },
    { href: '/office/dashboard', label: 'Dashboard' },
    { href: '/office/settings', label: 'Settings' },
    { href: '/office/applications', label: 'Applications' },
    { href: '/office/reviews', label: 'Reviews' },
  ],
};

async function loadStatus(): Promise<ServicesStatus | null> {
  try {
    const data = await api<{ services: ServicesStatus }>('/api/staff/status');
    services = data.services;
    return data.services;
  } catch {
    return null;
  }
}

function outageBanners(): HTMLElement {
  const wrap = el('div', { 'data-outage-banners': 'true' });
  if (!services) return wrap;
  for (const key of Object.keys(OUTAGE_COPY) as (keyof ServicesStatus)[]) {
    if (services[key] === 'down') {
      wrap.append(el('p', { class: 'alert-banner', role: 'alert', text: OUTAGE_COPY[key] }));
    }
  }
  return wrap;
}

export async function renderOffice(app: HTMLElement): Promise<void> {
  let me: User | null = null;
  let storeDown = false;
  try {
    me = (await api<{ user: User }>('/api/me')).user;
  } catch (e) {
    const err = e as { status?: number; body?: { error?: string } };
    if (err.body?.error === 'store_unavailable') {
      storeDown = true;
    }
  }
  await loadStatus();
  const who = document.querySelector('[data-office-who]') as HTMLElement;
  const nav = document.querySelector('[data-office-nav]') as HTMLElement;
  if (storeDown) {
    who.textContent = '';
    nav.textContent = '';
    app.append(el('main', { class: 'office-main' },
      outageBanners(),
      el('h1', { text: 'Back office' }),
      el('p', { text: 'The orders database is unreachable. Sign back in when it returns.' })));
    return;
  }
  if (!me || !['fulfilment', 'support', 'owner'].includes(me.role)) {
    document.getElementById('app')!.textContent = '';
    const { renderNotFound } = await import('../app.js');
    if (!me) {
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    const main = el('main', { class: 'page narrow' },
      el('h1', { text: "You don't have access to the back office." }));
    document.getElementById('app')!.append(main);
    void renderNotFound;
    return;
  }
  officeUser = me;
  who.textContent = `${me.name} - ${me.role}`;
  nav.textContent = '';
  for (const item of NAV_BY_ROLE[me.role] ?? []) {
    nav.append(el('a', { href: item.href, text: item.label }));
  }
  const shell = el('div', { class: 'office-shell' });
  const main = el('main', { class: 'office-main' });
  main.append(outageBanners());
  const path = window.location.pathname;
  shell.append(main);
  app.append(shell);
  if (path === '/office' || path === '/office/queue') await renderQueue(main);
  else if (path === '/office/stock') await renderStock(main);
  else if (path === '/office/search') renderSearch(main);
  else if (path.startsWith('/office/orders/')) await renderOrderDetail(main, path.split('/')[3] ?? '');
  else if (path === '/office/dashboard') await renderDashboard(main);
  else if (path === '/office/settings') await renderSettings(main);
  else if (path === '/office/applications') await renderApplications(main);
  else if (path === '/office/reviews') await renderReviews(main);
  else {
    main.append(el('h1', { text: "We couldn't find that page." }));
  }
  const signOut = el('button', { class: 'btn btn-ghost', text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await api('/api/auth/sign-out', { method: 'POST' });
    window.history.pushState({}, '', '/');
    const { renderRoute } = await import('../app.js');
    await renderRoute();
  });
  nav.append(signOut);
}

async function renderQueue(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Paid orders' }));
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'queue-status' });
  let orders: OrderView[] = [];
  try {
    orders = (await api<{ orders: OrderView[] }>('/api/staff/queue')).orders;
  } catch {
    orders = [];
  }
  const cards = el('div', { class: 'order-cards', 'data-queue-cards': 'true' });
  const table = el('table', { 'aria-label': 'Paid orders', 'data-queue-table': 'true' });
  const thead = el('thead', {}, el('tr', {},
    el('th', { text: 'Order' }), el('th', { text: 'Placed' }), el('th', { text: 'Province' }), el('th', { text: 'Cans' }), el('th', { text: 'Status' }), el('th', { text: 'Actions' })));
  const tbody = el('tbody');
  table.append(thead, tbody);
  const actions = (order: OrderView): HTMLElement => {
    const wrap = el('span', { class: 'actions' });
    const canFulfil = officeUser?.role === 'fulfilment' || officeUser?.role === 'owner';
    const transitions: [string, string][] = [['picking', 'Start picking'], ['packed', 'Mark packed'], ['shipped', 'Mark shipped']];
    if (canFulfil) {
      for (const [to, label] of transitions) {
        const btn = el('button', { class: 'btn btn-secondary', text: label });
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/staff/orders/${order.number}/transitions`, { json: { to } });
            announceStatus(status, `Order ${order.number} marked ${to}.`);
            const { renderRoute } = await import('../app.js');
            await renderRoute();
          } catch (e) {
            const err = e as { body?: { message?: string } };
            announceStatus(status, err.body?.message ?? `Order ${order.number} can't move to ${to} from here.`);
          }
        });
        wrap.append(btn);
      }
    }
    const slip = el('a', { class: 'btn btn-ghost', href: `/api/staff/orders/${order.number}/packing-slip.pdf`, text: `Packing slip for ${order.number}` });
    slip.target = '_blank';
    wrap.append(slip);
    return wrap;
  };
  for (const order of orders) {
    const cans = order.lines.reduce((s, l) => s + l.quantity, 0);
    const card = el('article', { 'aria-label': `Order ${order.number}`, class: 'order-card' },
      el('h2', { text: `Order ${order.number}` }),
      el('p', { class: 'muted mono', text: `${new Date(order.placed_at).toLocaleString()} - ${provinceName(order.province)} - ${cans} cans - ${order.status}` }),
      actions(order)
    );
    cards.append(card);
    tbody.append(el('tr', {},
      el('td', {}, el('a', { href: `/office/orders/${order.number}`, text: order.number })),
      el('td', { class: 'num', text: new Date(order.placed_at).toLocaleDateString() }),
      el('td', { text: provinceName(order.province) }),
      el('td', { class: 'num', text: String(cans) }),
      el('td', { text: order.status }),
      el('td', {}, actions(order))
    ));
  }
  main.append(status, cards, table);
  const refresh = setInterval(async () => {
    if (!document.body.contains(main)) {
      clearInterval(refresh);
      return;
    }
    try {
      const fresh = (await api<{ orders: OrderView[] }>('/api/staff/queue')).orders;
      const currentIds = orders.map((o) => o.number).join(',');
      const freshIds = fresh.map((o) => o.number).join(',');
      if (freshIds !== currentIds) {
        const { renderRoute } = await import('../app.js');
        await renderRoute();
      }
    } catch {
      // keep the page as is
    }
  }, 10000);
}

async function renderStock(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Stock' }));
  const table = el('table', { 'aria-label': 'Stock' });
  const thead = el('thead', {}, el('tr', {},
    ['Flavour', 'Received', 'Sold', 'Returned', 'On hand', 'Reserved', 'Available', 'Released'].map((label) => el('th', { text: label }))));
  const tbody = el('tbody');
  table.append(thead, tbody);
  try {
    const data = await api<{ flavours: { flavour: string; received: number; sold: number; returned: number; on_hand: number; reserved: number; available: number; released: number | null }[] }>('/api/staff/stock');
    for (const row of data.flavours) {
      tbody.append(el('tr', {},
        el('td', { text: row.flavour }),
        el('td', { class: 'num', text: String(row.received) }),
        el('td', { class: 'num', text: String(row.sold) }),
        el('td', { class: 'num', text: String(row.returned) }),
        el('td', { class: 'num', text: String(row.on_hand) }),
        el('td', { class: 'num', text: String(row.reserved) }),
        el('td', { class: 'num', text: String(row.available) }),
        el('td', { class: 'num', text: row.released === null ? '-' : String(row.released) })
      ));
    }
  } catch {
    tbody.append(el('tr', {}, el('td', { text: 'Stock is unavailable right now.' })));
  }
  main.append(table);
}

function renderSearch(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Find an order or subscription' }));
  const input = el('input', { type: 'search', 'aria-label': 'Find an order or subscription', class: 'field-row' });
  const results = el('div', { 'data-search-results': 'true' });
  const run = async (): Promise<void> => {
    const q = input.value.trim();
    if (!q) return;
    results.textContent = '';
    try {
      const data = await api<{ orders: OrderView[]; subscriptions: { id: string; plan_label: string; state: string }[] }>(
        `/api/staff/search?q=${encodeURIComponent(q)}`
      );
      results.append(el('h2', { text: 'Orders' }));
      for (const order of data.orders) {
        results.append(el('p', {}, el('a', { href: `/office/orders/${order.number}`, text: order.number }), ` - ${provinceName(order.province)} - ${dollars(order.total_cents)}`));
      }
      if (data.orders.length === 0) results.append(el('p', { text: 'No orders found.' }));
      results.append(el('h2', { text: 'Subscriptions' }));
      for (const sub of data.subscriptions) {
        results.append(el('p', { text: `${sub.plan_label} - ${sub.state}` }));
      }
      if (data.subscriptions.length === 0) results.append(el('p', { text: 'No subscriptions found.' }));
    } catch {
      results.append(el('p', { text: 'Search is unavailable right now.' }));
    }
  };
  input.addEventListener('change', () => void run());
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void run();
  });
  main.append(input, results);
  return Promise.resolve();
}

async function renderOrderDetail(main: HTMLElement, number: string): Promise<void> {
  main.append(el('h1', { text: `Order ${number}` }));
  let order: OrderView | null = null;
  let customer = { name: '', email: '' };
  try {
    const data = await api<{ order: OrderView; customer: { name: string; email: string } }>(`/api/staff/orders/${number}`);
    order = data.order;
    customer = data.customer;
  } catch {
    main.append(el('p', { text: "We couldn't find that order." }));
    return;
  }
  main.append(el('p', { text: `${customer.name} - ${customer.email}` }));
  main.append(el('p', { text: `${order.status} - ${provinceName(order.province)} - total ${dollars(order.total_cents)}` }));
  const lines = el('ul', { class: 'list-plain' });
  for (const line of order.lines) {
    lines.append(el('li', { text: `${line.quantity} x ${line.flavour}` }));
  }
  main.append(lines);
  main.append(el('h2', { text: 'Ship to' }));
  main.append(el('p', { text: `${order.ship_to.name}, ${order.ship_to.line1}${order.ship_to.line2 ? ', ' + order.ship_to.line2 : ''}, ${order.ship_to.city} ${order.ship_to.province} ${order.ship_to.postal_code}` }));
  main.append(el('h2', { text: 'Refunds' }));
  const refundsList = el('ul', { class: 'list-plain' });
  for (const refund of order.refunds) {
    refundsList.append(el('li', { text: `${dollars(refund.amount_cents)} - ${refund.status} - ${refund.reason}` }));
  }
  if (order.refunds.length === 0) refundsList.append(el('li', { text: 'No refunds.' }));
  main.append(refundsList);
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'refund-status' });
  main.append(status);
  const canRefund = officeUser?.role === 'support' || officeUser?.role === 'owner';
  if (canRefund) {
    const refundBtn = el('button', { class: 'btn btn-primary', text: 'Refund' });
    refundBtn.addEventListener('click', () => {
      openRefundDialog(main, number, order!, status);
    });
    const receipt = el('button', { class: 'btn btn-ghost', text: 'Resend receipt' });
    receipt.addEventListener('click', async () => {
      try {
        await api(`/api/staff/orders/${number}/resend-receipt`, { method: 'POST' });
        announceStatus(status, 'Receipt sent again.');
      } catch (e) {
        const err = e as { body?: { message?: string } };
        announceStatus(status, err.body?.message ?? 'Receipts are delayed right now.');
      }
    });
    const slip = el('a', { class: 'btn btn-secondary', href: `/api/staff/orders/${number}/packing-slip.pdf`, text: 'Packing slip (PDF)' });
    slip.target = '_blank';
    main.append(el('div', { class: 'checkout-actions' }, refundBtn, receipt, slip));
  }
}

function openRefundDialog(main: HTMLElement, number: string, order: OrderView, status: HTMLElement): void {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-label': `Refund order ${number}` });
  const title = el('h2', { text: `Refund order ${number}`, tabindex: '-1' });
  const amount = el('input', { 'aria-label': 'Amount', placeholder: '0.00' });
  const reason = el('input', { 'aria-label': 'Reason' });
  const fieldError = el('p', { class: 'field-error', 'data-refund-field-error': 'true' });
  const everything = el('button', { class: 'btn btn-ghost', text: 'Refund everything left' });
  const issue = el('button', { class: 'btn btn-primary', text: 'Issue refund' });
  const close = el('button', { class: 'btn btn-ghost', text: 'Close' });
  everything.addEventListener('click', () => {
    amount.value = (order.refundable_cents / 100).toFixed(2);
  });
  const closeDialog = (): void => {
    backdrop.remove();
    (document.querySelector('[data-refund-open]') as HTMLElement | null)?.focus();
  };
  issue.addEventListener('click', async () => {
    const value = Math.round(Number(amount.value) * 100);
    if (!Number.isFinite(value) || value < 1) {
      fieldError.textContent = 'Enter an amount to refund.';
      return;
    }
    try {
      const res = await fetch(`/api/staff/orders/${number}/refunds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `refund-${number}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ amount_cents: value, reason: reason.value.trim() || 'Customer request' }),
      });
      const body = (await res.json()) as { error?: string; message?: string; fields?: Record<string, string> };
      if (!res.ok) {
        if (body.fields?.amount_cents) {
          fieldError.textContent = body.fields.amount_cents;
        } else if (body.error === 'billing_unavailable') {
          fieldError.textContent = 'Billing is unreachable. No refund was made.';
        } else {
          fieldError.textContent = body.message ?? 'Refund failed.';
        }
        return;
      }
      closeDialog();
      announceStatus(status, `Refund of ${(value / 100).toFixed(2)} sent to billing. Waiting for confirmation.`);
    } catch {
      fieldError.textContent = 'Billing is unreachable. No refund was made.';
    }
  });
  close.addEventListener('click', closeDialog);
  dialog.append(
    title,
    el('div', { class: 'field-row' }, el('label', { text: 'Amount (dollars)' }), amount),
    el('div', { class: 'field-row' }, el('label', { text: 'Reason' }), reason),
    fieldError,
    el('div', { class: 'checkout-actions' }, everything, issue, close)
  );
  backdrop.append(dialog);
  document.body.append(backdrop);
  const focusables = (): HTMLElement[] =>
    [...dialog.querySelectorAll<HTMLElement>('button, input')].filter((n) => !n.hasAttribute('disabled'));
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      closeDialog();
    } else if (e.key === 'Tab') {
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  refundBtnMarker(main, number);
  title.focus();
}

function refundBtnMarker(_main: HTMLElement, _number: string): void {
  // marker so closeDialog can restore focus to the Refund button
  const btn = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Refund');
  if (btn) btn.setAttribute('data-refund-open', 'true');
}

async function renderDashboard(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Owner dashboard' }));
  try {
    const data = await api<{
      dunning: { entered: number; recovered: number; cancelled: number; in_progress: number };
      refunds: { count: number; total_cents: number };
      services: ServicesStatus;
    }>('/api/owner/dashboard');
    services = data.services;
    main.append(el('section', { 'aria-label': 'Dunning recovery', class: 'office-card' },
      el('h2', { text: 'Dunning recovery (last 30 days)' }),
      el('p', { class: 'office-num', text: `Entered ${data.dunning.entered} - Recovered ${data.dunning.recovered} - Cancelled ${data.dunning.cancelled} - In progress ${data.dunning.in_progress}` })
    ));
    main.append(el('section', { 'aria-label': 'Refunds', class: 'office-card' },
      el('h2', { text: 'Refunds (last 30 days)' }),
      el('p', { class: 'office-num', text: `${data.refunds.count} refunds - ${dollars(data.refunds.total_cents)}` })
    ));
    const list = el('ul', { 'aria-label': 'Services', class: 'services-list office-card' });
    const names: [keyof ServicesStatus, string][] = [
      ['killbill', 'Kill Bill'],
      ['postgres', 'Postgres'],
      ['pocketbase', 'PocketBase'],
      ['minio', 'MinIO'],
      ['mailpit', 'Mailpit'],
    ];
    for (const [key, name] of names) {
      list.append(el('li', { class: data.services[key] === 'up' ? 'service-up' : 'service-down', text: `${name}: ${data.services[key] === 'up' ? 'Up' : 'Down'}` }));
    }
    main.append(el('section', { 'aria-label': 'Services', class: 'office-card' }, el('h2', { text: 'Services' }), list));
  } catch {
    main.append(el('p', { text: 'The dashboard is unavailable right now.' }));
  }
  const poll = setInterval(async () => {
    if (!document.body.contains(main)) {
      clearInterval(poll);
      return;
    }
    const fresh = await loadStatus();
    if (fresh) {
      const banners = document.querySelector('[data-outage-banners]') as HTMLElement | null;
      if (banners) {
        banners.replaceWith(outageBanners());
      }
    }
  }, 10000);
}

async function renderSettings(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Settings' }));
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'settings-status' });
  let data: {
    provinces: { code: string; name: string; shipping_cents: number; free_shipping_threshold_cents: number }[];
    drop: { flavour: string; can_price_cents: number; released: number | null };
  } | null = null;
  try {
    data = await api<typeof data>('/api/owner/settings');
  } catch {
    main.append(el('p', { text: 'Settings are unavailable right now.' }));
    return;
  }
  const inputs: Record<string, HTMLInputElement> = {};
  const fields = el('div', {});
  for (const province of data.provinces) {
    const shipping = el('input', { value: (province.shipping_cents / 100).toFixed(2), 'aria-label': `${province.name} shipping` });
    const threshold = el('input', { value: (province.free_shipping_threshold_cents / 100).toFixed(2), 'aria-label': `${province.name} free-shipping threshold` });
    inputs[`${province.code}-shipping`] = shipping;
    inputs[`${province.code}-threshold`] = threshold;
    fields.append(
      el('div', { class: 'field-row' }, el('label', { text: `${province.name} shipping (dollars)` }), shipping),
      el('div', { class: 'field-row' }, el('label', { text: `${province.name} free-shipping threshold (dollars)` }), threshold)
    );
  }
  const price = el('input', { value: (data.drop.can_price_cents / 100).toFixed(2), 'aria-label': 'Cacao Orange price' });
  const released = el('input', { type: 'number', value: String(data.drop.released ?? 0), 'aria-label': 'Cacao Orange released', class: 'spinbutton' });
  fields.append(
    el('div', { class: 'field-row' }, el('label', { text: 'Cacao Orange price (dollars)' }), price),
    el('div', { class: 'field-row' }, el('label', { text: 'Cacao Orange released (cans)' }), released)
  );
  const save = el('button', { class: 'btn btn-primary', text: 'Save settings' });
  save.addEventListener('click', async () => {
    let ok = true;
    for (const province of data!.provinces) {
      try {
        await api(`/api/owner/provinces/${province.code}`, {
          method: 'PUT',
          json: {
            shipping_cents: Math.round(Number(inputs[`${province.code}-shipping`].value) * 100),
            free_shipping_threshold_cents: Math.round(Number(inputs[`${province.code}-threshold`].value) * 100),
          },
        });
      } catch {
        ok = false;
      }
    }
    try {
      await api('/api/owner/drop', {
        method: 'PUT',
        json: {
          can_price_cents: Math.round(Number(price.value) * 100),
          released: Number(released.value),
        },
      });
    } catch (e) {
      const err = e as { body?: { message?: string; error?: string } };
      if (err.body?.error === 'below_committed') {
        announceStatus(status, err.body.message ?? "The release can't go below committed cans.");
      } else {
        ok = false;
      }
    }
    if (ok) announceStatus(status, 'Settings saved.');
    else announceStatus(status, 'Some settings could not be saved.');
  });
  main.append(fields, save, status);
}

async function renderApplications(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Retailer applications' }));
  try {
    const data = await api<{
      applications: { id: string; business_name: string; contact_name: string; email: string; province: string; status: string; submitted_at: string }[];
    }>('/api/owner/applications');
    for (const application of data.applications) {
      const card = el('div', { class: 'office-card' },
        el('h2', { text: application.business_name }),
        el('p', { text: `${application.contact_name} - ${application.email} - ${application.province} - ${application.status}` })
      );
      const actions = el('div', { class: 'checkout-actions' });
      if (application.status === 'submitted') {
        const approve = el('button', { class: 'btn btn-primary', text: 'Approve' });
        const decline = el('button', { class: 'btn btn-ghost', text: 'Decline' });
        const decide = async (decision: 'approved' | 'declined'): Promise<void> => {
          try {
            await api(`/api/owner/applications/${application.id}/decision`, { json: { decision } });
            const { renderRoute } = await import('../app.js');
            await renderRoute();
          } catch (e) {
            const err = e as { body?: { message?: string } };
            card.append(el('p', { text: err.body?.message ?? 'The decision could not be saved.' }));
          }
        };
        approve.addEventListener('click', () => void decide('approved'));
        decline.addEventListener('click', () => void decide('declined'));
        actions.append(approve, decline);
      }
      const licence = el('a', { class: 'btn btn-secondary', href: `/api/owner/applications/${application.id}/licence`, text: 'View licence' });
      licence.target = '_blank';
      actions.append(licence);
      card.append(actions);
      main.append(card);
    }
    if (data.applications.length === 0) main.append(el('p', { text: 'No applications yet.' }));
  } catch {
    main.append(el('p', { text: 'Applications are unavailable right now.' }));
  }
}

async function renderReviews(main: HTMLElement): Promise<void> {
  main.append(el('h1', { text: 'Reviews waiting for a decision' }));
  try {
    const data = await api<{ reviews: { id: string; flavour: string; rating: number; body: string; author_first_name: string }[] }>('/api/owner/reviews?status=pending');
    for (const review of data.reviews) {
      const card = el('div', { class: 'office-card' },
        el('h2', { text: `${review.flavour} - ${'★'.repeat(review.rating)} by ${review.author_first_name}` }),
        el('p', { text: review.body }));
      const approve = el('button', { class: 'btn btn-primary', text: 'Approve review' });
      const reject = el('button', { class: 'btn btn-ghost', text: 'Reject review' });
      const decide = async (decision: 'approved' | 'rejected'): Promise<void> => {
        try {
          await api(`/api/owner/reviews/${review.id}/decision`, { json: { decision } });
          const { renderRoute } = await import('../app.js');
          await renderRoute();
        } catch (e) {
          const err = e as { body?: { message?: string } };
          card.append(el('p', { text: err.body?.message ?? 'The decision could not be saved.' }));
        }
      };
      approve.addEventListener('click', () => void decide('approved'));
      reject.addEventListener('click', () => void decide('rejected'));
      card.append(el('div', { class: 'checkout-actions' }, approve, reject));
      main.append(card);
    }
    if (data.reviews.length === 0) main.append(el('p', { text: 'No reviews waiting.' }));
  } catch {
    main.append(el('p', { text: 'Reviews are unavailable right now.' }));
  }
}
