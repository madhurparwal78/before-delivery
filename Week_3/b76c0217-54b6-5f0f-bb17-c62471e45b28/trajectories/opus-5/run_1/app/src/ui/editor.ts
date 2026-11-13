import { escapeHtml } from '../domain/markdown';
import { messages } from '../domain/messages';
import { SNIPPETS } from '../domain/components';
import type { Redirect } from '../domain/redirects';
import type { PageDocument } from '../api/documents';
import { page as shell, themeRadios } from './shell';
import type { NavTab } from './reader';

export interface EditorView {
  user: { id: string; name: string; role: 'owner' | 'editor' | 'viewer' };
  site: { id: string; slug: string; title: string };
  version: { id: string; slug: string; title: string };
  versions: { id: string; slug: string; title: string }[];
  tabs: NavTab[];
  page: PageDocument | null;
  pageGroupId: string | null;
  redirects: Redirect[];
  source: { fileName: string; bytes: number; sha256: string } | null;
}

const canWrite = (view: EditorView): boolean => view.user.role !== 'viewer';

function treeRows(view: EditorView): string {
  const currentId = view.page === null ? null : view.page.id;
  let focusAssigned = currentId !== null;
  return view.tabs
    .map((tab, tabIndex) => {
      const groups = tab.groups
        .map((group, groupIndex) => {
          const pages = group.pages
            .map((navPage, pageIndex) => {
              const isCurrent = navPage.id === currentId;
              const focus = isCurrent || (!focusAssigned && tabIndex === 0 && groupIndex === 0 && pageIndex === 0);
              if (focus) focusAssigned = true;
              return `<div class="row row-page" role="treeitem" id="row-${escapeHtml(navPage.id)}" aria-level="3" aria-posinset="${pageIndex + 1}" aria-setsize="${group.pages.length}" aria-selected="${isCurrent}" tabindex="${focus ? 0 : -1}" data-page-id="${escapeHtml(navPage.id)}" data-path="${escapeHtml(navPage.path)}" data-title="${escapeHtml(navPage.title)}" data-group-id="${escapeHtml(group.id)}">
<span class="row-title">${escapeHtml(navPage.title)}</span><span class="row-path mono">/${escapeHtml(navPage.path)}</span>
${canWrite(view) ? `<button type="button" class="row-actions" aria-label="Actions for ${escapeHtml(navPage.title)}" aria-haspopup="menu" aria-expanded="false" tabindex="-1">...</button>` : ''}
</div>`;
            })
            .join('');
          return `<div class="row row-group" role="treeitem" id="row-grp-${escapeHtml(group.id)}" aria-level="2" aria-posinset="${groupIndex + 1}" aria-setsize="${tab.groups.length}" aria-expanded="true" tabindex="-1" data-group-id="${escapeHtml(group.id)}" data-tab-id="${escapeHtml(tab.id)}" data-title="${escapeHtml(group.title)}">
<span class="row-title">${escapeHtml(group.title)}</span>
</div><div role="group">${pages}</div>`;
        })
        .join('');
      return `<div class="row row-tab" role="treeitem" id="row-tab-${escapeHtml(tab.id)}" aria-level="1" aria-posinset="${tabIndex + 1}" aria-setsize="${view.tabs.length}" aria-expanded="true" tabindex="-1" data-tab-id="${escapeHtml(tab.id)}" data-title="${escapeHtml(tab.title)}">
<span class="row-title">${escapeHtml(tab.title)}</span>
</div><div role="group">${groups}</div>`;
    })
    .join('');
}

function pagesTree(view: EditorView): string {
  return `<div class="tree-column" id="pages-panel">
<h2>Pages</h2>
<div role="tree" aria-label="Pages" id="pages-tree">${treeRows(view)}</div>
</div>`;
}

function slashMenu(): string {
  const options = SNIPPETS.map(
    (snippet, index) =>
      `<li role="option" id="slash-option-${index + 1}" data-index="${index}" aria-selected="${index === 0}">${escapeHtml(snippet.label)}</li>`,
  ).join('');
  return `<ul class="slash-menu" id="slash-menu" role="listbox" aria-label="Insert component" hidden>${options}</ul>`;
}

function pageEditor(view: EditorView): string {
  if (view.page === null) {
    return `<main class="page-editor"><p>No page open.</p></main>`;
  }
  const readOnly = !canWrite(view) || view.page.kind === 'reference';
  const lines = view.page.source.split('\n');
  const gutter = lines
    .map((_line, index) => `<span data-line="${index + 1}">${index + 1}</span>`)
    .join('');
  return `<main class="page-editor" data-page-id="${escapeHtml(view.page.id)}" data-revision="${view.page.revision}" data-path="${escapeHtml(view.page.path)}" data-kind="${escapeHtml(view.page.kind)}">
<div class="field"><label for="page-title-field">Title</label>
<input id="page-title-field" type="text" value="${escapeHtml(view.page.title)}"${readOnly ? ' readonly' : ''}></div>
${
  canWrite(view) && view.page.kind === 'page'
    ? `<div class="editor-toolbar"><button type="button" id="image-button">Image</button>
<input type="file" id="image-input" aria-label="Upload image" accept="image/png,image/jpeg,image/webp" hidden></div>`
    : ''
}
<div class="source-wrap">
<div class="gutter" id="gutter">${gutter}</div>
<textarea id="editor" aria-label="Page source" spellcheck="false" wrap="off"${readOnly ? ' readonly' : ''}>${escapeHtml(view.page.source)}</textarea>
${slashMenu()}
</div>
<p class="save-status" id="save-status"></p>
</main>`;
}

function proofMargin(view: EditorView): string {
  const chips = view.redirects
    .map(
      (redirect) =>
        `<li class="chip" data-from="${escapeHtml(redirect.from)}">${escapeHtml(`${redirect.from} \u2192 ${redirect.to}`)}</li>`,
    )
    .join('');
  const sourcePanel =
    view.source === null || view.page === null || view.page.kind !== 'reference'
      ? ''
      : `<section class="source-panel" aria-label="Source"><h2>Source</h2>
<p class="mono">${escapeHtml(view.source.fileName)}</p>
<p class="mono">${view.source.bytes} bytes</p>
<p class="mono">${escapeHtml(view.source.sha256)}</p>
<p><a href="/api/versions/${escapeHtml(view.version.id)}/openapi/source">Download source</a></p>
</section>`;
  return `<aside class="proof-margin" aria-label="Proof margin">
<div id="presence-notices"></div>
<div id="conflict-notice"></div>
<div>
<h2>Redirects</h2>
<ul class="redirect-chips" id="redirect-list" aria-label="Redirects">${chips}</ul>
</div>
<p id="links-rewritten"><span class="count">0</span> links rewritten</p>
<div id="publish-check-slot"></div>
${sourcePanel}
</aside>`;
}

function topBar(view: EditorView): string {
  const write = canWrite(view);
  const base = `/app/sites/${view.site.slug}/${view.version.slug}`;
  const actions: string[] = [];
  if (write) {
    actions.push(
      '<button type="button" id="new-page-button">New page</button>',
      '<button type="button" id="new-group-button">New group</button>',
      '<button type="button" id="import-button">Import OpenAPI</button>',
      '<input type="file" id="import-input" aria-label="OpenAPI file" accept="application/json" hidden>',
      '<button type="button" id="new-version-button">New version</button>',
    );
  }
  actions.push(`<a href="${base}/redirects">Redirects</a>`);
  if (view.page !== null) {
    actions.push(
      `<a href="${base}/preview/${escapeHtml(view.page.path)}" target="_blank" rel="noreferrer">Preview</a>`,
    );
  }
  if (write && view.page !== null) {
    actions.push('<button type="button" id="share-preview-button">Share preview</button>');
  }
  if (write) actions.push('<button type="button" id="publish-button">Publish</button>');
  actions.push(`<a href="/app/sites/${view.site.slug}/analytics">Analytics</a>`);
  if (view.user.role === 'owner') actions.push('<a href="/app/team">Team</a>');
  return `<header class="top-bar">
<button type="button" class="pages-button" id="pages-button">Pages</button>
<div class="titles"><span class="site-name">${escapeHtml(view.site.title)}</span><span class="version-name">${escapeHtml(view.version.title)}</span></div>
<div class="actions">${actions.join('')}${themeRadios()}<button type="button" id="sign-out-button">Sign out</button></div>
</header>`;
}

function dialogs(view: EditorView): string {
  const groupOptions = view.tabs
    .flatMap((tab) => tab.groups)
    .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.title)}</option>`)
    .join('');
  const tabOptions = view.tabs
    .map((tab) => `<option value="${escapeHtml(tab.id)}">${escapeHtml(tab.title)}</option>`)
    .join('');
  const versionOptions = view.versions
    .map(
      (version) =>
        `<option value="${escapeHtml(version.id)}"${version.id === view.version.id ? ' selected' : ''}>${escapeHtml(version.title)}</option>`,
    )
    .join('');
  return `<div class="modal" id="new-page-dialog" role="dialog" aria-modal="true" aria-label="New page" hidden>
<h2>New page</h2>
<div class="field"><label for="new-page-title">Title</label><input id="new-page-title" type="text"></div>
<div class="field"><label for="new-page-path">Path</label><input id="new-page-path" type="text"><p class="field-error" id="new-page-path-error" hidden></p></div>
<div class="field"><label for="new-page-group">Group</label><select id="new-page-group">${groupOptions}</select></div>
<div class="dialog-actions"><button type="button" class="primary" id="create-page">Create page</button><button type="button" id="cancel-new-page">Cancel</button></div>
</div>
<div class="modal" id="new-group-dialog" role="dialog" aria-modal="true" aria-label="New group" hidden>
<h2>New group</h2>
<div class="field"><label for="new-group-title">Title</label><input id="new-group-title" type="text"></div>
<div class="field"><label for="new-group-tab">Tab</label><select id="new-group-tab">${tabOptions}</select></div>
<div class="dialog-actions"><button type="button" class="primary" id="create-group">Create group</button><button type="button" id="cancel-new-group">Cancel</button></div>
</div>
<div class="modal" id="new-version-dialog" role="dialog" aria-modal="true" aria-label="New version" hidden>
<h2>New version</h2>
<div class="field"><label for="new-version-from">Copy from</label><select id="new-version-from">${versionOptions}</select></div>
<div class="field"><label for="new-version-slug">Slug</label><input id="new-version-slug" type="text"><p class="field-error" id="new-version-slug-error" hidden></p></div>
<div class="field"><label for="new-version-title">Title</label><input id="new-version-title" type="text"></div>
<div class="dialog-actions"><button type="button" class="primary" id="create-version">Create version</button><button type="button" id="cancel-new-version">Cancel</button></div>
</div>
<div class="modal" id="share-preview-dialog" role="dialog" aria-modal="true" aria-label="Share preview" hidden>
<h2>Share preview</h2>
<div class="field"><label for="preview-link">Preview link</label><input id="preview-link" type="text" readonly></div>
<div class="dialog-actions"><button type="button" id="copy-link">Copy link</button><button type="button" id="revoke-link">Revoke</button><button type="button" id="close-share">Close</button></div>
</div>
<div class="modal" id="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-heading" hidden>
<h2 id="publish-heading" tabindex="-1"></h2>
<div id="publish-body"></div>
</div>`;
}

export function editorPage(view: EditorView): string {
  const content = `${topBar(view)}
<div class="editor-layout">
${pagesTree(view)}
${pageEditor(view)}
${proofMargin(view)}
</div>
${dialogs(view)}`;
  const title =
    view.page === null
      ? `${view.version.title} - ${view.site.title}`
      : `${view.page.title} - ${view.site.title} (${view.version.title})`;
  return shell({
    documentTitle: title,
    bodyClass: 'editor',
    script: 'editor',
    data: {
      user: view.user,
      site: view.site,
      version: view.version,
      pageId: view.page === null ? null : view.page.id,
      revision: view.page === null ? 0 : view.page.revision,
      canWrite: canWrite(view),
      snippets: SNIPPETS,
      savedMessage: messages.saved,
    },
    content,
  });
}
