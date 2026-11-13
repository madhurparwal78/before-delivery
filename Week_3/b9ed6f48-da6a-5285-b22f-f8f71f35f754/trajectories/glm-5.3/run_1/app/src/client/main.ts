import './styles.css';
import { api, type User, type TimelineEvent } from './api.ts';
import {
  shell,
  loadSession,
  setPreference,
  wireDialogs,
  openDialog,
  closeDialog,
  errorSummary,
  clearErrorSummary,
  notice,
  isApiFailure,
} from './shell.ts';
import { initChapterPage } from './pages/chapter.ts';
import { initIndexPage } from './pages/index.ts';
import { initTimelinePage } from './pages/timeline.ts';
import { initSessionsPage } from './pages/sessions.ts';
import { initSupportPage } from './pages/support.ts';
import { initAccountPage } from './pages/account.ts';
import { initStudioPage } from './pages/studio.ts';
import { initBoxOfficePage } from './pages/boxoffice.ts';

/** The header, navigation and dialogs live on every page. */

async function boot(): Promise<void> {
  await loadSession();

  // Header switches
  const motionSwitch = document.querySelector<HTMLButtonElement>('[data-role="switch-motion"]');
  const soundSwitch = document.querySelector<HTMLButtonElement>('[data-role="switch-sound"]');
  if (motionSwitch) {
    motionSwitch.setAttribute('aria-checked', String(shell.preferences.motion));
    motionSwitch.addEventListener('click', async () => {
      const next = !shell.preferences.motion;
      await setPreference(next, shell.preferences.sound);
      motionSwitch.setAttribute('aria-checked', String(next));
    });
  }
  if (soundSwitch) {
    soundSwitch.setAttribute('aria-checked', String(shell.preferences.sound));
    soundSwitch.addEventListener('click', async () => {
      const next = !shell.preferences.sound;
      await setPreference(next ? true : false, next);
      await setPreference(shell.preferences.motion, next);
      soundSwitch.setAttribute('aria-checked', String(next));
      notice(next ? 'Sound on.' : 'Sound off.');
    });
  }

  const signInButton = document.querySelector<HTMLButtonElement>('[data-action="sign-in"]');
  if (signInButton) {
    signInButton.addEventListener('click', () => openDialog('dialog-sign-in', signInButton));
  }
  const createAccountLink = document.querySelector<HTMLButtonElement>('[data-action="create-account"]');
  if (createAccountLink) {
    createAccountLink.addEventListener('click', () => {
      closeDialog('dialog-sign-in');
      openDialog('dialog-create-account', createAccountLink);
    });
  }
  const signOutButton = document.querySelector<HTMLButtonElement>('[data-action="sign-out"]');
  if (signOutButton) {
    signOutButton.addEventListener('click', async () => {
      await api.post('/api/auth/logout');
      shell.user = null;
      notice('Signed out.');
      window.location.href = '/';
    });
  }

  const menuButton = document.querySelector<HTMLButtonElement>('[data-action="menu"]');
  if (menuButton) {
    menuButton.addEventListener('click', () => openDialog('dialog-menu', menuButton));
  }
  const chaptersButton = document.querySelector<HTMLButtonElement>('[data-action="chapters"]');
  if (chaptersButton) {
    chaptersButton.addEventListener('click', () => openDialog('dialog-chapters', chaptersButton));
  }

  wireSignIn();
  wireCreateAccount();
  wireDialogs();
  markCurrentNav();

  // Page controllers
  const page = document.body.dataset.page ?? '';
  switch (page) {
    case 'index':
      await initIndexPage();
      break;
    case 'chapter':
      await initChapterPage();
      break;
    case 'timeline':
      await initTimelinePage();
      break;
    case 'sources':
      await initSourcesPage();
      break;
    case 'sessions':
      await initSessionsPage();
      break;
    case 'support':
      await initSupportPage();
      break;
    case 'account':
      await initAccountPage();
      break;
    case 'studio':
      await initStudioPage();
      break;
    case 'box-office':
      await initBoxOfficePage();
      break;
    case 'not-found':
      break;
    default:
      break;
  }
}

function markCurrentNav(): void {
  const path = window.location.pathname;
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('.main-nav a, #dialog-menu a'))) {
    const href = link.getAttribute('href') ?? '';
    if (href === path) link.setAttribute('aria-current', 'page');
  }
}

function wireSignIn(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-sign-in');
  if (!dialog) return;
  const form = dialog.querySelector<HTMLFormElement>('form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrorSummary(dialog);
    const email = (dialog.querySelector<HTMLInputElement>('[data-field="email"]')?.value ?? '').trim();
    const password = dialog.querySelector<HTMLInputElement>('[data-field="password"]')?.value ?? '';
    try {
      const res = await api.post<{ user: User }>('/api/auth/login', { email, password });
      shell.user = res.user;
      notice(`Signed in as ${res.user.name}.`);
      closeDialog('dialog-sign-in');
      window.location.reload();
    } catch (e) {
      const message = isApiFailure(e) ? e.message : 'Email or password is incorrect.';
      errorSummary(dialog, message);
    }
  });
}

function wireCreateAccount(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-create-account');
  if (!dialog) return;
  const form = dialog.querySelector<HTMLFormElement>('form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrorSummary(dialog);
    const name = (dialog.querySelector<HTMLInputElement>('[data-field="name"]')?.value ?? '').trim();
    const email = (dialog.querySelector<HTMLInputElement>('[data-field="email"]')?.value ?? '').trim();
    const password = dialog.querySelector<HTMLInputElement>('[data-field="password"]')?.value ?? '';
    try {
      const res = await api.post<{ user: User }>('/api/auth/register', { name, email, password });
      shell.user = res.user;
      notice(`Signed in as ${res.user.name}.`);
      closeDialog('dialog-create-account');
      window.location.reload();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      } else {
        errorSummary(dialog, 'Something went wrong.');
      }
    }
  });
}

async function initSourcesPage(): Promise<void> {
  const container = document.querySelector<HTMLElement>('[data-role="sources"]');
  if (!container) return;
  const sources = await api.get<{ sources: Array<{ id: string; citation: string; cited_by: string[] }> }>('/api/sources');
  const events = await api.get<{ events: TimelineEvent[] }>('/api/timeline');
  const byId = new Map(events.events.map((e) => [e.id, e]));
  for (const source of sources.sources) {
    const section = document.createElement('article');
    section.className = 'card';
    const number = source.id.replace('src-', '');
    section.innerHTML = `
      <div class="cat-number">src-${number}</div>
      <h3>${escapeHtml(source.citation)}</h3>
      <p class="muted">Cited by</p>
    `;
    const ul = document.createElement('ul');
    for (const id of source.cited_by) {
      const ev = byId.get(id);
      if (!ev) continue;
      const li = document.createElement('li');
      li.textContent = `${ev.year} — ${ev.title}`;
      ul.appendChild(li);
    }
    if (!ul.children.length) {
      const li = document.createElement('li');
      li.textContent = 'No published events cite this source yet.';
      ul.appendChild(li);
    }
    section.appendChild(ul);
    container.appendChild(section);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

boot();
