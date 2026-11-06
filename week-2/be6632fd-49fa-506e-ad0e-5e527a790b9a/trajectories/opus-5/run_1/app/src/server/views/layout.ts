import type { Role, Session } from '../auth.ts';
import { attrs, html, icon, raw, type RawHtml } from './html.ts';
export { canUseScreen } from '../../domain/screens.ts';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const NAV: Record<Role, NavItem[]> = {
  launch_producer: [
    { path: '/studio/drops', label: 'Drops', icon: 'calendar-days' },
    { path: '/studio/stockists', label: 'Stockists', icon: 'store' },
    { path: '/studio/members', label: 'Members', icon: 'users' },
  ],
  merchandiser: [
    { path: '/studio/drops', label: 'Drops', icon: 'calendar-days' },
    { path: '/studio/stockists', label: 'Stockists', icon: 'store' },
    { path: '/studio/price-lists', label: 'Price lists', icon: 'receipt' },
  ],
  finance_lead: [
    { path: '/studio/invoicing', label: 'Invoicing', icon: 'receipt' },
    { path: '/studio/price-lists', label: 'Price lists', icon: 'file-text' },
    { path: '/studio/drops', label: 'Drops', icon: 'calendar-days' },
    { path: '/studio/stockists', label: 'Stockists', icon: 'store' },
  ],
  press_lead: [
    { path: '/studio/press', label: 'Press', icon: 'file-text' },
    { path: '/studio/drops', label: 'Drops', icon: 'calendar-days' },
  ],
  stockist_buyer: [{ path: '/studio/my-store', label: 'My store', icon: 'store' }],
};

export function navFor(role: Role): NavItem[] {
  return NAV[role];
}

export interface PageOptions {
  title: string;
  session?: Session | null;
  bodyClass?: string;
  night?: boolean;
  activePath?: string;
}

export function page(options: PageOptions, main: RawHtml): string {
  const session = options.session ?? null;
  return `<!doctype html>${html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title} · Hourline</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<script type="module" src="/assets/app.js"></script>
</head>
<body${attrs({
  class: ['app', options.bodyClass ?? '', options.night === true ? 'is-night' : ''].filter(Boolean).join(' '),
  'data-member-id': session === null ? null : session.memberId,
  'data-role': session === null ? null : session.role,
})}>
<a class="skip-link" href="#content">Skip to content</a>
<div class="route-wipe" data-route-wipe aria-hidden="true"></div>
${session === null ? raw('') : staffHeader(session, options.activePath ?? '')}
<main id="content" class="main" data-main tabindex="-1">${main}</main>
</body>
</html>`.value}`;
}

function staffHeader(session: Session, activePath: string): RawHtml {
  return html`<header class="studio-header" data-studio-header>
  <div class="studio-header__inner">
    <span class="studio-header__workspace">${session.workspaceName}</span>
    <nav class="studio-nav" aria-label="Studio">
      <ul class="studio-nav__list">
        ${navFor(session.role).map(
          (item) => html`<li><a${attrs({
            href: item.path,
            class: 'studio-nav__link',
            'aria-current': activePath === item.path ? 'page' : null,
          })}>${icon(item.icon)}<span>${item.label}</span></a></li>`,
        )}
      </ul>
    </nav>
    <form class="studio-header__out" method="post" action="/sign-out" data-sign-out>
      <button type="submit" class="button button--quiet">Sign out</button>
    </form>
  </div>
</header>`;
}

const STATUS_MARKS: Record<string, { icon: string; word: string }> = {
  upcoming: { icon: 'circle', word: 'Upcoming' },
  live: { icon: 'circle-dot', word: 'Live' },
  sold_out: { icon: 'circle-slash', word: 'Sold out' },
  withdrawn: { icon: 'x', word: 'Withdrawn' },
  draft: { icon: 'circle', word: 'Draft' },
  scheduled: { icon: 'circle', word: 'Upcoming' },
};

/** A status word beside its own distinct shape, never colour alone. */
export function statusMark(status: string): RawHtml {
  const mark = STATUS_MARKS[status] ?? { icon: 'circle', word: status };
  return html`<span class="status-mark" data-status="${status}">${icon(mark.icon)}<span class="status-mark__word">${mark.word}</span></span>`;
}

export function nightMark(): RawHtml {
  return html`<span class="night-mark">${icon('moon')}<span class="night-mark__word">Night</span></span>`;
}

export function statusRegion(name: string, initial = ''): RawHtml {
  return html`<p class="status-region" role="status" aria-live="polite" aria-label="${name}" data-status-region="${name}">${initial}</p>`;
}

/** Every form outside a dialog carries a Problems region that opens when a submit fails. */
export function problemsRegion(): RawHtml {
  return html`<div class="problems" role="region" aria-label="Problems" data-problems hidden tabindex="-1">
  <h2 class="problems__heading">Problems</h2>
  <ul class="problems__list" data-problems-list></ul>
</div>`;
}

export function emptyRow(columns: number): RawHtml {
  return html`<tr class="table__empty"><td colspan="${columns}">Nothing here yet.</td></tr>`;
}
