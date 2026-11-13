import {
  ApiError,
  announce,
  api,
  escapeHtml,
  jsonScript,
  newIdempotencyKey,
  qs,
  qsa,
  rupees,
  upload
} from './core.js';
import { onLive } from './live.js';

function staff(text: string): void {
  announce('staff-updates', text);
}

function showStale(): void {
  const alert = qs<HTMLElement>('[data-stale-alert]');
  if (alert === null) return;
  alert.hidden = false;
  alert.setAttribute('tabindex', '-1');
  alert.focus();
}

function clearFieldErrors(root: ParentNode): void {
  for (const node of qsa<HTMLElement>('[data-error-for]', root)) node.textContent = '';
}

function applyFieldErrors(root: ParentNode, fields: Record<string, string>): void {
  for (const [key, copy] of Object.entries(fields)) {
    const holder = qs<HTMLElement>(`[data-error-for="${key}"]`, root);
    if (holder !== null) holder.textContent = copy;
    const indexed = /^stock\.\d+\.available$/.test(key) ? qs<HTMLElement>('[data-error-for="price"]', root) : null;
    if (indexed !== null && holder === null) indexed.textContent = copy;
  }
}

async function saveVariant(group: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const sku = group.dataset.variant ?? '';
  clearFieldErrors(group);
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Saving';
  staff('Saving');
  const compareRaw = qs<HTMLInputElement>('[data-compare-at]', group)?.value ?? '';
  try {
    const result = await api<{ version: number }>(`/api/admin/variants/${sku}`, {
      method: 'PATCH',
      body: {
        version: Number(group.dataset.version),
        price: Number(qs<HTMLInputElement>('[data-price]', group)?.value ?? '0'),
        compare_at: compareRaw.trim() === '' ? null : Number(compareRaw),
        stock: [
          {
            location: 'bhiwandi',
            available: Number(qs<HTMLInputElement>('[data-stock-bhiwandi]', group)?.value ?? '0')
          },
          {
            location: 'gurugram',
            available: Number(qs<HTMLInputElement>('[data-stock-gurugram]', group)?.value ?? '0')
          }
        ]
      }
    });
    group.dataset.version = String(result.version);
    staff(`Saved ${sku}.`);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 412) showStale();
      else if (error.body.fields !== undefined) applyFieldErrors(group, error.body.fields);
      else staff(error.body.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function saveStatus(button: HTMLButtonElement): Promise<void> {
  const select = qs<HTMLSelectElement>('[data-product-status]');
  if (select === null) return;
  const slug = window.location.pathname.split('/').pop() ?? '';
  button.disabled = true;
  button.textContent = 'Saving';
  try {
    const result = await api<{ version: number }>(`/api/admin/products/${slug}`, {
      method: 'PATCH',
      body: { version: Number(button.dataset.version), status: select.value }
    });
    button.dataset.version = String(result.version);
    staff(`Saved ${slug}.`);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 412) showStale();
      else staff(error.body.message);
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Save status';
  }
}

let imageKey = newIdempotencyKey();
let pendingImage: File | null = null;

async function uploadImage(): Promise<void> {
  const slug = window.location.pathname.split('/').pop() ?? '';
  const alt = qs<HTMLInputElement>('[data-image-alt]')?.value ?? '';
  const colour = qs<HTMLSelectElement>('[data-image-colour]')?.value ?? '';
  const errorHolder = qs<HTMLElement>('[data-image-error]');
  const retry = qs<HTMLElement>('[data-image-retry]');
  if (pendingImage === null) return;
  if (errorHolder !== null) {
    errorHolder.hidden = true;
    errorHolder.textContent = '';
  }
  const form = new FormData();
  form.set('colour', colour);
  form.set('alt', alt);
  form.set('file', pendingImage);
  staff('Saving');
  try {
    await upload('/api/admin/products/' + slug + '/images', form, { 'Idempotency-Key': imageKey });
    staff(`Image added to ${slug} in ${colour}.`);
    if (retry !== null) retry.hidden = true;
    pendingImage = null;
    imageKey = newIdempotencyKey();
  } catch (error) {
    if (error instanceof ApiError) {
      if (errorHolder !== null) {
        errorHolder.hidden = false;
        errorHolder.textContent =
          error.body.fields === undefined
            ? error.body.message
            : Object.values(error.body.fields)[0] ?? error.body.message;
      }
      if (error.status === 503 && retry !== null) retry.hidden = false;
      if (error.body.fields !== undefined) applyFieldErrors(document, error.body.fields);
    }
  }
}

async function orderStatus(button: HTMLButtonElement): Promise<void> {
  const data = jsonScript<{ number: string; version: number } | null>('admin-order-data', null);
  if (data === null) return;
  const status = button.dataset.orderStatus ?? '';
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Saving';
  try {
    const order = await api<{ number: string; status: string; version: number }>(
      `/api/admin/orders/${data.number}/status`,
      { method: 'POST', body: { version: currentVersion(data.version), status } }
    );
    setVersion(order.version);
    staff(`${order.number} is now ${order.status.replace(/_/g, ' ')}.`);
    window.location.reload();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 412) showStale();
      else staff(error.body.message);
    }
    button.disabled = false;
    button.textContent = original;
  }
}

function currentVersion(fallback: number): number {
  const holder = qs<HTMLElement>('[data-order-version]');
  const value = holder === null ? NaN : Number(holder.dataset.orderVersion);
  return Number.isFinite(value) ? value : fallback;
}

function setVersion(version: number): void {
  const holder = qs<HTMLElement>('[data-order-version]');
  if (holder !== null) holder.dataset.orderVersion = String(version);
}

async function createShipment(button: HTMLButtonElement): Promise<void> {
  const data = jsonScript<{ number: string; version: number } | null>('admin-order-data', null);
  if (data === null) return;
  clearFieldErrors(document);
  const lineIds = qsa<HTMLInputElement>('[data-ship-line]')
    .filter((input) => input.checked)
    .map((input) => input.dataset.shipLine ?? '');
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Saving';
  try {
    const order = await api<{ number: string; status: string; version: number }>(
      `/api/admin/orders/${data.number}/shipments`,
      {
        method: 'POST',
        body: {
          version: currentVersion(data.version),
          line_ids: lineIds,
          carrier: qs<HTMLSelectElement>('[data-carrier]')?.value ?? '',
          tracking_number: qs<HTMLInputElement>('[data-tracking]')?.value ?? ''
        }
      }
    );
    setVersion(order.version);
    staff(`${order.number} is now ${order.status.replace(/_/g, ' ')}.`);
    window.location.reload();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 412) showStale();
      else if (error.body.fields !== undefined) applyFieldErrors(document, error.body.fields);
      else staff(error.body.message);
    }
    button.disabled = false;
    button.textContent = original;
  }
}

async function caseTransition(button: HTMLButtonElement): Promise<void> {
  const holder = qs<HTMLElement>('[data-case-number]');
  if (holder === null) return;
  const number = holder.dataset.caseNumber ?? '';
  const kind = window.location.pathname.split('/')[2] ?? 'returns';
  const to = button.dataset.transition ?? '';
  clearFieldErrors(document);
  button.disabled = true;
  const original = button.textContent ?? '';
  button.textContent = 'Saving';
  try {
    const result = await api<{ number: string; status: string; version: number }>(
      `/api/admin/${kind}/${number}/transition`,
      {
        method: 'POST',
        body: {
          version: Number(holder.dataset.caseVersion),
          to,
          reason: qs<HTMLInputElement>('[data-reject-reason]')?.value ?? null
        }
      }
    );
    holder.dataset.caseVersion = String(result.version);
    staff(`${result.number} is now ${result.status.replace(/_/g, ' ')}.`);
    window.location.reload();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 412) showStale();
      else if (error.body.fields !== undefined) applyFieldErrors(document, error.body.fields);
      else staff(error.body.message);
    }
    button.disabled = false;
    button.textContent = original;
  }
}

async function createCode(form: HTMLFormElement): Promise<void> {
  clearFieldErrors(form);
  const kind = qs<HTMLElement>('[data-promo-kind] [role="radio"][aria-checked="true"]')?.dataset.kind ?? 'percent';
  const limitRaw = qs<HTMLInputElement>('[data-promo-limit]')?.value ?? '';
  try {
    const created = await api<{ code: string }>('/api/admin/discount-codes', {
      method: 'POST',
      body: {
        code: (qs<HTMLInputElement>('[data-promo-code]')?.value ?? '').trim().toUpperCase(),
        kind,
        value: Number(qs<HTMLInputElement>('[data-promo-value]')?.value ?? '0'),
        collection: (qs<HTMLSelectElement>('[data-promo-collection]')?.value ?? '') || null,
        minimum: Number(qs<HTMLInputElement>('[data-promo-minimum]')?.value ?? '0'),
        starts_at: qs<HTMLInputElement>('[data-promo-starts]')?.value ?? '',
        ends_at: qs<HTMLInputElement>('[data-promo-ends]')?.value ?? '',
        usage_limit: limitRaw.trim() === '' ? null : Number(limitRaw)
      }
    });
    staff(`Code ${created.code} created.`);
    window.location.reload();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.body.fields !== undefined) applyFieldErrors(form, error.body.fields);
      else staff(error.body.message);
    }
  }
}

async function lookupGiftCard(): Promise<void> {
  const code = qs<HTMLInputElement>('[data-gift-code]')?.value.trim() ?? '';
  const body = qs<HTMLElement>('[data-gift-ledger]');
  if (body === null || code === '') return;
  try {
    const card = await api<{
      code: string;
      balance: number;
      entries: Array<{ group_id: string; account: string; amount: number; reason: string; at: string }>;
    }>(`/api/admin/gift-cards/${encodeURIComponent(code)}`);
    body.innerHTML = card.entries
      .map(
        (entry) =>
          `<tr><td>${escapeHtml(entry.group_id)}</td><td>${escapeHtml(entry.account)}</td>
           <td>${escapeHtml(rupees(entry.amount))}</td><td>${escapeHtml(entry.reason)}</td>
           <td>${escapeHtml(entry.at)}</td></tr>`
      )
      .join('');
    staff(`Balance ${rupees(card.balance)}`);
  } catch (error) {
    if (error instanceof ApiError) staff(error.body.message);
  }
}

async function loadMetrics(): Promise<void> {
  const from = qs<HTMLInputElement>('[data-metrics-from]')?.value ?? '';
  const to = qs<HTMLInputElement>('[data-metrics-to]')?.value ?? '';
  try {
    const figures = await api<Record<string, number>>(
      `/api/admin/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    );
    for (const [key, value] of Object.entries(figures)) {
      const holder = qs<HTMLElement>(`[data-figure="${key}"]`);
      if (holder === null) continue;
      holder.textContent =
        key === 'orders' || key === 'units_sold' ? String(value) : rupees(value);
    }
  } catch (error) {
    if (error instanceof ApiError) staff(error.body.message);
  }
}

export function setupAdmin(): void {
  if (qs<HTMLElement>('[data-figures]') !== null) void loadMetrics();

  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement | null;
    if (form === null) return;
    if (form.matches('[data-metrics-form]')) {
      event.preventDefault();
      void loadMetrics();
    }
    if (form.matches('[data-promotion-form]')) {
      event.preventDefault();
      void createCode(form);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const saveVariantButton = target.closest<HTMLButtonElement>('[data-save-variant]');
    if (saveVariantButton !== null) {
      event.preventDefault();
      const group = saveVariantButton.closest<HTMLElement>('[data-variant]');
      if (group !== null) void saveVariant(group, saveVariantButton);
      return;
    }

    const statusButton = target.closest<HTMLButtonElement>('[data-save-status]');
    if (statusButton !== null) {
      event.preventDefault();
      void saveStatus(statusButton);
      return;
    }

    if (target.closest('[data-add-image]') !== null) {
      event.preventDefault();
      qs<HTMLInputElement>('[data-image-input]')?.click();
      return;
    }

    if (target.closest('[data-image-retry]') !== null) {
      event.preventDefault();
      void uploadImage();
      return;
    }

    if (target.closest('[data-reload-latest]') !== null) {
      event.preventDefault();
      window.location.reload();
      return;
    }

    const shipmentButton = target.closest<HTMLButtonElement>('[data-create-shipment]');
    if (shipmentButton !== null) {
      event.preventDefault();
      void createShipment(shipmentButton);
      return;
    }

    const statusChange = target.closest<HTMLButtonElement>('[data-order-status]');
    if (statusChange !== null) {
      event.preventDefault();
      void orderStatus(statusChange);
      return;
    }

    const transition = target.closest<HTMLButtonElement>('[data-transition]');
    if (transition !== null) {
      event.preventDefault();
      void caseTransition(transition);
      return;
    }

    if (target.closest('[data-gift-lookup]') !== null) {
      event.preventDefault();
      void lookupGiftCard();
      return;
    }

    const kindRadio = target.closest<HTMLElement>('[data-promo-kind] [role="radio"]');
    if (kindRadio !== null) {
      event.preventDefault();
      for (const radio of qsa<HTMLElement>('[data-promo-kind] [role="radio"]')) {
        const on = radio === kindRadio;
        radio.setAttribute('aria-checked', on ? 'true' : 'false');
        radio.setAttribute('tabindex', on ? '0' : '-1');
      }
    }
  });

  const imageInput = qs<HTMLInputElement>('[data-image-input]');
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (file === undefined) return;
    pendingImage = file;
    void uploadImage();
  });

  const lowStock = qs<HTMLInputElement>('[data-low-stock]');
  lowStock?.addEventListener('change', () => {
    const params = new URLSearchParams(window.location.search);
    if (lowStock.checked) params.set('low_stock', 'true');
    else params.delete('low_stock');
    window.location.search = params.toString();
  });

  const orderSearch = qs<HTMLInputElement>('[data-order-search]');
  const statusFilter = qs<HTMLSelectElement>('[data-order-status-filter]');
  const applyOrderFilters = (): void => {
    const params = new URLSearchParams();
    if (orderSearch !== null && orderSearch.value.trim() !== '') params.set('q', orderSearch.value.trim());
    if (statusFilter !== null && statusFilter.value !== '') params.set('status', statusFilter.value);
    window.location.search = params.toString();
  };
  orderSearch?.addEventListener('change', applyOrderFilters);
  statusFilter?.addEventListener('change', applyOrderFilters);

  onLive((type, payload) => {
    if (type === 'queue') staff(`${String(payload.number)} is now ${String(payload.status).replace(/_/g, ' ')}.`);
    if (type === 'order') staff(`${String(payload.number)} is now ${String(payload.status).replace(/_/g, ' ')}.`);
  });
}
