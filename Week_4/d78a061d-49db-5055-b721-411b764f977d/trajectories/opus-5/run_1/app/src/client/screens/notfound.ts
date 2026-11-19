import { el } from '../dom.js';
import { languagePicker } from '../main.js';
import type { AppContext, Screen } from './shared.js';

export function renderNotFound(ctx: AppContext, host: HTMLElement): Screen {
  host.append(
    el('div', { class: 'paper-card' }, [
      el('h1', { text: ctx.t('notFound.heading') }),
      languagePicker(ctx),
      el('a', { href: '/hangar', class: 'link', text: ctx.t('nav.hangar') }),
    ]),
  );
  return {};
}
