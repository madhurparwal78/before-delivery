import { db } from '../db/pool';
import { Ctx } from '../http/context';
import { loadProducts } from '../domain/catalogue';
import { CARRIERS, COLLECTIONS } from '../domain/constants';
import { formatDateTimeIst, isoDateIst, rupees } from '../domain/money';
import { loadOrder, loadOrderLines, orderPayload } from '../domain/orders';
import {
  CLAIM_STATUS_WORDS,
  CLAIM_TRANSITIONS,
  ORDER_STATUS_WORDS,
  RETURN_STATUS_WORDS,
  RETURN_TRANSITIONS,
  TRIAL_STATUS_WORDS,
  TRIAL_TRANSITIONS,
  stockBadge
} from '../domain/rules';
import { balancesFor } from '../domain/stock';
import { Shell, attr, escapeHtml, renderPage } from './layout';

const NAV: Array<{ label: string; href: string; roles: string[] }> = [
  { label: 'Dashboard', href: '/admin', roles: ['operations'] },
  { label: 'Products', href: '/admin/products', roles: ['operations'] },
  { label: 'Inventory', href: '/admin/inventory', roles: ['operations'] },
  { label: 'Orders', href: '/admin/orders', roles: ['operations', 'support'] },
  { label: 'Returns', href: '/admin/returns', roles: ['support'] },
  { label: 'Trials', href: '/admin/trials', roles: ['support'] },
  { label: 'Warranty', href: '/admin/warranty', roles: ['support'] },
  { label: 'Promotions', href: '/admin/promotions', roles: ['operations'] },
  { label: 'Gift cards', href: '/admin/gift-cards', roles: ['operations'] },
  { label: 'Audit log', href: '/admin/audit', roles: ['operations', 'support'] },
  { label: 'Reports', href: '/admin/reports', roles: ['operations'] }
];

function adminShell(shell: Shell, title: string, body: string, page: string): string {
  const role = shell.user?.role ?? '';
  const links = NAV.filter((item) => item.roles.includes(role));
  const content = `
<div class="admin-layout">
  <nav aria-label="Staff" class="left-zone staff-nav">
    ${links.map((item) => `<a href="${attr(item.href)}">${escapeHtml(item.label)}</a>`).join('')}
  </nav>
  <div class="admin-main">
    <h1>${escapeHtml(title)}</h1>
    <p role="status" aria-live="polite" aria-label="Staff updates" data-staff-updates data-region="staff-updates"></p>
    <div role="alert" class="stale-alert" data-stale-alert hidden>
      <p>This record changed since you opened it. Reload to see the latest version.</p>
      <button type="button" data-reload-latest>Reload latest</button>
    </div>
    ${body}
  </div>
</div>`;
  return renderPage(shell, { title, page: `admin-${page}`, content, showBagDrawer: false });
}

export async function adminDashboard(ctx: Ctx, shell: Shell): Promise<string> {
  const to = ctx.query.get('to') ?? isoDateIst(new Date());
  const from = ctx.query.get('from') ?? isoDateIst(new Date(Date.now() - 29 * 86400000));
  const body = `
<form data-metrics-form>
  <label for="metrics-from">From</label>
  <input id="metrics-from" type="text" aria-label="From" value="${attr(from)}" data-metrics-from>
  <label for="metrics-to">To</label>
  <input id="metrics-to" type="text" aria-label="To" value="${attr(to)}" data-metrics-to>
  <button type="submit">Update figures</button>
</form>
<div role="region" aria-label="Figures" class="figures" data-figures>
  <p><span>Orders</span> <span data-figure="orders">0</span></p>
  <p><span>Gross sales</span> <span data-figure="gross_sales">₹0</span></p>
  <p><span>Refunds</span> <span data-figure="refunds">₹0</span></p>
  <p><span>Net sales</span> <span data-figure="net_sales">₹0</span></p>
  <p><span>Units sold</span> <span data-figure="units_sold">0</span></p>
  <p><span>Average order</span> <span data-figure="average_order_value">₹0</span></p>
</div>`;
  return adminShell(shell, 'Dashboard', body, 'dashboard');
}

export async function adminProducts(ctx: Ctx, shell: Shell): Promise<string> {
  const products = await loadProducts(db, {});
  const body = `
<table aria-label="Products" class="flat-table">
  <caption class="visually-hidden">Products</caption>
  <thead><tr><th scope="col">Product</th><th scope="col">Status</th><th scope="col">Variants</th></tr></thead>
  <tbody>
    ${products
      .map(
        (product) => `<tr><td><a href="/admin/products/${attr(product.slug)}">${escapeHtml(
          product.name
        )}</a></td><td>${escapeHtml(product.status)}</td><td>${product.variants.length}</td></tr>`
      )
      .join('')}
  </tbody>
</table>`;
  return adminShell(shell, 'Products', body, 'products');
}

export async function adminProduct(ctx: Ctx, shell: Shell, slug: string): Promise<string | null> {
  const [product] = await loadProducts(db, { slug });
  if (product === undefined) return null;
  const balances = await balancesFor(db, product.variants.map((variant) => variant.id));
  const colours = [...new Set(product.variants.map((variant) => variant.colour))];

  const body = `
<p>${escapeHtml(product.name)}</p>
<label for="product-status">Product status</label>
<select id="product-status" aria-label="Product status" data-product-status>
  <option value="draft" ${product.status === 'draft' ? 'selected' : ''}>Draft</option>
  <option value="published" ${product.status === 'published' ? 'selected' : ''}>Published</option>
  <option value="archived" ${product.status === 'archived' ? 'selected' : ''}>Archived</option>
</select>
<button type="button" data-save-status data-version="${product.version}">Save status</button>

<section class="upload-block">
  <button type="button" data-add-image>Upload image</button>
  <label class="visually-hidden" for="product-image">Product image</label>
  <input id="product-image" type="file" accept="image/jpeg,image/png,image/webp" data-image-input>
  <label for="image-alt">Alt text</label>
  <input id="image-alt" type="text" aria-label="Alt text" data-image-alt aria-describedby="image-alt-error">
  <p class="field-error" id="image-alt-error" data-error-for="alt"></p>
  <label for="image-colour">Image colour</label>
  <select id="image-colour" aria-label="Image colour" data-image-colour>
    ${colours.map((colour) => `<option value="${attr(colour)}">${escapeHtml(colour)}</option>`).join('')}
  </select>
  <button type="button" data-image-retry hidden>Try again</button>
  <div role="alert" data-image-error hidden></div>
</section>

${product.variants
  .map((variant) => {
    const locations = balances.get(variant.id) ?? [];
    const bhiwandi = locations.find((entry) => entry.location === 'bhiwandi')?.available ?? 0;
    const gurugram = locations.find((entry) => entry.location === 'gurugram')?.available ?? 0;
    return `
<div role="group" aria-label="${attr(variant.sku)}" class="variant-row" data-variant="${attr(variant.sku)}"
     data-version="${variant.version}">
  <label for="price-${attr(variant.sku)}">Price</label>
  <input id="price-${attr(variant.sku)}" type="text" aria-label="Price" value="${variant.price}" data-price
         aria-describedby="price-${attr(variant.sku)}-error">
  <p class="field-error" id="price-${attr(variant.sku)}-error" data-error-for="price"></p>
  <label for="compare-${attr(variant.sku)}">Compare-at price</label>
  <input id="compare-${attr(variant.sku)}" type="text" aria-label="Compare-at price"
         value="${variant.compare_at === null ? '' : variant.compare_at}" data-compare-at
         aria-describedby="compare-${attr(variant.sku)}-error">
  <p class="field-error" id="compare-${attr(variant.sku)}-error" data-error-for="compare_at"></p>
  <label for="bhiwandi-${attr(variant.sku)}">Available at Bhiwandi</label>
  <input id="bhiwandi-${attr(variant.sku)}" type="number" min="0" max="9999" aria-label="Available at Bhiwandi"
         value="${bhiwandi}" data-stock-bhiwandi>
  <label for="gurugram-${attr(variant.sku)}">Available at Gurugram</label>
  <input id="gurugram-${attr(variant.sku)}" type="number" min="0" max="9999" aria-label="Available at Gurugram"
         value="${gurugram}" data-stock-gurugram>
  <button type="button" data-save-variant>Save ${escapeHtml(variant.sku)}</button>
</div>`;
  })
  .join('')}`;
  return adminShell(shell, product.name, body, 'product');
}

export async function adminInventory(ctx: Ctx, shell: Shell, sku?: string): Promise<string> {
  const lowOnly = ctx.query.get('low_stock') === 'true';
  const products = await loadProducts(db, {});
  const variantIds = products.flatMap((product) => product.variants.map((variant) => variant.id));
  const balances = await balancesFor(db, variantIds);

  const rows = products
    .flatMap((product) =>
      product.variants.map((variant) => ({
        sku: variant.sku,
        product: product.name,
        colour: variant.colour,
        size: variant.size,
        available: variant.available,
        locations: balances.get(variant.id) ?? []
      }))
    )
    .filter((row) => (sku === undefined ? true : row.sku === sku))
    .filter((row) => !lowOnly || row.available <= 3)
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const movementRows =
    sku === undefined
      ? await db.query<{ sku: string; reason: string; ref: string; at: Date; quantity: number }>(
          `SELECT v.sku, m.reason, m.ref, m.at,
                  (SELECT max(quantity) FROM stock_entries e WHERE e.movement_id = m.id) AS quantity
           FROM stock_movements m JOIN variants v ON v.id = m.variant_id
           ORDER BY m.at DESC LIMIT 50`
        )
      : await db.query<{ sku: string; reason: string; ref: string; at: Date; quantity: number }>(
          `SELECT v.sku, m.reason, m.ref, m.at,
                  (SELECT max(quantity) FROM stock_entries e WHERE e.movement_id = m.id) AS quantity
           FROM stock_movements m JOIN variants v ON v.id = m.variant_id
           WHERE v.sku = $1 ORDER BY m.at DESC LIMIT 100`,
          [sku]
        );

  const body = `
<div class="field-row">
  <input id="low-stock-only" type="checkbox" data-low-stock ${lowOnly ? 'checked' : ''}>
  <label for="low-stock-only">Low stock only</label>
</div>
<table aria-label="Stock" class="flat-table">
  <caption class="visually-hidden">Stock</caption>
  <thead><tr><th scope="col">SKU</th><th scope="col">Product</th><th scope="col">Bhiwandi</th>
  <th scope="col">Gurugram</th><th scope="col">Available</th><th scope="col">Badge</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (row) => `<tr><td><a href="/admin/inventory/${attr(row.sku)}">${escapeHtml(row.sku)}</a></td>
      <td>${escapeHtml(row.product)}</td>
      <td>${row.locations.find((entry) => entry.location === 'bhiwandi')?.available ?? 0}</td>
      <td>${row.locations.find((entry) => entry.location === 'gurugram')?.available ?? 0}</td>
      <td>${row.available}</td><td>${escapeHtml(stockBadge(row.available))}</td></tr>`
      )
      .join('')}
  </tbody>
</table>
<table aria-label="Stock movements" class="flat-table">
  <caption class="visually-hidden">Stock movements</caption>
  <thead><tr><th scope="col">SKU</th><th scope="col">Reason</th><th scope="col">Reference</th>
  <th scope="col">Quantity</th><th scope="col">When</th></tr></thead>
  <tbody>
    ${movementRows
      .map(
        (row) => `<tr><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.reason)}</td>
      <td>${escapeHtml(row.ref)}</td><td>${escapeHtml(String(row.quantity))}</td>
      <td>${escapeHtml(formatDateTimeIst(row.at))}</td></tr>`
      )
      .join('')}
  </tbody>
</table>`;
  return adminShell(shell, sku === undefined ? 'Inventory' : `Inventory ${sku}`, body, 'inventory');
}

export async function adminOrders(ctx: Ctx, shell: Shell): Promise<string> {
  const search = ctx.query.get('q') ?? '';
  const status = ctx.query.get('status') ?? '';
  const rows = await db.query<{
    number: string;
    status: string;
    payment_status: string;
    placed_at: Date;
    email: string;
    totals: { total: number };
  }>(
    `SELECT number, status, payment_status, placed_at, email, totals FROM orders
     WHERE ($1 = '' OR number ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2 = '' OR status = $2)
     ORDER BY placed_at DESC LIMIT 200`,
    [search, status]
  );
  const options: Array<[string, string]> = [
    ['', 'All statuses'],
    ['placed', 'Placed'],
    ['packed', 'Packed'],
    ['partially_shipped', 'Partially shipped'],
    ['shipped', 'Shipped'],
    ['out_for_delivery', 'Out for delivery'],
    ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled']
  ];
  const body = `
<label class="visually-hidden" for="order-search">Search orders</label>
<input id="order-search" type="search" aria-label="Search orders" value="${attr(search)}" data-order-search>
<label class="visually-hidden" for="order-status">Status</label>
<select id="order-status" aria-label="Status" data-order-status-filter>
  ${options
    .map(
      ([value, label]) =>
        `<option value="${attr(value)}" ${value === status ? 'selected' : ''}>${escapeHtml(label)}</option>`
    )
    .join('')}
</select>
<table aria-label="Orders" class="flat-table">
  <caption class="visually-hidden">Orders</caption>
  <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th>
  <th scope="col">Payment</th><th scope="col">Total</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (row) => `<tr><td><a href="/admin/orders/${attr(row.number)}">${escapeHtml(row.number)}</a></td>
      <td>${escapeHtml(row.email)}</td><td>${escapeHtml(ORDER_STATUS_WORDS[row.status])}</td>
      <td>${escapeHtml(row.payment_status)}</td><td>${escapeHtml(rupees(row.totals.total))}</td></tr>`
      )
      .join('')}
  </tbody>
</table>
${rows.length === 0 ? '<p>No orders yet.</p>' : ''}`;
  return adminShell(shell, 'Orders', body, 'orders');
}

export async function adminOrder(ctx: Ctx, shell: Shell, number: string): Promise<string | null> {
  const order = await loadOrder(db, number);
  if (order === null) return null;
  const lines = await loadOrderLines(db, number);
  const payload = await orderPayload(db, order, new Date());
  const isOperations = shell.user?.role === 'operations';

  const body = `
<p>Order ${escapeHtml(order.number)} — ${escapeHtml(ORDER_STATUS_WORDS[order.status])}</p>
<p data-order-version="${order.version}">Version ${order.version}</p>
${lines
  .map(
    (line) => `
<div role="group" aria-label="${attr(line.sku)}" class="admin-line">
  <input id="ship-${attr(line.sku)}" type="checkbox" data-ship-line="${attr(line.id)}"
         ${line.fulfillment === 'packed' ? '' : 'disabled'}>
  <label for="ship-${attr(line.sku)}">Ship ${escapeHtml(line.sku)}</label>
  <span>${escapeHtml(line.fulfillment)}</span>
</div>`
  )
  .join('')}
${
  isOperations
    ? `
<label for="carrier">Carrier</label>
<select id="carrier" aria-label="Carrier" data-carrier aria-describedby="carrier-error">
  <option value="">Choose a carrier</option>
  ${CARRIERS.map((carrier) => `<option value="${attr(carrier)}">${escapeHtml(carrier)}</option>`).join('')}
</select>
<p class="field-error" id="carrier-error" data-error-for="carrier"></p>
<label for="tracking-number">Tracking number</label>
<input id="tracking-number" type="text" aria-label="Tracking number" data-tracking
       aria-describedby="tracking-error">
<p class="field-error" id="tracking-error" data-error-for="tracking_number"></p>
<button type="button" data-create-shipment>Create shipment</button>
${order.status === 'placed' ? '<button type="button" data-order-status="packed">Mark packed</button>' : ''}
${order.status === 'shipped' ? '<button type="button" data-order-status="out_for_delivery">Mark out for delivery</button>' : ''}
${order.status === 'out_for_delivery' ? '<button type="button" data-order-status="delivered">Mark delivered</button>' : ''}
${order.status === 'placed' || order.status === 'packed' ? '<button type="button" data-order-status="cancelled">Cancel order</button>' : ''}`
    : ''
}
<script type="application/json" id="admin-order-data">${JSON.stringify(payload)}</script>`;
  return adminShell(shell, `Order ${order.number}`, body, 'order');
}

type QueueKind = 'returns' | 'trials' | 'warranty';

const QUEUE_META: Record<QueueKind, { title: string; table: string; label: string; words: Record<string, string> }> = {
  returns: { title: 'Returns', table: 'returns', label: 'Returns queue', words: RETURN_STATUS_WORDS },
  trials: { title: 'Trials', table: 'trials', label: 'Trials queue', words: TRIAL_STATUS_WORDS },
  warranty: { title: 'Warranty', table: 'warranty_claims', label: 'Warranty queue', words: CLAIM_STATUS_WORDS }
};

export async function adminQueue(ctx: Ctx, shell: Shell, kind: QueueKind): Promise<string> {
  const meta = QUEUE_META[kind];
  const rows = await db.query<{ number: string; status: string; created_at: Date }>(
    `SELECT number, status, created_at FROM ${meta.table} ORDER BY created_at DESC LIMIT 200`
  );
  const body = `
<table aria-label="${attr(meta.label)}" class="flat-table">
  <caption class="visually-hidden">${escapeHtml(meta.label)}</caption>
  <thead><tr><th scope="col">Case</th><th scope="col">Status</th><th scope="col">Opened</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (row) => `<tr aria-label="${attr(row.number)}"><td><a href="/admin/${attr(kind)}/${attr(
          row.number
        )}">${escapeHtml(row.number)}</a></td><td>${escapeHtml(
          meta.words[row.status] ?? row.status
        )}</td><td>${escapeHtml(formatDateTimeIst(row.created_at))}</td></tr>`
      )
      .join('')}
  </tbody>
</table>
${rows.length === 0 ? '<p>Nothing waiting.</p>' : ''}`;
  return adminShell(shell, meta.title, body, kind);
}

const TRANSITION_LABELS: Record<string, string> = {
  approved: 'Approve',
  rejected: 'Reject',
  in_transit: 'Mark in transit',
  received: 'Mark received',
  inspected: 'Mark inspected',
  refunded: 'Issue refund',
  exchanged: 'Complete exchange',
  returned: 'Mark returned',
  under_review: 'Start review',
  repair: 'Book repair',
  replacement: 'Send replacement',
  resolved: 'Mark resolved'
};

export async function adminCase(
  ctx: Ctx,
  shell: Shell,
  kind: QueueKind,
  number: string
): Promise<string | null> {
  const meta = QUEUE_META[kind];
  const row = await db.one<Record<string, unknown>>(`SELECT * FROM ${meta.table} WHERE number = $1`, [number]);
  if (row === null) return null;
  const status = String(row.status);
  const transitions =
    kind === 'returns'
      ? RETURN_TRANSITIONS[status] ?? []
      : kind === 'trials'
        ? TRIAL_TRANSITIONS[status] ?? []
        : CLAIM_TRANSITIONS[status] ?? [];

  const evidence =
    kind === 'warranty'
      ? await db.query<{ id: string; kind: string; filename: string }>(
          'SELECT id, kind, filename FROM evidence WHERE claim_number = $1 ORDER BY stored_at ASC',
          [number]
        )
      : [];

  const body = `
<p data-case-number="${attr(number)}" data-case-version="${attr(String(row.version))}">${escapeHtml(
    number
  )} — ${escapeHtml(meta.words[status] ?? status)}</p>
${
  kind === 'warranty'
    ? `<p>${escapeHtml(String(row.component ?? ''))}</p><p>${escapeHtml(String(row.description ?? ''))}</p>`
    : ''
}
${evidence
  .map((item) =>
    item.kind === 'photo'
      ? `<img src="/api/admin/warranty/evidence/${attr(item.id)}/content" alt="Evidence ${attr(item.filename)}">`
      : `<a href="/api/admin/warranty/evidence/${attr(item.id)}/content">Receipt ${escapeHtml(item.filename)}</a>`
  )
  .join('')}
<div class="case-actions">
  ${transitions
    .map(
      (to) =>
        `<button type="button" data-transition="${attr(to)}">${escapeHtml(TRANSITION_LABELS[to] ?? to)}</button>`
    )
    .join('')}
  ${
    transitions.includes('rejected')
      ? `<label for="reject-reason">Reason</label>
         <input id="reject-reason" type="text" aria-label="Reason" data-reject-reason
                aria-describedby="reject-reason-error">
         <p class="field-error" id="reject-reason-error" data-error-for="reason"></p>`
      : ''
  }
</div>`;
  return adminShell(shell, `${meta.title} ${number}`, body, `${kind}-case`);
}

export async function adminPromotions(ctx: Ctx, shell: Shell): Promise<string> {
  const rows = await db.query<{
    code: string;
    kind: string;
    value: number;
    collection: string | null;
    minimum: number;
    used: number;
    usage_limit: number | null;
  }>('SELECT code, kind, value, collection, minimum, used, usage_limit FROM discount_codes ORDER BY code ASC');
  const body = `
<form data-promotion-form novalidate>
  <label for="promo-code">Code</label>
  <input id="promo-code" type="text" aria-label="Code" data-promo-code aria-describedby="promo-code-error">
  <p class="field-error" id="promo-code-error" data-error-for="code"></p>
  <div role="radiogroup" aria-label="Kind" data-promo-kind>
    <button type="button" role="radio" aria-label="Percentage" aria-checked="true" tabindex="0"
            data-kind="percent">Percentage</button>
    <button type="button" role="radio" aria-label="Fixed amount" aria-checked="false" tabindex="-1"
            data-kind="fixed">Fixed amount</button>
  </div>
  <label for="promo-value">Value</label>
  <input id="promo-value" type="text" aria-label="Value" data-promo-value aria-describedby="promo-value-error">
  <p class="field-error" id="promo-value-error" data-error-for="value"></p>
  <label for="promo-collection">Applies to</label>
  <select id="promo-collection" aria-label="Applies to" data-promo-collection>
    <option value="">Every line</option>
    ${COLLECTIONS.filter((collection) => collection.slug !== 'all')
      .map(
        (collection) =>
          `<option value="${attr(collection.slug)}">${escapeHtml(
            collection.slug === 'luggage'
              ? 'Luggage'
              : collection.slug === 'backpacks'
                ? 'Backpacks'
                : collection.slug === 'totes'
                  ? 'Totes'
                  : collection.slug === 'wallets'
                    ? 'Wallets'
                    : 'Accessories'
          )}</option>`
      )
      .join('')}
  </select>
  <label for="promo-minimum">Minimum spend</label>
  <input id="promo-minimum" type="text" aria-label="Minimum spend" value="0" data-promo-minimum
         aria-describedby="promo-minimum-error">
  <p class="field-error" id="promo-minimum-error" data-error-for="minimum"></p>
  <label for="promo-starts">Starts</label>
  <input id="promo-starts" type="text" aria-label="Starts" data-promo-starts aria-describedby="promo-starts-error">
  <p class="field-error" id="promo-starts-error" data-error-for="starts_at"></p>
  <label for="promo-ends">Ends</label>
  <input id="promo-ends" type="text" aria-label="Ends" data-promo-ends aria-describedby="promo-ends-error">
  <p class="field-error" id="promo-ends-error" data-error-for="ends_at"></p>
  <label for="promo-limit">Usage limit</label>
  <input id="promo-limit" type="text" aria-label="Usage limit" data-promo-limit aria-describedby="promo-limit-error">
  <p class="field-error" id="promo-limit-error" data-error-for="usage_limit"></p>
  <button type="submit">Create code</button>
</form>
<table aria-label="Discount codes" class="flat-table">
  <caption class="visually-hidden">Discount codes</caption>
  <thead><tr><th scope="col">Code</th><th scope="col">Kind</th><th scope="col">Value</th>
  <th scope="col">Applies to</th><th scope="col">Used</th></tr></thead>
  <tbody data-codes-body>
    ${rows
      .map(
        (row) => `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.kind)}</td>
      <td>${escapeHtml(String(row.value))}</td><td>${escapeHtml(row.collection ?? 'Every line')}</td>
      <td>${escapeHtml(String(row.used))}</td></tr>`
      )
      .join('')}
  </tbody>
</table>`;
  return adminShell(shell, 'Promotions', body, 'promotions');
}

export function adminGiftCards(ctx: Ctx, shell: Shell): string {
  const body = `
<label for="gift-card-code">Gift card code</label>
<input id="gift-card-code" type="text" aria-label="Gift card code" data-gift-code>
<button type="button" data-gift-lookup>Look up</button>
<table aria-label="Gift card ledger" class="flat-table">
  <caption class="visually-hidden">Gift card ledger</caption>
  <thead><tr><th scope="col">Group</th><th scope="col">Account</th><th scope="col">Amount</th>
  <th scope="col">Reason</th><th scope="col">When</th></tr></thead>
  <tbody data-gift-ledger></tbody>
</table>`;
  return adminShell(shell, 'Gift cards', body, 'gift-cards');
}

export async function adminAudit(ctx: Ctx, shell: Shell): Promise<string> {
  const rows = await db.query<{
    id: string;
    actor_name: string;
    action: string;
    entity: string;
    entity_id: string;
    at: Date;
  }>('SELECT id, actor_name, action, entity, entity_id, at FROM audit_entries ORDER BY id DESC LIMIT 200');
  const body = `
<table aria-label="Audit log" class="flat-table">
  <caption class="visually-hidden">Audit log</caption>
  <thead><tr><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th>
  <th scope="col">Record</th><th scope="col">When</th></tr></thead>
  <tbody>
    ${rows
      .map(
        (row) => `<tr><td>${escapeHtml(row.actor_name)}</td><td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.entity)}</td><td>${escapeHtml(row.entity_id)}</td>
      <td>${escapeHtml(formatDateTimeIst(row.at))}</td></tr>`
      )
      .join('')}
  </tbody>
</table>`;
  return adminShell(shell, 'Audit log', body, 'audit');
}

export function adminReports(ctx: Ctx, shell: Shell): string {
  const to = isoDateIst(new Date());
  const from = isoDateIst(new Date(Date.now() - 29 * 86400000));
  const body = `
<a href="/api/admin/reports/orders.csv?from=${attr(from)}&to=${attr(to)}">Download orders CSV</a>
<a href="/api/admin/reports/inventory.csv">Download inventory CSV</a>`;
  return adminShell(shell, 'Reports', body, 'reports');
}
