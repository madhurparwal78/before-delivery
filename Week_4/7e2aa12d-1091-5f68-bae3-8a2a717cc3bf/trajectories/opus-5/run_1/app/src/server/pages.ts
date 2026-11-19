import type { LayoutObject } from '../shared/types.js';
import { TEMPLATE_LABELS, TEMPLATE_KEYS } from '../shared/templates.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bootScript(data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script>window.__MULLION__=${json};</script>`;
}

function shell(title: string, body: string, data: unknown): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/assets/styles.css">
${bootScript(data)}
</head>
<body>
${body}
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
}

function nextField(next: string | null): string {
  return next ? `<input type="hidden" name="next" value="${escapeHtml(next)}">` : '';
}

function nextQuery(next: string | null): string {
  return next ? `?next=${encodeURIComponent(next)}` : '';
}

export function signUpPage(next: string | null): string {
  return shell(
    'Create your account — Mullion',
    `<main class="card-page">
  <section class="card">
    <h1>Create your account</h1>
    <div class="alert" role="alert" aria-label="Form problem" data-form-problem></div>
    <form data-auth-form="signup">
      ${nextField(next)}
      <p class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username"></p>
      <p class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password"></p>
      <p class="actions"><button type="submit" class="primary">Create account</button></p>
    </form>
    <p class="aside-link"><a href="/signin${nextQuery(next)}">Sign in</a></p>
  </section>
</main>`,
    { page: 'signup' },
  );
}

export function signInPage(next: string | null): string {
  return shell(
    'Sign in — Mullion',
    `<main class="card-page">
  <section class="card">
    <h1>Sign in</h1>
    <div class="alert" role="alert" aria-label="Form problem" data-form-problem></div>
    <form data-auth-form="signin">
      ${nextField(next)}
      <p class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username"></p>
      <p class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password"></p>
      <p class="actions"><button type="submit" class="primary">Sign in</button></p>
    </form>
    <p class="aside-link"><a href="/signup${nextQuery(next)}">Create an account</a></p>
  </section>
</main>`,
    { page: 'signin' },
  );
}

export interface LibraryItem {
  id: string;
  name: string;
  columns: string[];
}

export function libraryPage(items: LibraryItem[]): string {
  const list =
    items.length === 0
      ? '<p class="empty">No layouts yet.</p>'
      : `<ul class="library">${items
          .map(
            (item) =>
              `<li><a href="/layouts/${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)}">` +
              `<span class="layout-name">${escapeHtml(item.name)}</span>` +
              `<span class="layout-tracks numeric">${escapeHtml(item.columns.join(' '))}</span></a></li>`,
          )
          .join('')}</ul>`;

  const templates = TEMPLATE_KEYS.map(
    (key, index) =>
      `<p class="radio"><input type="radio" id="template-${key}" name="template" value="${key}"${
        index === 0 ? ' checked' : ''
      }><label for="template-${key}">${escapeHtml(TEMPLATE_LABELS[key])}</label></p>`,
  ).join('');

  return shell(
    'Your layouts — Mullion',
    `<header class="top-bar">
  <span class="wordmark">Mullion</span>
  <button type="button" data-sign-out>Sign out</button>
</header>
<main class="library-page">
  <div class="library-head">
    <h1>Your layouts</h1>
    <button type="button" class="primary" data-new-layout>New layout</button>
  </div>
  <div class="alert" role="alert" aria-label="Edit problem" data-edit-problem></div>
  ${list}
</main>
<dialog aria-label="New layout" data-dialog="new-layout">
  <h2>New layout</h2>
  <div class="alert" role="alert" aria-label="Dialog problem" data-dialog-problem></div>
  <p class="field"><label for="layout-name">Layout name</label><input id="layout-name" type="text" data-layout-name></p>
  <fieldset role="radiogroup" aria-label="Starter template">
    <legend>Starter template</legend>
    ${templates}
  </fieldset>
  <p class="actions"><button type="button" class="primary" data-create-layout>Create layout</button><button type="button" data-cancel>Cancel</button></p>
</dialog>`,
    { page: 'library' },
  );
}

export function editorPage(layout: LayoutObject, username: string): string {
  return shell(`${layout.name} — Mullion`, '<div id="app"></div>', {
    page: 'editor',
    username,
    layout,
  });
}

export function viewPage(layout: LayoutObject, token: string): string {
  return shell(`${layout.name} — Mullion`, '<div id="app"></div>', {
    page: 'view',
    token,
    layout,
  });
}

export function notAvailablePage(signedIn: boolean): string {
  const link = signedIn ? '<a href="/">Your layouts</a>' : '<a href="/signin">Sign in</a>';
  return shell(
    'This layout is not available. — Mullion',
    `<main class="card-page">
  <section class="card">
    <h1>This layout is not available.</h1>
    <p class="aside-link">${link}</p>
  </section>
</main>`,
    { page: 'not-available' },
  );
}
