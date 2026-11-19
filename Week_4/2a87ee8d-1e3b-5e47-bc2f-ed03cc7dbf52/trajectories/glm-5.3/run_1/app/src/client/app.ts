/**
 * The app shell: routing and every non-room page, with the public roles and
 * accessible names from the brief.
 */
import { api, errorMessage, errorFields, newClientOpId } from './api.js';
import { el, h, liveRegions } from './ui.js';
import { escapeHtml, longDate, amountFmt, hhmm } from './polyfill.js';
import { PLAN_PRICES, STATUS_LABELS, TERM_LABELS, PLAN_LABELS, type WorkshopStatus } from '../domain.js';
import { renderRoom, wirePresenceSending } from './room.js';

const app = document.getElementById('app') as HTMLElement;
const status = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Page status', class: 'visually-hidden' });
const alert = h('div', { role: 'alert', class: 'visually-hidden' });
document.body.append(status, alert);

interface Facilitator { name: string; email: string; timeZone: string }
let facilitator: Facilitator | null = null;

function say(msg: string): void { status.textContent = msg; }
function complain(msg: string): void { alert.textContent = msg; }

function route(): void {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter((p) => p.length > 0);
  const run = (): void => {
    if (parts.length === 0) return void pageLanding();
    switch (parts[0]) {
      case 'signin': return void pageSignIn();
      case 'workshops': return void pageWorkshops();
      case 'billing': return void pageBilling();
      case 'activity': return void pageActivity();
      case 'join': return void pageJoin(parts[1] ?? '');
      case 'w': return void pageRoom(parts[1] ?? '');
      case 'recap': return void pageRecap(parts[1] ?? '');
      default: return void pageLanding();
    }
  };
  run();
}

window.addEventListener('hashchange', route);

async function boot(): Promise<void> {
  const session = await api<{ facilitator?: Facilitator }>('GET', '/api/session');
  if (session.status === 200 && session.body.facilitator) facilitator = session.body.facilitator;
  route();
}
void boot();

// ---------------------------------------------------------------- landing

function pageLanding(): void {
  const term = { value: 'monthly' as 'monthly' | 'annual' };
  app.innerHTML = '';
  app.appendChild(el(`<main class="page">
    <section class="hero" aria-label="Hero">
      <div class="hero-mesh" aria-hidden="true"></div>
      <div class="lede">
        <h1>Brainstorm face down. Reveal together.</h1>
        <p>Lanternfold Rooms is the shared canvas for freelance facilitators: silent rounds nobody can peek at, one reveal, honest dot votes, and a recap in the client's inbox before the day is out.</p>
        <hr class="rule">
        <p class="muted">No guest seats. No board caps. Your words stay yours until you choose to show them.</p>
        <div class="toolbar-line"><a href="#/signin">Sign in</a> <a href="#/signin">Start a workshop</a></div>
      </div>
      <div class="mini-canvas" role="region" aria-label="Reveal demo">
        <div class="mini-frame">
          <h3>Problems</h3>
          <div class="mini-stickies" id="demo-cards"></div>
        </div>
        <button id="play-reveal" aria-label="Play the reveal" style="margin-top:14px">Play the reveal</button>
      </div>
    </section>
    <section class="section" role="region" aria-label="Plans">
      <h2>Plans</h2>
      <radiogroup class="term-toggle" role="radiogroup" aria-label="Billing term">
        <label><input type="radio" name="term" value="monthly" checked> Monthly</label>
        <label><input type="radio" name="term" value="annual"> Annual</label>
      </radiogroup>
      <div class="plans-grid" id="plans-grid"></div>
    </section>
  </main>`));

  const cards = document.getElementById('demo-cards') as HTMLElement;
  const renderDemo = (faceUp: boolean): void => {
    cards.replaceChildren();
    const texts = ['Slow handoffs', 'Onboarding drag', 'Unclear owners', 'Too many tools', 'Late feedback', 'Scope drift'];
    texts.forEach((t, i) => {
      const wrap = el('<div class="flip-wrap"></div>');
      const card = el(`<div class="${faceUp ? 'mini-sticky' : 'mini-back'}" aria-hidden="true"></div>`);
      if (faceUp) card.textContent = t;
      wrap.appendChild(card);
      cards.appendChild(wrap);
      void i;
    });
  };
  renderDemo(false);
  document.getElementById('play-reveal')?.addEventListener('click', () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderDemo(false);
    const wraps = Array.from(cards.querySelectorAll('.flip-wrap > div'));
    wraps.forEach((card, i) => {
      if (reduced) {
        card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, delay: i * 100, fill: 'backwards' });
      } else {
        card.animate(
          [{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(90deg)', opacity: 0.5 }],
          { duration: 210, delay: i * 100, fill: 'forwards' },
        );
      }
    });
    setTimeout(() => renderDemo(true), reduced ? 300 : wraps.length * 100 + 250);
  });

  const grid = document.getElementById('plans-grid') as HTMLElement;
  const renderPlans = (): void => {
    grid.replaceChildren();
    const plans: Array<{ code: 'free' | 'studio' | 'agency'; rec?: boolean }> = [
      { code: 'free' }, { code: 'studio', rec: true }, { code: 'agency' },
    ];
    for (const p of plans) {
      const price = p.code === 'free' ? '0.00' : PLAN_PRICES[p.code][term.value];
      const per = p.code === 'free' ? 'month' : term.value === 'monthly' ? 'month' : 'year';
      const group = h('div', { class: `plan-card${p.rec ? ' recommended' : ''}`, role: 'group', 'aria-label': `${PLAN_LABELS[p.code]} plan` });
      if (p.rec) group.appendChild(h('div', { class: 'plan-rec' }, 'Recommended'));
      group.appendChild(h('h3', {}, PLAN_LABELS[p.code]));
      group.appendChild(h('div', { class: 'plan-price' }, `€${amountFmt(price)} / ${per}`));
      grid.appendChild(group);
    }
  };
  renderPlans();
  document.querySelectorAll<HTMLInputElement>('input[name="term"]').forEach((input) => {
    input.addEventListener('change', () => {
      term.value = input.value as 'monthly' | 'annual';
      renderPlans();
    });
  });
}

// ---------------------------------------------------------------- sign-in

function pageSignIn(): void {
  app.innerHTML = '';
  app.appendChild(el(`<main class="page narrow">
    <h1>Sign in</h1>
    <form id="signin-form">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username">
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password">
      <button type="submit" id="signin-btn">Sign in</button>
    </form>
    <div role="alert" id="signin-alert" class="alert" hidden></div>
  </main>`));
  const form = document.getElementById('signin-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('signin-btn') as HTMLButtonElement;
    const email = (document.getElementById('email') as HTMLInputElement).value;
    const password = (document.getElementById('password') as HTMLInputElement).value;
    btn.textContent = 'Signing in…';
    btn.disabled = true;
    const res = await api<{ facilitator?: Facilitator }>('POST', '/api/session', { email, password });
    btn.disabled = false;
    btn.textContent = 'Sign in';
    if (res.status === 200) {
      facilitator = res.body.facilitator ?? null;
      window.location.hash = '#/workshops';
    } else {
      const alertEl = document.getElementById('signin-alert') as HTMLElement;
      alertEl.hidden = false;
      alertEl.textContent = errorMessage(res.body as never);
    }
  });
}

// ---------------------------------------------------------------- workshops

interface WorkshopObj {
  id: string; title: string; template: string; status: WorkshopStatus;
  scheduledStart: string; scheduledEnd: string; timeZone: string;
  fee: { amount: string }; joinUrl: string | null; recap?: { status: string; reason: string | null; attempts: number; recipients: number | null; recapUrl: string; invoice?: { number: string; amount: string } | null } | null;
}

async function pageWorkshops(): Promise<void> {
  app.innerHTML = '<main class="page"><p class="muted">Loading…</p></main>';
  const billing = await api<{ state?: string; readOnlyAt?: string | null; stale?: boolean; syncedAt?: string }>('GET', '/api/billing');
  const res = await api<{ workshops: WorkshopObj[] }>('GET', '/api/workshops');
  if (res.status === 401 || res.status === 403) {
    window.location.hash = '#/signin';
    return;
  }
  const workshops = res.body.workshops ?? [];
  const active = workshops.filter((w) => w.status !== 'archived');
  const archived = workshops.filter((w) => w.status === 'archived');
  app.innerHTML = '';
  const main = el('<main class="page"></main>');
  if (billing.status === 200 && (billing.body.state === 'past_due' || billing.body.state === 'read_only')) {
    const banner = el(`<div role="region" aria-label="Billing notice" class="alert">
      <span id="billing-banner-text"></span>
      <button id="retry-payment" aria-label="Retry payment">Retry payment</button>
    </div>`);
    const text = banner.querySelector('#billing-banner-text') as HTMLElement;
    if (billing.body.state === 'read_only') {
      text.textContent = 'Your workspace is read-only until the overdue payment is settled.';
    } else {
      text.textContent = `Your last payment didn't go through. Settle it by ${billing.body.readOnlyAt ? longDate(new Date(billing.body.readOnlyAt), facilitator?.timeZone ?? 'UTC') : ''} to keep editing.`;
    }
    banner.querySelector('#retry-payment')?.addEventListener('click', () => {
      window.location.hash = '#/billing';
    });
    main.appendChild(banner);
  }
  main.appendChild(el('<h1 class="page-heading">Your workshops</h1>'));
  main.appendChild(el(`<div class="toolbar-line">
    <button id="new-workshop">New workshop</button>
    <a href="#/billing">Plan and billing</a>
    <a href="#/activity">Activity log</a>
    <span style="flex:1"></span>
    <button id="signout" class="ghost" aria-label="Sign out">Sign out</button>
  </div>`));
  const list = el('<ul class="ruled" id="workshops-list" role="list" aria-label="Workshops"></ul>');
  for (const w of active) {
    const li = h('li');
    const start = `${w.scheduledStart.replace('T', ' ')}`;
    li.appendChild(h('a', { href: `#/w/${w.id}` }, w.title));
    li.appendChild(h('span', { class: 'badge' }, STATUS_LABELS[w.status]));
    li.appendChild(h('span', { class: 'muted' }, start));
    list.appendChild(li);
  }
  main.appendChild(list);
  const archTitle = el('<h2>Archived</h2>');
  const archList = el('<ul class="ruled" role="list" aria-label="Archived"></ul>');
  for (const w of archived) {
    const li = h('li');
    li.appendChild(h('a', { href: `#/w/${w.id}` }, w.title));
    li.appendChild(h('span', { class: 'badge' }, 'Archived'));
    archList.appendChild(li);
  }
  if (archived.length > 0) main.append(archTitle, archList);
  app.appendChild(main);
  document.getElementById('signout')?.addEventListener('click', async () => {
    await api('DELETE', '/api/session');
    facilitator = null;
    window.location.hash = '#/';
  });
  document.getElementById('new-workshop')?.addEventListener('click', () => openNewWorkshopDialog());
}

function openNewWorkshopDialog(): void {
  import('./ui.js').then(({ openDialog }) => {
    openDialog({ label: 'New workshop', onOpen: (dialog) => {
      dialog.innerHTML = `<h2>New workshop</h2>
        <label for="nw-title">Title</label>
        <input id="nw-title">
        <div role="radiogroup" aria-label="Template" id="nw-templates"></div>
        <label for="nw-start">Starts</label>
        <input id="nw-start" type="datetime-local">
        <label for="nw-end">Ends</label>
        <input id="nw-end" type="datetime-local">
        <label for="nw-sponsor">Sponsor email</label>
        <input id="nw-sponsor" type="email">
        <label for="nw-fee">Client fee (EUR)</label>
        <input id="nw-fee" inputmode="decimal">
        <div class="row"><button id="nw-create">Create workshop</button><button id="nw-cancel" class="ghost">Cancel</button></div>`;
      const templates = [
        { code: 'retrospective', label: 'Retrospective' },
        { code: 'discovery', label: 'Discovery sprint' },
        { code: 'strategy', label: 'Strategy offsite' },
        { code: 'blank', label: 'Blank' },
      ];
      const group = dialog.querySelector('#nw-templates') as HTMLElement;
      templates.forEach((t, i) => {
        const label = h('label') as HTMLLabelElement;
        const input = h('input', { type: 'radio', name: 'template', value: t.code }) as HTMLInputElement;
        if (i === 0) input.checked = true;
        input.addEventListener('change', () => {
          group.querySelectorAll('input').forEach((x) => { (x as HTMLInputElement).checked = x === input; });
        });
        label.append(input, ` ${t.label}`);
        group.appendChild(label);
      });
      dialog.querySelector('#nw-cancel')?.addEventListener('click', () => dialog.close());
      dialog.querySelector('#nw-create')?.addEventListener('click', async () => {
        const btn = dialog.querySelector('#nw-create') as HTMLButtonElement;
        btn.textContent = 'Creating…';
        btn.disabled = true;
        const fee = (dialog.querySelector('#nw-fee') as HTMLInputElement).value.trim();
        const body: Record<string, unknown> = {
          title: (dialog.querySelector('#nw-title') as HTMLInputElement).value,
          template: (dialog.querySelector('input[name="template"]:checked') as HTMLInputElement).value,
          scheduledStart: (dialog.querySelector('#nw-start') as HTMLInputElement).value,
          scheduledEnd: (dialog.querySelector('#nw-end') as HTMLInputElement).value,
          sponsorEmail: (dialog.querySelector('#nw-sponsor') as HTMLInputElement).value,
        };
        if (fee !== '') body.fee = fee;
        const res = await api<{ workshop: WorkshopObj }>('POST', '/api/workshops', body, { retry: true });
        btn.disabled = false;
        btn.textContent = 'Create workshop';
        if (res.status === 201) {
          dialog.close();
          say(`Workshop created from the ${TEMPLATE_TEXT[res.body.workshop.template] ?? res.body.workshop.template} template`);
          window.location.hash = `#/w/${res.body.workshop.id}`;
        } else {
          const fields = errorFields(res.body as never);
          complain(errorMessage(res.body as never));
          for (const [k, v] of Object.entries(fields)) {
            const input = dialog.querySelector(`#nw-${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`) as HTMLInputElement | null;
            if (input) input.setCustomValidity(v);
            const msg = dialog.querySelector(`[data-field="${k}"]`) as HTMLElement | null;
            if (msg) msg.textContent = v;
            else {
              const label = input?.previousElementSibling;
              const err = h('div', { class: 'field-error', 'data-field': k }, v);
              label?.after(err);
            }
          }
          if (res.status === 402) {
            dialog.close();
            window.location.hash = '#/billing';
          }
        }
      });
    } });
  });
}

const TEMPLATE_TEXT: Record<string, string> = {
  retrospective: 'Retrospective',
  discovery: 'Discovery sprint',
  strategy: 'Strategy offsite',
  blank: 'Blank',
};

// ---------------------------------------------------------------- billing

async function pageBilling(): Promise<void> {
  app.innerHTML = '<main class="page"><p class="muted">Loading…</p></main>';
  const res = await api<{
    plan: 'free' | 'studio' | 'agency'; term: 'monthly' | 'annual'; state: string;
    readOnlyAt: string | null; renewsOn: string; pendingChange: { plan: string; term: string; effectiveDate: string } | null;
    entitlements: { activeWorkshops: number | null; invitesPerDay: number | null };
    usage: { activeWorkshops: number; invitesToday: number };
    invoices: Array<{ id: string; number: string; date: string; amount: string; status: string }>;
    stale: boolean; syncedAt: string;
  }>('GET', '/api/billing');
  if (res.status === 401 || res.status === 403) {
    window.location.hash = '#/signin';
    return;
  }
  const b = res.body;
  app.innerHTML = '';
  const main = el('<main class="page"></main>');
  main.appendChild(el('<h1 class="page-heading">Plan and billing</h1>'));
  const pageStatus = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Billing activity', class: 'visually-hidden' });
  const pageAlert = h('div', { role: 'alert', 'aria-live': 'assertive', 'aria-label': 'Billing problems', class: 'visually-hidden' });
  if (b.state === 'past_due' || b.state === 'read_only') {
    const banner = el(`<div role="region" aria-label="Billing notice" class="alert">
      <span id="bill-banner-text"></span>
      <button id="bill-retry" aria-label="Retry payment">Retry payment</button>
    </div>`);
    const text = banner.querySelector('#bill-banner-text') as HTMLElement;
    text.textContent = b.state === 'read_only'
      ? 'Your workspace is read-only until the overdue payment is settled.'
      : `Your last payment didn't go through. Settle it by ${b.readOnlyAt ? longDate(new Date(b.readOnlyAt), facilitator?.timeZone ?? 'UTC') : ''} to keep editing.`;
    banner.querySelector('#bill-retry')?.addEventListener('click', async () => {
      const btn = banner.querySelector('#bill-retry') as HTMLButtonElement;
      btn.textContent = 'Retrying…';
      const r = await api('POST', '/api/billing/payments', { clientOpId: newClientOpId() }, { retry: true });
      btn.textContent = 'Retry payment';
      if (r.status === 200) {
        pageStatus.textContent = 'Payment received. Your workspace is fully editable again.';
        void pageBilling();
      } else {
        pageAlert.textContent = errorMessage(r.body as never);
      }
    });
    main.appendChild(banner);
  }
  const tz = facilitator?.timeZone ?? 'UTC';
  main.appendChild(el(`<p id="current-plan">${PLAN_LABELS[b.plan]} (${TERM_LABELS[b.term]}) — renews on ${longDate(new Date(b.renewsOn + 'T00:00:00Z'), tz)}</p>`));
  if (b.stale) {
    main.appendChild(el(`<p class="muted">Showing your plan as of ${longDate(new Date(b.syncedAt), tz)}, ${hhmm(new Date(b.syncedAt), tz)} — billing is unavailable.</p>`));
  }
  if (b.pendingChange) {
    main.appendChild(el(`<p id="pending-change">Changes on ${b.pendingChange.effectiveDate} to ${PLAN_LABELS[b.pendingChange.plan as 'free']} (${TERM_LABELS[b.pendingChange.term as 'monthly']})</p>`));
  }
  main.appendChild(el(`<div role="radiogroup" aria-label="Plan" id="plan-radios"></div>`));
  const planGroup = main.querySelector('#plan-radios') as HTMLElement;
  for (const plan of ['free', 'studio', 'agency'] as const) {
    const label = h('label') as HTMLLabelElement;
    const input = h('input', { type: 'radio', name: 'plan', value: plan }) as HTMLInputElement;
    if (plan === b.plan) input.checked = true;
    label.append(input, ` ${PLAN_LABELS[plan]}`);
    planGroup.appendChild(label);
  }
  main.appendChild(el(`<div role="radiogroup" aria-label="Billing term" id="term-radios"></div>`));
  const termGroup = main.querySelector('#term-radios') as HTMLElement;
  for (const term of ['monthly', 'annual'] as const) {
    const label = h('label') as HTMLLabelElement;
    const input = h('input', { type: 'radio', name: 'term', value: term }) as HTMLInputElement;
    if (term === b.term) input.checked = true;
    label.append(input, ` ${TERM_LABELS[term]}`);
    termGroup.appendChild(label);
  }
  const changeBtn = h('button', { 'aria-label': 'Change plan' }, 'Change plan') as HTMLButtonElement;
  main.appendChild(changeBtn);
  changeBtn.addEventListener('click', async () => {
    const plan = (main.querySelector('input[name="plan"]:checked') as HTMLInputElement).value;
    const term = (main.querySelector('input[name="term"]:checked') as HTMLInputElement).value;
    changeBtn.textContent = 'Changing…';
    changeBtn.disabled = true;
    const res2 = await api<{ invoice: { number: string; amount: string } | null }>('POST', '/api/billing/plan', { clientOpId: newClientOpId(), plan, term }, { retry: true });
    changeBtn.disabled = false;
    changeBtn.textContent = 'Change plan';
    if (res2.status === 200) {
      const inv = res2.body.invoice;
      pageStatus.textContent = inv
        ? `Plan changed to ${PLAN_LABELS[plan as 'free']} (${TERM_LABELS[term as 'monthly']}). Invoice ${inv.number} for €${amountFmt(inv.amount)}.`
        : `Plan changed to ${PLAN_LABELS[plan as 'free']} (${TERM_LABELS[term as 'monthly']}).`;
      void pageBilling();
    } else {
      pageAlert.textContent = errorMessage(res2.body as never);
    }
  });
  const usage = el('<ul class="ruled" id="usage-list" role="list" aria-label="Usage"></ul>');
  const capText = (used: number, cap: number | null): string => cap === null ? `${used}, unlimited` : `${used} of ${cap}`;
  usage.appendChild(h('li', {}, `Active workshops — ${capText(b.usage.activeWorkshops, b.entitlements.activeWorkshops)}`));
  usage.appendChild(h('li', {}, `Invites today — ${capText(b.usage.invitesToday, b.entitlements.invitesPerDay)}`));
  main.appendChild(usage);
  const invoices = el('<ul class="ruled" id="invoices" role="list" aria-label="Invoices"></ul>');
  for (const inv of b.invoices) {
    const paid = inv.status === 'paid';
    invoices.appendChild(h('li', {}, `${longDate(new Date(inv.date + 'T00:00:00Z'), tz)} — Invoice ${inv.number} — €${amountFmt(inv.amount)} — ${paid ? 'Paid' : 'Unpaid'}`));
  }
  if (b.invoices.length > 0) main.appendChild(invoices);
  main.append(pageStatus, pageAlert);
  app.appendChild(main);
}

// ---------------------------------------------------------------- activity

async function pageActivity(): Promise<void> {
  app.innerHTML = '<main class="page"><p class="muted">Loading…</p></main>';
  const first = await api<{ entries: Array<{ id: string; seq: number; at: string; action: string; workshopId: string | null }>; nextCursor: string | null }>('GET', '/api/activity?limit=20');
  if (first.status === 401 || first.status === 403) {
    window.location.hash = '#/signin';
    return;
  }
  const main = el('<main class="page"></main>');
  main.appendChild(el('<h1 class="page-heading">Activity log</h1>'));
  const list = el('<ul class="ruled" role="list" aria-label="Activity"></ul>');
  main.appendChild(list);
  const renderEntry = (e: { at: string; action: string; workshopId: string | null }): HTMLElement => {
    const d = new Date(e.at);
    const time = hhmm(d, facilitator?.timeZone ?? 'UTC');
    const workshop = e.workshopId ? workshopTitleCache.get(e.workshopId) : undefined;
    const label = ACTION_LABELS[e.action] ?? e.action;
    return h('li', { tabindex: '0' }, `${longDate(d, facilitator?.timeZone ?? 'UTC')}, ${time} — ${label}${workshop ? ` — ${workshop}` : ''}`);
  };
  for (const e of first.body.entries) list.appendChild(renderEntry(e));
  let cursor = first.body.nextCursor;
  const moreBtn = h('button', { 'aria-label': 'Load more' }, 'Load more') as HTMLButtonElement;
  moreBtn.addEventListener('click', async () => {
    if (!cursor) return;
    const res = await api<{ entries: typeof first.body.entries; nextCursor: string | null }>('GET', `/api/activity?cursor=${encodeURIComponent(cursor)}&limit=20`);
    if (res.status === 200) {
      const firstNew = renderEntry(res.body.entries[0]);
      list.appendChild(firstNew);
      for (const e of res.body.entries.slice(1)) list.appendChild(renderEntry(e));
      cursor = res.body.nextCursor;
      firstNew.focus();
      if (!cursor) moreBtn.remove();
    }
  });
  if (cursor) main.appendChild(moreBtn);
  app.replaceChildren(main);
  void api<{ workshops: WorkshopObj[] }>('GET', '/api/workshops').then((r) => {
    if (r.status === 200) {
      for (const w of r.body.workshops) workshopTitleCache.set(w.id, w.title);
      list.replaceChildren();
      for (const e of first.body.entries) list.appendChild(renderEntry(e));
    }
  });
}

const workshopTitleCache = new Map<string, string>();

const ACTION_LABELS: Record<string, string> = {
  'workshop.created': 'Workshop created',
  'workshop.transitioned': 'Moved to',
  'join_link.rotated': 'Join link replaced',
  'join_link.turned_off': 'Join link turned off',
  'invites.sent': 'Invites added',
  'frame.trashed': 'Frame moved to trash',
  'frame.restored': 'Frame restored',
  'frame.purged': 'Frame purged',
  'version.restored': 'Version restored',
  'note.facilitator_only_changed': 'Facilitator-only flag changed',
  'plan.changed': 'Plan changed',
  'plan.change_scheduled': 'Plan change scheduled',
  'payment.retried': 'Payment retried',
  'sponsor.invoiced': 'Sponsor invoiced',
  'recap.completed': 'Recap sent',
};

// ---------------------------------------------------------------- join

async function pageJoin(token: string): Promise<void> {
  app.innerHTML = '<main class="page narrow"><p class="muted">Loading…</p></main>';
  const info = await api<{ workshop: { title: string; status: string; scheduledStart: string; scheduledEnd: string; timeZone: string } }>('GET', `/api/join/${token}`);
  const main = el('<main class="page narrow"></main>');
  const alertBox = h('div', { role: 'alert', id: 'join-alert', class: 'alert', hidden: 'hidden' });
  if (info.status === 404) {
    main.appendChild(el('<h1>We couldn\'t find that workshop link.</h1>'));
    app.replaceChildren(main);
    return;
  }
  if (info.status === 410) {
    const code = (info.body as { error?: { code?: string } }).error?.code;
    main.appendChild(el(`<h1>${code === 'link_revoked' ? 'This join link has been turned off. Ask your facilitator for a new one.' : 'This join link has expired. Ask your facilitator for a new one.'}</h1>`));
    app.replaceChildren(main);
    return;
  }
  const workshop = info.body.workshop;
  main.appendChild(el(`<h1>${escapeHtml(workshop.title)}</h1>`));
  main.appendChild(el(`<p class="muted">${workshop.scheduledStart.replace('T', ' ')} to ${workshop.scheduledEnd.replace('T', ' ')} (${workshop.timeZone})</p>`));
  main.appendChild(el(`<form id="join-form">
    <label for="join-name">Your name</label>
    <input id="join-name" autocomplete="name">
    <button type="submit" id="join-btn">Join workshop</button>
  </form>`));
  main.appendChild(alertBox);
  app.replaceChildren(main);
  (document.getElementById('join-form') as HTMLFormElement).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('join-btn') as HTMLButtonElement;
    btn.textContent = 'Joining…';
    btn.disabled = true;
    const displayName = (document.getElementById('join-name') as HTMLInputElement).value;
    const res = await api<{ workshopId: string }>('POST', `/api/join/${token}`, { displayName }, { retry: true });
    btn.disabled = false;
    btn.textContent = 'Join workshop';
    if (res.status === 200 || res.status === 201) {
      window.location.hash = `#/w/${res.body.workshopId}`;
    } else {
      const code = (res.body as { error?: { code?: string } }).error?.code;
      const retryAfter = res.headers['retry-after'];
      let message = errorMessage(res.body as never);
      if (code === 'workshop_not_open') message = "This workshop hasn't opened yet. Try again when your facilitator opens the room.";
      if (code === 'workshop_closed') message = 'This workshop has ended.';
      if (code === 'room_full') message = 'This room is full. Ask your facilitator to free a place.';
      if (code === 'rate_limited') message = `Too many attempts — try again in ${retryAfter ?? ''} seconds.`;
      alertBox.hidden = false;
      alertBox.textContent = message;
    }
  });
}

// ---------------------------------------------------------------- room and recap

async function pageRoom(workshopId: string): Promise<void> {
  renderRoom(app, workshopId, {});
  wirePresenceSending(workshopId);
}

async function pageRecap(token: string): Promise<void> {
  app.innerHTML = '<main class="page"><p class="muted">Loading…</p></main>';
  const res = await api<{
    workshop: { title: string };
    status: string; reason: string | null;
    invoice: { number: string; amount: string } | null;
    files: Array<{ name: string; label: string; url: string }>;
    clusters: Array<{ frame: string; title: string; dotTotal: number; notes: string[] }>;
  }>('GET', `/api/recaps/${token}`);
  if (res.status !== 200) {
    app.innerHTML = '<main class="page"><h1>Not found</h1></main>';
    return;
  }
  const r = res.body;
  const main = el('<main class="page"></main>');
  main.appendChild(el(`<h1 class="page-heading">Recap: ${escapeHtml(r.workshop.title)}</h1>`));
  const statusText = r.status === 'complete' ? 'Recap sent' : 'Recap in progress';
  main.appendChild(el(`<p id="recap-status">${statusText}</p>`));
  if (r.invoice) {
    main.appendChild(el(`<p class="mono">Invoice ${r.invoice.number} — €${amountFmt(r.invoice.amount)}</p>`));
  }
  const files = el('<ul class="ruled" role="list" aria-label="Recap files"></ul>');
  for (const f of r.files) {
    files.appendChild(h('li', {}, '')).appendChild(h('a', { href: f.url }, f.label));
  }
  if (r.files.length > 0) main.appendChild(files);
  const ranking = el('<ul class="ruled" role="list" aria-label="Cluster ranking"></ul>');
  for (const c of r.clusters) {
    const li = h('li');
    li.appendChild(h('div', {}, `${c.frame} — ${c.title} — ${c.dotTotal} dots`));
    for (const note of c.notes) li.appendChild(h('div', { class: 'muted' }, note));
    ranking.appendChild(li);
  }
  main.appendChild(ranking);
  app.replaceChildren(main);
}
