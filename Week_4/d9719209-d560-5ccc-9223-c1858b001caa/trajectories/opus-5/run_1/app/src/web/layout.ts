import { copy } from '../shared/copy.js';
import { attribute, html, raw, type Raw } from '../shared/html.js';
import type { CommunityView, PageData } from '../shared/types.js';

export interface LayoutOptions {
  title: string;
  nonce: string;
  data: PageData;
  main: Raw;
  sidebar?: Raw | null;
  rail?: CommunityView[];
}

function masthead(data: PageData): Raw {
  const account = data.account;
  return html`
    <header class="masthead">
      <div class="masthead-inner">
        <button
          type="button"
          class="drawer-toggle"
          aria-expanded="false"
          aria-controls="community-drawer"
          data-drawer-toggle
        >Communities</button>
        <a class="wordmark" href="/">Moothall</a>
        <span class="live-indicator" id="live-indicator" data-live-indicator>${copy.live.on}</span>
        <nav class="account-controls" aria-label="Account">
          ${account
            ? html`
                ${account.role === 'admin' ? html`<a href="/admin/reports">Admin</a>` : raw('')}
                <a href="/communities/new">Create community</a>
                <a href="/u/${account.username}">u/${account.username}</a>
                <button type="button" data-sign-out>Sign out</button>
              `
            : html`
                <a href="/login">Sign in</a>
                <a href="/signup">Create account</a>
              `}
        </nav>
      </div>
    </header>
  `;
}

function unverifiedBanner(data: PageData): Raw {
  if (!data.account || data.account.emailVerified) return raw('');
  return html`
    <div class="unverified-banner" data-unverified-banner>
      <p>${copy.verify.banner}</p>
      <button type="button" data-resend-verification>Resend email</button>
    </div>
  `;
}

function railMarkup(communities: CommunityView[]): Raw {
  return html`
    <nav class="rail" id="community-drawer" aria-label="Communities" data-drawer>
      <h2 class="rail-heading">Communities</h2>
      <ul class="rail-list">
        <li><a href="/">Home</a></li>
        <li><a href="/communities">All communities</a></li>
        ${communities.map(
          (community) => html`<li><a href="/c/${community.name}">c/${community.name}</a></li>`,
        )}
      </ul>
    </nav>
  `;
}

export function document(options: LayoutOptions): string {
  const payload = JSON.stringify(options.data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${options.title}</title>
<link rel="stylesheet" href="/static/app.css" />
<link rel="icon" href="/static/icon.svg" type="image/svg+xml" />
</head>
<body data-route="${options.data.route}">
<a class="skip-link" href="#main">Skip to content</a>
${masthead(options.data).value}
${unverifiedBanner(options.data).value}
<div class="live-regions">
  <div id="live-status" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="live-alert" role="alert" aria-atomic="true"></div>
</div>
<div class="toast-stack" id="toast-stack" aria-hidden="true"></div>
<div class="shell">
${railMarkup(options.rail ?? []).value}
<main id="main" class="feed-column" tabindex="-1">
${options.main.value}
</main>
${options.sidebar ? `<aside class="sidebar">${options.sidebar.value}</aside>` : '<aside class="sidebar"></aside>'}
</div>
<script type="application/json" id="page-data">${payload}</script>
<script nonce="${options.nonce}">
if (window.innerWidth < 768) {
  var drawer = document.getElementById('community-drawer');
  if (drawer) { drawer.setAttribute('inert', ''); drawer.hidden = true; }
}
</script>
<script type="module" src="/static/app.js" nonce="${options.nonce}"></script>
</body>
</html>`;
}

export function sidebarCommunity(community: CommunityView, logEntries: Raw): Raw {
  return html`
    <section class="sidebar-section">
      <h2>About c/${community.name}</h2>
      <p class="community-description">${community.description}</p>
      <h3>Rules</h3>
      <ol class="rule-list">
        ${community.rules.map((rule) => html`<li><strong>${rule.title}</strong> ${rule.description}</li>`)}
      </ol>
    </section>
    <section class="sidebar-section">
      <h2>Moderation log</h2>
      ${logEntries}
      <p><a href="/c/${community.name}/about/log">Full moderation log</a></p>
    </section>
  `;
}

export function formField(options: {
  id: string;
  label: string;
  type?: string;
  value?: string;
  autocomplete?: string;
  describedBy?: string;
  required?: boolean;
  inputMode?: string;
}): Raw {
  return html`
    <div class="field">
      <label for="${options.id}">${options.label}</label>
      <input
        id="${options.id}"
        name="${options.id}"
        type="${options.type ?? 'text'}"
        value="${options.value ?? ''}"
        ${attribute('autocomplete', options.autocomplete ?? null)}
        ${attribute('inputmode', options.inputMode ?? null)}
        ${attribute('required', options.required === true)}
        aria-describedby="${options.id}-error"
      />
      <p class="field-error" id="${options.id}-error" hidden></p>
    </div>
  `;
}
