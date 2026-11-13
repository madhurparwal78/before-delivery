import { documentTitle, LOCALE_OPTION_NAMES, LOCALES, t, type Locale, type MessageKey } from '../shared/i18n/index.js';
import { STORIES } from '../shared/constants.js';

export type Page =
  | { name: 'home' }
  | { name: 'signup' }
  | { name: 'signin' }
  | { name: 'forgot' }
  | { name: 'reset' }
  | { name: 'verify' }
  | { name: 'hangar' }
  | { name: 'builder'; characterId: string | null }
  | { name: 'forge' }
  | { name: 'armoury' }
  | { name: 'models' }
  | { name: 'stories' }
  | { name: 'chapterComplete'; storyId: string; chapter: number }
  | { name: 'lobby' }
  | { name: 'party'; partyId: string }
  | { name: 'invite'; token: string }
  | { name: 'play'; sessionId: string }
  | { name: 'notFound' };

export const PUBLIC_PAGES: Page['name'][] = [
  'home',
  'signup',
  'signin',
  'forgot',
  'reset',
  'verify',
];

/** Pages that carry the Language combobox in the server-rendered shell. */
const PICKER_PAGES: Page['name'][] = [...PUBLIC_PAGES, 'notFound', 'hangar'];

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Decides which page a path is, or null when the path is an unknown route. */
export function resolvePage(pathname: string): Page | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const segments = path.split('/').filter((segment) => segment !== '');

  if (segments.length === 0) return { name: 'home' };
  if (segments.length === 1) {
    switch (segments[0]) {
      case 'signup':
        return { name: 'signup' };
      case 'signin':
        return { name: 'signin' };
      case 'forgot-password':
        return { name: 'forgot' };
      case 'reset-password':
        return { name: 'reset' };
      case 'verify':
        return { name: 'verify' };
      case 'hangar':
        return { name: 'hangar' };
      case 'builder':
        return { name: 'builder', characterId: null };
      case 'forge':
        return { name: 'forge' };
      case 'armoury':
        return { name: 'armoury' };
      case 'models':
        return { name: 'models' };
      case 'stories':
        return { name: 'stories' };
      case 'lobby':
        return { name: 'lobby' };
      default:
        return null;
    }
  }
  if (segments.length === 2) {
    if (segments[0] === 'builder' && UUID_RE.test(segments[1])) {
      return { name: 'builder', characterId: segments[1] };
    }
    if (segments[0] === 'party' && UUID_RE.test(segments[1])) {
      return { name: 'party', partyId: segments[1] };
    }
    if (segments[0] === 'invite' && segments[1] !== '') return { name: 'invite', token: segments[1] };
    if (segments[0] === 'play' && UUID_RE.test(segments[1])) {
      return { name: 'play', sessionId: segments[1] };
    }
    return null;
  }
  if (
    segments.length === 5 &&
    segments[0] === 'stories' &&
    segments[2] === 'chapters' &&
    segments[4] === 'complete'
  ) {
    const story = STORIES.find((entry) => entry.id === segments[1]);
    const chapter = Number.parseInt(segments[3], 10);
    if (story === undefined || !/^\d+$/.test(segments[3])) return null;
    if (chapter < 1 || chapter > story.chapters) return null;
    return { name: 'chapterComplete', storyId: story.id, chapter };
  }
  return null;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function languagePicker(locale: Locale): string {
  const options = LOCALES.map(
    (value) =>
      `<option value="${value}"${value === locale ? ' selected' : ''}>${LOCALE_OPTION_NAMES[value]}</option>`,
  ).join('');
  return `<label class="field picker"><span>${escapeHtml(t(locale, 'label.language'))}</span>
<select id="language-picker" aria-label="${escapeHtml(t(locale, 'label.language'))}">${options}</select></label>`;
}

function shellBody(locale: Locale, page: Page): string {
  const parts: string[] = [];
  if (PICKER_PAGES.includes(page.name)) {
    parts.push(`<div class="paper-card shell-card">${languagePicker(locale)}`);
    if (page.name === 'notFound') {
      parts.push(`<h1>${escapeHtml(t(locale, 'notFound.heading'))}</h1>`);
    } else if (page.name === 'home') {
      parts.push(`<h1>Linewright</h1><p>${escapeHtml(t(locale, 'home.tagline'))}</p>`);
    } else if (page.name !== 'hangar') {
      const headings: Partial<Record<Page['name'], MessageKey>> = {
        signup: 'heading.signup',
        signin: 'heading.signin',
        forgot: 'heading.forgot',
        reset: 'heading.reset',
        verify: 'title.verify',
      };
      const key = headings[page.name];
      if (key !== undefined) parts.push(`<h1>${escapeHtml(t(locale, key))}</h1>`);
    }
    parts.push('</div>');
  }
  return parts.join('');
}

export interface ShellOptions {
  locale: Locale;
  page: Page;
  storyTitleKey?: MessageKey;
  signedIn: boolean;
}

export function renderShell(options: ShellOptions): string {
  const { locale, page } = options;
  const title =
    page.name === 'play' && options.storyTitleKey !== undefined
      ? t(locale, 'title.pattern', { screen: t(locale, options.storyTitleKey) })
      : documentTitle(locale, titleKeyFor(page));

  const preload =
    locale === 'ja'
      ? ['noto-sans-jp-400.woff2', 'noto-sans-jp-700.woff2']
          .map(
            (file) =>
              `<link rel="preload" href="/assets/fonts/${file}" as="font" type="font/woff2" crossorigin>`,
          )
          .join('')
      : '';

  const bootstrap = JSON.stringify({
    locale,
    page,
    signedIn: options.signedIn,
  });

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
${preload}
</head>
<body>
<div id="scene-root" aria-hidden="true"></div>
<div id="app">${shellBody(locale, page)}</div>
<script id="bootstrap" type="application/json">${bootstrap.replace(/</g, '\\u003c')}</script>
<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
}
