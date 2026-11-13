import type { Locale } from '../shared/domain.js';
import { dicts } from '../shared/i18n.js';
import { localeNames, locales } from '../shared/domain.js';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type PageKind =
  | 'home' | 'signup' | 'signin' | 'forgot-password' | 'reset-password' | 'verify'
  | 'hangar' | 'builder' | 'forge' | 'armoury' | 'models' | 'stories' | 'lobby'
  | 'party-lobby' | 'invite' | 'play' | 'chapter-complete' | 'not-found';

const screenKey: Partial<Record<PageKind, string>> = {
  signin: 'sign-in', signup: 'sign-up', 'forgot-password': 'forgot-password',
  hangar: 'hangar', builder: 'builder', forge: 'forge', armoury: 'armoury',
  models: 'models', stories: 'stories', lobby: 'lobby', 'party-lobby': 'party-lobby',
  invite: 'invite', verify: 'verify', 'reset-password': 'reset-password',
  'chapter-complete': 'chapter-complete', 'not-found': 'not-found',
};

function languagePicker(locale: Locale, dict: typeof dicts.en): string {
  const options = locales
    .map((l) => `<option value="${l}"${l === locale ? ' selected' : ''}>${escapeHtml(localeNames[l] ?? l)}</option>`)
    .join('');
  const languageLabel = dict.controls.language ?? 'Language';
  return `<div class="lang-row"><label for="language-picker">${escapeHtml(languageLabel)}</label>
    <select id="language-picker" aria-label="${escapeHtml(languageLabel)}" role="combobox">${options}</select></div>`;
}

export type ShellOptions = {
  locale: Locale;
  kind: PageKind;
  titleOverride?: string;
  signedIn: boolean;
  bodyHtml: string;
  suppressHydration?: boolean;
};

export function shell(opts: ShellOptions): string {
  const dict = dicts[opts.locale];
  const key = screenKey[opts.kind];
  const screenName = (key ? dict.screens[key] : opts.titleOverride) ?? 'Linewright';
  const title = opts.kind === 'home' ? (dict.copy['title-home'] ?? 'Linewright') : `${screenName} · Linewright`;
  const jpFonts = opts.locale === 'ja'
    ? '<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/noto-sans-jp-400-55f978b3.woff2" crossorigin><link rel="preload" as="font" type="font/woff2" href="/assets/fonts/noto-sans-jp-700-55f978b3.woff2" crossorigin><link rel="stylesheet" href="/assets/jp-fonts.css">'
    : '';
  const picker = `<div id="language-picker-root">${languagePicker(opts.locale, dict)}</div>`;
  return `<!doctype html>
<html lang="${opts.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/main.css">
${jpFonts}
<script>self.__lwLocale=${JSON.stringify(opts.locale)};self.__lwKind=${JSON.stringify(opts.kind)};self.__lwSignedIn=${opts.signedIn};self.__lwSuppress=${opts.suppressHydration ? 'true' : 'false'};</script>
</head>
<body data-page="${opts.kind}">
<div id="notifications" role="status" aria-live="polite" class="polite-region"></div>
<div id="global-alert" role="alert" hidden></div>
<div id="app">${opts.bodyHtml}</div>
${picker}
<script type="module" src="/assets/main.js" defer></script>
</body>
</html>`;
}

export function clientShell(kind: PageKind, locale: Locale, signedIn: boolean): string {
  return shell({ locale, kind, signedIn, bodyHtml: '<div id="root"></div>', suppressHydration: true });
}
