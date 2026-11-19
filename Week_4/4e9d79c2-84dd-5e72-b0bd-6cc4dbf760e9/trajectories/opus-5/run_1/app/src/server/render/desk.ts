import { moneyLabel } from '../../domain/money.js';
import { formatUkDate } from '../../domain/time.js';
import { escapeHtml, dialog, field, iconDesk, problems, radioGroup, refreshLine, selectField, sheet, shell } from './layout.js';

const DESK_NAVIGATION = [
  { path: '/enquiries', label: 'Enquiries' },
  { path: '/operators', label: 'Operators' },
  { path: '/payments', label: 'Payments' },
  { path: '/diary', label: 'Diary' },
  { path: '/documents', label: 'Documents' },
  { path: '/rates', label: 'Rate tables' },
  { path: '/customers', label: 'Customers' },
  { path: '/aftercare/complaints', label: 'Complaints' },
  { path: '/aftercare/lost-property', label: 'Lost property' },
];

function deskNavigation(path: string): string {
  const links = DESK_NAVIGATION.map(
    (item) =>
      `<li><a href="${item.path}"${path.startsWith(item.path) ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a></li>`,
  ).join('');
  return `<nav class="desk-navigation" aria-label="Desk"><ul>${links}</ul>
  <button type="button" data-opens="change-password">Change password</button>
  <button type="button" data-sign-out>Sign out</button>
</nav>`;
}

function changePasswordDialog(): string {
  return dialog({
    id: 'change-password',
    title: 'Change password',
    body: `<div class="field underline-field"><label for="current-password">Current password</label>
      <input id="current-password" type="password" autocomplete="current-password"></div>
      <div class="field underline-field"><label for="new-password">New password</label>
      <input id="new-password" type="password" autocomplete="new-password"></div>`,
    actions: `<button type="button" data-action="save-password">Save password</button>`,
  });
}

export type DeskPage = {
  path: string;
  heading: string;
  title: string;
  main: string;
  mainAction?: string;
  dialogs?: string;
  data?: Record<string, unknown>;
};

export function deskShell(page: DeskPage): string {
  return shell({
    title: page.title,
    bodyClass: 'desk',
    before: `<div class="desk-top">
  <button type="button" class="menu-button" data-opens="desk-menu">Menu</button>
  <span class="wordmark">Merrowfield</span>
</div>
<div class="band plum-band desk-band">
  <h1 tabindex="-1">${escapeHtml(page.heading)}</h1>
  ${deskNavigation(page.path)}
</div>
${refreshLine()}`,
    after: `${page.mainAction ? `<div class="bottom-bar">${page.mainAction}</div>` : ''}
${sheet({ id: 'desk-menu', title: 'Menu', body: deskNavigation(page.path), actions: '' })}
${changePasswordDialog()}
${page.dialogs ?? ''}
<p class="session-line" data-part="session-line" hidden></p>`,
    main: page.main,
    data: { ...page.data, path: page.path },
  });
}

export function signInPage(returnTo: string | null): string {
  return shell({
    title: 'Sign in | Wayticket',
    bodyClass: 'desk sign-in',
    main: `<div class="band plum-band"><h1 tabindex="-1">Sign in</h1></div>
<form class="desk-form" data-form="sign-in" novalidate>
  ${problems()}
  ${field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}
  <div class="field underline-field"><label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password"></div>
  <button type="submit" class="main-action">Sign in</button>
  <p><a href="/sign-up">Start a desk</a></p>
</form>`,
    data: { returnTo },
  });
}

export function signUpPage(): string {
  return shell({
    title: 'Start a desk | Wayticket',
    bodyClass: 'desk sign-in',
    main: `<div class="band plum-band"><h1 tabindex="-1">Start a desk</h1></div>
<form class="desk-form" data-form="sign-up" novalidate>
  ${problems()}
  ${field({ id: 'desk-name', label: 'Desk name' })}
  ${field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' })}
  <div class="field underline-field"><label for="password">Password</label>
    <input id="password" type="password" autocomplete="new-password"></div>
  <button type="submit" class="main-action">Start desk</button>
  <p><a href="/sign-in">Sign in</a></p>
</form>`,
  });
}

export function emptyState(line: string): string {
  return `<div class="empty-state">${iconDesk()}<p>${escapeHtml(line)}</p></div>`;
}

export function moneyCell(pennies: number): string {
  return `<td class="money">${escapeHtml(moneyLabel(pennies))}</td>`;
}

export function dateCell(date: string): string {
  return `<td>${escapeHtml(formatUkDate(date))}</td>`;
}

export { DESK_NAVIGATION, selectField, radioGroup, dialog, sheet, field, problems, escapeHtml };
