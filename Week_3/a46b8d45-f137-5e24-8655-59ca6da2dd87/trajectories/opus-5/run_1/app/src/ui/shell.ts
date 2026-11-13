/**
 * The page shell: the skip link, the header with the language switch on owner pages, and
 * the one status region and one alert region every page carries.
 */

import { CONTROL_NAMES, OWNER_FIELD_ERRORS, OWNER_PENDING, OWNER_REFUSALS, PAGE_HEADINGS, STATE_NAMES } from '../shared/copy';
import { bilingual, bilingualLabel, h, pick, text, type Attributes } from '../shared/html';
import { LANGUAGES, type Language } from '../shared/format';

export interface ShellOptions {
  title: string;
  language: Language;
  /** Operator screens are English only and carry no language switch. */
  audience: 'owner' | 'operator';
  body: string;
  /** Extra state the browser needs, with no credential and no private field. */
  pageData?: Record<string, unknown>;
}

const SKIP_OWNER = { 'en-GB': 'Skip to claim', 'pl-PL': 'Skip to claim' };
const SKIP_OPERATOR = 'Skip to claim workspace';

/**
 * The copy the browser needs for messages it raises itself, in both languages, so a
 * refusal or a pending line is never invented in the browser.
 */
function browserCopy(): Record<string, unknown> {
  return {
    refusals: OWNER_REFUSALS,
    fields: OWNER_FIELD_ERRORS,
    pending: OWNER_PENDING,
    states: STATE_NAMES,
  };
}

function languageSwitch(language: Language): string {
  return h(
    'div',
    {
      role: 'radiogroup',
      class: 'language-switch',
      'aria-label': pick(CONTROL_NAMES.languageGroup, language),
      ...bilingualLabel(CONTROL_NAMES.languageGroup),
    },
    ...LANGUAGES.map((candidate) => {
      const label = candidate === 'en-GB' ? CONTROL_NAMES.english : CONTROL_NAMES.polish;
      const id = `language-${candidate}`;
      return h(
        'span',
        { class: 'language-option' },
        h('input', {
          type: 'radio',
          id,
          name: 'language',
          value: candidate,
          checked: candidate === language,
          class: 'language-radio',
        }),
        h('label', { for: id, ...bilingual(label) }, text(pick(label, language))),
      );
    }),
  );
}

export function renderShell(options: ShellOptions): string {
  const owner = options.audience === 'owner';
  const skipAttributes: Attributes = owner
    ? { href: '#desk-main', class: 'skip-link', ...bilingual(SKIP_OWNER) }
    : { href: '#desk-main', class: 'skip-link' };

  const header = h(
    'header',
    { class: 'desk-header' },
    h(
      'a',
      { href: '/', class: 'brand', ...(owner ? bilingual(PAGE_HEADINGS.home) : {}) },
      text(owner ? pick(PAGE_HEADINGS.home, options.language) : 'Holmgarth Aftercare'),
    ),
    owner ? languageSwitch(options.language) : '',
  );

  const liveRegions = h(
    'div',
    { class: 'live-regions' },
    // Exactly one general status region and exactly one alert region per page.
    h('div', { role: 'status', class: 'desk-status', id: 'desk-status' }),
    h('div', { role: 'alert', class: 'desk-alert', id: 'desk-alert', tabindex: '-1' }),
  );

  const data = { language: options.language, copy: browserCopy(), ...(options.pageData ?? {}) };

  return `<!DOCTYPE html>
${h(
  'html',
  { lang: options.language === 'pl-PL' && owner ? 'pl-PL' : 'en-GB' },
  h(
    'head',
    {},
    h('meta', { charset: 'utf-8' }),
    h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
    h('title', {}, text(options.title)),
    h('link', { rel: 'stylesheet', href: '/styles.css' }),
  ),
  h(
    'body',
    { class: owner ? 'owner' : 'operator', 'data-language': options.language },
    h('a', skipAttributes, text(owner ? pick(SKIP_OWNER, options.language) : SKIP_OPERATOR)),
    header,
    liveRegions,
    h('main', { id: 'desk-main', class: 'desk-main' }, options.body),
    h('script', { type: 'application/json', id: 'desk-data' }, JSON.stringify(data).replace(/</g, '\\u003c')),
    h('script', { src: '/app.js' }),
  ),
)}
`;
}
