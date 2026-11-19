import { getJson, requestJson } from '../shared/api.ts';
import { clear, el } from '../shared/dom.ts';
import { createEnquiriesView } from './enquiriesView.ts';
import { createMonthsView } from './monthsView.ts';
import { createProjectsView } from './projectsView.ts';
import { createSettingsView } from './settingsView.ts';

type ViewName = 'projects' | 'enquiries' | 'months' | 'settings';

const app = document.getElementById('app') as HTMLElement;
const status = el('p', { class: 'status-line console-status', role: 'status', 'aria-label': 'Console status' });
const body = el('div', { class: 'console-body' });
const header = el('div', { class: 'console-header' });
app.append(header, status, body);

const setStatus = (text: string): void => {
  status.textContent = text;
};

const projects = createProjectsView(setStatus);
const enquiries = createEnquiriesView(setStatus);
const months = createMonthsView(setStatus);
const settings = createSettingsView(setStatus);

const views = {
  projects: { view: projects, label: 'Projects' },
  enquiries: { view: enquiries, label: 'Enquiries' },
  months: { view: months, label: 'Months' },
  settings: { view: settings, label: 'Settings' },
} as const;

let active: ViewName | null = null;

function show(name: ViewName): void {
  if (active !== null && active !== name) {
    const previous = views[active].view;
    if ('deactivate' in previous) previous.deactivate();
  }
  active = name;
  clear(body);
  body.append(views[name].view.element);
  views[name].view.activate();
  for (const link of header.querySelectorAll<HTMLElement>('a[data-view]')) {
    if (link.dataset.view === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function renderSignedIn(): void {
  clear(header);
  const nav = el('nav', { class: 'console-nav', 'aria-label': 'Console' });
  for (const name of Object.keys(views) as ViewName[]) {
    const link = el('a', { href: `#${name}`, 'data-view': name, text: views[name].label });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.hash = `#${name}`;
      show(name);
    });
    nav.append(link);
  }
  const signOut = el('button', { type: 'button', class: 'secondary', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void (async () => {
      await requestJson<unknown>('DELETE', '/api/console/session');
      renderSignIn();
    })();
  });
  header.append(nav, signOut);
  const requested = window.location.hash.replace('#', '') as ViewName;
  show(requested in views ? requested : 'projects');
}

function renderSignIn(): void {
  active = null;
  clear(header);
  clear(body);
  setStatus('');
  const email = el('input', { id: 'signin-email', type: 'email', class: 'console-input', autocomplete: 'username' });
  const password = el('input', {
    id: 'signin-password',
    type: 'password',
    class: 'console-input',
    autocomplete: 'current-password',
  });
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Sign in' });
  const form = el('form', { class: 'console-form signin-form', 'aria-label': 'Operator sign in' }, [
    el('h1', { class: 'console-title', text: 'Earshot console' }),
    el('div', { class: 'field' }, [el('label', { for: 'signin-email', text: 'Email' }), email]),
    el('div', { class: 'field' }, [el('label', { for: 'signin-password', text: 'Password' }), password]),
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setStatus('Signing in\u2026');
    void (async () => {
      const result = await requestJson<unknown>('POST', '/api/console/session', {
        body: { email: email.value, password: password.value },
      });
      if (result.ok) {
        setStatus('');
        renderSignedIn();
        return;
      }
      setStatus(result.status === 401 ? 'That email and password don\u2019t match.' : result.message);
    })();
  });
  body.append(form);
  email.focus();
}

async function boot(): Promise<void> {
  const session = await getJson<unknown>('/api/console/settings');
  if (session.ok) renderSignedIn();
  else renderSignIn();
}

void boot();
