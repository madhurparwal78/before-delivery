import { api } from './api';
import { clear, el } from './dom';
import { canReach, refreshSystem, state } from './state';

const NAV_ITEMS: { path: string; label: string; screen: string }[] = [
  { path: '/run', label: 'Run', screen: 'run' },
  { path: '/jobs', label: 'Jobs', screen: 'jobs' },
  { path: '/library', label: 'Library', screen: 'library' },
  { path: '/webhooks', label: 'Webhooks', screen: 'webhooks' },
  { path: '/finance', label: 'Finance', screen: 'finance' },
  { path: '/admin', label: 'Admin', screen: 'admin' },
];

export interface Shell {
  railSlot: HTMLElement;
  main: HTMLElement;
  topbarExtras: HTMLElement;
  notices: HTMLElement;
  alerts: HTMLElement;
}

let shell: Shell | null = null;
let navigateTo: (path: string) => void = () => {};
let teamChanged: () => void = () => {};

export function onNavigate(handler: (path: string) => void): void {
  navigateTo = handler;
}

export function go(path: string): void {
  navigateTo(path);
}

export function onTeamChange(handler: () => void): void {
  teamChanged = handler;
}

export function notice(message: string): void {
  if (!shell) return;
  shell.notices.textContent = message;
  shell.alerts.textContent = '';
}

export function pending(message: string): void {
  notice(message);
}

export function alertError(message: string): void {
  if (!shell) return;
  shell.alerts.textContent = message;
}

export function clearMessages(): void {
  if (!shell) return;
  shell.notices.textContent = '';
  shell.alerts.textContent = '';
}

function serviceStatusCopy(): string[] {
  const messages: string[] = [];
  if (state.system.storage === 'down') {
    messages.push('Storage is unreachable. New jobs wait in the queue, and uploads and image links are paused.');
  }
  if (state.system.billing === 'down') {
    messages.push('Billing is unreachable. Top-ups stay pending until it returns.');
  }
  return messages;
}

function renderServiceStatus(region: HTMLElement): void {
  clear(region);
  for (const message of serviceStatusCopy()) {
    region.append(el('p', { class: 'service-note', text: message }));
  }
}

export function buildShell(currentPath: string): Shell {
  clear(document.body);
  const member = state.member!;
  const nav = el('nav', { class: 'primary-nav', 'aria-label': 'Primary' });
  for (const item of NAV_ITEMS) {
    if (!canReach(item.screen)) continue;
    const link = el('a', {
      href: item.path,
      class: `nav-link${currentPath === item.path ? ' nav-link-current' : ''}`,
      text: item.label,
      'aria-current': currentPath === item.path ? 'page' : null,
    });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      nav.classList.remove('nav-open');
      navigateTo(item.path);
    });
    nav.append(link);
  }

  const menuButton = el('button', { type: 'button', class: 'menu-button', text: 'Menu' });
  menuButton.addEventListener('click', () => nav.classList.toggle('nav-open'));

  const topbarExtras = el('div', { class: 'topbar-extras' });

  const signOut = el('button', { type: 'button', class: 'sign-out', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void api.del('/api/session').then(() => {
      state.member = null;
      navigateTo('/signin');
    });
  });

  const who = el('p', { class: 'who' }, [
    el('span', { text: member.name }),
    el('span', { class: 'who-team', text: member.team_id === null ? roleTitle() : teamLabel() }),
  ]);

  const teamPicker = el('div', { class: 'team-picker' });
  if (member.role !== 'member') {
    const select = el('select', { class: 'team-select', 'aria-label': 'Team' });
    for (const team of state.teams) {
      select.append(el('option', { value: team.id, text: team.name, selected: team.id === state.selectedTeamId }));
    }
    select.value = state.selectedTeamId;
    select.addEventListener('change', () => {
      state.selectedTeamId = select.value;
      teamChanged();
    });
    teamPicker.append(select);
  }

  const topbar = el('header', { class: 'topbar' }, [
    el('p', { class: 'brand', text: 'Lumenfold Dispatch' }),
    menuButton,
    nav,
    who,
    teamPicker,
    signOut,
    topbarExtras,
  ]);

  const serviceStatus = el('div', { class: 'service-status', role: 'region', 'aria-label': 'Service status' });
  renderServiceStatus(serviceStatus);
  const notices = el('div', { class: 'notices', role: 'status', 'aria-live': 'polite', 'aria-label': 'Notices' });
  const alerts = el('div', { class: 'alerts', role: 'alert' });
  const railSlot = el('div', { class: 'rail-slot' });
  const main = el('main', { class: 'main', id: 'main', tabindex: '-1' });

  const skip = el('a', { href: '#main', class: 'skip-link', text: 'Skip to main content' });
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
  });

  document.body.append(
    skip,
    topbar,
    serviceStatus,
    el('div', { class: 'messages' }, [notices, alerts]),
    el('div', { class: 'workspace' }, [railSlot, main]),
  );

  shell = { railSlot, main, topbarExtras, notices, alerts };
  startServicePolling(serviceStatus);
  return shell;
}

let servicePoller: number | null = null;

function startServicePolling(region: HTMLElement): void {
  if (servicePoller !== null) window.clearInterval(servicePoller);
  servicePoller = window.setInterval(() => {
    void refreshSystem().then(() => renderServiceStatus(region));
  }, 5000);
}

function roleTitle(): string {
  const role = state.member!.role;
  if (role === 'admin') return 'Org admin';
  if (role === 'finance') return 'Finance controller';
  if (role === 'compliance') return 'Compliance reviewer';
  return 'Member';
}

function teamLabel(): string {
  const team = state.teams.find((candidate) => candidate.id === state.member!.team_id);
  return team?.name ?? '';
}

export function sectionHeading(text: string): HTMLElement {
  return el('h3', { class: 'section-heading', text });
}
