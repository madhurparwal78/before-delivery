// The signed-in shell: sticky header with mega-dropdowns, the mobile menu,
// the service status region and the cookie and data notice.

import { Integrations, Project, User, api } from './api';
import { openModal } from './dialog';
import { clear, el } from './dom';
import { outageCopy, problem } from './feedback';
import { navigate } from './router';

export type Desk = {
  user: User | null;
  projects: Project[];
  currentSlug: string | null;
  currentLanguage: string | null;
  integrations: Integrations;
};

export const desk: Desk = {
  user: null,
  projects: [],
  currentSlug: null,
  currentLanguage: null,
  integrations: { git_host: 'up', ai_engine: 'up', webhooks: 'up' },
};

export function currentProject(): Project | null {
  return desk.projects.find((project) => project.slug === desk.currentSlug) ?? null;
}

let openGroup: { button: HTMLButtonElement; panel: HTMLElement } | null = null;

function closeGroup(returnFocus: boolean): void {
  if (!openGroup) return;
  openGroup.panel.hidden = true;
  openGroup.button.setAttribute('aria-expanded', 'false');
  const button = openGroup.button;
  openGroup = null;
  if (returnFocus) button.focus();
}

document.addEventListener('click', (event) => {
  if (!openGroup) return;
  const target = event.target as Node;
  if (!openGroup.panel.contains(target) && !openGroup.button.contains(target)) closeGroup(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && openGroup) {
    event.preventDefault();
    closeGroup(true);
  }
});

type GroupName = 'Projects' | 'Branches' | 'Review' | 'Workspace';

function groupLinks(name: GroupName): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (name === 'Projects') {
    const byClient = new Map<string, Project[]>();
    for (const project of desk.projects) {
      byClient.set(project.client, [...(byClient.get(project.client) ?? []), project]);
    }
    for (const [client, projects] of byClient) {
      nodes.push(el('p', { class: 'dropdown-group-label', text: client }));
      for (const project of projects) {
        nodes.push(link(`/projects/${project.slug}`, project.name));
      }
    }
    nodes.push(
      el('button', {
        type: 'button',
        class: 'dropdown-action',
        text: 'New project',
        onclick: () => {
          closeGroup(false);
          openNewProjectDialog(null);
        },
      }),
    );
  }
  if (name === 'Branches') {
    for (const project of desk.projects) {
      nodes.push(el('p', { class: 'dropdown-group-label', text: project.name }));
      for (const branch of project.branches ?? []) {
        if (branch.state !== 'open' && branch.state !== 'in_review') continue;
        nodes.push(
          link(`/projects/${project.slug}?branch=${encodeURIComponent(branch.name)}`, branch.name),
        );
      }
    }
  }
  if (name === 'Review') nodes.push(link('/review', 'Review queue'));
  if (name === 'Workspace') {
    for (const project of desk.projects) {
      nodes.push(el('p', { class: 'dropdown-group-label', text: project.name }));
      nodes.push(link(`/projects/${project.slug}/tm`, 'Translation memory'));
      nodes.push(link(`/projects/${project.slug}/settings`, 'Settings'));
    }
  }
  return nodes;
}

function link(href: string, text: string): HTMLAnchorElement {
  return el('a', { href, text });
}

function dropdown(name: GroupName): HTMLElement {
  const panel = el('nav', { class: 'dropdown-panel', 'aria-label': name, hidden: true }, groupLinks(name));
  const button = el('button', {
    type: 'button',
    class: 'header-button',
    'aria-expanded': 'false',
    onclick: (event: Event) => {
      event.stopPropagation();
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      closeGroup(false);
      if (isOpen) return;
      clear(panel);
      panel.append(...groupLinks(name));
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      openGroup = { button, panel };
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' && button.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        panel.querySelector<HTMLElement>('a, button')?.focus();
      }
    },
  }, [el('span', { text: name }), el('span', { class: 'chevron', 'aria-hidden': 'true' })]);
  return el('div', { class: 'header-group' }, [button, panel]);
}

// languageProject is the project whose target languages the picker offers: the
// project on screen, or the first one on the review queue.
function languageProject(): Project | null {
  return currentProject() ?? desk.projects[0] ?? null;
}

function languageMenu(): HTMLElement {
  const project = languageProject();
  const enabled = languagePickerEnabled();
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Target language', hidden: true });
  const button = el('button', {
    type: 'button',
    class: 'header-icon',
    'aria-label': 'Target language',
    'aria-expanded': 'false',
    disabled: !enabled,
    onclick: (event: Event) => {
      event.stopPropagation();
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      closeGroup(false);
      if (isOpen) return;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      openGroup = { button, panel: menu };
    },
  }, [globeGlyph()]);

  for (const language of project?.target_languages ?? []) {
    menu.append(
      el('button', {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': desk.currentLanguage === language ? 'true' : 'false',
        text: language,
        onclick: () => {
          desk.currentLanguage = language;
          closeGroup(false);
          const url = new URL(window.location.href);
          url.searchParams.set('lang', language);
          navigate(url.pathname + url.search, true);
        },
      }),
    );
  }
  return el('div', { class: 'header-group' }, [button, menu]);
}

function languagePickerEnabled(): boolean {
  const path = window.location.pathname.replace(/\/$/, '');
  const onScreen = path === '/review' || /^\/projects\/[^/]+(\/editor)?$/.test(path);
  return onScreen && (languageProject()?.target_languages.length ?? 0) > 0;
}

function globeGlyph(): HTMLElement {
  const holder = el('span', { class: 'glyph', 'aria-hidden': 'true' });
  holder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" focusable="false">
    <circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c3 3 3 13 0 16"/><path d="M12 4c-3 3-3 13 0 16"/>
  </svg>`;
  return holder;
}

export function buildHeader(): HTMLElement {
  const owner = desk.user?.role === 'owner';
  const brand = el('a', { href: '/desk', class: 'brand', 'aria-label': 'Interline Desk' }, ['Interline Desk']);
  const desktop = el('div', { class: 'header-desktop' });
  if (owner) {
    desktop.append(dropdown('Projects'), dropdown('Branches'));
  }
  desktop.append(dropdown('Review'));
  if (owner) {
    desktop.append(dropdown('Workspace'), el('a', { href: '/audit', class: 'header-link', text: 'Audit log' }));
  }
  desktop.append(languageMenu());
  if (owner) {
    desktop.append(
      el('a', { href: tmHref(), class: 'button outline', text: 'Import' }),
      el('button', {
        type: 'button',
        class: 'button primary',
        text: 'New project',
        onclick: (event: Event) => openNewProjectDialog(event.currentTarget as HTMLElement),
      }),
    );
  }
  desktop.append(
    el('button', { type: 'button', class: 'button quiet', text: 'Sign out', onclick: signOut }),
  );

  const hamburger = el('button', {
    type: 'button',
    class: 'header-icon hamburger',
    'aria-label': 'Open menu',
    onclick: (event: Event) => openMobileMenu(event.currentTarget as HTMLElement),
  }, [el('span', { class: 'bars', 'aria-hidden': 'true' })]);

  const header = el('header', { class: 'desk-header' }, [
    el('div', { class: 'content-column header-inner' }, [brand, desktop, hamburger]),
  ]);
  return header;
}

function tmHref(): string {
  const slug = desk.currentSlug ?? desk.projects[0]?.slug;
  return slug ? `/projects/${slug}/tm` : '/desk';
}

async function signOut(): Promise<void> {
  await api.del('/api/session');
  desk.user = null;
  navigate('/sign-in');
}

function openMobileMenu(opener: HTMLElement): void {
  const owner = desk.user?.role === 'owner';
  openModal({
    name: 'Menu',
    opener,
    fullHeight: true,
    body: (handle) => {
      const groups: GroupName[] = owner ? ['Projects', 'Branches', 'Review', 'Workspace'] : ['Review'];
      const nodes: (Node | string)[] = [
        el('button', {
          type: 'button',
          class: 'button quiet',
          text: 'Close menu',
          onclick: () => handle.close(),
        }),
      ];
      for (const name of groups) {
        const panel = el('div', { class: 'accordion-panel', hidden: true }, groupLinks(name));
        const button = el('button', {
          type: 'button',
          class: 'accordion-button',
          'aria-expanded': 'false',
          onclick: () => {
            const open = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', open ? 'false' : 'true');
            panel.hidden = open;
          },
        }, [el('span', { text: name }), el('span', { class: 'chevron', 'aria-hidden': 'true' })]);
        nodes.push(el('div', { class: 'accordion' }, [button, panel]));
      }
      const pinned = el('div', { class: 'menu-pinned' }, [
        owner
          ? el('button', {
              type: 'button',
              class: 'button primary',
              text: 'New project',
              onclick: () => {
                handle.close();
                openNewProjectDialog(null);
              },
            })
          : null,
        el('button', { type: 'button', class: 'button quiet', text: 'Sign out', onclick: signOut }),
      ]);
      nodes.push(pinned);
      return nodes;
    },
  });
}

// openNewProjectDialog is shared by the header, the mobile menu and the
// dashboard.
export let openNewProjectDialog: (opener: HTMLElement | null) => void = () => {};

export function setNewProjectDialog(open: (opener: HTMLElement | null) => void): void {
  openNewProjectDialog = open;
}

export function buildFeedbackRegions(): HTMLElement {
  return el('div', { class: 'content-column feedback' }, [
    el('p', { id: 'desk-updates', role: 'status', 'aria-live': 'polite', 'aria-label': 'Desk updates' }),
    el('p', { id: 'desk-problems', role: 'alert', 'aria-label': 'Desk problems' }),
  ]);
}

export function buildServiceStatus(): HTMLElement {
  return el('section', {
    id: 'service-status',
    class: 'content-column service-status',
    role: 'region',
    'aria-label': 'Service status',
  });
}

let announcedOutages = new Set<string>();

export function paintServiceStatus(): void {
  const region = document.getElementById('service-status');
  if (!region) return;
  clear(region);
  const down = (Object.keys(outageCopy) as (keyof Integrations)[]).filter(
    (service) => desk.integrations[service] === 'down',
  );
  for (const service of down) {
    const copy = outageCopy[service];
    region.append(
      el('div', { class: 'banner' }, [
        el('span', { class: 'banner-label', text: copy.label }),
        el('span', { text: copy.text }),
      ]),
    );
    if (!announcedOutages.has(service)) problem(`${copy.label}: ${copy.text}`);
  }
  announcedOutages = new Set(down);
}

export async function refreshIntegrations(): Promise<void> {
  if (!desk.user) return;
  try {
    desk.integrations = await api.get<Integrations>('/api/integrations');
  } catch {
    return;
  }
  paintServiceStatus();
}

export function startIntegrationPolling(): void {
  window.setInterval(() => void refreshIntegrations(), 15000);
}

// cookieNotice is the bottom-left panel shown until this browser hides it.
export function cookieNotice(): HTMLElement | null {
  if (window.localStorage.getItem('interline-notice') === 'hidden') return null;
  const details = el('p', {
    class: 'notice-details',
    hidden: true,
    text: 'Your choice to hide this notice is remembered in this browser only.',
  });
  const panel = el('section', {
    class: 'cookie-notice',
    role: 'region',
    'aria-label': 'Cookie and data notice',
  }, [
    el('p', {
      text: 'Interline Desk sets one session cookie to keep you signed in. No tracking or advertising cookies.',
    }),
    details,
    el('div', { class: 'notice-actions' }, [
      el('button', {
        type: 'button',
        class: 'button outline',
        text: 'Details',
        onclick: () => {
          details.hidden = false;
        },
      }),
      el('button', {
        type: 'button',
        class: 'button primary',
        text: 'Got it',
        onclick: () => {
          window.localStorage.setItem('interline-notice', 'hidden');
          panel.remove();
        },
      }),
    ]),
  ]);
  return panel;
}

// stickyHeaderBorder draws the header's hairline once the page has scrolled.
export function watchScroll(): void {
  const update = (): void => {
    document.body.classList.toggle('scrolled', window.scrollY > 10);
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}
