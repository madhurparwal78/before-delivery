import { api } from './api.js';
import { clear, el, icon } from './dom.js';
import { realtime } from './realtime.js';
import { readBootstrap, type AppContext, type Screen } from './state.js';
import {
  documentTitle,
  LOCALE_OPTION_NAMES,
  LOCALES,
  t,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '../shared/i18n/index.js';
import type { Account } from '../shared/types.js';
import { resolvePage, type Page } from '../server/pages.js';
import { renderAuthScreen } from './screens/auth.js';
import { renderHangar } from './screens/hangar.js';
import { renderBuilder } from './screens/builder.js';
import { renderForge } from './screens/forge.js';
import { renderArmoury } from './screens/armoury.js';
import { renderModels } from './screens/models.js';
import { renderStories, renderChapterComplete } from './screens/stories.js';
import { renderLobby, renderParty, renderInvite } from './screens/social.js';
import { renderPlay } from './screens/play.js';
import { renderNotFound } from './screens/notfound.js';

const bootstrap = readBootstrap();

let locale: Locale = bootstrap.locale;
let account: Account | null = null;
let currentScreen: Screen | null = null;

const appRoot = document.getElementById('app') as HTMLElement;
const liveRegions = el('div', { class: 'live-regions' });
const notifications = el('div', {
  class: 'live-region',
  role: 'status',
  'aria-live': 'polite',
  'aria-label': t(locale, 'region.notifications'),
});
const bannerHost = el('div', { class: 'banner-host' });
const frame = el('div', { class: 'frame' });

const NAV_ITEMS: { path: string; key: MessageKey; glyph: string }[] = [
  { path: '/hangar', key: 'nav.hangar', glyph: 'home' },
  { path: '/builder', key: 'nav.builder', glyph: 'pencil' },
  { path: '/forge', key: 'nav.forge', glyph: 'hammer' },
  { path: '/armoury', key: 'nav.armoury', glyph: 'swords' },
  { path: '/models', key: 'nav.models', glyph: 'box' },
  { path: '/stories', key: 'nav.stories', glyph: 'book-open' },
  { path: '/lobby', key: 'nav.lobby', glyph: 'users' },
];

function translate(key: MessageKey, params: MessageParams = {}): string {
  return t(locale, key, params);
}

function titleKeyFor(page: Page): MessageKey | null {
  switch (page.name) {
    case 'home':
      return null;
    case 'signup':
      return 'title.signup';
    case 'signin':
      return 'title.signin';
    case 'forgot':
      return 'title.forgot';
    case 'reset':
      return 'title.reset';
    case 'verify':
      return 'title.verify';
    case 'hangar':
      return 'title.hangar';
    case 'builder':
      return 'title.builder';
    case 'forge':
      return 'title.forge';
    case 'armoury':
      return 'title.armoury';
    case 'models':
      return 'title.models';
    case 'stories':
      return 'title.stories';
    case 'chapterComplete':
      return 'title.chapterComplete';
    case 'lobby':
      return 'title.lobby';
    case 'party':
      return 'title.party';
    case 'invite':
      return 'title.invite';
    case 'play':
      return 'title.stories';
    case 'notFound':
      return 'title.notFound';
  }
}

export function languagePicker(ctx: AppContext): HTMLElement {
  const select = el('select', { 'aria-label': ctx.t('label.language'), id: 'language-picker' });
  for (const value of LOCALES) {
    const option = el('option', { value }, [LOCALE_OPTION_NAMES[value]]);
    if (value === locale) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const chosen = select.value as Locale;
    void (async () => {
      await api.put('/api/locale', { locale: chosen });
      locale = chosen;
      document.documentElement.lang = chosen;
      notifications.setAttribute('aria-label', t(locale, 'region.notifications'));
      await render(currentPage);
    })();
  });
  return el('label', { class: 'field picker' }, [el('span', { text: ctx.t('label.language') }), select]);
}

function navigation(ctx: AppContext): HTMLElement {
  const nav = el('nav', { class: 'main-nav', 'aria-label': ctx.t('nav.main') });
  const list = el('ul');
  for (const item of NAV_ITEMS) {
    const link = el(
      'a',
      {
        href: item.path,
        'aria-current': window.location.pathname.startsWith(item.path) ? 'page' : null,
      },
      [icon(item.glyph), el('span', { text: ctx.t(item.key) })],
    );
    list.append(el('li', {}, [link]));
  }
  nav.append(list);
  return nav;
}

let currentPage: Page = bootstrap.page;

const context: AppContext = {
  get locale(): Locale {
    return locale;
  },
  get account(): Account | null {
    return account;
  },
  get page(): Page {
    return currentPage;
  },
  t: translate,
  navigate(path: string, options?: { replace?: boolean }): void {
    const target = new URL(path, window.location.origin);
    if (target.pathname === window.location.pathname && target.search === window.location.search) {
      return;
    }
    if (options?.replace === true) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
    void render(resolvePage(window.location.pathname) ?? { name: 'notFound' });
  },
  announce(text: string): void {
    notifications.textContent = text;
  },
  setBanner(text: string | null): void {
    clear(bannerHost);
    if (text !== null) bannerHost.append(el('div', { class: 'alert', role: 'alert', text }));
  },
  async refreshAccount(): Promise<void> {
    try {
      const response = await api.get<{ account: Account }>('/api/me');
      account = response.account;
    } catch {
      account = null;
    }
  },
};

async function render(page: Page): Promise<void> {
  currentPage = page;
  currentScreen?.destroy?.();
  currentScreen = null;
  clear(frame);
  document.documentElement.lang = locale;
  document.title =
    page.name === 'play' ? document.title : documentTitle(locale, titleKeyFor(page));

  const signedIn = account !== null;
  const content = el('div', { class: 'screen' });
  if (signedIn && page.name !== 'play') frame.append(navigation(context));
  frame.append(content);
  if (page.name === 'play') frame.classList.add('frame-play');
  else frame.classList.remove('frame-play');

  context.setBanner(null);

  switch (page.name) {
    case 'home':
    case 'signin':
    case 'signup':
    case 'forgot':
    case 'reset':
    case 'verify':
      currentScreen = await renderAuthScreen(context, content, page);
      break;
    case 'hangar':
      currentScreen = await renderHangar(context, content);
      break;
    case 'builder':
      currentScreen = await renderBuilder(context, content, page.characterId);
      break;
    case 'forge':
      currentScreen = await renderForge(context, content);
      break;
    case 'armoury':
      currentScreen = await renderArmoury(context, content);
      break;
    case 'models':
      currentScreen = await renderModels(context, content);
      break;
    case 'stories':
      currentScreen = await renderStories(context, content);
      break;
    case 'chapterComplete':
      currentScreen = await renderChapterComplete(context, content, page.storyId, page.chapter);
      break;
    case 'lobby':
      currentScreen = await renderLobby(context, content);
      break;
    case 'party':
      currentScreen = await renderParty(context, content, page.partyId);
      break;
    case 'invite':
      currentScreen = await renderInvite(context, content, page.token);
      break;
    case 'play':
      currentScreen = await renderPlay(context, content, page.sessionId);
      break;
    case 'notFound':
      currentScreen = renderNotFound(context, content);
      break;
  }
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest('a');
  if (target === null || target === undefined) return;
  const href = target.getAttribute('href');
  if (href === null || href.startsWith('http') || target.hasAttribute('download')) return;
  event.preventDefault();
  context.navigate(href);
});

window.addEventListener('popstate', () => {
  void render(resolvePage(window.location.pathname) ?? { name: 'notFound' });
});

async function boot(): Promise<void> {
  liveRegions.append(notifications);
  clear(appRoot);
  appRoot.append(bannerHost, frame, liveRegions);
  if (bootstrap.signedIn) {
    await context.refreshAccount();
    realtime.start();
  }
  await render(bootstrap.page);
}

void boot();
