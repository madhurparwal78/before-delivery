import type { Session } from '../auth.ts';
import { formatCopenhagenInstant } from '../../domain/time.ts';
import type { DropRecord } from '../repo/drops.ts';
import { button, dialog, field, link, pageData, stickyBar, table } from './components.ts';
import { attrs, html, icon, raw } from './html.ts';
import { page, problemsRegion, statusMark, statusRegion } from './layout.ts';

export interface LookView {
  id: string;
  position: number;
  title: string;
  altText: string;
  width: number;
  height: number;
}

export function lookbookPage(
  session: Session,
  drop: DropRecord,
  looks: readonly LookView[],
  orderVersion: number,
): string {
  const main = html`<h1 class="page-heading">Lookbook · ${drop.name}</h1>
${button('Add look', { action: 'open-add-look' })}
<ul class="looks-grid" aria-label="Looks" data-looks-list>
  ${looks.map(
    (look) => html`<li class="look-card"${attrs({ 'data-look-id': look.id })}>
    <img${attrs({
      src: `/api/drops/${drop.id}/looks/${look.id}/image`,
      alt: look.altText,
      width: look.width,
      height: look.height,
      loading: 'lazy',
    })}>
    <p class="look-card__title">${look.title}</p>
    <p class="look-card__position mono" data-look-position>${look.position} / ${looks.length}</p>
    <button type="button" class="button button--quiet look-card__move" data-look-move>${icon('grip-vertical')}<span>Move</span></button>
  </li>`,
  )}
</ul>
${statusRegion('Lookbook status')}
${dialog({
  name: 'Add look',
  body: html`${field({ name: 'lookImage', label: 'Look image', kind: 'file' })}
${field({ name: 'lookTitle', label: 'Look title' })}
${field({ name: 'altText', label: 'Alt text', kind: 'textarea', rows: 3 })}`,
  actions: html`${button('Upload look', { pending: 'Uploading…', action: 'upload-look' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${pageData({ screen: 'lookbook', dropId: drop.id, orderVersion })}`;
  return page({ title: `Lookbook · ${drop.name}`, session, activePath: '/studio/drops' }, main);
}

export interface StoryView {
  html: string;
  version: number;
  publishedAt: string | null;
}

export function storyPage(session: Session, drop: DropRecord, story: StoryView): string {
  const main = html`<h1 class="page-heading">Story · ${drop.name}</h1>
${problemsRegion()}
<div class="toolbar" role="toolbar" aria-label="Formatting">
  ${button('Heading', { variant: 'quiet', action: 'format-h2' })}
  ${button('Subheading', { variant: 'quiet', action: 'format-h3' })}
  ${button('Bold', { variant: 'quiet', action: 'format-bold' })}
  ${button('Italic', { variant: 'quiet', action: 'format-italic' })}
  ${button('Bulleted list', { variant: 'quiet', action: 'format-ul' })}
  ${button('Numbered list', { variant: 'quiet', action: 'format-ol' })}
  ${button('Link', { variant: 'quiet', action: 'open-add-link' })}
</div>
<div class="story-editor"
  contenteditable="true"
  role="textbox"
  aria-multiline="true"
  aria-label="Story"
  data-story-editor>${raw(story.html)}</div>
<div class="actions-row actions-row--desktop">
  ${button('Save story', { pending: 'Saving story…', action: 'save-story' })}
  ${button('Publish story', { variant: 'quiet', action: 'open-publish' })}
</div>
${statusRegion('Story status')}
${dialog({
  name: 'Add link',
  body: field({ name: 'linkAddress', label: 'Link address', placeholder: 'https://' }),
  actions: html`${button('Add link', { action: 'add-link' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${dialog({
  name: 'Publish story',
  body: html`<p>Publishing copies the saved story to the public drop page and the press preview.</p>`,
  actions: html`${button('Publish', { pending: 'Publishing…', action: 'publish-story' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${stickyBar(html`${button('Save story', { pending: 'Saving story…', action: 'save-story' })}${button('Publish story', { variant: 'quiet', action: 'open-publish' })}`)}
${pageData({ screen: 'story', dropId: drop.id, version: story.version })}`;
  return page({ title: `Story · ${drop.name}`, session, activePath: '/studio/press' }, main);
}

export function pressPage(session: Session, drops: readonly DropRecord[]): string {
  const main = html`<h1 class="page-heading">Press</h1>
${table({
  name: 'Drops',
  columns: ['Name', 'Status', 'Story', 'Previews'],
  rows: drops.map(
    (drop) => html`<tr>
    <td>${drop.name}</td>
    <td>${statusMark(drop.status)}</td>
    <td>${link('Story', `/studio/drops/${drop.id}/story`)}</td>
    <td>${link('Press previews', `/studio/drops/${drop.id}/previews`)}</td>
  </tr>`,
  ),
})}
${pageData({ screen: 'press' })}`;
  return page({ title: 'Press', session, activePath: '/studio/press' }, main);
}

export interface PreviewView {
  id: string;
  editorName: string;
  outlet: string;
  status: string;
  expiresAtMs: number;
}

export function previewsPage(
  session: Session,
  drop: DropRecord,
  previews: readonly PreviewView[],
): string {
  const main = html`<h1 class="page-heading">Press previews · ${drop.name}</h1>
${button('Send preview', { action: 'open-send-preview' })}
${table({
  name: 'Preview links',
  columns: ['Editor', 'Outlet', 'Status', 'Expires', 'Actions'],
  rows: previews.map(
    (preview) => html`<tr${attrs({ 'data-preview-id': preview.id })}>
    <td>${preview.editorName}</td>
    <td>${preview.outlet}</td>
    <td>${preview.status === 'active' ? statusMark('live') : statusMark('sold_out')}<span class="sr-detail">${preview.status}</span></td>
    <td class="mono">${formatCopenhagenInstant(preview.expiresAtMs)}</td>
    <td class="actions-cell">
      ${button('Revoke', { variant: 'quiet', action: 'open-revoke', attributes: { 'data-preview-id': preview.id } })}
      ${button('Regenerate', { variant: 'quiet', action: 'open-regenerate', attributes: { 'data-preview-id': preview.id } })}
    </td>
  </tr>`,
  ),
})}
${statusRegion('Preview status')}
${dialog({
  name: 'Send preview',
  body: html`${field({ name: 'editorName', label: 'Editor name' })}
${field({ name: 'editorEmail', label: 'Editor email', kind: 'email' })}
${field({ name: 'outlet', label: 'Outlet' })}`,
  actions: html`${button('Send preview', { pending: 'Sending…', action: 'send-preview' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${dialog({
  name: 'Revoke link',
  body: html`<p>The editor's current link stops working at once.</p>`,
  actions: html`${button('Revoke link', { variant: 'danger', pending: 'Revoking…', action: 'revoke-link' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${dialog({
  name: 'Regenerate link',
  body: html`<p>A new link is emailed and the old one stops working at once.</p>`,
  actions: html`${button('Regenerate link', { pending: 'Regenerating…', action: 'regenerate-link' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${pageData({ screen: 'previews', dropId: drop.id })}`;
  return page({ title: `Press previews · ${drop.name}`, session, activePath: '/studio/press' }, main);
}
