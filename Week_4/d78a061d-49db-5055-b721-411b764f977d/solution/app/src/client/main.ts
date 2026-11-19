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
import { Backdrop } from './scene/backdrop.js';
import { DEFAULT_LOOK, lookFrom } from './screens/shared.js';
import type { Character } from '../shared/types.js';
import type { HeroLook } from './scene/hero.js';

/** Screens without a scene of their own show the sketchbook world behind them. */
const BACKDROP_PAGES: readonly Page['name'][] = [
  'armoury',
  'models',
  'stories',
  'chapterComplete',
  'lobby',
  'party',
  'invite',
  'notFound',
];
const sceneRoot = document.getElementById('scene-root') as HTMLElement;
let backdrop: Backdrop | null = null;

async function backdropLook(): Promise<HeroLook> {
  if (account === null) return DEFAULT_LOOK;
  try {
    const { characters } = await api.get<{ characters: Character[] }>('/api/characters');
    const hero = characters.find((entry) => entry.equipped) ?? characters[0];
    return hero === undefined ? DEFAULT_LOOK : lookFrom(hero);
  } catch {
    return DEFAULT_LOOK;
  }
}

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
      // The page re-renders on the next frame, once the saved choice is in place.
      requestAnimationFrame(() => {
        locale = chosen;
        document.documentElement.lang = chosen;
        notifications.setAttribute('aria-label', t(locale, 'region.notifications'));
        void render(currentPage);
      });
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
      [icon(item.glyph), el('span', { class: 'tab-label', text: ctx.t(item.key) })],
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
      // A signed-in account's own locale comes first in locale resolution.
      locale = account.locale;
    } catch {
      account = null;
    }
  },
  async enterSignedIn(): Promise<void> {
    await context.refreshAccount();
    realtime.start();
    context.navigate('/hangar');
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

  backdrop?.destroy();
  backdrop = null;
  if (BACKDROP_PAGES.includes(page.name)) {
    void backdropLook().then((look) => {
      if (currentPage === page && backdrop === null) backdrop = new Backdrop(sceneRoot, look);
    });
  }

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

/**
 * The first screen waits (briefly) for the two faces most of its text is set in, so a wider
 * fallback never wraps a line that the real face then unwraps and shifts the page.
 */
function latinFaces(): Promise<unknown> {
  const faces = Promise.all([
    document.fonts.load("400 1em 'Nunito'"),
    document.fonts.load("600 1em 'Fredoka'"),
  ]).catch(() => undefined);
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

async function boot(): Promise<void> {
  const fonts = latinFaces();
  liveRegions.append(notifications);
  clear(appRoot);
  appRoot.append(bannerHost, frame, liveRegions);
  if (bootstrap.signedIn) {
    await context.refreshAccount();
    realtime.start();
  }
  await fonts;
  await render(bootstrap.page);
}

void boot();
