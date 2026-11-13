import { esc } from './render';
import { copy } from '../shared/copy';
import { css } from './screen';

export type EditorShellArgs = {
  siteSlug: string;
  siteId: string;
  versionSlug: string;
  versionId: string;
  versionTitle: string;
  siteTitle: string;
  pagePath: string;
  pageId: string;
  role: string;
  teamName: string;
  versions: { id: string; slug: string; title: string; default: boolean; publishedAt: string | null }[];
  openapi?: { fileName: string; bytes: number; sha256: string } | null;
  isReference?: boolean;
};

export function editorShell(args: EditorShellArgs): string {
  const canEdit = args.role === 'owner' || args.role === 'editor';
  const topbar = `
  <button type="button" data-new-page>New page</button>
  <button type="button" data-new-group>New group</button>
  <button type="button" data-import-openapi>Import OpenAPI</button>
  <button type="button" data-new-version>New version</button>
  <a href="/app/sites/${esc(args.siteSlug)}/${esc(args.versionSlug)}/redirects">Redirects</a>
  <a href="/app/sites/${esc(args.siteSlug)}/${esc(args.versionSlug)}/preview/${esc(args.pagePath)}" target="_blank">Preview</a>
  <button type="button" data-share-preview>Share preview</button>
  <button type="button" data-publish>Publish</button>
  <a href="/app/sites/${esc(args.siteSlug)}/analytics">Analytics</a>
  ${args.role === 'owner' ? `<a href="/app/team">Team</a>` : ''}
  <div class="theme-group" data-theme-group></div>
  <button type="button" data-sign-out>Sign out</button>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(args.siteTitle)} - Galley</title>
<style>${css()}</style>
</head>
<body class="editor-page"
  data-site-slug="${esc(args.siteSlug)}"
  data-site-id="${esc(args.siteId)}"
  data-version-slug="${esc(args.versionSlug)}"
  data-version-id="${esc(args.versionId)}"
  data-version-title="${esc(args.versionTitle)}"
  data-page-id="${esc(args.pageId)}"
  data-role="${esc(args.role)}"
  data-versions="${esc(JSON.stringify(args.versions))}">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<div class="editor-shell">
<header class="editor-topbar">
  <button type="button" class="pages-drawer-button" data-pages-drawer-button>Pages</button>
  <strong class="site-title">${esc(args.siteTitle)} / ${esc(args.versionTitle)}</strong>
  ${canEdit ? topbar : `
  <a href="/app/sites/${esc(args.siteSlug)}/${esc(args.versionSlug)}/preview/${esc(args.pagePath)}" target="_blank">Preview</a>
  <a href="/app/sites/${esc(args.siteSlug)}/analytics">Analytics</a>
  ${args.role === 'owner' ? `<a href="/app/team">Team</a>` : ''}
  <div class="theme-group" data-theme-group></div>
  <button type="button" data-sign-out>Sign out</button>`}
</header>
<nav class="editor-tree" aria-label="Pages">
  <div data-tree></div>
</nav>
<main class="editor-main">
  <label class="field">
    <span class="sr-only">Title</span>
    <input type="text" data-title-field aria-label="Title" ${canEdit ? '' : 'readonly'}>
  </label>
  <div class="toolbar">
    ${canEdit ? `<button type="button" data-image-button>Image</button>` : ''}
    <span class="save-status" data-save-status role="status"></span>
  </div>
  <div class="source-wrap">
    <div data-gutter aria-hidden="true"></div>
    <label class="sr-only" for="editor">Page source</label>
    <textarea id="editor" aria-label="Page source" ${canEdit ? '' : 'readonly'}></textarea>
  </div>
</main>
<aside class="proof-margin" data-proof-margin role="complementary" aria-label="Proof margin">
  <div data-presence></div>
  <h2 class="margin-heading">Redirects</h2>
  <ul data-redirects-list class="redirects-list"></ul>
  <p class="count"><span id="links-rewritten">0</span> links rewritten</p>
  <section data-publish-panel hidden aria-label="Publish check" role="complementary">
    <h2 class="margin-heading" data-panel-heading>Publish check</h2>
    <p data-panel-text></p>
    <div data-panel-list class="problem-list"></div>
    <button type="button" data-panel-close>Close</button>
  </section>
  ${args.isReference && args.openapi ? `
  <section class="source-panel" role="region" aria-label="Source">
    <h2 class="margin-heading">Source</h2>
    <p class="mono">${esc(args.openapi.fileName)}</p>
    <p class="mono">${args.openapi.bytes} bytes</p>
    <p class="mono">${esc(args.openapi.sha256)}</p>
    <a href="/api/versions/${esc(args.versionId)}/openapi/source">Download source</a>
  </section>` : ''}
</aside>
</div>
<div data-pages-drawer hidden>
  <div data-tree data-tree-drawer></div>
</div>
<script src="/client/editor.js"></script>
</body>
</html>`;
}

export function signinShell(next: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in - Galley</title>
<style>${css()}</style>
</head>
<body class="signin-page">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main class="signin-main">
<h1>Sign in</h1>
<form data-signin-form>
  <label class="field"><span>Email</span><input type="email" data-email aria-label="Email" autocomplete="email"></label>
  <label class="field"><span>Password</span><input type="password" data-password aria-label="Password"></label>
  <button type="submit">Sign in</button>
  <p data-error role="alert"></p>
</form>
</main>
<script src="/client/signin.js"></script>
</body>
</html>`;
}

export function appShell(teamName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galley</title>
<style>${css()}</style>
</head>
<body class="app-page">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main class="app-main">
<h1>${esc(teamName)}</h1>
<div data-sites-list></div>
</main>
<script src="/client/app.js"></script>
</body>
</html>`;
}

export function teamShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team - Galley</title>
<style>${css()}</style>
</head>
<body class="team-page">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main class="team-main">
<h1>Team</h1>
<table aria-label="Members">
<thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
<tbody data-members-body></tbody>
</table>
<h2>Invite</h2>
<form data-invite-form>
  <label class="field"><span>Email</span><input type="email" data-invite-email aria-label="Email"></label>
  <label class="field"><span>Role</span>
    <select data-invite-role aria-label="Role">
      <option value="editor">Editor</option>
      <option value="viewer">Viewer</option>
    </select>
  </label>
  <button type="submit">Send invite</button>
</form>
<h2>Invites</h2>
<table aria-label="Invites">
<thead><tr><th>Email</th><th>Role</th><th>Status</th></tr></thead>
<tbody data-invites-body></tbody>
</table>
</main>
<script src="/client/team.js"></script>
</body>
</html>`;
}

export function analyticsShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analytics - Galley</title>
<style>${css()}</style>
</head>
<body class="analytics-page">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main class="analytics-main">
<h1>Analytics</h1>
<h2>Page ratings</h2>
<table aria-label="Page ratings">
<thead><tr><th>Page</th><th>Yes</th><th>No</th><th>Helpful</th></tr></thead>
<tbody data-ratings-body></tbody>
</table>
<h2>Search terms</h2>
<table aria-label="Search terms">
<thead><tr><th>Term</th><th>Searches</th><th>Results</th></tr></thead>
<tbody data-terms-body></tbody>
</table>
</main>
<script src="/client/analytics.js"></script>
</body>
</html>`;
}

export function redirectsShell(siteSlug: string, versionSlug: string, versionId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirects - Galley</title>
<style>${css()}</style>
</head>
<body class="redirects-page" data-version-id="${esc(versionId)}">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main class="redirects-main">
<h1>Redirects</h1>
<table aria-label="Redirects">
<thead><tr><th>From</th><th>To</th><th>Kind</th><th></th></tr></thead>
<tbody data-redirects-body></tbody>
</table>
<h2>Add redirect</h2>
<form data-add-redirect>
  <label class="field"><span>From</span><input type="text" data-from aria-label="From"></label>
  <label class="field"><span>To</span><input type="text" data-to aria-label="To"></label>
  <button type="submit">Add redirect</button>
  <p data-error role="alert"></p>
</form>
<a href="/app/sites/${esc(siteSlug)}/${esc(versionSlug)}/pages">Back to pages</a>
</main>
<script src="/client/redirects.js"></script>
</body>
</html>`;
}

export function inviteShell(teamName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(copy.inviteHeading(teamName))}</title>
<style>${css()}</style>
</head>
<body class="invite-page" data-team-name="${esc(teamName)}">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main class="invite-main">
<h1>${esc(copy.inviteHeading(teamName))}</h1>
<form data-invite-form>
  <label class="field"><span>Name</span><input type="text" data-name aria-label="Name"></label>
  <label class="field"><span>Password</span><input type="password" data-password aria-label="Password"></label>
  <button type="submit">Join team</button>
  <p data-error role="alert"></p>
</form>
</main>
<script src="/client/invite.js"></script>
</body>
</html>`;
}

export function forbiddenShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access denied</title>
<style>${css()}</style>
</head>
<body class="forbidden-page">
<div id="announcer" role="status" aria-live="polite" class="sr-only"></div>
<main><h1>${esc(copy.noAccess)}</h1></main>
</body>
</html>`;
}
