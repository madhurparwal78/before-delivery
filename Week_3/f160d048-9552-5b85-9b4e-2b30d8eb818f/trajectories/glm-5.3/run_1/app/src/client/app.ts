// The client entry: routing, the app shell and page composition.
import { h, clear } from './dom.js';
import { api, ApiFailure } from './api.js';
import type { Me } from './types.js';
import { announce, alertBand, setToastSeconds } from './feedback.js';
import { openDialog } from './feedback.js';
import { live, onReload } from './live.js';
import { landingPage } from './pages/landing.js';
import { signInPage, joinPage, joinConfirmPage, forgotPasswordPage, resetPasswordPage } from './pages/auth.js';
import { jobsPage, jobPage, applyPage } from './pages/jobs.js';
import { companiesPage, companyPage } from './pages/companies.js';
import { contributePage, reviewFormPage, payFormPage, interviewFormPage } from './pages/contribute.js';
import { myContributionsPage } from './pages/contributions.js';
import { savedJobsPage, alertsPage } from './pages/saved.js';
import { applicationsPage, applicationDetailPage } from './pages/applications.js';
import { channelsPage, channelPage } from './pages/channels.js';
import { moderationPage } from './pages/moderation.js';
import { employerHomePage, newJobPage, pipelinePage, applicantPage } from './pages/employer.js';
import { founderPage } from './pages/founder.js';

export interface PageContext {
  me: Me | null;
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
  navigate: (path: string) => void;
  rerender: () => void;
  refreshMe: () => Promise<void>;
}

let me: Me | null = null;
export { me as meState };

async function refreshMe(): Promise<void> {
  try {
    me = await api.get<Me>('/api/me');
  } catch {
    me = null;
  }
}

export function currentMe(): Me | null {
  return me;
}

function navigate(path: string): void {
  window.history.pushState(null, '', path);
  void render();
}

function route(pathname: string): { page: (ctx: PageContext) => HTMLElement; params: Record<string, string> } | null {
  const table: { pattern: RegExp; page: (ctx: PageContext) => HTMLElement }[] = [
    { pattern: /^\/$/, page: (ctx) => landingPage(ctx) },
    { pattern: /^\/sign-in$/, page: (ctx) => signInPage(ctx) },
    { pattern: /^\/join$/, page: (ctx) => joinPage(ctx) },
    { pattern: /^\/join\/confirm$/, page: (ctx) => joinConfirmPage(ctx) },
    { pattern: /^\/forgot-password$/, page: (ctx) => forgotPasswordPage(ctx) },
    { pattern: /^\/reset-password$/, page: (ctx) => resetPasswordPage(ctx) },
    { pattern: /^\/jobs$/, page: (ctx) => jobsPage(ctx) },
    { pattern: /^\/jobs\/([^/]+)$/, page: (ctx) => jobPage(ctx) },
    { pattern: /^\/jobs\/([^/]+)\/apply$/, page: (ctx) => applyPage(ctx) },
    { pattern: /^\/companies$/, page: (ctx) => companiesPage(ctx) },
    { pattern: /^\/companies\/([^/]+)$/, page: (ctx) => companyPage(ctx) },
    { pattern: /^\/companies\/([^/]+)\/reviews\/([^/]+)$/, page: (ctx) => companyPage(ctx) },
    { pattern: /^\/contribute$/, page: (ctx) => contributePage(ctx) },
    { pattern: /^\/contribute\/review$/, page: (ctx) => reviewFormPage(ctx) },
    { pattern: /^\/contribute\/pay$/, page: (ctx) => payFormPage(ctx) },
    { pattern: /^\/contribute\/interview$/, page: (ctx) => interviewFormPage(ctx) },
    { pattern: /^\/me\/contributions$/, page: (ctx) => myContributionsPage(ctx) },
    { pattern: /^\/saved$/, page: (ctx) => savedJobsPage(ctx) },
    { pattern: /^\/alerts$/, page: (ctx) => alertsPage(ctx) },
    { pattern: /^\/applications$/, page: (ctx) => applicationsPage(ctx) },
    { pattern: /^\/applications\/([^/]+)$/, page: (ctx) => applicationDetailPage(ctx) },
    { pattern: /^\/channels$/, page: (ctx) => channelsPage(ctx) },
    { pattern: /^\/channels\/([^/]+)$/, page: (ctx) => channelPage(ctx) },
    { pattern: /^\/moderation$/, page: (ctx) => moderationPage(ctx) },
    { pattern: /^\/employer$/, page: (ctx) => employerHomePage(ctx) },
    { pattern: /^\/employer\/jobs\/new$/, page: (ctx) => newJobPage(ctx) },
    { pattern: /^\/employer\/jobs\/([^/]+)$/, page: (ctx) => pipelinePage(ctx) },
    { pattern: /^\/employer\/applications\/([^/]+)$/, page: (ctx) => applicantPage(ctx) },
    { pattern: /^\/founder$/, page: (ctx) => founderPage(ctx) },
  ];
  for (const entry of table) {
    const match = pathname.match(entry.pattern);
    if (!match) continue;
    const params: Record<string, string> = {};
    match.slice(1).forEach((value, index) => {
      params[String(index + 1)] = value;
    });
    return { page: entry.page, params };
  }
  return null;
}

function namedParams(pathname: string): Record<string, string> {
  const reviewMatch = pathname.match(/^\/companies\/([^/]+)\/reviews\/([^/]+)$/);
  if (reviewMatch) return { slug: reviewMatch[1], id: reviewMatch[2] };
  const jobApply = pathname.match(/^\/jobs\/([^/]+)\/apply$/);
  if (jobApply) return { id: jobApply[1] };
  const job = pathname.match(/^\/jobs\/([^/]+)$/);
  if (job) return { id: job[1] };
  const company = pathname.match(/^\/companies\/([^/]+)$/);
  if (company) return { slug: company[1] };
  const application = pathname.match(/^\/applications\/([^/]+)$/);
  if (application) return { id: application[1] };
  const channel = pathname.match(/^\/channels\/([^/]+)$/);
  if (channel) return { slug: channel[1] };
  const pipeline = pathname.match(/^\/employer\/jobs\/([^/]+)$/);
  if (pipeline) return { id: pipeline[1] };
  const applicant = pathname.match(/^\/employer\/applications\/([^/]+)$/);
  if (applicant) return { id: applicant[1] };
  return {};
}

function notFoundPage(): HTMLElement {
  return h('main', { class: 'page' },
    h('h1', {}, 'Page not found'),
    h('p', {}, 'It may have been removed, or the link is wrong.'),
    h('p', {}, h('a', { href: '/jobs' }, 'Search lab jobs')),
  );
}

function header(): HTMLElement {
  const nav = h('nav', { class: 'site-nav', 'aria-label': 'Main' },
    h('a', { href: '/jobs' }, 'Lab jobs'),
    h('a', { href: '/companies' }, 'Companies'),
    h('a', { href: '/channels' }, 'Channels'),
    h('a', { href: '/contribute' }, 'Share'),
  );
  if (me) {
    nav.appendChild(h('a', { href: '/me/contributions' }, 'My contributions'));
    nav.appendChild(h('a', { href: '/saved' }, 'Saved jobs'));
    nav.appendChild(h('a', { href: '/applications' }, 'My applications'));
    nav.appendChild(h('a', { href: '/alerts' }, 'Alerts'));
  }
  const header = h('header', { class: 'site-header' },
    h('a', { class: 'wordmark', href: '/' }, 'Candour Bench'),
    nav,
  );
  if (me) {
    const signOut = h('button', { class: 'text-button', type: 'button' }, 'Sign out');
    signOut.addEventListener('click', async () => {
      await api.post('/api/auth/sign-out');
      me = null;
      navigate('/');
    });
    header.appendChild(signOut);
  } else {
    header.appendChild(h('a', { href: '/sign-in' }, 'Sign in'));
  }
  if (me && (me.role === 'moderator' || me.role === 'founder')) {
    nav.appendChild(h('a', { href: '/moderation' }, 'Moderation'));
  }
  if (me && (me.role === 'employer_admin' || me.role === 'recruiter')) {
    nav.appendChild(h('a', { href: '/employer' }, 'Employer home'));
  }
  if (me && me.role === 'founder') {
    nav.appendChild(h('a', { href: '/founder' }, 'Founder console'));
  }
  // The phone menu button and dialog.
  const menuButton = h('button', { class: 'text-button menu-button', type: 'button' }, 'Menu');
  menuButton.addEventListener('click', () => {
    openDialog('Menu', (dialog) => {
      const list = h('nav', { 'aria-label': 'Menu' });
      for (const link of Array.from(header.querySelectorAll('nav a'))) {
        const clone = link.cloneNode(true) as HTMLElement;
        list.appendChild(clone);
      }
      const close = h('button', { class: 'text-button', type: 'button' }, 'Close');
      close.addEventListener('click', () => dialog.close());
      return h('div', {}, list, close);
    }, menuButton);
  });
  header.appendChild(menuButton);
  return header;
}

async function render(): Promise<void> {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const root = document.getElementById('app');
  if (!root) return;
  clear(root);
  alertBand(null);
  const shell = h('div', {});
  root.appendChild(shell);
  shell.appendChild(header());
  const matched = route(path);
  const ctx: PageContext = {
    me,
    params: namedParams(path),
    query,
    path,
    navigate,
    rerender: () => void render(),
    refreshMe,
  };
  if (!matched) {
    shell.appendChild(notFoundPage());
    return;
  }
  const content = await Promise.resolve(matched.page(ctx));
  shell.appendChild(content);
}

export async function boot(): Promise<void> {
  const settings = await api.get<{ toast_seconds: number; min_pay_reports: number; search_page_size: number }>('/api/settings').catch(() => null);
  if (settings) setToastSeconds(settings.toast_seconds);
  await refreshMe();
  void render();
  window.addEventListener('popstate', () => void render());
  live.subscribe(() => undefined);
  onReload(() => void render());
}

void boot();


export function requireMe(ctx: PageContext): Me {
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    throw new ApiFailure(401, { error: 'unauthenticated', message: 'Sign in to continue.' });
  }
  return ctx.me;
}
