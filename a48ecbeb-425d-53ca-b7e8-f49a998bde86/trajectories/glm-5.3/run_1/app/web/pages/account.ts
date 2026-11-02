import { api, announceStatus, dollars, el, provinceName, type Address, type OrderView, type SubscriptionView, type User } from '../api.js';

export async function renderAccount(): Promise<void> {
  let me: User | null = null;
  try {
    me = (await api<{ user: User }>('/api/me')).user;
  } catch (e) {
    const err = e as { status?: number; body?: { error?: string } };
    if (err.body?.error === 'store_unavailable') {
      const main = el('main', { class: 'page narrow' },
        el('h1', { text: 'Your account' }),
        el('p', { class: 'alert-banner', text: "The shop can't update right now. Try again in a moment." }));
      document.getElementById('app')!.append(main);
      return;
    }
    window.location.href = `/sign-in?next=${encodeURIComponent('/account')}`;
    return;
  }
  if (!me) return;
  const main = el('main', { class: 'page' });
  main.append(el('h1', { text: 'Your account' }));
  main.append(el('p', { text: `${me.name} - ${me.email}` }));
  main.append(el('h2', { text: 'Orders' }));
  const ordersList = el('ul', { class: 'list-plain' });
  let orders: OrderView[] = [];
  try {
    orders = (await api<{ orders: OrderView[] }>('/api/orders')).orders;
  } catch {
    orders = [];
  }
  if (orders.length === 0) ordersList.append(el('li', { text: 'No orders yet. Build your first crate.' }));
  for (const order of orders) {
    const invoice = el('a', { href: order.invoice_url, text: 'Invoice (PDF)' });
    invoice.setAttribute('download', `${order.number}.pdf`);
    ordersList.append(el('li', {},
      el('a', { href: `/orders/${order.number}/thanks`, text: `Order ${order.number}` }),
      el('span', { class: 'mono', text: ` ${dollars(order.total_cents)} ` }),
      el('span', { class: 'muted', text: order.status }),
      ' ', invoice
    ));
  }
  main.append(ordersList);
  main.append(el('h2', { text: 'Subscriptions' }));
  const subsList = el('ul', { class: 'list-plain' });
  let subs: SubscriptionView[] = [];
  try {
    subs = (await api<{ subscriptions: SubscriptionView[] }>('/api/subscriptions')).subscriptions;
  } catch (e) {
    const err = e as { body?: { error?: string } };
    if (err.body?.error === 'billing_unavailable') {
      main.append(el('p', { class: 'alert-banner', text: 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.' }));
    }
  }
  if (subs.length === 0) subsList.append(el('li', { text: 'No subscriptions yet.' }));
  for (const sub of subs) {
    subsList.append(el('li', {},
      el('a', { href: `/account/subscriptions/${sub.id}`, text: sub.plan_label }),
      el('span', { class: 'muted', text: ` - ${stateLabel(sub)}` })
    ));
  }
  main.append(subsList);
  main.append(el('h2', { text: 'Saved addresses' }));
  const addrList = el('ul', { class: 'list-plain' });
  let addresses: Address[] = [];
  try {
    addresses = (await api<{ addresses: Address[] }>('/api/addresses')).addresses;
  } catch {
    addresses = [];
  }
  for (const address of addresses) {
    addrList.append(el('li', { text: `${address.name}, ${address.line1}${address.line2 ? ', ' + address.line2 : ''}, ${address.city} ${address.province} ${address.postal_code}${address.is_default ? ' (default)' : ''}` }));
  }
  main.append(addrList);
  const signOut = el('button', { class: 'btn btn-ghost', text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await api('/api/auth/sign-out', { method: 'POST' });
    window.history.pushState({}, '', '/');
    const { renderRoute } = await import('../app.js');
    await renderRoute();
  });
  main.append(el('p', {}, signOut));
  document.getElementById('app')!.append(main);
}

function stateLabel(sub: SubscriptionView): string {
  switch (sub.state) {
    case 'active': return 'Active';
    case 'paused': return sub.pause ? `Paused until ${sub.pause.resumes_on}` : 'Paused';
    case 'past_due': return 'Payment overdue';
    case 'cancel_pending': return `Ends on ${sub.billing_end_date}`;
    case 'cancelled': return 'Cancelled';
  }
}

export async function renderSubscriptionPath(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean); // account, subscriptions, id, [page]
  const id = parts[2] ?? '';
  const page = parts[3];
  if (!page) {
    await renderSubscriptionPage(id);
  } else if (page === 'pause') {
    await renderPausePage(id);
  } else if (page === 'swap') {
    await renderSwapPage(id);
  } else if (page === 'cancel') {
    await renderCancelPage(id);
  } else if (page === 'card') {
    await renderCardPage(id);
  } else {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
  }
}

async function loadSub(id: string): Promise<SubscriptionView | null> {
  try {
    const data = await api<{ subscription: SubscriptionView }>(`/api/subscriptions/${id}`);
    return data.subscription;
  } catch (e) {
    const err = e as { status?: number; body?: { error?: string } };
    if (err.body?.error === 'billing_unavailable') {
      const main = el('main', { class: 'page narrow' },
        el('h1', { text: 'Your auto-delivery' }),
        el('p', { class: 'alert-banner', role: 'alert', text: 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.' }));
      document.getElementById('app')!.append(main);
      return null;
    }
    return null;
  }
}

function dunningBanner(sub: SubscriptionView): HTMLElement | null {
  if (!sub.dunning) return null;
  const step = sub.dunning.step;
  if (step === 'day0' || step.startsWith('retry')) {
    return el('p', { class: 'alert-banner', role: 'alert', text: "Your renewal payment didn't go through. Update your card to keep your boxes coming." });
  }
  const cancels = new Date(sub.dunning.cancels_at);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return el('p', { class: 'alert-banner', role: 'alert', text: `Your deliveries are on hold because we couldn't take payment. Update your card before ${fmt.format(cancels).replace(',', ' at')} to restart them.` });
}

function stateText(sub: SubscriptionView): string {
  switch (sub.state) {
    case 'active':
      if (sub.pause) return `Pause scheduled from ${sub.pause.from}, resumes ${sub.pause.resumes_on}`;
      if (sub.skip) return 'Next box skipped';
      return 'Active';
    case 'paused':
      return sub.pause ? `Paused until ${sub.pause.resumes_on}` : 'Paused';
    case 'past_due':
      return 'Payment overdue';
    case 'cancel_pending':
      return `Ends on ${sub.billing_end_date}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

function cutoffNote(sub: SubscriptionView): string {
  return `Changes made now apply to the box after next, on ${sub.changes_apply_to}.`;
}

function changeBadge(change: { status: string } | null): HTMLElement {
  if (!change) return el('span', { class: 'change-badge', hidden: true });
  const label = change.status === 'pending_provider' ? 'Pending confirmation' : change.status === 'applied' ? 'Applied' : 'Rejected';
  return el('span', { class: `change-badge ${change.status}`, text: label });
}

async function renderSubscriptionPage(id: string): Promise<void> {
  const sub = await loadSub(id);
  if (!sub) {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Your auto-delivery' }));
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'subscription-status' });
  const stateP = el('p', { class: 'state-text', 'data-state-text': 'true', text: stateText(sub) });
  main.append(stateP, status);
  if (sub.state === 'cancelled' && sub.dunning) {
    main.append(el('p', { text: 'This subscription ended because payment couldn\u2019t be taken.' }));
  }
  const banner = dunningBanner(sub);
  if (banner) main.append(banner);
  main.append(el('p', { text: `${sub.plan_label} - delivered ${sub.cadence === 'monthly' ? 'every month' : 'every two months'}` }));
  main.append(el('p', { text: `Next renewal: ${sub.next_renewal_date}` }));
  main.append(el('p', { class: 'muted', text: cutoffNote(sub) }));
  main.append(el('p', { text: `Card: ${sub.card.brand} ending ${sub.card.last4}` }));
  const latest = sub.pending_change ?? sub.last_change;
  const badgeRow = el('p', { 'data-change-badge-row': 'true' }, changeBadge(latest));
  if (sub.pending_change) {
    announceStatus(status, 'Saved. Waiting for billing to confirm.');
  } else if (sub.last_change && sub.last_change.status === 'applied') {
    announceStatus(status, 'Billing confirmed your change.');
  } else if (sub.last_change && sub.last_change.status === 'rejected') {
    announceStatus(status, "Billing didn't accept this change. Nothing was changed.");
  }
  main.append(badgeRow);
  const actions = el('div', { class: 'checkout-actions', 'data-sub-actions': 'true' });
  const disable = sub.pending_change !== null;
  const pause = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}/pause`, text: 'Pause deliveries' });
  const resume = el('button', { class: 'btn btn-secondary', text: 'Resume deliveries' });
  const skip = el('button', { class: 'btn btn-ghost', text: 'Skip next box' });
  const swap = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}/swap`, text: 'Swap flavours' });
  const cancel = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}/cancel`, text: 'Cancel subscription' });
  const card = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}/card`, text: 'Update card' });
  const refresh = async (): Promise<void> => {
    const fresh = await loadSub(id);
    if (!fresh) return;
    const stateTextEl = main.querySelector('[data-state-text]') as HTMLElement;
    stateTextEl.textContent = stateText(fresh);
    const bannerEl = main.querySelector('.alert-banner');
    const newBanner = dunningBanner(fresh);
    if (newBanner && !bannerEl) main.insertBefore(newBanner, stateTextEl.nextSibling);
    if (!newBanner && bannerEl) bannerEl.remove();
    const badgeRowEl = main.querySelector('[data-change-badge-row]') as HTMLElement;
    badgeRowEl.textContent = '';
    badgeRowEl.append(changeBadge(fresh.pending_change ?? fresh.last_change));
    if (fresh.pending_change) {
      announceStatus(status, 'Saved. Waiting for billing to confirm.');
    } else if (fresh.last_change && fresh.last_change.status === 'applied') {
      announceStatus(status, 'Billing confirmed your change.');
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    }
    const actionsEl = main.querySelector('[data-sub-actions]') as HTMLElement;
    for (const btn of actionsEl.querySelectorAll('button')) btn.disabled = false;
  };
  resume.addEventListener('click', async () => {
    try {
      await api(`/api/subscriptions/${sub.id}/changes`, { json: { kind: 'resume' } });
      announceStatus(status, 'Saved. Waiting for billing to confirm.');
      for (const btn of actions.querySelectorAll('button')) btn.disabled = true;
      setTimeout(() => void refresh(), 2000);
    } catch (e) {
      const err = e as { body?: { error?: string; message?: string } };
      announceStatus(status, err.body?.message ?? "That change isn't possible right now.");
    }
  });
  skip.addEventListener('click', async () => {
    try {
      await api(`/api/subscriptions/${sub.id}/changes`, { json: { kind: 'skip' } });
      announceStatus(status, 'Saved. Waiting for billing to confirm.');
      for (const btn of actions.querySelectorAll('button')) btn.disabled = true;
      setTimeout(() => void refresh(), 2000);
    } catch (e) {
      const err = e as { body?: { error?: string; message?: string } };
      announceStatus(status, err.body?.message ?? "That change isn't possible right now.");
    }
  });
  if (disable) {
    for (const btn of actions.querySelectorAll('button')) btn.disabled = true;
  }
  const showResume = sub.pause !== null || sub.state === 'paused';
  const showPausePause = sub.state === 'active' && !sub.pause;
  const actionsRow = el('div', { class: 'checkout-actions' });
  if (showPausePause) actionsRow.append(pause);
  if (showResume) actionsRow.append(resume);
  actionsRow.append(skip, swap, cancel, card);
  actions.append(actionsRow);
  main.append(actions);
  if (sub.pending_change) {
    const interval = setInterval(() => {
      if (!document.body.contains(main)) {
        clearInterval(interval);
        return;
      }
      void refresh();
    }, 2000);
  }
  document.getElementById('app')!.append(main);
}

async function renderPausePage(id: string): Promise<void> {
  const sub = await loadSub(id);
  if (!sub) {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Pause deliveries' }));
  main.append(el('p', { class: 'muted', text: cutoffNote(sub) }));
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Pause for' });
  for (const n of [1, 2, 3]) {
    group.append(el('label', {}, el('input', { type: 'radio', name: 'cycles', value: String(n), ...(n === 1 ? { checked: true } : {}) }), ` ${n} box${n > 1 ? 'es' : ''}`));
  }
  const save = el('button', { class: 'btn btn-primary', text: 'Save pause' });
  const back = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}`, text: 'Back' });
  save.addEventListener('click', async () => {
    const checked = group.querySelector('input:checked') as HTMLInputElement | null;
    const cycles = Number(checked?.value ?? 1);
    try {
      await api(`/api/subscriptions/${sub.id}/changes`, { json: { kind: 'pause', cycles } });
      window.history.pushState({}, '', `/account/subscriptions/${sub.id}`);
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    } catch (e) {
      const err = e as { body?: { error?: string; message?: string } };
      const mainEl = document.querySelector('main') as HTMLElement;
      announceStatus(mainEl.appendChild(el('p', { role: 'status', 'aria-live': 'polite' })), err.body?.message ?? "That change isn't possible right now.");
    }
  });
  main.append(group, el('div', { class: 'checkout-actions' }, back, save));
  document.getElementById('app')!.append(main);
}

async function renderSwapPage(id: string): Promise<void> {
  const sub = await loadSub(id);
  if (!sub) {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Swap flavours' }));
  main.append(el('p', { class: 'muted', text: cutoffNote(sub) }));
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Choose your box' });
  const plans: { id: string; label: string; cadence: string }[] = [
    { id: 'ceibo-guava-lime-monthly', label: 'Guava & Lime box - 12 cans', cadence: 'monthly' },
    { id: 'ceibo-guava-lime-bimonthly', label: 'Guava & Lime box - 12 cans', cadence: 'bimonthly' },
    { id: 'ceibo-yuzu-ginger-monthly', label: 'Yuzu Ginger box - 12 cans', cadence: 'monthly' },
    { id: 'ceibo-yuzu-ginger-bimonthly', label: 'Yuzu Ginger box - 12 cans', cadence: 'bimonthly' },
    { id: 'ceibo-passionfruit-basil-monthly', label: 'Passionfruit Basil box - 12 cans', cadence: 'monthly' },
    { id: 'ceibo-passionfruit-basil-bimonthly', label: 'Passionfruit Basil box - 12 cans', cadence: 'bimonthly' },
    { id: 'ceibo-discovery-monthly', label: 'Discovery box - 4 of each', cadence: 'monthly' },
    { id: 'ceibo-discovery-bimonthly', label: 'Discovery box - 4 of each', cadence: 'bimonthly' },
  ];
  const sameRhythm = plans.filter((p) => p.cadence === sub.cadence && p.id !== sub.plan);
  for (const plan of sameRhythm) {
    group.append(el('label', {}, el('input', { type: 'radio', name: 'plan', value: plan.id }), ` ${plan.label}`));
  }
  if (sameRhythm.length === 0) {
    group.append(el('p', { text: 'No other boxes share this delivery rhythm.' }));
  }
  const save = el('button', { class: 'btn btn-primary', text: 'Save swap' });
  const back = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}`, text: 'Back' });
  save.addEventListener('click', async () => {
    const checked = group.querySelector('input:checked') as HTMLInputElement | null;
    if (!checked) return;
    try {
      await api(`/api/subscriptions/${sub.id}/changes`, { json: { kind: 'swap', plan: checked.value } });
      window.history.pushState({}, '', `/account/subscriptions/${sub.id}`);
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    } catch (e) {
      const err = e as { body?: { message?: string } };
      const mainEl = document.querySelector('main') as HTMLElement;
      announceStatus(mainEl.appendChild(el('p', { role: 'status', 'aria-live': 'polite' })), err.body?.message ?? "That change isn't possible right now.");
    }
  });
  main.append(group, el('div', { class: 'checkout-actions' }, back, save));
  document.getElementById('app')!.append(main);
}

async function renderCancelPage(id: string): Promise<void> {
  const sub = await loadSub(id);
  if (!sub) {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Cancel subscription' }));
  main.append(el('p', { text: `Your subscription ends on Kill Bill's charged-through date: ${sub.billing_end_date ?? sub.next_renewal_date}. It never ends earlier.` }));
  const cancel = el('button', { class: 'btn btn-primary', text: 'Cancel at end of term' });
  const back = el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}`, text: 'Back' });
  cancel.addEventListener('click', async () => {
    try {
      await api(`/api/subscriptions/${sub.id}/changes`, { json: { kind: 'cancel' } });
      window.history.pushState({}, '', `/account/subscriptions/${sub.id}`);
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    } catch (e) {
      const err = e as { body?: { message?: string } };
      const mainEl = document.querySelector('main') as HTMLElement;
      announceStatus(mainEl.appendChild(el('p', { role: 'status', 'aria-live': 'polite' })), err.body?.message ?? "That change isn't possible right now.");
    }
  });
  main.append(el('div', { class: 'checkout-actions' }, back, cancel));
  document.getElementById('app')!.append(main);
}

async function renderCardPage(id: string): Promise<void> {
  const sub = await loadSub(id);
  if (!sub) {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Update card' }));
  const number = el('input', { 'aria-label': 'Card number', class: 'field-row' });
  const expiry = el('input', { 'aria-label': 'Expiry (MM/YY)', placeholder: 'MM/YY', class: 'field-row' });
  const cvc = el('input', { 'aria-label': 'Security code', placeholder: '123', class: 'field-row' });
  const save = el('button', { class: 'btn btn-primary', text: 'Save card' });
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'subscription-status' });
  save.addEventListener('click', async () => {
    const match = /^(\d{2})\s*\/?\s*(\d{2})$/.exec(expiry.value.trim());
    if (!match || !/^\d{3}$/.test(cvc.value) || !/^\d{13,19}$/.test(number.value.replace(/\s+/g, ''))) {
      announceStatus(status, 'Enter a valid card number, a future expiry as MM/YY, and the 3-digit security code.');
      return;
    }
    try {
      const res = await fetch(`/api/subscriptions/${sub.id}/card`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          number: number.value,
          expiry_month: Number(match[1]),
          expiry_year: 2000 + Number(match[2]),
          cvc: cvc.value,
        }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        if (body.error === 'card_declined') {
          announceStatus(status, 'Your card was declined. No money was taken.');
        } else if (body.error === 'billing_unavailable') {
          announceStatus(status, 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.');
        } else {
          announceStatus(status, body.message ?? "That change isn't possible right now.");
        }
        return;
      }
      window.history.pushState({}, '', `/account/subscriptions/${sub.id}`);
      const { renderRoute } = await import('../app.js');
      await renderRoute();
      const statusEl = document.querySelector('[data-region="subscription-status"]') as HTMLElement | null;
      if (statusEl) announceStatus(statusEl, body.message ?? 'Card updated.');
    } catch {
      announceStatus(status, 'Billing is unreachable, so changes are paused. Your subscription hasn\u2019t changed.');
    }
  });
  main.append(
    el('div', { class: 'field-row' }, el('label', { text: 'Card number' }), number),
    el('div', { class: 'field-row' }, el('label', { text: 'Expiry (MM/YY)' }), expiry),
    el('div', { class: 'field-row' }, el('label', { text: 'Security code' }), cvc),
    el('div', { class: 'checkout-actions' }, el('a', { class: 'btn btn-ghost', href: `/account/subscriptions/${sub.id}`, text: 'Back' }), save),
    status
  );
  document.getElementById('app')!.append(main);
  void provinceName;
}
