import { api, ApiError } from './api.js';
import { clear, el } from './dom.js';
import { closeAll } from './dialog.js';
import { paintVerdict, pushStateFor, verdictCard } from './verdictcard.js';
import { renderUnlock } from './screens/unlock.js';
import { renderPlan } from './screens/plan.js';
import { renderProjects } from './screens/projects.js';
import { renderProject } from './screens/project.js';
import { renderSessions } from './screens/sessions.js';
import { renderLibrary } from './screens/library.js';
import { renderSite } from './screens/site.js';
import { renderShared } from './screens/shared.js';

const NAV = [
  ['Plan', '/plan'],
  ['Projects', '/projects'],
  ['Sessions', '/sessions'],
  ['Library', '/library'],
  ['Site', '/site'],
];
const CARD_REFRESH_MS = 30000;

const shell = document.getElementById('shell');
let cardTimer = null;
let teardown = null;

function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

function chrome(main) {
  const nav = el(
    'nav',
    { 'aria-label': 'Main' },
    NAV.map(([label, href]) =>
      el('a', {
        href,
        text: label,
        'aria-current': location.pathname.startsWith(href) ? 'page' : null,
      }),
    ),
  );
  const lock = el('button', {
    type: 'button',
    text: 'Lock workspace',
    class: 'ghost',
    onclick: async () => {
      await api('POST', '/api/lock-workspace');
      navigate('/unlock');
    },
  });
  const rail = el('div', { class: 'rail' }, [nav, el('div', { class: 'shell-head' }, [lock])]);
  return el('div', { class: 'shell private' }, [rail, main]);
}

async function refreshCard(card, { silent = false } = {}) {
  try {
    const [plan, pushes] = await Promise.all([
      api('GET', '/api/tonight'),
      api('GET', '/api/pushes').catch(() => null),
    ]);
    paintVerdict(card, plan, pushStateFor(pushes && pushes.pushes, plan.date));
    return plan;
  } catch (error) {
    if (!silent) throw error;
    return null;
  }
}

const SCREENS = {
  '/plan': renderPlan,
  '/projects': renderProjects,
  '/sessions': renderSessions,
  '/library': renderLibrary,
  '/site': renderSite,
};

async function render() {
  closeAll();
  if (cardTimer) clearInterval(cardTimer);
  cardTimer = null;
  if (teardown) teardown();
  teardown = null;
  clear(shell);
  const path = location.pathname;

  if (path.startsWith('/s/')) {
    const main = el('main', {});
    shell.append(el('div', { class: 'shell public' }, [main]));
    await renderShared(main, path.slice(3));
    return;
  }

  let me = null;
  try {
    me = await api('GET', '/api/me');
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }

  if (!me) {
    const main = el('main', {});
    shell.append(el('div', { class: 'shell public' }, [main]));
    renderUnlock(main);
    if (path !== '/unlock') history.replaceState({}, '', '/unlock');
    return;
  }
  if (path === '/' || path === '/unlock') {
    history.replaceState({}, '', '/plan');
  }

  const card = verdictCard();
  const main = el('main', {});
  shell.append(chrome(main));

  const context = {
    card,
    paintCard: (plan, pushState) => paintVerdict(card, plan, pushState),
    navigate,
    ownsCard: false,
  };

  const screen = SCREENS[location.pathname];
  if (screen) {
    teardown = (await screen(main, context)) || null;
  } else if (location.pathname.startsWith('/projects/')) {
    teardown =
      (await renderProject(main, context, location.pathname.slice('/projects/'.length))) ||
      null;
  } else {
    main.append(el('p', { text: 'That screen does not exist.' }));
  }

  if (!context.ownsCard) {
    await refreshCard(card, { silent: true });
    cardTimer = setInterval(() => refreshCard(card, { silent: true }), CARD_REFRESH_MS);
  }
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="/"]');
  if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  navigate(link.getAttribute('href'));
});

window.addEventListener('popstate', render);
render().catch((error) => {
  clear(shell);
  shell.append(
    el('main', {}, [
      el('div', { role: 'alert', 'aria-label': 'Error summary', class: 'error-summary' }, [
        el('p', { text: error.message }),
      ]),
    ]),
  );
});

