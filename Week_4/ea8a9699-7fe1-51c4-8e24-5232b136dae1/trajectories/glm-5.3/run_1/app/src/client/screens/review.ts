// The review page for a freelancer with a link token.

import type { Comment } from '../../shared/types.js';
import { api, el, session } from '../lib.js';
import { topBar } from '../app.js';
import { clearInvalid, errorSummary, formField, markInvalid } from './signin.js';

export interface ReviewPayloadClient {
  cluster: {
    title: string;
    publicDescription: string;
    itemCount: number;
    entries: { id: string; position: number; title: string; kind: string; mediaUrl: string; timecode: string | null; sourceClipTitle: string | null; isPrivate: boolean }[];
  };
  comments: Comment[];
  link: { expiresAt: string; canComment: boolean };
}

export async function renderReview(token: string): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  const page = el('div');
  const main = el('main', { class: 'page-narrow', style: 'max-width: 720px' });
  const r = await api<ReviewPayloadClient>('GET', `/api/review/${token}`);
  if (!r.ok) {
    const err = r.error;
    const heading =
      err?.error === 'link_expired' ? 'This review link has expired.'
      : err?.error === 'link_revoked' ? 'This review link was revoked.'
      : err?.error === 'link_inactive' ? 'This cluster is no longer in review.'
      : 'This review link does not exist.';
    main.append(el('section', { class: 'panel' }, el('h1', {}, heading)));
    page.append(main);
    return page;
  }
  const data = r.data!;
  page.append(topBar({ account: acc, bare: true }));
  const banner = el('p', { class: 'panel mono' }, `Review: ${data.cluster.title} · expires ${data.link.expiresAt.replace('T', ' ').slice(0, 16)} UTC`);
  main.append(banner);

  const list = el('ol', { class: 'stack', 'aria-label': 'Entries' });
  for (const entry of data.cluster.entries) {
    const li = el('li', { class: 'panel' });
    if (entry.kind === 'clip') {
      li.append(el('video', { src: entry.mediaUrl, controls: false, muted: true, preload: 'metadata' }));
    } else {
      li.append(el('img', { src: entry.mediaUrl, alt: '', loading: 'lazy' }));
    }
    const title = el('div', { class: 'ref-title-full' }, `${entry.position}. ${entry.title}`);
    li.append(title);
    if (entry.kind === 'still' && entry.sourceClipTitle && entry.timecode) {
      li.append(el('div', { class: 'still-meta' }, `${entry.sourceClipTitle} · ${entry.timecode}`));
    }
    list.append(li);
  }
  main.append(list);

  // Comments
  const commentsPanel = el('section', { class: 'panel stack', 'aria-label': 'Comments' });
  const commentsList = el('ul', { class: 'stack' });
  for (const c of data.comments) {
    const li = el('li', {});
    li.append(el('strong', {}, c.authorName), el('p', {}, c.body));
    commentsList.append(li);
  }
  commentsPanel.append(commentsList);

  const status = el('div', { id: 'review-status', role: 'status', class: 'visually-hidden' });
  status.setAttribute('aria-live', 'polite');

  if (!data.link.canComment) {
    commentsPanel.append(el('p', { class: 'muted' }, 'This link is view-only.'));
  } else {
    const form = el('form', { class: 'stack', novalidate: true }) as HTMLFormElement;
    const name = el('input', { type: 'text', id: 'review-name' }) as HTMLInputElement;
    name.setAttribute('aria-label', 'Your name');
    const body = el('textarea', { id: 'review-comment' }) as HTMLTextAreaElement;
    body.setAttribute('aria-label', 'Comment');
    const post = el('button', { type: 'submit', class: 'btn btn-primary', id: 'review-post' }, 'Post comment') as HTMLButtonElement;
    post.setAttribute('aria-label', 'Post comment');
    form.append(formField('Your name', name), formField('Comment', body), el('div', {}, post));
    let retryTimer: number | undefined;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid(form);
      post.disabled = true;
      const rr = await api<Comment>('POST', `/api/review/${token}/comments`, { authorName: name.value, body: body.value });
      if (rr.ok && rr.data) {
        post.disabled = false;
        body.value = ''; // only the Comment field clears
        announceReview('Comment posted.');
        commentsList.append(el('li', {}, el('strong', {}, rr.data.authorName), el('p', {}, rr.data.body)));
        return;
      }
      const err = rr.error;
      if (err?.error === 'rate_limited') {
        const seconds = err.retryAfter ?? 1;
        announceReview(`You're commenting too fast. Try again in ${seconds} seconds.`);
        // The fields keep their text; the button stays disabled for the wait.
        post.disabled = true;
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          post.disabled = false;
        }, seconds * 1000);
        body.focus();
        return;
      }
      if (err?.error === 'link_expired' || err?.error === 'link_revoked' || err?.error === 'link_inactive') {
        // Replace the page with the message, keeping the typed comment.
        const heading =
          err.error === 'link_expired' ? 'This review link has expired.'
          : err.error === 'link_revoked' ? 'This review link was revoked.'
          : 'This cluster is no longer in review.';
        const unsent = el('section', { class: 'panel stack' });
        unsent.append(el('h1', {}, heading));
        const region = el('div', { role: 'region', 'aria-label': 'Unsent comment' });
        const note = el('textarea', { readonly: true, 'aria-label': 'Unsent comment' }) as HTMLTextAreaElement;
        note.value = body.value;
        region.append(note);
        unsent.append(region);
        page.replaceChildren(topBar({ account: null, bare: true }), el('main', { class: 'page-narrow', style: 'max-width: 720px' }, unsent));
        return;
      }
      post.disabled = false;
      const errors = err?.errors ?? {};
      if (Object.keys(errors).length > 0) {
        form.prepend(errorSummary(errors, { authorName: 'review-name', body: 'review-comment' }));
        document.getElementById('error-summary')?.focus();
        if (errors.authorName) markInvalid(name, errors.authorName);
        if (errors.body) markInvalid(body, errors.body);
      }
    });
    commentsPanel.append(form);
  }
  commentsPanel.append(status);
  main.append(commentsPanel);
  page.append(main);
  return page;
}

function announceReview(message: string): void {
  const region = document.getElementById('review-status');
  if (region) region.textContent = message;
}
