import { el } from './ui.js';
import { get, post, ApiRequestFailed } from './api.js';
import { renderHeader, renderFooter, type Me } from './shell.js';
import { renderTodayScreen } from './today.js';
import { renderWardScreen } from './ward.js';
import { renderPatientsScreen, renderPatientRecord, renderConsultScreen } from './patients.js';
import { renderInvoicesScreen, renderInvoiceScreen } from './invoices.js';
import { renderStockScreen, renderStaffScreen } from './staff.js';
import { renderPublicBooking, renderConfirmation, notFoundCard } from './public.js';
import { live, announcer, ensureSession } from './live.js';

const ROLE_SCREEN_ACCESS: Record<string, string[]> = {
  '/today': ['front-desk', 'nurse', 'vet', 'manager'],
  '/ward': ['front-desk', 'nurse', 'vet', 'manager'],
  '/patients': ['front-desk', 'nurse', 'vet', 'manager'],
  '/consult': ['front-desk', 'nurse', 'vet', 'manager'],
  '/invoices': ['front-desk', 'vet', 'manager'],
  '/stock': ['front-desk', 'nurse', 'vet', 'manager'],
  '/staff': ['manager'],
};

const STAFF_PREFIXES = ['/today', '/ward', '/patients', '/consult', '/invoices', '/stock', '/staff'];

async function main(): Promise<void> {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);

  // public routes first
  if (path === '/login') return renderLogin();
  if (path.startsWith('/invite/')) return renderInvite(path.slice('/invite/'.length));
  if (path.startsWith('/book/')) {
    const parts = path.split('/');
    const slug = parts[2];
    if (parts[3] === 'confirmation' && parts[4]) {
      return renderConfirmation(document.getElementById('root')!, slug, parts[4]);
    }
    return renderPublicBooking(document.getElementById('root')!, slug, query.get('pet'));
  }

  const isStaffScreen = STAFF_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
  if (!isStaffScreen && path !== '/') {
    const root = document.getElementById('root')!;
    root.textContent = '';
    const me = await ensureSession();
    root.append(notFoundCard());
    void me;
    return;
  }

  const me = await ensureSession();
  if (!me) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
    return;
  }

  live.start();
  live.onEvent((event) => {
    if (event === 'access-removed') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    if (event === 'role-changed') {
      // the very next request obeys the new role; re-check the current screen
      void ensureSession().then((fresh) => {
        if (fresh) renderApp(fresh);
      });
    }
  });

  renderApp(me);
}

async function renderApp(me: Me): Promise<void> {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const root = document.getElementById('root')!;

  const prefix = '/' + path.split('/')[1];
  const allowed = ROLE_SCREEN_ACCESS[prefix];
  if (allowed && !allowed.includes(me.role)) {
    root.textContent = '';
    root.append(renderHeader(me, path, (p) => (window.location.href = p)));
    root.append(el('main', {}, forbiddenCard()));
    root.append(renderFooter(me, me.clinic.slug));
    return;
  }

  const navigate = (p: string): void => {
    window.location.href = p;
  };

  root.textContent = '';
  const header = renderHeader(me, path, navigate);
  const main = el('div', { id: 'screen-root' });
  const footer = renderFooter(me, me.clinic.slug);
  root.append(header, main, footer);

  live.setRefetch(() => {
    void ensureSession().then((fresh) => {
      if (fresh) renderApp(fresh);
    });
  });

  if (path === '/' || path === '/today') {
    renderTodayScreen(main, me, path, navigate);
  } else if (path === '/ward') {
    renderWardScreen(main, me, path, navigate);
  } else if (path === '/patients') {
    renderPatientsScreen(main, me);
  } else if (path.startsWith('/patients/')) {
    renderPatientRecord(main, me, path.split('/')[2], query.get('tab') ?? 'overview');
  } else if (path.startsWith('/consult/')) {
    renderConsultScreen(main, me, path.split('/')[2]);
  } else if (path === '/invoices') {
    renderInvoicesScreen(main, me);
  } else if (path.startsWith('/invoices/')) {
    renderInvoiceScreen(main, me, path.split('/')[2]);
  } else if (path === '/stock') {
    renderStockScreen(main, me);
  } else if (path === '/staff') {
    renderStaffScreen(main, me);
  } else {
    main.textContent = '';
    main.append(notFoundCard());
  }
}

function forbiddenCard(): HTMLElement {
  const card = el('div', { class: 'tinted-card', style: 'max-width:640px;margin:0 auto' });
  card.append(el('p', { style: 'font-weight:700;color:#14212b', text: 'Your role cannot do that.' }));
  card.append(el('a', { class: 'pill pill-primary', href: '/today' }, 'Go to today'));
  return card;
}

// ---------- login ----------

function renderLogin(): void {
  const root = document.getElementById('root')!;
  root.textContent = '';
  const query = new URLSearchParams(window.location.search);
  const next = query.get('next') ?? '';
  const main = el('main', { style: 'max-width:460px;margin:0 auto;padding:64px 24px' });
  const card = el('div', { class: 'tinted-card' });
  card.append(el('h1', { class: 'screen-headline', style: 'font-size:32px', text: 'Sign in' }));
  const errP = el('p', { role: 'alert' });
  const email = el('input', { class: 'input-pill', 'aria-label': 'Email', type: 'email' }) as HTMLInputElement;
  const password = el('input', { class: 'input-pill', 'aria-label': 'Password', type: 'password' }) as HTMLInputElement;
  const submit = el('button', { class: 'pill pill-primary', style: 'margin-top:8px' }, 'Sign in');
  submit.addEventListener('click', async () => {
    submit.setAttribute('aria-busy', 'true');
    try {
      const res = await post('/api/session', { email: email.value, password: password.value, next });
      window.location.href = res.landing;
    } catch (e) {
      if (e instanceof ApiRequestFailed) errP.textContent = e.err.message;
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });
  card.append(
    el('div', { class: 'field' }, el('label', { text: 'Email' }), email),
    el('div', { class: 'field' }, el('label', { text: 'Password' }), password),
    errP,
    submit,
  );
  main.append(card);
  root.append(main);
  email.focus();
}

function renderInvite(token: string): void {
  const root = document.getElementById('root')!;
  root.textContent = '';
  const main = el('main', { style: 'max-width:460px;margin:0 auto;padding:64px 24px' });
  const card = el('div', { class: 'tinted-card' });
  main.append(card);
  root.append(main);
  void (async () => {
    try {
      const inv = await get(`/api/invitations/${token}`);
      card.append(el('h1', { class: 'screen-headline', style: 'font-size:32px', text: `Join ${inv.clinicName}` }));
      const errP = el('p', { role: 'alert' });
      const password = el('input', { class: 'input-pill', 'aria-label': 'Password', type: 'password' }) as HTMLInputElement;
      const submit = el('button', { class: 'pill pill-primary' }, 'Set password');
      submit.addEventListener('click', async () => {
        try {
          await post(`/api/invitations/${token}/accept`, { password: password.value });
          window.location.href = '/today';
        } catch (e) {
          if (e instanceof ApiRequestFailed) errP.textContent = e.err.message;
        }
      });
      card.append(
        el('div', { class: 'field' }, el('label', { text: 'Password' }), password),
        errP,
        submit,
      );
      password.focus();
    } catch {
      card.append(el('h1', { class: 'screen-headline', style: 'font-size:32px', text: "We couldn't find that page." }));
      card.append(el('a', { class: 'pill pill-primary', href: '/today' }, 'Back to today'));
    }
  })();
}

main();
