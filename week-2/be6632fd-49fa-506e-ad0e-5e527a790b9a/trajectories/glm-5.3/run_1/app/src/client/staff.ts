// Staff screens. Each renders behind the shared studio header with the role's
// navigation, and every list keeps its accessible name even when empty.
import { api, apiOk, failOf, MARKETS, ROLE_LABELS, ROLE_HOME, NAV_BY_ROLE, MESSAGES,
  type MemberOut, type DropStaff, type DropBuyer, type AllocationOut, type AllocationBuyer,
  type StockistOut, type PreviewOut, type LookOut } from './api.js';
import { el, buttonEl, liveRegion, announce, statusMark, pending, openDialog, emptyRow, clearFieldErrors, showProblems, fieldError } from './ui.js';
import { route, navigate, notFoundScreen } from './router.js';
import { marketTimeWords, parseInstant, dateWords, money, cphParts } from './format.js';
import { prefersReducedMotion } from './router.js';

let member: MemberOut | null = null;

export function setMember(m: MemberOut | null): void { member = m; }

export function renderAuthNeeded(root: HTMLElement, path: string): HTMLElement {
  const h = el('h1', {}, 'Sign in');
  root.append(el('div', { class: 'panel' }, h,
    el('p', { text: MESSAGES.sessionEnded }),
    el('a', { class: 'btn btn-primary', href: `/sign-in?next=${encodeURIComponent(path)}`, text: 'Sign in again' })));
  return h;
}

export function renderForbidden(root: HTMLElement): HTMLElement {
  const h = el('h1', {}, 'Drops');
  root.append(el('div', { class: 'panel' }, h, el('p', { text: MESSAGES.forbidden })));
  return h;
}

export function renderNotFoundScreen(root: HTMLElement): HTMLElement {
  const screen = notFoundScreen();
  root.append(screen);
  return screen as HTMLElement;
}

export function authFailed(fail: { status: number; code: string }): boolean {
  return fail.status === 401;
}

// The shared studio header.
export function renderHeader(activeHref: string): HTMLElement | null {
  const header = document.getElementById('header');
  if (!header) return null;
  header.replaceChildren();
  if (!member) return null;
  const nav = el('nav', { 'aria-label': 'Studio' });
  for (const item of NAV_BY_ROLE[member.role] ?? []) {
    const link = el('a', { href: item.href, text: item.label, ...(item.href === activeHref ? { 'aria-current': 'page' } : {}) });
    nav.append(link);
  }
  const out = buttonEl({ text: 'Sign out', onclick: async () => {
    await api('POST', '/api/auth/sign-out');
    member = null;
    await navigate('/sign-in', { wipe: true });
  } });
  const wrap = el('header', { class: 'staff-header' });
  wrap.append(el('span', { class: 'ws-name', text: 'Hourline' }), nav, el('span', { class: 'spacer' }), out);
  header.append(wrap);
  return wrap;
}

export function registerStaffRoutes(): void {
  route('/studio/drops', renderDrops);
  route('/studio/drops/new', renderNewDrop);
  route('/studio/invoicing', renderInvoicing);
  route('/studio/price-lists', renderPriceLists);
  route('/studio/press', renderPress);
  route('/studio/stockists', (root) => renderStockists(root));
  route('/studio/stockists/:id', (root, p) => renderStockist(root, p.id));
  route('/studio/members', renderMembers);
  route('/studio/my-store', renderMyStore);
  route('/studio/drops/:id/allocations', (root, p) => import('./allocation-screens.js').then(m => m.renderAllocationsForDrop(root, p.id)));
  route('/studio/allocations/:id', (root, p) => import('./allocation-screens.js').then(m => m.renderAllocation(root, p.id)));
  route('/studio/drops/:id/line-sheet', (root, p) => import('./linesheet-screen.js').then(m => m.renderLineSheet(root, p.id)));
  route('/studio/drops/:id/lookbook', (root, p) => import('./lookbook-screen.js').then(m => m.renderLookbook(root, p.id)));
  route('/studio/drops/:id/story', (root, p) => import('./story-screen.js').then(m => m.renderStory(root, p.id)));
  route('/studio/drops/:id/previews', (root, p) => import('./previews-screen.js').then(m => m.renderPreviews(root, p.id)));
}

async function ensureSession(): Promise<boolean> {
  if (member) return true;
  try {
    const res = await api<{ member: MemberOut }>('GET', '/api/auth/session');
    member = res.data?.member ?? null;
    return member !== null;
  } catch { return false; }
}

async function renderDrops(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) { const m = await import('./staff.js'); void m; return renderAuthNeeded(root, '/studio/drops'); }
  if (member!.role === 'stockist_buyer') return renderMyStore(root);
  renderHeader('/studio/drops');
  const h = el('h1', {}, 'Drops');
  const wrap = el('div', { class: 'grid12' });
  root.append(h, wrap);
  let drops: DropStaff[] = [];
  try {
    const res = await apiOk<{ items: DropStaff[] }>('GET', '/api/drops');
    drops = res.items ?? [];
  } catch (err) {
    const fail = failOf(err);
    if (fail.status === 401) return renderAuthNeeded(root, '/studio/drops');
  }
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Drops' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Type' }), el('th', { text: 'Status' }), el('th', { text: 'Opens' }))));
  const tbody = el('tbody');
  table.append(tbody);
  if (drops.length === 0) tbody.append(emptyRow(4));
  for (const d of drops) {
    const link = el('a', { href: `/studio/drops/${d.id}`, text: d.name });
    const status = el('td', {});
    status.append(statusMark(d.status));
    const opens = d.goLiveAt ? marketTimeWords(parseInstant(d.goLiveAt), 'copenhagen', 'Copenhagen') : '—';
    tbody.append(el('tr', {},
      el('td', { 'data-label': 'Name' }, link),
      el('td', { 'data-label': 'Type', text: d.type === 'simultaneous' ? 'Simultaneous' : 'Rolling' }),
      el('td', { 'data-label': 'Status' }, status),
      el('td', { 'data-label': 'Opens', class: 'mono', text: opens })));
  }
  const panel = el('section', { class: 'panel col-12' }, table);
  wrap.append(panel);
  if (member!.role === 'launch_producer') {
    const newLink = el('a', { class: 'btn btn-primary', href: '/studio/drops/new', text: 'New drop' });
    panel.prepend(newLink);
  }
  return h;
}

// New drop: four steps, every typed value and the current step kept in the browser
// until the drop is created.
const NEW_DROP_KEY = 'hourline:new-drop';

interface NewDropState {
  step: number;
  name: string;
  type: 'simultaneous' | 'rolling';
  holdSeconds: string;
  internalNote: string;
  markets: Record<string, string>;
  styles: { styleNumber: string; name: string; colour: string; wholesaleEdition: string }[];
}

async function renderNewDrop(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/drops/new');
  if (member!.role !== 'launch_producer') return renderForbidden(root);
  renderHeader('/studio/drops');
  const h = el('h1', {}, 'New drop');
  const status = liveRegion('New drop status');
  let state: NewDropState = loadDraft();
  const form = el('form', { onsubmit: (e: Event) => e.preventDefault() });
  const body = el('div', {});
  form.append(body);

  function loadDraft(): NewDropState {
    try {
      const raw = localStorage.getItem(`${NEW_DROP_KEY}:${member!.id}`);
      if (raw) return JSON.parse(raw) as NewDropState;
    } catch { /* fresh */ }
    return {
      step: 1, name: '', type: 'simultaneous', holdSeconds: '900', internalNote: '',
      markets: Object.fromEntries(MARKETS.map(m => [m.market, '0'])),
      styles: [{ styleNumber: '', name: '', colour: '', wholesaleEdition: '0' }]
    };
  }

  function saveDraft(): void {
    try { localStorage.setItem(`${NEW_DROP_KEY}:${member!.id}`, JSON.stringify(state)); } catch { /* ignore */ }
  }

  const back = buttonEl({ class: 'btn', text: 'Back', onclick: () => { state.step = Math.max(1, state.step - 1); saveDraft(); draw(); } });
  const next = buttonEl({ class: 'btn btn-primary', text: 'Next', onclick: async () => {
    const fields = collectFields();
    const restore = pending(next, 'Checking…');
    try {
      await api('POST', '/api/drops/checks', fields);
      state.step = Math.min(4, state.step + 1);
      saveDraft();
      draw();
    } catch (err) {
      const fail = failOf(err);
      if (fail.fields) {
        showProblems(form, fail, fieldLabelsFor(state.step));
        for (const [p, msg] of Object.entries(fail.fields)) fieldError(form, p, msg, p);
      } else announce(status, fail.message, true);
    } finally { restore(); }
  } });

  function collectFields(): Record<string, unknown> {
    if (state.step === 1) {
      return { name: state.name, type: state.type, holdSeconds: Number(state.holdSeconds) || 900, internalNote: state.internalNote };
    }
    if (state.step === 2) {
      return { type: state.type, markets: Object.fromEntries(Object.entries(state.markets).map(([k, v]) => [k, Number(v) || 0])) };
    }
    if (state.step === 3) {
      return { styles: state.styles.map(s => ({ styleNumber: s.styleNumber, name: s.name, colour: s.colour, wholesaleEdition: Number(s.wholesaleEdition) || 0 })) };
    }
    return {};
  }

  function fieldLabelsFor(step: number): Record<string, string> {
    if (step === 1) return { name: 'Drop name', type: 'Drop type', holdSeconds: 'Hold length in seconds' };
    return {};
  }

  function draw(): void {
    body.replaceChildren();
    const counter = el('p', { class: 'mono', text: `Step ${state.step} / 4` });
    body.append(counter);
    if (state.step === 1) {
      const name = inputRow('Drop name', state.name, v => { state.name = v; saveDraft(); });
      const type = radios('Drop type', [['simultaneous', 'Simultaneous'], ['rolling', 'Rolling']], state.type, v => { state.type = v as 'simultaneous' | 'rolling'; saveDraft(); });
      const hold = inputRow('Hold length in seconds', state.holdSeconds, v => { state.holdSeconds = v; saveDraft(); }, 'number');
      const note = inputRow('Internal note', state.internalNote, v => { state.internalNote = v; saveDraft(); });
      body.append(name, type, hold, note);
    } else if (state.step === 2) {
      for (const m of MARKETS) {
        body.append(inputRow(`${m.city} pieces`, state.markets[m.market] ?? '0', v => { state.markets[m.market] = v; saveDraft(); }, 'number'));
      }
    } else if (state.step === 3) {
      const table = el('table', {});
      table.append(el('caption', { text: 'Styles' }));
      table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Style number' }), el('th', { text: 'Name' }), el('th', { text: 'Colour' }), el('th', { text: 'Wholesale edition' }))));
      const tb = el('tbody');
      table.append(tb);
      state.styles.forEach((s, i) => {
        const row = el('tr', {});
        const cells: HTMLInputElement[] = [];
        for (const [key, label, type] of [['styleNumber', 'Style number', 'text'], ['name', 'Style name', 'text'], ['colour', 'Colour', 'text'], ['wholesaleEdition', 'Wholesale edition', 'number']] as [keyof NewDropState['styles'][number], string, string][]) {
          const input = el('input', { type, 'aria-label': label, value: String(s[key] ?? ''), class: 'mono' }) as HTMLInputElement;
          input.addEventListener('input', () => { state.styles[i][key] = input.value; saveDraft(); });
          cells.push(input);
          row.append(el('td', {}, input));
        }
        tb.append(row);
      });
      body.append(table);
      const add = buttonEl({ class: 'btn', text: 'Add style', onclick: () => {
        state.styles.push({ styleNumber: '', name: '', colour: '', wholesaleEdition: '0' });
        saveDraft();
        draw();
      } });
      body.append(add);
    } else {
      body.append(el('p', { class: 'note', text: 'Review the drop, then create it.' }));
      const create = buttonEl({ class: 'btn btn-primary', text: 'Create drop', onclick: async () => {
        const restore = pending(create, 'Creating…');
        try {
          const payload = {
            name: state.name,
            type: state.type,
            holdSeconds: Number(state.holdSeconds) || 900,
            internalNote: state.internalNote,
            markets: Object.fromEntries(Object.entries(state.markets).map(([k, v]) => [k, Number(v) || 0])),
            styles: state.styles.map(s => ({ styleNumber: s.styleNumber, name: s.name, colour: s.colour, wholesaleEdition: Number(s.wholesaleEdition) || 0 }))
          };
          const res = await api<DropStaff>('POST', '/api/drops', payload);
          localStorage.removeItem(`${NEW_DROP_KEY}:${member!.id}`);
          announce(status, 'Drop created.');
          await navigate(`/studio/drops/${res.data!.id}`, { wipe: true });
        } catch (err) {
          const fail = failOf(err);
          if (fail.fields) { showProblems(form, fail, fieldLabelsFor(1)); for (const [p, msg] of Object.entries(fail.fields)) fieldError(form, p, msg, p); }
          else announce(status, fail.message, true);
        } finally { restore(); }
      } });
      body.append(create);
    }
    const row = el('div', { class: 'btn-row', style: 'margin-top: 16px;' });
    if (state.step > 1) row.append(back);
    if (state.step < 4) row.append(next);
    body.append(row);
  }

  root.append(h, el('section', { class: 'panel col-12' }, form, status));
  draw();
  return h;
}

function inputRow(label: string, value: string, onChange: (v: string) => void, type = 'text'): HTMLElement {
  const input = el('input', { type, 'aria-label': label, value, class: 'mono' }) as HTMLInputElement;
  input.addEventListener('input', () => onChange(input.value));
  const wrap = el('label', { class: 'field' });
  wrap.append(el('span', { class: 'label', text: label }), input);
  return wrap;
}

function radios(label: string, options: [string, string][], value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = el('div', { role: 'radiogroup', 'aria-label': label, class: 'field' });
  for (const [v, text] of options) {
    const input = el('input', { type: 'radio', name: label, value: v, ...(v === value ? { checked: true } : {}) }) as HTMLInputElement;
    input.addEventListener('change', () => onChange(v));
    wrap.append(el('label', { class: 'check' }, input, el('span', { text })));
  }
  return wrap;
}

async function renderInvoicing(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/invoicing');
  renderHeader('/studio/invoicing');
  const h = el('h1', {}, 'Invoicing');
  const status = liveRegion('Invoicing status');
  const ready = el('table', { class: 'table-to-cards' });
  ready.append(el('caption', { text: 'Ready to confirm' }));
  ready.append(el('thead', {}, el('tr', {}, el('th', { text: 'Stockist' }), el('th', { text: 'Drop' }), el('th', { text: 'Total' }))));
  const readyBody = el('tbody');
  ready.append(readyBody);
  const confirmed = el('table', { class: 'table-to-cards' });
  confirmed.append(el('caption', { text: 'Confirmed allocations' }));
  confirmed.append(el('thead', {}, el('tr', {}, el('th', { text: 'Stockist' }), el('th', { text: 'Drop' }), el('th', { text: 'Invoice' }), el('th', { text: 'Total' }), el('th', { text: 'Confirmed' }))));
  const confirmedBody = el('tbody');
  confirmed.append(confirmedBody);
  root.append(h, el('div', { class: 'grid12' },
    el('section', { class: 'panel col-6' }, ready),
    el('section', { class: 'panel col-6' }, confirmed),
    status));
  try {
    const res = await apiOk<{ items: AllocationOut[] }>('GET', '/api/allocations');
    for (const a of res.items ?? []) {
      const row = el('tr', {}, el('td', { 'data-label': 'Stockist' }, el('a', { href: `/studio/allocations/${a.id}`, text: a.stockistName })),
        el('td', { 'data-label': 'Drop', text: a.dropName }),
        el('td', { 'data-label': 'Total', class: 'mono', text: a.totalMinor !== null ? money(a.totalMinor, a.currency) : '—' }));
      if (a.status === 'split') readyBody.append(row);
      if (a.status === 'confirmed') {
        confirmedBody.append(el('tr', {},
          el('td', { 'data-label': 'Stockist' }, el('a', { href: `/studio/allocations/${a.id}`, text: a.stockistName })),
          el('td', { 'data-label': 'Drop', text: a.dropName }),
          el('td', { 'data-label': 'Invoice', class: 'mono', text: a.invoiceNumber ?? '—' }),
          el('td', { 'data-label': 'Total', class: 'mono', text: a.totalMinor !== null ? money(a.totalMinor, a.currency) : '—' }),
          el('td', { 'data-label': 'Confirmed', class: 'mono', text: a.confirmedAt ?? '—' })));
      }
    }
    if (readyBody.children.length === 0) readyBody.append(emptyRow(3));
    if (confirmedBody.children.length === 0) confirmedBody.append(emptyRow(5));
  } catch (err) { const fail = failOf(err); if (fail.status === 401) return renderAuthNeeded(root, '/studio/invoicing'); }
  return h;
}

async function renderPriceLists(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/price-lists');
  renderHeader('/studio/price-lists');
  const h = el('h1', {}, 'Price lists');
  const status = liveRegion('Price list status');
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Price lists' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Effective from' }), el('th', { text: 'Prices' }), el('th', { text: 'In force' }))));
  const tbody = el('tbody');
  table.append(tbody);
  const addBtn = buttonEl({ class: 'btn btn-primary', text: 'Add price list', onclick: () => {
    openDialog({
      label: 'Add price list', opener: addBtn,
      body: (dlg) => {
        const name = el('input', { type: 'text', 'aria-label': 'Name' }) as HTMLInputElement;
        const tomorrow = cphParts(new Date(Date.now() + 86400000)).iso;
        const date = el('input', { type: 'text', 'aria-label': 'Effective date', value: tomorrow, class: 'mono' }) as HTMLInputElement;
        const prices = el('textarea', { 'aria-label': 'Prices', placeholder: 'MV-2701 DKK 1234.50' }) as HTMLTextAreaElement;
        const save = buttonEl({ class: 'btn btn-primary', text: 'Save price list', onclick: () => {
          const lines = prices.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
            const m = /^(\S+)\s+(\S+)\s+([\d,.]+)$/.exec(l);
            if (!m) return null;
            const amount = Number(m[3].replace(/,/g, ''));
            return { styleNumber: m[1], currency: m[2], unitPriceMinor: Math.round(amount * 100) };
          }).filter((x): x is { styleNumber: string; currency: string; unitPriceMinor: number } => x !== null);
          dlg.onResult(api('POST', '/api/price-lists', { name: name.value, effectiveDate: date.value, prices: lines }), (ok, fail) => {
            if (ok) announce(status, `Price list saved. It applies from ${date.value}.`);
            else if (fail?.fields) {
              const errorBox = dlg.root.querySelector('.dialog-error') as HTMLElement;
              if (errorBox) { errorBox.hidden = false; errorBox.textContent = Object.values(fail.fields)[0] ?? fail.message; }
            } else if (fail) announce(status, fail.message, true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Name' }), name),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Effective date' }), date),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Prices (one "style currency amount" per line)' }), prices),
          el('div', { class: 'btn-row' }, save, cancel));
      }
    });
  } });
  root.append(h, el('section', { class: 'panel col-12' }, addBtn, table, status));
  try {
    const res = await apiOk<{ items: { id: string; name: string; effectiveDate: string; prices: { styleNumber: string; currency: string; unitPriceMinor: number }[]; createdAt: string; inForce: boolean }[] }>('GET', '/api/price-lists');
    for (const pl of res.items ?? []) {
      tbody.append(el('tr', {},
        el('td', { 'data-label': 'Name', text: pl.name }),
        el('td', { 'data-label': 'Effective from', class: 'mono', text: pl.effectiveDate }),
        el('td', { 'data-label': 'Prices', text: `${pl.prices.length}` }),
        el('td', { 'data-label': 'In force', text: pl.inForce ? 'Yes' : 'No' })));
    }
    if (tbody.children.length === 0) tbody.append(emptyRow(4));
  } catch (err) { const fail = failOf(err); if (fail.status === 401) return renderAuthNeeded(root, '/studio/price-lists'); }
  return h;
}

async function renderPress(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/press');
  renderHeader('/studio/press');
  const h = el('h1', {}, 'Press');
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Drops' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Drop' }), el('th', { text: 'Story' }), el('th', { text: 'Previews' }))));
  const tbody = el('tbody');
  table.append(tbody);
  root.append(h, el('section', { class: 'panel col-12' }, table));
  try {
    const res = await apiOk<{ items: DropStaff[] }>('GET', '/api/drops');
    for (const d of res.items ?? []) {
      tbody.append(el('tr', {},
        el('td', { 'data-label': 'Drop', text: d.name }),
        el('td', { 'data-label': 'Story' }, el('a', { href: `/studio/drops/${d.id}/story`, text: 'Story' })),
        el('td', { 'data-label': 'Previews' }, el('a', { href: `/studio/drops/${d.id}/previews`, text: 'Previews' }))));
    }
    if (tbody.children.length === 0) tbody.append(emptyRow(3));
  } catch (err) { const fail = failOf(err); if (fail.status === 401) return renderAuthNeeded(root, '/studio/press'); }
  return h;
}

async function renderMembers(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/members');
  if (member!.role !== 'launch_producer') return renderForbidden(root);
  renderHeader('/studio/members');
  const h = el('h1', {}, 'Members');
  const status = liveRegion('Members status');
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Members' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Email' }), el('th', { text: 'Role' }), el('th', { text: 'Actions' }))));
  const tbody = el('tbody');
  table.append(tbody);
  const inviteBtn = buttonEl({ class: 'btn btn-primary', text: 'Invite member', onclick: () => {
    openDialog({
      label: 'Invite member', opener: inviteBtn,
      body: (dlg) => {
        const email = el('input', { type: 'email', 'aria-label': 'Email' }) as HTMLInputElement;
        const role = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
        for (const r of Object.keys(ROLE_LABELS)) role.append(el('option', { value: r, text: ROLE_LABELS[r], ...(r === 'merchandiser' ? { selected: true } : {}) }));
        const send = buttonEl({ class: 'btn btn-primary', text: 'Send invitation', onclick: () => {
          dlg.onResult(api('POST', '/api/members/invitations', { email: email.value, role: role.value, stockistId: role.value === 'stockist_buyer' ? null : null }), (ok, fail) => {
            if (ok) announce(status, `If ${email.value} can be invited, an invitation is on its way.`);
            else announce(status, fail?.message ?? 'Sending failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Email' }), email),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Role' }), role),
          el('div', { class: 'btn-row' }, send, cancel));
      }
    });
  } });
  root.append(h, el('section', { class: 'panel col-12' }, inviteBtn, table, status));
  try {
    const res = await apiOk<{ items: MemberOut[] }>('GET', '/api/members');
    for (const m of res.items ?? []) {
      const changeBtn = buttonEl({ class: 'btn btn-sm', text: 'Change role', onclick: () => {
        openDialog({
          label: 'Change role', opener: changeBtn,
          body: (dlg) => {
            const role = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
            for (const r of Object.keys(ROLE_LABELS)) role.append(el('option', { value: r, text: ROLE_LABELS[r], ...(r === m.role ? { selected: true } : {}) }));
            const save = buttonEl({ class: 'btn btn-primary', text: 'Save role', onclick: () => {
              dlg.onResult(api('PATCH', `/api/members/${m.id}`, { role: role.value }), (ok, fail) => {
                if (ok) { announce(status, 'Role updated.'); void navigate('/studio/members', { push: false, wipe: false }); }
                else announce(status, fail?.code === 'last_producer' ? 'A workspace needs at least one launch producer.' : fail?.message ?? 'Saving failed', true);
              });
            } });
            const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
            return el('div', {}, el('label', { class: 'field' }, el('span', { class: 'label', text: 'Role' }), role), el('div', { class: 'btn-row' }, save, cancel));
          },
          successFocus: h
        });
      } });
      const removeBtn = buttonEl({ class: 'btn btn-sm', text: 'Remove', onclick: () => {
        openDialog({
          label: 'Remove member', opener: removeBtn, successFocus: h,
          body: (dlg) => {
            const confirmBtn = buttonEl({ class: 'btn btn-danger', text: 'Remove member', onclick: () => {
              dlg.onResult(api('DELETE', `/api/members/${m.id}`), (ok, fail) => {
                if (ok) { announce(status, 'Member removed.'); void navigate('/studio/members', { push: false, wipe: false }); }
                else announce(status, fail?.code === 'last_producer' ? 'A workspace needs at least one launch producer.' : fail?.message ?? 'Removing failed', true);
              });
            } });
            const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
            return el('div', {}, el('p', { text: `Remove ${m.name}?` }), el('div', { class: 'btn-row' }, confirmBtn, cancel));
          }
        });
      } });
      tbody.append(el('tr', {},
        el('td', { 'data-label': 'Name', text: m.name }),
        el('td', { 'data-label': 'Email', text: m.email }),
        el('td', { 'data-label': 'Role', text: ROLE_LABELS[m.role] ?? m.role }),
        el('td', { 'data-label': 'Actions' }, changeBtn, removeBtn)));
    }
    if (tbody.children.length === 0) tbody.append(emptyRow(4));
  } catch (err) { const fail = failOf(err); if (fail.status === 401) return renderAuthNeeded(root, '/studio/members'); }
  return h;
}

async function renderMyStore(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/my-store');
  renderHeader('/studio/my-store');
  const status = liveRegion('Store status');
  let store: StockistOut | null = null;
  try {
    const res = await apiOk<StockistOut>('GET', '/api/stockists');
    store = (res as unknown as { items: StockistOut[] }).items?.[0] ?? null;
  } catch { /* buyers see their own store */ }
  const h = el('h1', {}, store?.name ?? 'My store');
  const openTable = el('table', { class: 'table-to-cards' });
  openTable.append(el('caption', { text: 'Open drops' }));
  openTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Drop' }), el('th', { text: 'Status' }), el('th', { text: 'Actions' }))));
  const openBody = el('tbody');
  openTable.append(openBody);
  const allocTable = el('table', { class: 'table-to-cards' });
  allocTable.append(el('caption', { text: 'My allocations' }));
  allocTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Drop' }), el('th', { text: 'Status' }), el('th', { text: 'Total' }))));
  const allocBody = el('tbody');
  allocTable.append(allocBody);
  const invTable = el('table', { class: 'table-to-cards' });
  invTable.append(el('caption', { text: 'My invoices' }));
  invTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Invoice' }), el('th', { text: 'Drop' }), el('th', { text: 'Total' }), el('th', { text: 'Confirmed' }))));
  const invBody = el('tbody');
  invTable.append(invBody);
  root.append(h, el('div', { class: 'grid12' },
    el('section', { class: 'panel col-12' }, openTable),
    el('section', { class: 'panel col-12' }, allocTable),
    el('section', { class: 'panel col-12' }, invTable),
    status));
  try {
    const drops = await apiOk<{ items: DropBuyer[] }>('GET', '/api/drops');
    for (const d of drops.items ?? []) {
      const reqBtn = buttonEl({ class: 'btn btn-sm', text: 'Request quantities', onclick: () => {
        openDialog({
          label: 'Request quantities', opener: reqBtn,
          body: (dlg) => {
            const inputs = d.styles.map(s => ({ style: s, input: el('input', { type: 'number', min: '0', value: '0', 'aria-label': `${s.styleNumber} quantity`, class: 'mono' }) as HTMLInputElement }));
            const send = buttonEl({ class: 'btn btn-primary', text: 'Send request', onclick: () => {
              dlg.onResult(api('POST', `/api/drops/${d.id}/requests`, { stockistId: store?.id, lines: inputs.map(i => ({ styleNumber: i.style.styleNumber, quantity: Number(i.input.value) || 0 })) }), (ok, fail) => {
                if (ok) announce(status, 'Request saved.');
                else if (fail?.code === 'allocation_split') announce(status, 'The edition was already split, so requests are closed.', true);
                else announce(status, fail?.message ?? 'Sending failed', true);
              });
            } });
            const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
            return el('div', {},
              ...inputs.map(i => el('label', { class: 'field' }, el('span', { class: 'label', text: `${i.style.styleNumber} quantity` }), i.input)),
              el('div', { class: 'btn-row' }, send, cancel));
          }
        });
      } });
      openBody.append(el('tr', {},
        el('td', { 'data-label': 'Drop', text: d.name }),
        el('td', { 'data-label': 'Status' }, statusMark(d.status)),
        el('td', { 'data-label': 'Actions' }, reqBtn)));
    }
    const allocs = await apiOk<{ items: AllocationBuyer[] }>('GET', '/api/allocations');
    for (const a of allocs.items ?? []) {
      allocBody.append(el('tr', {},
        el('td', { 'data-label': 'Drop', text: a.dropName }),
        el('td', { 'data-label': 'Status', text: a.status }),
        el('td', { 'data-label': 'Total', class: 'mono', text: a.totalMinor !== null ? money(a.totalMinor, a.currency) : '—' })));
      if (a.invoiceNumber) {
        invBody.append(el('tr', {},
          el('td', { 'data-label': 'Invoice', class: 'mono', text: a.invoiceNumber }),
          el('td', { 'data-label': 'Drop', text: a.dropName }),
          el('td', { 'data-label': 'Total', class: 'mono', text: a.totalMinor !== null ? money(a.totalMinor, a.currency) : '—' }),
          el('td', { 'data-label': 'Confirmed', class: 'mono', text: a.confirmedAt ?? '—' })));
      }
    }
    if (openBody.children.length === 0) openBody.append(emptyRow(3));
    if (allocBody.children.length === 0) allocBody.append(emptyRow(3));
    if (invBody.children.length === 0) invBody.append(emptyRow(4));
  } catch (err) { const fail = failOf(err); if (fail.status === 401) return renderAuthNeeded(root, '/studio/my-store'); }
  return h;
}

async function renderStockists(root: HTMLElement): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, '/studio/stockists');
  renderHeader('/studio/stockists');
  const h = el('h1', {}, 'Stockists');
  const status = liveRegion('Stockist status');
  const search = el('input', { type: 'search', 'aria-label': 'Search stockists', placeholder: 'Search stockists' }) as HTMLInputElement;
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Stockists' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Market' }), el('th', { text: 'Contact' }), el('th', { text: 'Actions' }))));
  const tbody = el('tbody');
  table.append(tbody);
  const loadMore = buttonEl({ class: 'btn', text: 'Load more stockists' });
  const archivedSwitch = el('input', { type: 'checkbox', 'aria-label': 'Show archived', role: 'switch' }) as HTMLInputElement;
  const archivedTable = el('table', { class: 'table-to-cards' });
  archivedTable.append(el('caption', { text: 'Archived stockists' }));
  archivedTable.append(el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Market' }), el('th', { text: 'Actions' }))));
  const archivedBody = el('tbody');
  archivedTable.append(archivedBody);
  const exportLink = el('a', { class: 'btn', href: '/api/stockists.csv', text: 'Export CSV' });
  const addBtn = buttonEl({ class: 'btn btn-primary', text: 'Add stockist', onclick: () => {
    openDialog({
      label: 'Add stockist', opener: addBtn,
      body: (dlg) => {
        const name = el('input', { type: 'text', 'aria-label': 'Name' }) as HTMLInputElement;
        const market = el('select', { 'aria-label': 'Market' }) as HTMLSelectElement;
        for (const m of MARKETS) market.append(el('option', { value: m.market, text: m.city, ...(m.market === 'copenhagen' ? { selected: true } : {}) }));
        const cname = el('input', { type: 'text', 'aria-label': 'Contact name' }) as HTMLInputElement;
        const cemail = el('input', { type: 'email', 'aria-label': 'Contact email' }) as HTMLInputElement;
        const cphone = el('input', { type: 'text', 'aria-label': 'Contact phone' }) as HTMLInputElement;
        const notes = el('textarea', { 'aria-label': 'Notes' }) as HTMLTextAreaElement;
        const save = buttonEl({ class: 'btn btn-primary', text: 'Save stockist', onclick: () => {
          dlg.onResult(api('POST', '/api/stockists', {
            name: name.value, market: market.value, contactName: cname.value,
            contactEmail: cemail.value, contactPhone: cphone.value, notes: notes.value
          }), (ok, fail) => {
            if (ok) { announce(status, 'Stockist added.'); void navigate('/studio/stockists', { push: false, wipe: false }); }
            else if (fail?.fields) {
              const errorBox = dlg.root.querySelector('.dialog-error') as HTMLElement;
              if (errorBox) { errorBox.hidden = false; errorBox.textContent = Object.values(fail.fields)[0] ?? fail.message; }
            }
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Name' }), name),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Market' }), market),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Contact name' }), cname),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Contact email' }), cemail),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Contact phone' }), cphone),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Notes' }), notes),
          el('div', { class: 'btn-row' }, save, cancel));
      }
    });
  } });

  let cursor: string | null = null;
  async function load(archived: boolean, append: boolean): Promise<void> {
    const params = new URLSearchParams({ limit: '25' });
    if (search.value) params.set('q', search.value);
    if (archived) params.set('archived', 'true');
    if (append && cursor) params.set('cursor', cursor);
    const target = archived ? archivedBody : tbody;
    if (!append) target.replaceChildren();
    try {
      const res = await apiOk<{ items: StockistOut[]; nextCursor: string | null }>('GET', `/api/stockists?${params}`);
      for (const s of res.items ?? []) {
        const rowEl = el('tr', {},
          el('td', { 'data-label': 'Name' }, el('a', { href: `/studio/stockists/${s.id}`, text: s.name })),
          el('td', { 'data-label': 'Market', text: s.city }),
          el('td', { 'data-label': 'Contact', text: s.contactErased ? MESSAGES.contactErased : (s.contactName ?? '') }),
          el('td', { 'data-label': 'Actions' }, archived
            ? buttonEl({ class: 'btn btn-sm', text: 'Restore', onclick: () => restoreStockist(s, archivedBody, h) })
            : buttonEl({ class: 'btn btn-sm', text: 'Archive', onclick: () => archiveStockist(s, h) })));
        target.append(rowEl);
      }
      cursor = res.nextCursor;
      loadMore.hidden = !(res.nextCursor);
      if (target.children.length === 0) target.append(emptyRow(4));
    } catch (err) { const fail = failOf(err); if (fail.status === 401) renderAuthNeeded(root, '/studio/stockists'); }
  }

  async function archiveStockist(s: StockistOut, h1: HTMLElement): Promise<void> {
    openDialog({
      label: 'Archive stockist', opener: null, successFocus: h1,
      body: (dlg) => {
        const confirmBtn = buttonEl({ class: 'btn btn-primary', text: 'Archive stockist', onclick: () => {
          dlg.onResult(api('POST', `/api/stockists/${s.id}/archive`), (ok, fail) => {
            if (ok) { announce(status, 'Stockist archived.'); void navigate('/studio/stockists', { push: false, wipe: false }); }
            else announce(status, fail?.message ?? 'Archiving failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, el('p', { text: `Archive ${s.name}?` }), el('div', { class: 'btn-row' }, confirmBtn, cancel));
      }
    });
  }

  async function restoreStockist(s: StockistOut, opener: HTMLElement, h1: HTMLElement): Promise<void> {
    void opener;
    openDialog({
      label: 'Restore stockist', opener: null, successFocus: h1,
      body: (dlg) => {
        const confirmBtn = buttonEl({ class: 'btn btn-primary', text: 'Restore stockist', onclick: () => {
          dlg.onResult(api('POST', `/api/stockists/${s.id}/restore`), (ok, fail) => {
            if (ok) { announce(status, 'Stockist restored.'); void navigate('/studio/stockists', { push: false, wipe: false }); }
            else announce(status, fail?.message ?? 'Restoring failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, el('p', { text: `Restore ${s.name}?` }), el('div', { class: 'btn-row' }, confirmBtn, cancel));
      }
    });
  }

  loadMore.addEventListener('click', () => void load(false, true));
  search.addEventListener('input', () => void load(false, false));
  archivedSwitch.addEventListener('change', () => void load(archivedSwitch.checked, false));
  root.append(h,
    el('section', { class: 'panel col-12' }, search, table, loadMore,
      el('label', { class: 'check' }, archivedSwitch, el('span', { text: 'Show archived' })), archivedTable, exportLink, addBtn, status));
  await load(false, false);
  await load(true, false);
  return h;
}

async function renderStockist(root: HTMLElement, id: string): Promise<HTMLElement> {
  if (!(await ensureSession())) return renderAuthNeeded(root, `/studio/stockists/${id}`);
  renderHeader('/studio/stockists');
  let s: StockistOut | null = null;
  try { s = await apiOk<StockistOut>('GET', `/api/stockists/${id}`); } catch { s = null; }
  if (!s) return renderNotFoundScreen(root);
  const h = el('h1', {}, s.name);
  const status = liveRegion('Stockist status');
  const eraseBtn = buttonEl({ class: 'btn btn-danger', text: 'Erase contact', onclick: () => {
    openDialog({
      label: 'Erase contact', opener: eraseBtn, successFocus: h,
      body: (dlg) => {
        const confirmBtn = buttonEl({ class: 'btn btn-danger', text: 'Erase contact', onclick: () => {
          dlg.onResult(api('POST', `/api/stockists/${s!.id}/erase-contact`), (ok, fail) => {
            if (ok) { announce(status, 'Contact erased.'); void navigate(`/studio/stockists/${id}`, { push: false, wipe: false }); }
            else announce(status, fail?.message ?? 'Erasing failed', true);
          });
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {}, el('p', { text: `Erase the contact for ${s!.name}?` }), el('div', { class: 'btn-row' }, confirmBtn, cancel));
      }
    });
  } });
  root.append(h, el('section', { class: 'panel col-6' },
    el('p', {}, el('strong', { text: 'Market: ' }), s.city),
    el('p', {}, el('strong', { text: 'Currency: ' }), s.currency),
    el('p', {}, el('strong', { text: 'Contact: ' }), s.contactErased ? MESSAGES.contactErased : `${s.contactName ?? ''} ${s.contactEmail ?? ''} ${s.contactPhone ?? ''}`.trim()),
    el('p', {}, el('strong', { text: 'Notes: ' }), s.notes),
    eraseBtn, status));
  return h;
}

