import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api, ApiFailure } from '../lib/api.js';
import { navigate, usePath } from '../lib/router.js';
import { store, useStore, onLiveEvent } from '../lib/store.js';
import { announce, LoadingPanel, signOut } from '../app.js';
import { rupees, dateTimeText } from '../lib/format.js';

const OPS_LINKS = ['Dashboard', 'Products', 'Inventory', 'Orders', 'Promotions', 'Gift cards', 'Audit log', 'Reports'];
const SUPPORT_LINKS = ['Orders', 'Returns', 'Trials', 'Warranty', 'Audit log'];

export function Admin(props: { path: string; search: string }): JSX.Element {
  useStore();
  const user = store.user;

  if (user === null || (user.role !== 'operations' && user.role !== 'support')) {
    return (
      <section class="panel staff-refusal">
        <h1>This area is for Roam House staff.</h1>
      </section>
    );
  }

  const links = user.role === 'operations' ? OPS_LINKS : SUPPORT_LINKS;
  const parts = props.path.split('/').filter(Boolean); // ['admin', ...]
  const page = parts[1] ?? 'dashboard';

  return (
    <div class="admin-page">
      <div class="admin-layout">
        <aside class="left-zone">
          <nav aria-label="Staff" class="staff-nav">
            {links.map((link) => {
              const slug = link.toLowerCase().replace(' ', '-');
              return (
                <a key={link} href={`/admin/${slug}`} aria-current={page === slug ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); navigate(`/admin/${slug}`); }}>{link}</a>
              );
            })}
          </nav>
          <button class="secondary" onClick={() => { void signOut(); }}>Sign out</button>
        </aside>
        <div class="admin-main">
          {page === 'dashboard' || page === '' ? <Dashboard /> : null}
          {page === 'products' ? <Products sub={parts[2]} /> : null}
          {page === 'inventory' ? <Inventory sub={parts[2]} /> : null}
          {page === 'orders' ? <StaffOrders number={parts[2]} /> : null}
          {page === 'returns' || page === 'trials' || page === 'warranty' ? <Queue kind={page} number={parts[2]} /> : null}
          {page === 'promotions' ? <Promotions /> : null}
          {page === 'gift-cards' ? <GiftCards /> : null}
          {page === 'audit-log' ? <AuditLog /> : null}
          {page === 'reports' ? <Reports /> : null}
        </div>
      </div>
    </div>
  );
}

function StaffStatus(): JSX.Element {
  return <span class="visually-hidden" id="staff-updates-live" role="status" aria-live="polite" />;
}

type MetricsBody = { orders: number; gross_sales: number; refunds: number; net_sales: number; units_sold: number; average_order_value: number };
type InventoryRow = { sku: string; product: string; colour: string; size: string; locations: { location: string; available: number; reserved: number; committed: number; on_hand: number }[]; available: number; on_hand: number };
type Movement = { movement_id: number; reason: string; ref: string; at: string; entries: { account: string; location: string; quantity: number }[] };
type OrderRow = { number: string; status: string; placed_at: string; total: number; customer: { email: string } };
type QueueRow = { number: string; status: string; customer?: { email: string } };
type CodeRow = { code: string; kind: string; value: number; collection: string | null; minimum: number; used: number; usage_limit: number | null };
type LedgerBody = { code: string; balance: number; entries: { group_id: number; account: string; amount: number; reason: string; ref: string; at: string }[] };
type AuditRow = { id: number; actor: { name: string; role: string }; action: string; entity: string; entity_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string };

function Dashboard(): JSX.Element {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [figures, setFigures] = useState<{ orders: number; gross_sales: number; refunds: number; net_sales: number; units_sold: number; average_order_value: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setError(null);
    try {
      setFigures(await api.get<MetricsBody>(`/api/admin/metrics?from=${from}&to=${to}`));
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.body.fields?.from ?? err.body.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h1>Dashboard</h1>
      <form onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <label><span>From</span><input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
        <label><span>To</span><input type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} /></label>
        <button class="primary">Apply</button>
      </form>
      {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
      {figures !== null ? (
        <div role="region" aria-label="Figures" class="figures">
          <p>Orders: {figures.orders}</p>
          <p>Gross sales: {rupees(figures.gross_sales)}</p>
          <p>Refunds: {rupees(figures.refunds)}</p>
          <p>Net sales: {rupees(figures.net_sales)}</p>
          <p>Units sold: {figures.units_sold}</p>
          <p>Average order: {rupees(figures.average_order_value)}</p>
        </div>
      ) : null}
    </section>
  );
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type AdminProduct = {
  slug: string; name: string; category: string; material: string; status: string; version: number;
  variants: {
    sku: string; colour: string; colour_slug: string; size: string; price: number; compare_at: number | null; version: number;
    available: number; badge: string;
    stock: { location: string; available: number; reserved: number; committed: number; on_hand: number }[];
  }[];
  images: { id: string; colour: string; colour_slug: string; alt: string; position: number }[];
};

function Products(props: { sub?: string }): JSX.Element {
  if (props.sub !== undefined) return <ProductEdit slug={props.sub} />;
  const [list, setList] = useState<{ slug: string; name: string; category: string; status: string; version: number }[] | null>(null);
  useEffect(() => {
    void api.get<{ slug: string; name: string; category: string; status: string; version: number }[]>('/api/admin/products').then(setList).catch(() => setList([]));
  }, []);
  if (list === null) return <LoadingPanel />;
  return (
    <section>
      <h1>Products</h1>
      <table class="staff-table">
        <thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Status</th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.slug}>
              <td><a href={`/admin/products/${p.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/products/${p.slug}`); }}>{p.name}</a></td>
              <td>{p.category}</td>
              <td><span class={`status-block ${p.status}`} aria-hidden="true" /><span>{p.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProductEdit(props: { slug: string }): JSX.Element {
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [savingSku, setSavingSku] = useState<string | null>(null);

  useEffect(() => {
    void api.get<AdminProduct>(`/api/admin/products/${props.slug}`).then(setProduct).catch(() => setError("We couldn't find that."));
  }, [props.slug]);

  const saveVariant = async (sku: string, fields: { price?: number; compare_at?: number | null; stock?: { location: string; available: number }[] }): Promise<void> => {
    setSavingSku(sku);
    setError(null);
    setStale(false);
    try {
      const variant = product?.variants.find((v) => v.sku === sku);
      if (variant === undefined) return;
      const fresh = await api.patch(`/api/admin/variants/${sku}`, { version: variant.version, ...fields });
      announce('staff-updates', `Saved ${sku}.`);
      void fresh;
      const refreshed = await api.get<AdminProduct>(`/api/admin/products/${props.slug}`);
      setProduct(refreshed);
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.body.error === 'stale_version') { setStale(true); announce('staff-updates', err.body.message); }
        else setError(err.body.message);
      }
    } finally {
      setSavingSku(null);
    }
  };

  const saveStatus = async (status: string): Promise<void> => {
    if (product === null) return;
    setStale(false);
    try {
      await api.patch(`/api/admin/products/${props.slug}`, { version: product.version, status });
      announce('staff-updates', `Saved ${props.slug}.`);
      setProduct(await api.get<AdminProduct>(`/api/admin/products/${props.slug}`));
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.body.error === 'stale_version') setStale(true);
        else setError(err.body.message);
      }
    }
  };

  if (product === null) return error !== null ? <p role="alert">{error}</p> : <LoadingPanel />;

  return (
    <section>
      <h1>{product.name}</h1>
      {stale ? (
        <div role="alert" class="alert-panel">
          <p>This record changed since you opened it. Reload to see the latest version.</p>
          <button onClick={() => { void api.get<AdminProduct>(`/api/admin/products/${props.slug}`).then((fresh) => { setProduct(fresh); setStale(false); }); }}>Reload latest</button>
        </div>
      ) : null}
      <form onSubmit={(e) => { e.preventDefault(); void saveStatus((e.currentTarget as unknown as { status: { value: string } }).status.value); }}>
        <label>
          <span>Product status</span>
          <select aria-label="Product status" name="status">
            <option value="draft">Draft</option>
            <option value="published" selected={product.status === 'published'}>Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <button class="primary">Save status</button>
      </form>
      <table class="staff-table variants-table">
        <caption>Variants</caption>
        <thead><tr><th scope="col">SKU</th><th scope="col">Price</th><th scope="col">Compare-at</th><th scope="col">Bhiwandi</th><th scope="col">Gurugram</th></tr></thead>
        <tbody>
          {product.variants.map((v) => (
            <tr key={v.sku}>
              <td>
                <div role="group" aria-label={v.sku}>
                  <p>{v.sku}</p>
                  <p class="muted">{v.colour}, {v.size} — {v.badge}</p>
                  <VariantForm variant={v} saving={savingSku === v.sku} onSave={saveVariant} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <UploadImage slug={props.slug} colours={product.variants.map((v) => ({ name: v.colour, slug: v.colour_slug }))} />
    </section>
  );
}

function VariantForm(props: {
  variant: AdminProduct['variants'][0];
  saving: boolean;
  onSave: (sku: string, fields: { price?: number; compare_at?: number | null; stock?: { location: string; available: number }[] }) => Promise<void>;
}): JSX.Element {
  const v = props.variant;
  const [price, setPrice] = useState(String(v.price));
  const [compareAt, setCompareAt] = useState(v.compare_at === null ? '' : String(v.compare_at));
  const [bhiwandi, setBhiwandi] = useState(String(v.stock.find((s) => s.location === 'bhiwandi')?.available ?? 0));
  const [gurugram, setGurugram] = useState(String(v.stock.find((s) => s.location === 'gurugram')?.available ?? 0));

  return (
    <div class="variant-form">
      <label><span>Price</span><input aria-label="Price" value={price} onInput={(e) => setPrice((e.target as HTMLInputElement).value)} /></label>
      <label><span>Compare-at price</span><input aria-label="Compare-at price" value={compareAt} onInput={(e) => setCompareAt((e.target as HTMLInputElement).value)} /></label>
      <label><span>Available at Bhiwandi</span><input role="spinbutton" aria-label="Available at Bhiwandi" type="number" value={bhiwandi} onInput={(e) => setBhiwandi((e.target as HTMLInputElement).value)} /></label>
      <label><span>Available at Gurugram</span><input role="spinbutton" aria-label="Available at Gurugram" type="number" value={gurugram} onInput={(e) => setGurugram((e.target as HTMLInputElement).value)} /></label>
      <button class="primary" disabled={props.saving} onClick={() => {
        void props.onSave(v.sku, {
          price: Number(price),
          compare_at: compareAt === '' ? null : Number(compareAt),
          stock: [{ location: 'bhiwandi', available: Number(bhiwandi) }, { location: 'gurugram', available: Number(gurugram) }],
        });
      }}>{props.saving ? 'Saving' : `Save ${v.sku}`}</button>
    </div>
  );
}

function UploadImage(props: { slug: string; colours: { name: string; slug: string }[] }): JSX.Element {
  const [alt, setAlt] = useState('');
  const [colour, setColour] = useState(props.colours[0]?.name ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const idemKey = useState(() => randomKey())[0];

  const uploadFile = async (file: File): Promise<void> => {
    setFailed(null);
    setStatus('Saving');
    const form = new FormData();
    form.append('colour', colour);
    form.append('alt', alt);
    form.append('file', file);
    const res = await fetch(`/api/admin/products/${props.slug}/images`, {
      method: 'POST', body: form, credentials: 'same-origin',
      headers: { 'Idempotency-Key': idemKey },
    });
    const body = await res.json();
    if (!res.ok) {
      setFailed(body.message);
      setRetry(true);
      setStatus(null);
      return;
    }
    setStatus(`Image added to ${props.slug} in ${colour}.`);
    announce('staff-updates', `Image added to ${props.slug} in ${colour}.`);
    setRetry(false);
  };

  return (
    <div class="upload-image">
      <h2>Upload image</h2>
      <label><span>Alt text</span><input value={alt} onInput={(e) => setAlt((e.target as HTMLInputElement).value)} /></label>
      <label>
        <span>Image colour</span>
        <select aria-label="Image colour" value={colour} onChange={(e) => setColour((e.target as HTMLSelectElement).value)}>
          {props.colours.map((c) => <option key={c.slug} value={c.name}>{c.name}</option>)}
        </select>
      </label>
      <label class="file-button">
        <span>Upload image</span>
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Product image" onChange={(e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file !== undefined) void uploadFile(file);
        }} />
      </label>
      {status !== null ? <p>{status}</p> : null}
      {failed !== null ? (
        <div role="alert" class="alert-panel">
          <p>{failed}</p>
          {retry ? <button onClick={() => { const input = document.querySelector<HTMLInputElement>('[aria-label="Product image"]'); const file = input?.files?.[0]; if (file !== undefined) void uploadFile(file); }}>Try again</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Inventory(props: { sub?: string }): JSX.Element {
  const [rows, setRows] = useState<{ sku: string; product: string; colour: string; size: string; locations: { location: string; available: number; reserved: number; committed: number; on_hand: number }[]; available: number; on_hand: number }[] | null>(null);
  const [lowOnly, setLowOnly] = useState(new URLSearchParams(location.search).get('low_stock') === 'true');
  const [movements, setMovements] = useState<{ movement_id: number; reason: string; ref: string; at: string; entries: { account: string; location: string; quantity: number }[] }[] | null>(null);

  const load = async (low: boolean): Promise<void> => {
    setRows(await api.get<InventoryRow[]>(`/api/admin/inventory${low ? '?low_stock=true' : ''}`));
  };

  useEffect(() => {
    void load(lowOnly);
    navigate(`/admin/inventory${lowOnly ? '?low_stock=true' : ''}`, true);
  }, [lowOnly]);

  useEffect(() => {
    if (props.sub === undefined) return;
    void api.get<Movement[]>(`/api/admin/inventory/${props.sub}/movements`).then(setMovements).catch(() => setMovements([]));
  }, [props.sub]);

  if (rows === null) return <LoadingPanel />;

  return (
    <section>
      <h1>Inventory</h1>
      <label class="checkbox-row">
        <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly((e.target as HTMLInputElement).checked)} />
        <span>Low stock only</span>
      </label>
      <table aria-label="Stock" class="staff-table">
        <thead><tr><th scope="col">SKU</th><th scope="col">Product</th><th scope="col">Available</th><th scope="col">On hand</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sku}>
              <td><a href={`/admin/inventory/${r.sku}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/inventory/${r.sku}`); }}>{r.sku}</a></td>
              <td>{r.product} — {r.colour}, {r.size}</td>
              <td>{r.available}</td>
              <td>{r.on_hand}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {movements !== null ? (
        <table aria-label="Stock movements" class="staff-table">
          <thead><tr><th scope="col">Movement</th><th scope="col">Reason</th><th scope="col">Entries</th></tr></thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.movement_id}>
                <td>#{m.movement_id}</td>
                <td>{m.reason}</td>
                <td>{m.entries.map((e) => `${e.account}/${e.location}: ${e.quantity}`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

const ORDER_STATUSES = ['placed', 'packed', 'partially_shipped', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];

function StaffOrders(props: { number?: string }): JSX.Element {
  if (props.number !== undefined) return <StaffOrder number={props.number} />;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<{ number: string; status: string; placed_at: string; total: number; customer: { email: string } }[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q !== '') params.set('q', q);
    if (status !== '') params.set('status', status);
    void api.get<OrderRow[]>(`/api/admin/orders${params.toString() === '' ? '' : `?${params.toString()}`}`).then(setRows).catch(() => setRows([]));
  }, [q, status]);

  return (
    <section>
      <h1>Orders</h1>
      <search>
        <input type="search" aria-label="Search orders" placeholder="Search orders" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </search>
      <label>
        <span>Status</span>
        <select aria-label="Status" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {rows === null ? <LoadingPanel /> : (
        <table aria-label="Orders" class="staff-table">
          <thead><tr><th scope="col">Number</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number}>
                <td><a href={`/admin/orders/${r.number}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/orders/${r.number}`); }}>{r.number}</a></td>
                <td>{r.customer.email}</td>
                <td>{r.status}</td>
                <td>{rupees(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type StaffOrderBody = {
  number: string; status: string; version: number; email: string;
  lines: { id: number; sku: string; product: string; colour: string; size: string; quantity: number; fulfillment: string; shipment: { carrier: string; tracking_number: string } | null }[];
  timeline: { status: string; label: string; at: string }[];
  payment: { status: string };
  customer: { name: string; email: string };
};

function StaffOrder(props: { number: string }): JSX.Element {
  const [body, setBody] = useState<StaffOrderBody | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shipLines, setShipLines] = useState<number[]>([]);
  const [carrier, setCarrier] = useState('Coastline Couriers');
  const [tracking, setTracking] = useState('');

  const load = async (): Promise<void> => {
    try {
      setBody(await api.get<StaffOrderBody>(`/api/admin/orders/${props.number}`));
    } catch { /* the order may be gone */ }
  };

  useEffect(() => {
    void load();
  }, [props.number]);

  // Live updates land without a reload.
  useEffect(() => onLiveEvent((type, data) => {
    if (type === 'order' && data.number === props.number) void load();
  }), [props.number]);

  if (body === null) return <LoadingPanel />;

  const canPack = body.status === 'placed';
  const canShip = body.status === 'packed' || body.status === 'partially_shipped';
  const canMove = body.status === 'packed' || body.status === 'partially_shipped' || body.status === 'shipped';
  const canCancel = body.status === 'placed' || body.status === 'packed';

  const move = async (status: string): Promise<void> => {
    setBusy(true);
    setStale(false);
    try {
      await api.post(`/api/admin/orders/${props.number}/status`, { version: body.version, status });
      announce('staff-updates', `${props.number} is now ${status}.`);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure && err.body.error === 'stale_version') setStale(true);
    } finally {
      setBusy(false);
    }
  };

  const ship = async (): Promise<void> => {
    setBusy(true);
    setStale(false);
    try {
      await api.post(`/api/admin/orders/${props.number}/shipments`, {
        version: body.version, line_ids: shipLines, carrier, tracking_number: tracking,
      });
      announce('staff-updates', `${props.number} is now shipped.`);
      await load();
      setShipLines([]);
      setTracking('');
    } catch (err) {
      if (err instanceof ApiFailure && err.body.error === 'stale_version') setStale(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>{props.number}</h1>
      {stale ? (
        <div role="alert" class="alert-panel">
          <p>This record changed since you opened it. Reload to see the latest version.</p>
          <button onClick={() => { void load(); setStale(false); }}>Reload latest</button>
        </div>
      ) : null}
      <p>Customer: {body.customer.email}</p>
      <ol class="timeline">
        {body.timeline.map((t) => <li key={`${t.status}-${t.at}`}>{t.label} — {dateTimeText(t.at)}</li>)}
      </ol>
      <table class="staff-table">
        <thead><tr><th scope="col">Line</th><th scope="col">Fulfilment</th><th scope="col">Ship</th></tr></thead>
        <tbody>
          {body.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.sku} — {line.product} × {line.quantity}</td>
              <td>{line.fulfillment}{line.shipment !== null ? ` (${line.shipment.carrier} ${line.shipment.tracking_number})` : ''}</td>
              <td>
                {line.fulfillment === 'packed' || line.fulfillment === 'unfulfilled' ? (
                  <label>
                    <input type="checkbox" aria-label={`Ship ${line.sku}`} checked={shipLines.includes(line.id)}
                      onChange={(e) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        setShipLines((current) => checked ? [...current, line.id] : current.filter((id) => id !== line.id));
                      }} />
                  </label>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canShip ? (
        <div class="ship-form">
          <label>
            <span>Carrier</span>
            <select aria-label="Carrier" value={carrier} onChange={(e) => setCarrier((e.target as HTMLSelectElement).value)}>
              <option value="Coastline Couriers">Coastline Couriers</option>
              <option value="Peak Express">Peak Express</option>
            </select>
          </label>
          <label><span>Tracking number</span><input aria-label="Tracking number" value={tracking} onInput={(e) => setTracking((e.target as HTMLInputElement).value)} /></label>
          <button class="primary" disabled={busy || shipLines.length === 0} onClick={() => { void ship(); }}>Create shipment</button>
        </div>
      ) : null}
      {canPack ? <button class="primary" disabled={busy} onClick={() => { void move('packed'); }}>Mark packed</button> : null}
      {canMove && body.status !== 'shipped' ? <button class="primary" disabled={busy} onClick={() => { void move('out_for_delivery'); }}>Mark out for delivery</button> : null}
      {body.status === 'shipped' || body.status === 'out_for_delivery' ? <button class="primary" disabled={busy} onClick={() => { void move('delivered'); }}>Mark delivered</button> : null}
      {canCancel ? <button class="secondary" disabled={busy} onClick={() => { void move('cancelled'); }}>Cancel order</button> : null}
    </section>
  );
}

function Queue(props: { kind: string; number?: string }): JSX.Element {
  if (props.number !== undefined) return <CaseDetail kind={props.kind} number={props.number} />;
  const [rows, setRows] = useState<{ number: string; status: string; customer?: { email: string } }[] | null>(null);

  useEffect(() => {
    void api.get<QueueRow[]>(`/api/admin/${props.kind}`).then(setRows).catch(() => setRows([]));
  }, [props.kind]);

  const label = props.kind === 'returns' ? 'Returns queue' : props.kind === 'trials' ? 'Trials queue' : 'Warranty queue';

  return (
    <section>
      <h1>{props.kind.charAt(0).toUpperCase() + props.kind.slice(1)}</h1>
      {rows === null ? <LoadingPanel /> : rows.length === 0 ? <p>Nothing waiting.</p> : (
        <table aria-label={label} class="staff-table">
          <thead><tr><th scope="col">Case</th><th scope="col">Customer</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number}>
                <td><a href={`/admin/${props.kind}/${r.number}`} onClick={(e) => { e.preventDefault(); navigate(`/admin/${props.kind}/${r.number}`); }}>{r.number}</a></td>
                <td>{r.customer?.email ?? ''}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const RETURN_MOVES: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['in_transit'],
  in_transit: ['received'],
  received: ['inspected'],
  inspected: ['refunded', 'exchanged'],
};
const TRIAL_MOVES: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['returned'],
  returned: ['refunded'],
};
const WARRANTY_MOVES: Record<string, string[]> = {
  submitted: ['under_review'],
  under_review: ['approved', 'rejected'],
  approved: ['repair', 'replacement'],
  repair: ['resolved'],
  replacement: ['resolved'],
};
const MOVE_LABELS: Record<string, string> = {
  approved: 'Approve', rejected: 'Reject', in_transit: 'Mark in transit', received: 'Mark received',
  inspected: 'Mark inspected', refunded: 'Issue refund', exchanged: 'Complete exchange',
  returned: 'Mark returned', under_review: 'Start review', repair: 'Book repair',
  replacement: 'Send replacement', resolved: 'Mark resolved',
};

function CaseDetail(props: { kind: string; number: string }): JSX.Element {
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);

  const load = async (): Promise<void> => {
    setBody(await api.get(`/api/admin/${props.kind}/${props.number}`));
  };

  useEffect(() => {
    void load();
  }, [props.number]);

  useEffect(() => onLiveEvent((type) => {
    if (type === props.kind || type === 'queue') void load();
  }), [props.number]);

  if (body === null) return <LoadingPanel />;

  const status = String(body.status);
  const version = Number(body.version);
  const moves = props.kind === 'returns' ? RETURN_MOVES : props.kind === 'trials' ? TRIAL_MOVES : WARRANTY_MOVES;
  const options = moves[status] ?? [];

  const transition = async (to: string): Promise<void> => {
    setBusy(true);
    setStale(false);
    try {
      await api.post(`/api/admin/${props.kind}/${props.number}/transition`, {
        version, to, reason: to === 'rejected' ? reason : undefined,
      });
      announce('staff-updates', `${props.number} is now ${to}.`);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure && err.body.error === 'stale_version') setStale(true);
    } finally {
      setBusy(false);
    }
  };

  const evidence = Array.isArray(body.evidence) ? body.evidence as { id: number; kind: string; filename: string }[] : [];

  return (
    <section>
      <h1>{props.number}</h1>
      {stale ? (
        <div role="alert" class="alert-panel">
          <p>This record changed since you opened it. Reload to see the latest version.</p>
          <button onClick={() => { void load(); setStale(false); }}>Reload latest</button>
        </div>
      ) : null}
      <p>Status: {status}</p>
      <ol class="timeline">
        {(body.history as { status: string; at: string }[]).map((h) => <li key={`${h.status}-${h.at}`}>{h.status} — {dateTimeText(h.at)}</li>)}
      </ol>
      {props.kind === 'warranty' ? (
        <ul>
          {evidence.map((e) => (
            <li key={e.id}>
              {e.kind === 'photo'
                ? <img src={`/api/admin/warranty/evidence/${e.id}/content`} alt={`Evidence ${e.filename}`} />
                : <a href={`/api/admin/warranty/evidence/${e.id}/content`}>Receipt {e.filename}</a>}
            </li>
          ))}
        </ul>
      ) : null}
      {options.includes('rejected') ? (
        <label><span>Reason</span><input aria-label="Reason" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} /></label>
      ) : null}
      {options.map((to) => (
        <button key={to} class="primary" disabled={busy} onClick={() => { void transition(to); }}>{busy ? 'Saving' : MOVE_LABELS[to] ?? to}</button>
      ))}
    </section>
  );
}

function Promotions(): JSX.Element {
  const [codes, setCodes] = useState<{ code: string; kind: string; value: number; collection: string | null; minimum: number; used: number; usage_limit: number | null }[] | null>(null);
  const [form, setForm] = useState({ code: '', kind: 'percent', value: '', collection: '', minimum: '0', starts_at: '2026-01-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z', usage_limit: '' });
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = async (): Promise<void> => {
    setCodes(await api.get<CodeRow[]>('/api/admin/discount-codes'));
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (): Promise<void> => {
    setFields({});
    try {
      await api.post('/api/admin/discount-codes', {
        code: form.code.toUpperCase(), kind: form.kind, value: Number(form.value),
        collection: form.collection === '' ? null : form.collection,
        minimum: Number(form.minimum),
        starts_at: form.starts_at, ends_at: form.ends_at,
        usage_limit: form.usage_limit === '' ? null : Number(form.usage_limit),
      });
      announce('staff-updates', `Code ${form.code.toUpperCase()} created.`);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.body.fields ?? {});
    }
  };

  return (
    <section>
      <h1>Promotions</h1>
      <form onSubmit={(e) => { e.preventDefault(); void create(); }} novalidate>
        <label><span>Code</span><input aria-label="Code" value={form.code} onInput={(e) => setForm({ ...form, code: (e.target as HTMLInputElement).value })} />{fields.code !== undefined ? <p class="field-error" role="alert">{fields.code}</p> : null}</label>
        <fieldset>
          <legend>Kind</legend>
          <div role="radiogroup" aria-label="Kind" class="radios">
            <label class="radio"><input type="radio" name="kind" value="percent" checked={form.kind === 'percent'} onChange={() => setForm({ ...form, kind: 'percent' })} /><span>Percentage</span></label>
            <label class="radio"><input type="radio" name="kind" value="fixed" checked={form.kind === 'fixed'} onChange={() => setForm({ ...form, kind: 'fixed' })} /><span>Fixed amount</span></label>
          </div>
        </fieldset>
        <label><span>Value</span><input aria-label="Value" value={form.value} onInput={(e) => setForm({ ...form, value: (e.target as HTMLInputElement).value })} />{fields.value !== undefined ? <p class="field-error" role="alert">{fields.value}</p> : null}</label>
        <label>
          <span>Applies to</span>
          <select aria-label="Applies to" value={form.collection} onChange={(e) => setForm({ ...form, collection: (e.target as HTMLSelectElement).value })}>
            <option value="">Every line</option>
            <option value="luggage">Luggage</option>
            <option value="backpacks">Backpacks</option>
            <option value="totes">Totes</option>
            <option value="wallets">Wallets</option>
            <option value="accessories">Accessories</option>
          </select>
        </label>
        <label><span>Minimum spend</span><input aria-label="Minimum spend" value={form.minimum} onInput={(e) => setForm({ ...form, minimum: (e.target as HTMLInputElement).value })} /></label>
        <label><span>Starts</span><input aria-label="Starts" value={form.starts_at} onInput={(e) => setForm({ ...form, starts_at: (e.target as HTMLInputElement).value })} />{fields.starts_at !== undefined ? <p class="field-error" role="alert">{fields.starts_at}</p> : null}</label>
        <label><span>Ends</span><input aria-label="Ends" value={form.ends_at} onInput={(e) => setForm({ ...form, ends_at: (e.target as HTMLInputElement).value })} />{fields.ends_at !== undefined ? <p class="field-error" role="alert">{fields.ends_at}</p> : null}</label>
        <label><span>Usage limit</span><input aria-label="Usage limit" value={form.usage_limit} onInput={(e) => setForm({ ...form, usage_limit: (e.target as HTMLInputElement).value })} /></label>
        <button class="primary">Create code</button>
      </form>
      {codes === null ? <LoadingPanel /> : (
        <table aria-label="Discount codes" class="staff-table">
          <thead><tr><th scope="col">Code</th><th scope="col">Kind</th><th scope="col">Value</th><th scope="col">Used</th></tr></thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.code}><td>{c.code}</td><td>{c.kind}</td><td>{c.value}</td><td>{c.used}{c.usage_limit !== null ? ` / ${c.usage_limit}` : ''}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function GiftCards(): JSX.Element {
  const [code, setCode] = useState('');
  const [ledger, setLedger] = useState<{ code: string; balance: number; entries: { group_id: number; account: string; amount: number; reason: string; ref: string; at: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (): Promise<void> => {
    setError(null);
    try {
      setLedger(await api.get<LedgerBody>(`/api/admin/gift-cards/${code.toUpperCase()}`));
    } catch (err) {
      if (err instanceof ApiFailure) setError(err.body.message);
    }
  };

  return (
    <section>
      <h1>Gift cards</h1>
      <form onSubmit={(e) => { e.preventDefault(); void lookup(); }}>
        <label><span>Gift card code</span><input aria-label="Gift card code" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} /></label>
        <button class="primary">Look up</button>
      </form>
      {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
      {ledger !== null ? (
        <>
          <p>Balance: {rupees(ledger.balance)}</p>
          <table aria-label="Gift card ledger" class="staff-table">
            <thead><tr><th scope="col">Group</th><th scope="col">Account</th><th scope="col">Amount</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              {ledger.entries.map((e) => (
                <tr key={`${e.group_id}-${e.account}`}><td>{e.group_id}</td><td>{e.account}</td><td>{e.amount}</td><td>{e.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}

function AuditLog(): JSX.Element {
  const [rows, setRows] = useState<{ id: number; actor: { name: string; role: string }; action: string; entity: string; entity_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string }[] | null>(null);
  useEffect(() => {
    void api.get<AuditRow[]>('/api/admin/audit').then(setRows).catch(() => setRows([]));
  }, []);
  if (rows === null) return <LoadingPanel />;
  return (
    <section>
      <h1>Audit log</h1>
      <table aria-label="Audit log" class="staff-table">
        <thead><tr><th scope="col">At</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{dateTimeText(r.at)}</td>
              <td>{r.actor.name} ({r.actor.role})</td>
              <td>{r.action}</td>
              <td>{r.entity} {r.entity_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Reports(): JSX.Element {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  return (
    <section>
      <h1>Reports</h1>
      <label><span>From</span><input type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} /></label>
      <label><span>To</span><input type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} /></label>
      <p><a href={`/api/admin/reports/orders.csv?from=${from}&to=${to}`} download>Download orders CSV</a></p>
      <p><a href="/api/admin/reports/inventory.csv" download>Download inventory CSV</a></p>
    </section>
  );
}
