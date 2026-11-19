import { clear, el } from './dom.js';
import { closeAllDialogs } from './dialog.js';
import { startLive } from './live.js';
import { currentPath, navigate, setRenderer } from './router.js';
import { loadSession, signedIn } from './state.js';
import { renderTopBar, startInboxBadge } from './topbar.js';
import { renderAccount } from './pages/account.js';
import { renderGoals } from './pages/goals.js';
import { renderInbox } from './pages/inbox.js';
import { renderIntake } from './pages/intake.js';
import { renderMyWork } from './pages/mywork.js';
import { projectNotFound, renderProject } from './pages/project.js';
import { renderRules } from './pages/rules.js';
import { renderWelcome } from './pages/welcome.js';
import { renderWorkload } from './pages/workload.js';

const main = document.getElementById('main') as HTMLElement;
let loadingTimer: number | null = null;

function showLoading(): void {
  clear(main);
  main.className = 'page page--loading';
  const sentence = el('p', { class: 'empty__sentence' }, 'Loading');
  const panel = el('div', { class: 'empty' }, sentence);
  main.appendChild(panel);
  loadingTimer = window.setTimeout(() => {
    const reload = el('button', { type: 'button', class: 'pill pill--dark' }, 'Reload');
    reload.addEventListener('click', () => window.location.reload());
    panel.appendChild(reload);
  }, 5000);
}

function teardown(): void {
  if (loadingTimer !== null) {
    window.clearTimeout(loadingTimer);
    loadingTimer = null;
  }
  main.dispatchEvent(new Event('page:teardown'));
  closeAllDialogs();
}

async function render(path: string): Promise<void> {
  teardown();
  const url = new URL(path, window.location.origin);
  const segments = url.pathname.split('/').filter(Boolean);
  const search = url.searchParams;

  if (segments[0] === 'f' && segments[1]) {
    clear(main);
    await renderIntake(main, segments[1]);
    return;
  }
  if (segments[0] === 'account') {
    clear(main);
    renderAccount(main, search);
    return;
  }
  if (!signedIn()) {
    if (segments.length === 0) {
      clear(main);
      renderWelcome(main);
      return;
    }
    navigate('/account', true);
    return;
  }

  showLoading();
  try {
    if (segments.length === 0) {
      clear(main);
      await renderMyWork(main);
    } else if (segments[0] === 'projects' && segments[1] && segments[2] === 'rules') {
      clear(main);
      await renderRules(main, segments[1]);
    } else if (segments[0] === 'projects' && segments[1]) {
      clear(main);
      await renderProject(main, segments[1], search);
    } else if (segments[0] === 'goals') {
      clear(main);
      await renderGoals(main);
    } else if (segments[0] === 'workload' && segments[1]) {
      clear(main);
      await renderWorkload(main, segments[1], search.get('from'));
    } else if (segments[0] === 'inbox') {
      clear(main);
      await renderInbox(main);
    } else {
      clear(main);
      projectNotFound(main);
    }
  } finally {
    if (loadingTimer !== null) {
      window.clearTimeout(loadingTimer);
      loadingTimer = null;
    }
  }
}

async function boot(): Promise<void> {
  await loadSession();
  renderTopBar();
  setRenderer((path) => {
    void render(path);
  });
  if (signedIn()) {
    startLive();
    await startInboxBadge();
  }
  await render(currentPath());
  window.addEventListener('resize', () => {
    renderTopBar();
  });
}

window.addEventListener('scroll', () => {
  document.body.classList.toggle('is-scrolled', window.scrollY > 0);
});

void boot();
