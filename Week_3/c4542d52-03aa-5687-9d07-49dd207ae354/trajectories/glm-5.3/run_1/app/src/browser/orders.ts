import { h } from './dom.js';
import { get, post } from './api.js';
import type { Order, DocumentRec } from './api.js';
import { shell, page, navigate, announce, onSocketOpen } from './app.js';
import { onEvent } from './socket.js';
import { fmtInstant, fmtMoney } from './format.js';

const ORDER_WORDS: Record<string, string> = {
  pending: 'Pending',
  held: 'Held',
  issued: 'Issued',
  cancelled: 'Cancelled',
};

// The Exercise chapter opens with a full-bleed black band.
page('/exercise', ['option_holder', 'leaver'], async (root, ctx) => {
  const { orders } = await get<{ orders: Order[] }>('/api/exercises');
  const person = ctx.person;

  const list = h('ul', { style: { listStyle: 'none', padding: 0 } });
  if (orders.length === 0) {
    root.appendChild(shell(person,
      h('section', { class: 'band black full-bleed' }, h('h1', {}, 'Exercise')),
      h('section', { class: 'band black' }, 'No exercise orders yet.'),
    ));
    return;
  }
  for (const o of orders) {
    const li = h('li', { style: { marginBottom: '12px' } });
    const link = h('a', { href: `/exercises/${o.id}` }, o.id);
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate(`/exercises/${o.id}`);
    });
    li.append(
      h('div', {}, link),
      h('div', { class: 'num' }, `${o.options.toLocaleString('en-US')} options — $${fmtMoney(o.cost)} — ${ORDER_WORDS[o.state]}`),
    );
    list.appendChild(li);
  }

  root.appendChild(shell(person,
    h('section', { class: 'band black full-bleed' }, h('h1', {}, 'Exercise')),
    h('p', { class: 'side-note' }, 'Your exercise orders, newest first.'),
    list,
  ));
});

page('/exercises/:id', ['option_holder', 'leaver', 'founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const order = await get<Order>(`/api/exercises/${ctx.params.id}`);

  const heading = h('h1', { tabindex: '-1' }, `${order.id} — ${ORDER_WORDS[order.state]}`);

  const providerRecord = h('section', { role: 'region', 'aria-label': 'Provider record' },
    h('h2', {}, 'Provider record'),
    order.payment
      ? h('div', {},
          h('p', {}, `Reference ${order.payment.id}`),
          h('p', {}, `Amount $${fmtMoney(String(order.payment.amount_cents / 100))} USD`),
          order.payment.confirmed_at ? h('p', {}, `Confirmed ${fmtInstant(order.payment.confirmed_at)}`) : null,
        )
      : h('p', {}, 'No payment record yet.'),
  );

  const noticeStatus = h('p', {}, `Exercise notice: ${order.notice ? order.notice.status : 'pending'}`);

  const retryPayment = h('button', { class: 'primary', style: { display: order.state === 'held' ? '' : 'none' } }, 'Retry payment') as HTMLButtonElement;
  const retryNotice = h('button', { class: 'primary', style: { display: order.notice?.status === 'pending' && order.state === 'issued' ? '' : 'none' } }, 'Retry notice') as HTMLButtonElement;
  const cancelOrder = h('button', { class: 'secondary', style: { display: order.state === 'pending' || order.state === 'held' ? '' : 'none' } }, 'Cancel order') as HTMLButtonElement;

  retryPayment.addEventListener('click', async () => {
    try {
      await post(`/api/exercises/${order.id}/retry`);
      navigate(`/exercises/${order.id}`, true);
    } catch (e) {
      const err = e as { message?: string };
      announce(err.message ?? '', `retry-pay-${order.id}`);
    }
  });

  retryNotice.addEventListener('click', async () => {
    try {
      await post(`/api/exercises/${order.id}/retry`);
      navigate(`/exercises/${order.id}`, true);
      announce(`Exercise notice for ${order.id} sealed in the vault.`, `notice-${order.id}`);
    } catch (e) {
      const err = e as { message?: string };
      announce(err.message ?? '', `retry-notice-${order.id}`);
    }
  });

  cancelOrder.addEventListener('click', async () => {
    try {
      await post(`/api/exercises/${order.id}/cancel`);
      announce(`Order ${order.id} cancelled. No shares were issued.`, `cancel-${order.id}`);
      navigate(`/exercises/${order.id}`, true);
    } catch (e) {
      const err = e as { message?: string };
      announce(err.message ?? '', `cancel-fail-${order.id}`);
    }
  });

  const content = h('div', {},
    heading,
    h('p', { class: 'side-note' }, `${order.options.toLocaleString('en-US')} options at $${order.strike}`),
    h('p', {}, `Cost $${fmtMoney(order.cost)}`),
    providerRecord,
    noticeStatus,
    h('div', { class: 'dialog-actions' }, retryPayment, retryNotice, cancelOrder),
  );

  root.appendChild(shell(person, content));
  heading.focus();

  // Live state changes keep focus where it was.
  onEvent((ev) => {
    const data = ev.data as Record<string, unknown> | null;
    if (ev.type === 'order_state' && data?.order_id === order.id) {
      navigate(`/exercises/${order.id}`, true);
    }
  });

  // Nothing sent while the socket is closed.
  onSocketOpen((open) => {
    retryPayment.disabled = !open;
    retryNotice.disabled = !open;
    cancelOrder.disabled = !open;
  });
});

// ---------- documents ----------

page('/documents', ['founder_admin', 'option_holder', 'leaver', 'investor'], async (root, ctx) => {
  const person = ctx.person;
  const { documents } = await get<{ documents: DocumentRec[] }>('/api/documents');
  const list = h('ul', { role: 'list', 'aria-label': 'Documents', style: { listStyle: 'none', padding: 0 } });
  if (documents.length === 0) {
    root.appendChild(shell(person, h('section', { class: 'band black' }, 'No documents yet.')));
    return;
  }
  for (const d of documents) {
    const li = h('li', { style: { marginBottom: '10px' } });
    const link = h('a', { href: `/documents/${d.id}`, 'data-doc': d.id }, d.title);
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate(`/documents/${d.id}`);
    });
    li.append(link, h('div', { class: 'side-note' }, `${d.kind.replace('_', ' ')} — ${d.status}`));
    list.appendChild(li);
  }
  root.appendChild(shell(person, h('h1', {}, 'Documents'), list));
});

page('/documents/:id', ['founder_admin', 'option_holder', 'leaver', 'investor'], async (root, ctx) => {
  const person = ctx.person;
  const docId = ctx.params.id!;
  const doc = await get<DocumentRec>(`/api/documents/${docId}`);

  const { documents } = await get<{ documents: DocumentRec[] }>('/api/documents');
  const list = h('ul', { role: 'list', 'aria-label': 'Documents', style: { listStyle: 'none', padding: 0 } });

  const dialog = h('dialog', { 'aria-label': 'Document viewer' }) as HTMLDialogElement;

  async function openViewer(id: string): Promise<void> {
    const content = await fetch(`/api/documents/${id}/content`, { credentials: 'same-origin' });
    if (!content.ok) {
      const body = h('section', { class: 'band red' }, "The document vault can't be reached. Try again shortly.");
      dialog.replaceChildren(
        h('h2', {}, doc.title),
        body,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'secondary', onclick: () => dialog.close() }, 'Close')),
      );
      dialog.showModal();
      return;
    }
    const text = await content.text();
    const seal = content.headers.get('X-Document-SHA256') ?? '';
    dialog.replaceChildren(
      h('h2', { id: 'doc-title' }, doc.title),
      h('div', { class: 'dialog-body' },
        h('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit' } }, text),
        h('p', {}, `Seal ${seal.slice(0, 12)}`),
        h('p', {}, `Version ${doc.version}`),
        doc.supersedes ? h('p', {}, `Corrects ${doc.supersedes}`) : null,
        doc.superseded_by ? h('p', {}, `Superseded by ${doc.superseded_by}`) : null,
      ),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'secondary', onclick: () => dialog.close() }, 'Close')),
    );
    dialog.showModal();
  }

  for (const d of documents) {
    const li = h('li', { style: { marginBottom: '10px' } });
    const link = h('a', { href: `/documents/${d.id}`, 'data-doc': d.id }, d.title);
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate(`/documents/${d.id}`);
    });
    li.append(link, h('div', { class: 'side-note' }, `${d.kind.replace('_', ' ')} — ${d.status}`));
    list.appendChild(li);
  }

  const heading = h('h1', {}, 'Documents');
  root.appendChild(shell(person, heading, list, dialog));

  await openViewer(docId);

  dialog.addEventListener('close', () => {
    if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
    navigate('/documents', true);
    const link = document.querySelector<HTMLAnchorElement>(`[data-doc="${docId}"]`);
    if (link) link.focus();
  });
});
