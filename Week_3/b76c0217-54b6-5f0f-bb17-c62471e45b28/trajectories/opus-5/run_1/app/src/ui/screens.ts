import { escapeHtml } from '../domain/markdown';
import { messages } from '../domain/messages';
import { page as shell, themeRadios } from './shell';

const appBar = (title: string, role: 'owner' | 'editor' | 'viewer'): string => `<header class="top-bar">
<div class="titles"><span class="site-name">${escapeHtml(title)}</span></div>
<div class="actions"><a href="/app">Sites</a>${role === 'owner' ? '<a href="/app/team">Team</a>' : ''}${themeRadios()}<button type="button" id="sign-out-button">Sign out</button></div>
</header>`;

export function signInPage(next: string | null): string {
  const content = `<main class="sign-in-card">
<h1>Galley</h1>
<div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="username"></div>
<div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password"></div>
<p class="form-error" id="sign-in-error" hidden></p>
<button type="button" class="primary" id="sign-in-button">Sign in</button>
</main>`;
  return shell({
    documentTitle: 'Sign in - Galley',
    bodyClass: 'signin',
    script: 'editor',
    data: { screen: 'signin', next },
    content,
  });
}

export interface HomeSite {
  slug: string;
  title: string;
  versions: { slug: string; title: string; isDefault: boolean; published: boolean }[];
}

export function homePage(view: {
  user: { name: string; role: 'owner' | 'editor' | 'viewer' };
  teamName: string;
  sites: HomeSite[];
}): string {
  const cards = view.sites
    .map(
      (site) => `<section class="site-card"><h2>${escapeHtml(site.title)}</h2>
<p class="mono">/docs/${escapeHtml(site.slug)}</p>
<ul>${site.versions
        .map(
          (version) =>
            `<li><span class="mono">${escapeHtml(version.slug)}</span><span>${escapeHtml(version.title)}</span>${version.isDefault ? '<span class="chip">default</span>' : ''}<a href="/app/sites/${escapeHtml(site.slug)}/${escapeHtml(version.slug)}/pages">Edit</a><a href="/app/sites/${escapeHtml(site.slug)}/analytics">Analytics</a>${version.published ? `<a href="/docs/${escapeHtml(site.slug)}/${escapeHtml(version.slug)}">Live site</a>` : ''}</li>`,
        )
        .join('')}</ul></section>`,
    )
    .join('');
  const content = `${appBar(view.teamName, view.user.role)}
<main class="screen"><h1>Sites</h1>${cards}</main>`;
  return shell({
    documentTitle: `${view.teamName} - Galley`,
    bodyClass: 'home',
    script: 'editor',
    data: { screen: 'home' },
    content,
  });
}

export function redirectsPage(view: {
  user: { name: string; role: 'owner' | 'editor' | 'viewer' };
  site: { slug: string; title: string };
  version: { id: string; slug: string; title: string };
}): string {
  const content = `${appBar(`${view.site.title} - ${view.version.title}`, view.user.role)}
<main class="screen">
<h1>Redirects</h1>
<p><a href="/app/sites/${escapeHtml(view.site.slug)}/${escapeHtml(view.version.slug)}/pages">Back to pages</a></p>
<table aria-label="Redirects"><thead><tr><th>From</th><th>To</th><th>Kind</th><th></th></tr></thead>
<tbody id="redirect-rows"></tbody></table>
${
  view.user.role === 'viewer'
    ? ''
    : `<h2>Add redirect</h2>
<div class="field"><label for="redirect-from">From</label><input id="redirect-from" type="text"><p class="field-error" id="redirect-from-error" hidden></p></div>
<div class="field"><label for="redirect-to">To</label><input id="redirect-to" type="text"><p class="field-error" id="redirect-to-error" hidden></p></div>
<button type="button" class="primary" id="add-redirect">Add redirect</button>`
}
</main>`;
  return shell({
    documentTitle: `Redirects - ${view.site.title} (${view.version.title})`,
    bodyClass: 'redirects',
    script: 'editor',
    data: { screen: 'redirects', versionId: view.version.id, canWrite: view.user.role !== 'viewer' },
    content,
  });
}

export function analyticsPage(view: {
  user: { name: string; role: 'owner' | 'editor' | 'viewer' };
  site: { id: string; slug: string; title: string };
}): string {
  const content = `${appBar(view.site.title, view.user.role)}
<main class="screen tables">
<h1>Analytics</h1>
<section><h2>Page ratings</h2>
<table aria-label="Page ratings"><thead><tr><th>Page</th><th>Yes</th><th>No</th><th>Helpful</th></tr></thead>
<tbody id="rating-rows"></tbody></table></section>
<section><h2>Search terms</h2>
<table aria-label="Search terms"><thead><tr><th>Term</th><th>Searches</th><th>Results</th></tr></thead>
<tbody id="term-rows"></tbody></table></section>
</main>`;
  return shell({
    documentTitle: `Analytics - ${view.site.title}`,
    bodyClass: 'analytics',
    script: 'editor',
    data: { screen: 'analytics', siteId: view.site.id },
    content,
  });
}

export function teamPage(view: {
  user: { name: string; role: 'owner' | 'editor' | 'viewer' };
  teamName: string;
}): string {
  const content = `${appBar(view.teamName, view.user.role)}
<main class="screen tables">
<h1>Team</h1>
<section><h2>Members</h2>
<table aria-label="Members"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
<tbody id="member-rows"></tbody></table></section>
<section><h2>Invite</h2>
<div class="field"><label for="invite-email">Email</label><input id="invite-email" type="email"><p class="field-error" id="invite-email-error" hidden></p></div>
<div class="field"><label for="invite-role">Role</label><select id="invite-role"><option value="editor">Editor</option><option value="viewer">Viewer</option></select></div>
<button type="button" class="primary" id="send-invite">Send invite</button></section>
<section><h2>Invites</h2>
<table aria-label="Invites"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
<tbody id="invite-rows"></tbody></table></section>
</main>`;
  return shell({
    documentTitle: `Team - ${view.teamName}`,
    bodyClass: 'team',
    script: 'editor',
    data: { screen: 'team' },
    content,
  });
}

export function invitePage(view: { teamName: string; token: string }): string {
  const content = `<main class="sign-in-card">
<h1>${escapeHtml(messages.inviteHeading(view.teamName))}</h1>
<div class="field"><label for="invite-name">Name</label><input id="invite-name" type="text"></div>
<div class="field"><label for="invite-password">Password</label><input id="invite-password" type="password" autocomplete="new-password"></div>
<p class="form-error" id="invite-error" hidden></p>
<button type="button" class="primary" id="join-team">Join team</button>
</main>`;
  return shell({
    documentTitle: messages.inviteHeading(view.teamName),
    bodyClass: 'invite',
    script: 'editor',
    data: { screen: 'invite', token: view.token },
    content,
  });
}

export function invalidInvitePage(): string {
  return shell({
    documentTitle: 'Galley',
    bodyClass: 'invite',
    script: 'editor',
    content: `<main class="sign-in-card"><h1>${escapeHtml(messages.inviteInvalid)}</h1></main>`,
  });
}

export function forbiddenPage(): string {
  return shell({
    documentTitle: 'Galley',
    bodyClass: 'forbidden',
    script: 'editor',
    content: `<main class="screen"><h1>${escapeHtml(messages.noAccess)}</h1></main>`,
  });
}
