import { api, type OrderJson, type PieceJson } from './api.js';
import { startPieceCanvas } from './canvas.js';
import { announce, observeEntrances, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);
  if (!me) {
    window.location.href = '/auth/login?return_to=/library';
    return;
  }
  const result = await api<{ orders: OrderJson[] }>('GET', '/api/me/orders');
  const list = document.querySelector<HTMLElement>('[data-library-rows]');
  const empty = document.querySelector<HTMLElement>('[data-library-empty]');
  if (!result.ok || !list) return;
  const orders = (result.body as { orders: OrderJson[] }).orders;
  if (empty) empty.hidden = orders.length > 0;

  for (const order of orders) {
    const piece = await api<PieceJson>('GET', `/api/pieces/${order.piece_slug}`);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td data-label="Edition view"><div data-edition-thumb style="width:96px;aspect-ratio:4/3;border-radius:8px;overflow:hidden;border:1px solid var(--border)"></div></td>
      <td data-label="Piece"><span class="display-face">${escapeHtml(order.piece_title)}</span></td>
      <td data-label="Edition" class="tnum">Edition ${order.edition} of ${order.edition_count}</td>
      <td data-label="State">${order.state}</td>
      <td data-label="Invoice" class="mono">${order.invoice_number ?? '—'}</td>
      <td data-label="Downloads">
        <button type="button" data-download-export>Download export</button>
        <button type="button" data-download-invoice>Download invoice</button>
      </td>`;
    list.appendChild(row);
    const thumb = row.querySelector<HTMLElement>('[data-edition-thumb]');
    if (thumb && piece.ok) startPieceCanvas(thumb, piece.body as PieceJson, {});
    row.querySelector<HTMLButtonElement>('[data-download-export]')?.addEventListener('click', () => void download(order.id, 'export'));
    row.querySelector<HTMLButtonElement>('[data-download-invoice]')?.addEventListener('click', () => void download(order.id, 'invoice'));
  }
  observeEntrances();
}

async function download(orderId: string, kind: 'export' | 'invoice'): Promise<void> {
  const status = document.querySelector<HTMLElement>('[data-library-status]');
  const result = await api<{ url: string }>('GET', `/api/orders/${orderId}/${kind}`);
  if (result.status === 503) {
    announce(status, `Downloads are paused while file storage is offline.`);
    return;
  }
  if (result.status === 409) {
    const body = result.body as { error: { invoice_number?: string | null } };
    announce(status, `Paid, invoice pending. Invoice ${body.error.invoice_number ?? ''} will be ready shortly.`);
    return;
  }
  if (!result.ok) {
    announce(status, `That download is not available yet.`);
    return;
  }
  const url = (result.body as { url: string }).url;
  window.location.href = url;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void main();
