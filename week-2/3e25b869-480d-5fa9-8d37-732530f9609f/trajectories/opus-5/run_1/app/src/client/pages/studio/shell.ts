import type { Bilingual } from '../../../shared/catalog.js';
import { STUDIO, UI } from '../../../shared/copy.js';
import type { StaffRole } from '../../../shared/types.js';
import { api, ApiFailure } from '../../api.js';
import { announce, clearRegion, regionText } from '../../live.js';
import { navigate } from '../../router.js';
import { loadStaff, store } from '../../store.js';
import { bind, bindText, el, labelled, refresh, say } from '../../ui.js';

export type StudioPage =
  | 'batches'
  | 'packing'
  | 'finance'
  | 'reconciliation'
  | 'audit'
  | 'notices';

const NAV: { page: StudioPage; href: string; text: Bilingual; roles: StaffRole[] }[] = [
  { page: 'batches', href: '/studio/batches', text: UI.navBatches, roles: ['maker'] },
  { page: 'packing', href: '/studio/packing', text: UI.navPacking, roles: ['maker', 'packing'] },
  { page: 'finance', href: '/studio/finance', text: UI.navFinance, roles: ['maker', 'finance'] },
  {
    page: 'reconciliation',
    href: '/studio/reconciliation',
    text: UI.navReconciliation,
    roles: ['maker', 'finance'],
  },
  { page: 'audit', href: '/studio/audit', text: UI.navAudit, roles: ['maker', 'finance'] },
  { page: 'notices', href: '/studio/notices', text: UI.navNotices, roles: ['maker', 'finance'] },
];

export function allowedPages(role: StaffRole): StudioPage[] {
  return NAV.filter((entry) => entry.roles.includes(role)).map((entry) => entry.page);
}

function studioNavigation(role: StaffRole): HTMLElement {
  const nav = el('nav', { class: 'studio-nav' });
  const list = el('ul', { class: 'studio-nav-list' });
  for (const entry of NAV) {
    if (!entry.roles.includes(role)) continue;
    const link = el('a', { href: entry.href, class: 'nav-link' });
    bindText(link, () => say(entry.text));
    list.append(el('li', {}, [link]));
  }
  nav.append(list);
  bind(() => nav.setAttribute('aria-label', say(UI.studioNav)));
  return nav;
}

export function studioRegion(): HTMLElement {
  const region = el('p', { role: 'status', class: 'live-region' });
  bind(() => {
    region.setAttribute('aria-label', say(UI.studioUpdates));
    region.textContent = regionText('studio');
  });
  return region;
}

export function reportStudioFailure(error: unknown, fallback: Bilingual): void {
  if (!(error instanceof ApiFailure)) throw error;
  if (error.status === 403) announce('studio', STUDIO.forbidden);
  else if (error.code === 'stale_version') announce('studio', STUDIO.staleVersion);
  else if (error.status === 503) announce('studio', STUDIO.billingUnavailable);
  else announce('studio', fallback);
}

function signInForm(main: HTMLElement): void {
  const heading = el('h1', { class: 'page-heading' });
  const email = el('input', { type: 'email', class: 'input', autocomplete: 'username' });
  const password = el('input', { type: 'password', class: 'input', autocomplete: 'current-password' });
  const submit = el('button', { type: 'submit', class: 'button primary' });
  const alert = el('div', { role: 'alert', class: 'alert', hidden: true });
  const form = el('form', { class: 'studio-sign-in' }, [
    alert,
    labelled(UI.email, email),
    labelled(UI.password, password),
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await api.post('/api/staff/sign-in', { email: email.value.trim(), password: password.value });
        await loadStaff();
        const first = store.staff ? allowedPages(store.staff.role)[0] : 'batches';
        navigate(`/studio/${first}`, { replace: true });
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        alert.hidden = false;
        refresh();
      }
    })();
  });
  bind(() => {
    heading.textContent = say(UI.studioHeading);
    submit.textContent = say(UI.signIn);
    alert.textContent = alert.hidden ? '' : say(UI.studioSignInFailed);
  });
  main.append(heading, form);
}

export type StudioRenderer = (body: HTMLElement, role: StaffRole) => void | Promise<void>;

export async function renderStudio(
  main: HTMLElement,
  page: StudioPage | null,
  renderers: Record<StudioPage, StudioRenderer>,
): Promise<void> {
  clearRegion('studio');
  const signedIn = await loadStaff();
  const staff = store.staff;
  if (!signedIn || !staff) {
    signInForm(main);
    return;
  }
  const permitted = allowedPages(staff.role);
  const target = page && permitted.includes(page) ? page : (permitted[0] as StudioPage);
  if (page !== target) {
    navigate(`/studio/${target}`, { replace: true });
    return;
  }
  const signOut = el('button', { type: 'button', class: 'button quiet' });
  signOut.addEventListener('click', () => {
    void (async () => {
      await api.post('/api/staff/sign-out');
      store.staff = null;
      navigate('/studio', { replace: true });
    })();
  });
  bindText(signOut, () => say(UI.signOut));
  const body = el('div', { class: 'studio-body' });
  main.append(
    el('div', { class: 'studio-shell' }, [studioNavigation(staff.role), body, signOut]),
  );
  await renderers[target](body, staff.role);
}
