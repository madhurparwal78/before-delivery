import { api, formatPrice, displayDate, type Order, type Membership } from '../api.ts';
import { shell, notice, openDialog, closeDialog, errorSummary, clearErrorSummary, isApiFailure } from '../shell.ts';

/** Account: membership, orders with receipt links, the saved path and bookmarks. */

export async function initAccountPage(): Promise<void> {
  await renderMembership();
  await renderOrders();
  await renderPath();
  await renderBookmarks();
}

async function renderMembership(): Promise<void> {
  const region = document.querySelector<HTMLElement>('[data-role="membership"]');
  if (!region) return;
  let membership: Membership | null = null;
  try {
    const res = await api.get<{ membership: Membership | null }>('/api/me/membership');
    membership = res.membership;
  } catch {
    membership = null;
  }
  const statusLine = region.querySelector<HTMLElement>('[data-role="membership-status"]');
  const detailLine = region.querySelector<HTMLElement>('[data-role="membership-detail"]');
  const nextLine = region.querySelector<HTMLElement>('[data-role="membership-next"]');
  const actions = region.querySelector<HTMLElement>('[data-role="membership-actions"]');
  if (!membership) {
    if (statusLine) statusLine.textContent = shell.user ? "You don't have a supporter membership." : 'Please sign in.';
    if (detailLine) detailLine.textContent = '';
    if (nextLine) nextLine.textContent = '';
    if (actions) actions.textContent = '';
    return;
  }
  const label =
    membership.status === 'active' ? 'Active'
      : membership.status === 'pending_change' ? 'Pending change'
        : membership.status === 'overdue' ? 'Overdue'
          : 'Cancelled';
  if (statusLine) statusLine.textContent = `${membership.tier_name} · ${label}`;
  if (detailLine) {
    if (membership.status === 'pending_change' && membership.pending) {
      detailLine.textContent = membership.pending.kind === 'downgrade'
        ? `Changes to ${displayDate(membership.pending.effective_on)} on ${displayDate(membership.pending.effective_on)}.`.replace(/.*Changes to [0-9]+ [A-Za-z]+ [0-9]+ on/, `Changes to ${membership.pending.tier} on`)
        : `Ends on ${displayDate(membership.pending.effective_on)}.`;
    } else if (membership.status === 'overdue') {
      detailLine.textContent = `Payment of ${formatPrice(membership.amount_due_minor ?? 0, membership.currency)} is overdue.`;
    } else {
      detailLine.textContent = '';
    }
  }
  if (nextLine) {
    nextLine.textContent = membership.next_charge
      ? `Next payment ${formatPrice(membership.next_charge.amount_minor, membership.currency)} on ${displayDate(membership.next_charge.on)}.`
      : '';
  }
  if (actions) {
    actions.textContent = '';
    if (membership.status === 'overdue') {
      const retry = document.createElement('button');
      retry.textContent = 'Retry payment';
      retry.addEventListener('click', () => void retryPayment(retry));
      const update = document.createElement('button');
      update.textContent = 'Update card';
      update.addEventListener('click', () => openDialog('dialog-update-card', update));
      actions.append(retry, update);
    }
  }
  void closeDialog;
}

async function retryPayment(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  notice('Processing payment, please wait.');
  try {
    await api.post<{ membership: Membership; receipt_email: string }>('/api/me/membership/retry', {});
    notice('Payment received. Your membership is active.');
    await renderMembership();
  } catch (e) {
    notice(isApiFailure(e) ? e.message : 'Something went wrong.');
  } finally {
    button.disabled = false;
  }
}

async function renderOrders(): Promise<void> {
  const tableBody = document.querySelector<HTMLElement>('[data-role="orders-body"]');
  if (!tableBody) return;
  if (!shell.user) {
    tableBody.textContent = '';
    return;
  }
  try {
    const res = await api.get<{ orders: Order[] }>('/api/me/orders');
    tableBody.textContent = '';
    for (const order of res.orders) {
      const tr = document.createElement('tr');
      const receiptCell = document.createElement('td');
      const link = document.createElement('a');
      link.href = order.receipt_url;
      link.textContent = `Receipt ${order.receipt_number}`;
      receiptCell.appendChild(link);
      const descCell = document.createElement('td');
      descCell.textContent = order.description;
      const amountCell = document.createElement('td');
      amountCell.className = 'num';
      amountCell.textContent = formatPrice(order.amount_minor, order.currency);
      const statusCell = document.createElement('td');
      statusCell.textContent = order.status;
      tr.append(receiptCell, descCell, amountCell, statusCell);
      tableBody.appendChild(tr);
    }
  } catch {
    tableBody.textContent = '';
  }
}

async function renderPath(): Promise<void> {
  const region = document.querySelector<HTMLElement>('[data-role="path"]');
  if (!region) return;
  if (!shell.user) return;
  try {
    const res = await api.get<{ path: { resolved: number[]; last_chapter: number | null; last_exhibit: string } }>('/api/me/path');
    const list = region.querySelector<HTMLElement>('[data-role="resolved-list"]');
    if (list) {
      list.textContent = '';
      for (const chapter of res.path.resolved) {
        const li = document.createElement('li');
        const numeral = NUMERALS[chapter] ?? String(chapter);
        li.textContent = `Chapter ${numeral}`;
        list.appendChild(li);
      }
      if (!res.path.resolved.length) {
        const li = document.createElement('li');
        li.textContent = 'No chapters resolved yet.';
        list.appendChild(li);
      }
    }
    const continueSlot = region.querySelector<HTMLElement>('[data-role="continue"]');
    if (continueSlot) {
      continueSlot.textContent = '';
      if (res.path.last_chapter) {
        const numeral = NUMERALS[res.path.last_chapter] ?? String(res.path.last_chapter);
        const a = document.createElement('a');
        a.href = `/chapters/${res.path.last_chapter}`;
        a.textContent = `Continue at chapter ${numeral}`;
        continueSlot.appendChild(a);
      }
    }
  } catch {
    /* accounts unavailable */
  }
}

async function renderBookmarks(): Promise<void> {
  const list = document.querySelector<HTMLElement>('[data-role="bookmarks-list"]');
  if (!list) return;
  if (!shell.user) return;
  try {
    const res = await api.get<{ bookmarks: Array<{ id: string; target_type: string; target_id: string; title: string }> }>('/api/me/bookmarks');
    list.textContent = '';
    for (const bookmark of res.bookmarks) {
      const li = document.createElement('li');
      if (bookmark.target_type === 'chapter') {
        const a = document.createElement('a');
        a.href = `/chapters/${bookmark.target_id.split('-')[1]}`;
        a.textContent = bookmark.title;
        li.appendChild(a);
      } else {
        li.textContent = bookmark.title;
      }
      const remove = document.createElement('button');
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        try {
          await api.delete(`/api/me/bookmarks/${bookmark.id}`);
          notice('Bookmark removed.');
          li.remove();
        } catch (e) {
          notice(isApiFailure(e) ? e.message : 'Something went wrong.');
        }
      });
      li.appendChild(remove);
      list.appendChild(li);
    }
    if (!res.bookmarks.length) {
      const li = document.createElement('li');
      li.textContent = 'No bookmarks yet.';
      list.appendChild(li);
    }
  } catch {
    /* accounts unavailable */
  }
}

const NUMERALS: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII',
};

void errorSummary;
void clearErrorSummary;
