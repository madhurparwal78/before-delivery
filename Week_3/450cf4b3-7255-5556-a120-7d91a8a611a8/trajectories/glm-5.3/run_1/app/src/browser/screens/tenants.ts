import { api, state, el, clear, longDateFromKey, dollars, durationText } from '../lib.js';
import { announce } from '../live.js';
import { readKitchen, buildHeader, removeHeader, startClockText } from '../header.js';
import { openPasswordDialog } from './packs.js';

// Tenants list and tenant detail for the owner, with approve and refund.

interface TenantJson {
  id: string; businessName: string; contactName: string; email: string;
  status: string; suspendedReason: string | null;
  insuranceExpiresOn: string | null; foodHandlerExpiresOn: string | null;
  createdAt: string;
  packs?: PackDetail[]; documents?: DocJson[];
}

interface PackDetail {
  id: string; hours: number; balanceMinutes: number; status: string;
  refundableCents: number; refundedCents: number | null;
}

interface DocJson {
  id: string; kind: string; expiresOn: string; coverState: string; daysLeft: number | null;
  sha256: string | null; hasFile: boolean; contentType: string | null;
  notices: Array<{ point: string; status: string; sentAt: string | null }>;
}

let zone = 'UTC';

export function renderTenants(app: HTMLElement): () => void {
  let destroyed = false;
  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    zone = kitchen.timeZone;
    removeHeader();
    buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    const stopClock = startClockText({ clockText: document.querySelector('.clock-text') as HTMLElement, menuButton: null, menuPanel: null }, zone);

    const wrap = el('div', { class: 'tenants-wrap' });
    app.append(el('h1', { class: 'screen-heading' }, 'Tenants'), wrap);
    const load = async () => {
      const r = await api('GET', '/api/tenants');
      if (destroyed || r.status !== 200 || !r.ok) return;
      const data = r.ok as { tenants: TenantJson[] };
      clear(wrap);
      const table = el('table', { 'aria-label': 'Tenants', class: 'tenants-table' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Business'), el('th', {}, 'Contact'), el('th', {}, 'Status'),
          el('th', {}, 'Insurance expires'), el('th', {}, 'Food-handler card expires'))),
      ) as HTMLTableElement;
      const body = el('tbody', {});
      for (const t of data.tenants) {
        const link = el('a', { href: `/tenants/${t.id}` }, t.businessName);
        body.appendChild(el('tr', {},
          el('td', {}, link),
          el('td', {}, t.contactName),
          el('td', {}, statusLabel(t.status)),
          el('td', {}, t.insuranceExpiresOn ?? '—'),
          el('td', {}, t.foodHandlerExpiresOn ?? '—'),
        ));
      }
      table.appendChild(body);
      wrap.appendChild(table);
    };
    await load();
    return () => {
      stopClock();
      removeHeader();
    };
  };
  let cleanupFn: (() => void) | null = null;
  void boot().then((fn) => { cleanupFn = fn ?? null; });
  return () => {
    destroyed = true;
    cleanupFn?.();
  };
}

export function renderTenantDetail(app: HTMLElement, url: URL, tenantId: string): () => void {
  const timers: number[] = [];
  let destroyed = false;
  void url;

  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    zone = kitchen.timeZone;
    removeHeader();
    buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    const stopClock = startClockText({ clockText: document.querySelector('.clock-text') as HTMLElement, menuButton: null, menuPanel: null }, zone);

    const wrap = el('div', { class: 'tenant-detail' });
    app.appendChild(wrap);
    let data: TenantJson | null = null;
    let noticeStates: Map<string, string> = new Map();

    const load = async () => {
      const r = await api('GET', `/api/tenants/${tenantId}`);
      if (destroyed || r.status !== 200 || !r.ok) {
        if (!destroyed && r.fail && r.fail.status === 404 && !data) {
          clear(wrap);
          wrap.append(el('h1', { class: 'screen-heading' }, 'Tenant'), el('p', {}, "That record isn't available."));
        }
        return;
      }
      const fresh = r.ok as TenantJson;
      data = fresh;
      draw();
    };

    const draw = () => {
      if (!data) return;
      const focused = document.activeElement as HTMLElement | null;
      const focusId = focused?.getAttribute('data-focus-id');
      clear(wrap);
      const heading = el('h1', { class: 'screen-heading', 'data-focus-id': 'heading' }, data.businessName);
      wrap.append(heading, el('p', { class: 'tenant-status' }, `Status: ${statusLabel(data.status)}`));
      if (data.status === 'documents_pending') {
        const approveBtn = el('button', { class: 'btn btn-primary', 'data-focus-id': 'approve' }, `Approve ${data.businessName}`) as HTMLButtonElement;
        approveBtn.addEventListener('click', async () => {
          approveBtn.setAttribute('aria-disabled', 'true');
          const r = await api('POST', `/api/tenants/${tenantId}/approve`);
          if (destroyed) return;
          approveBtn.removeAttribute('aria-disabled');
          if (r.status === 200) {
            announce(`${data!.businessName} approved.`);
            await load();
            heading.setAttribute('tabindex', '-1');
            heading.focus();
          } else {
            announce(r.fail?.body?.message ?? "Couldn't reach the kitchen. Nothing changed; try again.");
          }
        });
        wrap.appendChild(approveBtn);
      }

      const docsRegion = el('section', { 'aria-label': 'Documents', role: 'region', class: 'detail-docs' }, el('h2', {}, 'Documents'));
      for (const doc of data.documents ?? []) {
        const row = el('div', { class: 'doc-row' });
        row.append(el('span', {}, kindLabel(doc.kind)));
        row.append(el('span', {}, doc.expiresOn));
        row.append(el('span', {}, coverLabel(doc)));
        row.append(el('span', { class: 'mono' }, doc.sha256 ? doc.sha256.slice(0, 12) : '—'));
        if (doc.hasFile) {
          row.append(el('a', { href: `/api/documents/${doc.id}/file`, ...(doc.contentType === 'application/pdf' ? { target: '_blank' } : {}) }, 'Open'));
        }
        for (const notice of doc.notices) {
          const label = notice.point === 'seven_days' ? '7-day notice' : 'Expires-today notice';
          const stateKey = `${doc.id}:${notice.point}`;
          const line = notice.status === 'sent' && notice.sentAt
            ? `${label}: Sent ${longDateFromKey(dateKeyOf(notice.sentAt), zone)} ${timeOf(notice.sentAt)}`
            : `${label}: Queued`;
          const previous = noticeStates.get(stateKey);
          if (previous === 'queued' && notice.status === 'sent') {
            announce(`Notice sent: ${kindLabel(doc.kind)}, ${label}.`);
          }
          noticeStates.set(stateKey, notice.status);
          row.append(el('span', { class: 'notice-line' }, line));
        }
        docsRegion.appendChild(row);
      }
      wrap.appendChild(docsRegion);

      const packsRegion = el('section', { 'aria-label': 'Packs', role: 'region', class: 'detail-packs' }, el('h2', {}, 'Packs'));
      (data.packs ?? []).forEach((pack, index) => {
        const packHeading = el('h3', { class: 'pack-heading', 'data-focus-id': `pack-${pack.id}` }, `${pack.hours}-hour pack #${index + 1}`);
        const panel = el('section', { class: 'pack-panel' }, packHeading);
        panel.append(el('p', {}, `Balance: ${durationText(pack.balanceMinutes)}`));
        if (pack.status === 'refunded' && pack.refundedCents !== null) {
          panel.append(el('p', {}, `Refunded $${dollars(pack.refundedCents)}`));
        } else if (pack.status === 'active' && pack.balanceMinutes > 0) {
          panel.append(el('p', {}, `Refundable now $${dollars(pack.refundableCents)}`));
          const refundBtn = el('button', { class: 'btn btn-danger', 'data-focus-id': `refund-${pack.id}` }, `Refund ${pack.hours}-hour pack`) as HTMLButtonElement;
          refundBtn.addEventListener('click', () => void pressRefund(pack));
          panel.appendChild(refundBtn);
        }
        packsRegion.appendChild(panel);
      });
      wrap.appendChild(packsRegion);

      if (focusId) {
        const target = wrap.querySelector(`[data-focus-id="${focusId}"]`) as HTMLElement | null;
        target?.focus();
      }
    };

    const pressRefund = async (pack: PackDetail) => {
      const fresh = await api('GET', `/api/tenants/${tenantId}`);
      let expected = pack.refundableCents;
      if (fresh.status === 200 && fresh.ok) {
        const t = fresh.ok as TenantJson;
        const livePack = (t.packs ?? []).find((p) => p.id === pack.id);
        if (livePack) expected = livePack.refundableCents;
      }
      const send = async () => {
        const r = await api('POST', `/api/packs/${pack.id}/refund`, { body: { expectedCents: expected } });
        if (destroyed || r.sentUnder !== state.sessionId) return;
        if (r.status === 200) {
          const detail = r.ok as PackDetail & { refundedCents: number };
          announce(`Refunded $${dollars(detail.refundedCents ?? detail.refundedCents)} to ${data?.businessName ?? ''}.`);
          await load();
          const heading = wrap.querySelector('[data-focus-id^="pack-"]') as HTMLElement | null;
          heading?.setAttribute('tabindex', '-1');
          heading?.focus();
          return;
        }
        const fail = r.fail;
        if (fail && fail.status === 412) {
          announce(`The refundable amount changed to $${dollars(refreshAmount(pack.id))}. Check it and press Refund again.`);
          await load();
          return;
        }
        if (fail && fail.status === 403 && fail.body?.error === 'reauth_required') {
          openPasswordDialog(async () => { await send(); }, () => {
            announce('Refund not sent. Confirm your password to refund this pack.');
          });
          return;
        }
        announce(fail?.body?.message ?? 'Billing is unreachable. No refund was issued.');
        await load();
      };
      void send();
    };

    const refreshAmount = (packId: string): number => {
      const p = (data?.packs ?? []).find((x) => x.id === packId);
      return p?.refundableCents ?? 0;
    };

    await load();
    timers.push(window.setInterval(() => { void load(); }, 10_000));
    return () => {
      destroyed = true;
      stopClock();
      for (const t of timers) clearInterval(t);
      removeHeader();
    };
  };

  let cleanupFn: (() => void) | null = null;
  void boot().then((fn) => { cleanupFn = fn ?? null; });
  return () => {
    destroyed = true;
    cleanupFn?.();
  };
}

function statusLabel(status: string): string {
  if (status === 'applied') return 'Applied — upload your documents';
  if (status === 'documents_pending') return 'Waiting for review';
  if (status === 'approved') return 'Approved';
  if (status === 'suspended') return 'Suspended';
  return status;
}

function coverLabel(doc: DocJson): string {
  if (doc.coverState === 'ok') return 'Valid';
  if (doc.coverState === 'expires_soon') return doc.daysLeft === 1 ? 'Expires in 1 day' : `Expires in ${doc.daysLeft} days`;
  if (doc.coverState === 'expires_today') return 'Expires today';
  if (doc.coverState === 'lapsed') return 'Lapsed';
  return 'Superseded';
}

function kindLabel(kind: string): string {
  return kind === 'insurance_certificate' ? 'Certificate of insurance' : 'Food-handler card';
}

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
