import type { ApiError } from '../http/errors.js';
import type { ErrorCode } from '../shared/copy.js';
import { errorMessage } from '../shared/copy.js';
import { s } from '../shared/strings.js';
import type { RequestContext } from '../http/router.js';
import { landingRoute } from '../domain/session.js';
import { esc, tag } from './html.js';
import { link, page } from './layout.js';

const OUTAGE_CODES: readonly ErrorCode[] = [
  'storage_unavailable',
  'search_unavailable',
  'billing_unavailable',
];

/**
 * A refusal on a page surface shows the published copy in the current locale,
 * with a link to the signed-in role's own landing route.
 */
export function renderErrorPage(error: ApiError, ctx: RequestContext | null): string {
  const locale = ctx?.locale ?? 'en';
  const lang = ctx?.lang ?? null;
  const role = ctx?.session?.role ?? null;
  const message = errorMessage(error.code, locale, error.params);
  // The refusal is itself proof of the outage, ahead of the health monitor.
  const banner = OUTAGE_CODES.includes(error.code) ? message : null;

  return page(
    { locale, lang, title: message, role, banner },
    tag(
      'section',
      { class: 'panel narrow' },
      tag('h1', {}, esc(message)),
      tag(
        'p',
        {},
        tag(
          'a',
          { href: link(role === null ? '/catalogue' : landingRoute(role), lang) },
          esc(role === null ? s('catalogueLink', locale) : s('goToYourArea', locale)),
        ),
      ),
    ),
  );
}
