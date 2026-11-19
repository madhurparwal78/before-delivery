import { clear, h, isPhone, qs } from './dom';
import { refreshTimes } from './components/text';
import { openComposer } from './components/composer';
import {
  connectLive,
  currentMember,
  loadConfig,
  loadMe,
  on,
  onCounters,
  refreshCounters,
} from './state';
import { confirmView, joinView, landingView, signInView } from './views/auth';
import { applicantsView } from './views/board';
import { feedView, hashtagView, postPageView } from './views/feed';
import { companyView, jobView, jobsSearchView, myJobsView } from './views/jobs';
import { jobEditorView } from './views/jobeditor';
import { messagingView } from './views/messaging';
import { notFoundView, notificationsView, searchView } from './views/misc';
import { networkView } from './views/network';
import { mutualView, profileView, settingsView } from './views/profile';

const root = document.getElementById('app') as HTMLElement;

function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  render();
}

function liveRegions(): HTMLElement {
  const names = [
    'Network announcements',
    'Feed announcements',
    'Messaging announcements',
    'Jobs announcements',
    'Profile announcements',
  ];
  const wrap = h('div', { class: 'live-regions' });
  for (const name of names) {
    wrap.append(
      h('p', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': name,
        'data-live': name,
        class: 'live-region',
      }),
    );
  }
  return wrap;
}

function countedName(base: string, count: number, singular: string, plural: string): string {
  if (count === 0) return base;
  return `${base}, ${count} ${count === 1 ? singular : plural}`;
}

function header(): HTMLElement | null {
  const me = currentMember();
  /* Signed out, the landing and the auth forms carry their own head. */
  if (!me) return null;
  const search = h('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search',
    class: 'input search-box',
    placeholder: 'Search',
    keydown: (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key !== 'Enter') return;
      keyEvent.preventDefault();
      const value = (keyEvent.currentTarget as HTMLInputElement).value;
      navigate(`/search?type=people&q=${encodeURIComponent(value)}`);
    },
  });
  const bar = h('header', { class: 'app-header' }, [
    h('a', { href: '/', 'aria-label': 'Plainwork', class: 'monogram' }, ['Pw']),
    search,
  ]);

  if (!isPhone()) {
    const nav = h('nav', { 'aria-label': 'Primary', class: 'primary-nav' });
    const home = h('a', { href: '/feed', class: 'nav-link' }, ['Home']);
    const network = h('a', { href: '/network', class: 'nav-link' }, ['My network']);
    const jobs = h('a', { href: '/jobs', class: 'nav-link' }, ['Jobs']);
    const messaging = h('a', { href: '/messaging', class: 'nav-link' }, ['Messaging']);
    const notifications = h('a', { href: '/notifications', class: 'nav-link' }, ['Notifications']);
    const mePage = h('a', { href: `/in/${me.handle}`, class: 'nav-link' }, ['Me']);
    nav.append(home, network, jobs, messaging, notifications, mePage);
    bar.append(nav);
    onCounters((counters) => {
      network.setAttribute(
        'aria-label',
        countedName('My network', counters.invitations, 'invitation', 'invitations'),
      );
      messaging.setAttribute(
        'aria-label',
        countedName('Messaging', counters.messaging, 'unread', 'unread'),
      );
      notifications.setAttribute(
        'aria-label',
        countedName('Notifications', counters.notifications, 'unread', 'unread'),
      );
    });
  } else {
    bar.append(
      h('a', { href: '/notifications', class: 'nav-link' }, ['Notifications']),
      h('a', { href: `/in/${me.handle}`, class: 'nav-link' }, ['Me']),
    );
  }
  return bar;
}

function tabBar(): HTMLElement | null {
  const me = currentMember();
  if (!me || !isPhone()) return null;
  const nav = h('nav', { 'aria-label': 'Tabs', class: 'tab-bar' });
  const home = h('a', { href: '/feed', class: 'tab-link' }, ['Home']);
  const network = h('a', { href: '/network', class: 'tab-link' }, ['Network']);
  const post = h('a', { href: '/feed#compose', class: 'tab-link' }, ['Post']);
  const messaging = h('a', { href: '/messaging', class: 'tab-link' }, ['Messaging']);
  const jobs = h('a', { href: '/jobs', class: 'tab-link' }, ['Jobs']);
  nav.append(home, network, post, messaging, jobs);
  onCounters((counters) => {
    network.setAttribute(
      'aria-label',
      countedName('Network', counters.invitations, 'invitation', 'invitations'),
    );
    messaging.setAttribute(
      'aria-label',
      countedName('Messaging', counters.messaging, 'unread', 'unread'),
    );
  });
  return nav;
}

function viewFor(path: string, search: URLSearchParams): HTMLElement {
  const me = currentMember();
  if (path === '/') return me ? feedView() : landingView();
  if (path === '/join') return joinView(navigate);
  if (path === '/confirm') return confirmView(navigate);
  if (path === '/signin') return signInView(navigate);
  if (!me) return notFoundView();
  if (path === '/feed') return feedView();
  if (path === '/network') return networkView();
  if (path === '/notifications') return notificationsView();
  if (path === '/settings') return settingsView();
  if (path === '/my-jobs') return myJobsView();
  if (path === '/jobs') return jobsSearchView();
  if (path === '/messaging') return messagingView(null, null, navigate);
  if (path === '/search') {
    const type = search.get('type');
    const chosen = type === 'posts' || type === 'jobs' ? type : 'people';
    return searchView(chosen, search.get('q') ?? '', navigate);
  }

  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'posts' && segments.length === 2) return postPageView(segments[1]);
  if (segments[0] === 'hashtag' && segments.length === 2) return hashtagView(segments[1]);
  if (segments[0] === 'in' && segments.length === 2) return profileView(segments[1], navigate);
  if (segments[0] === 'in' && segments.length === 3 && segments[2] === 'mutual') {
    return mutualView(segments[1]);
  }
  if (segments[0] === 'company' && segments.length === 2) return companyView(segments[1]);
  if (segments[0] === 'messaging' && segments.length === 2) {
    return messagingView(segments[1], null, navigate);
  }
  if (segments[0] === 'messaging' && segments.length === 3 && segments[1] === 'with') {
    return messagingView(null, segments[2], navigate);
  }
  if (segments[0] === 'jobs' && segments.length === 2) return jobView(segments[1]);
  if (segments[0] === 'jobs' && segments.length === 3 && segments[2] === 'applicants') {
    return applicantsView(segments[1]);
  }
  if (segments[0] === 'jobs' && segments.length === 3 && segments[2] === 'edit') {
    return jobEditorView(segments[1]);
  }
  return notFoundView();
}

function render(): void {
  const url = new URL(window.location.href);
  clear(root);
  const bar = header();
  if (bar) root.append(bar);
  const main = h('main', { class: 'app-main' });
  main.append(viewFor(url.pathname, url.searchParams));
  root.append(main);
  const tabs = tabBar();
  if (tabs) root.append(tabs);
  root.append(liveRegions());
  document.body.classList.toggle('phone', isPhone());
  if (url.hash === '#compose' && currentMember()) {
    window.setTimeout(() => {
      const opener = qs<HTMLElement>('.start-post');
      openComposer({ opener, onDone: () => render() });
    }, 0);
  }
}

document.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement | null)?.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
  if (link.hasAttribute('download') || href.startsWith('/media/') || href.startsWith('/api/')) return;
  event.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', () => render());
window.addEventListener('resize', () => {
  const phone = isPhone();
  if (document.body.classList.contains('phone') !== phone) render();
});

async function boot(): Promise<void> {
  await loadConfig();
  await loadMe();
  render();
  if (currentMember()) {
    connectLive();
    void refreshCounters();
  }
  on('tick', () => refreshTimes());
  on('clock', () => {
    refreshTimes();
    render();
  });
  on('network', () => void refreshCounters());
  on('message', () => void refreshCounters());
  window.setInterval(() => refreshTimes(), 30000);
}

void boot();
