// My contributions: the author's own posts and their states.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce, openDialog, toast } from '../feedback.js';
import { live, onReload } from '../live.js';
import { monthYear } from '../format.js';
import type { MyPost } from '../types.js';
import type { PageContext } from '../app.js';

export function myContributionsPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  if (!ctx.me) {
    ctx.navigate('/sign-in');
    return main;
  }
  const list = h('ul', { role: 'list', 'aria-label': 'My contributions' });
  main.appendChild(h('h1', {}, 'My contributions'));
  main.appendChild(list);
  void build(list, ctx);
  return main;
}

async function build(list: HTMLElement, ctx: PageContext): Promise<void> {
  async function reload(): Promise<void> {
    const response = await api.get<{ posts: MyPost[] }>('/api/me/posts');
    clear(list);
    for (const post of response.posts) {
      const item = h('li', { 'data-id': post.id });
      const statusText =
        post.state === 'rejected'
          ? `Rejected: ${post.reason ?? ''}`
          : post.state.charAt(0).toUpperCase() + post.state.slice(1);
      item.appendChild(h('p', {}, post.label));
      item.appendChild(h('p', { class: 'post-status', 'data-state': post.state }, statusText));
      item.appendChild(h('p', { class: 'muted' }, monthYear(post.posted_month)));
      if (post.editable) {
        const edit = h('button', { class: 'text-button', type: 'button' }, `Edit ${post.label}`);
        edit.addEventListener('click', () => {
          alertBand('Editing opens the same form again with your values kept.');
          void undefined;
        });
        item.appendChild(edit);
      }
      if (post.state !== 'claimed') {
        const del = h('button', { class: 'text-button', type: 'button' }, `Delete ${post.label}`);
        del.addEventListener('click', () => {
          openDialog('Delete this post?', (dialog) => {
            const confirm = h('button', { class: 'solid-button', type: 'button' }, 'Delete post');
            confirm.addEventListener('click', async () => {
              try {
                await api.delete(`/api/posts/${post.id}`);
                announce('Post deleted.');
                toast('Post deleted.');
                dialog.close();
                await reload();
              } catch (err) {
                alertBand(apiErrorMessage(err));
              }
            });
            const keep = h('button', { class: 'text-button', type: 'button' }, 'Keep post');
            keep.addEventListener('click', () => dialog.close());
            return h('div', {}, h('p', {}, 'Delete this post?'), confirm, keep);
          }, del);
        });
        item.appendChild(del);
      }
      list.appendChild(item);
    }
  }

  await reload();
  live.subscribe((event) => {
    if (event.type === 'post.state') {
      const state = event.data.state as string;
      const reason = (event.data.reason as string | null) ?? null;
      const existing = list.querySelector<HTMLElement>(`li[data-id="${event.data.post_id}"]`);
      if (existing) {
        const status = existing.querySelector('.post-status');
        if (status) {
          status.setAttribute('data-state', state);
          status.textContent =
            state === 'rejected' ? `Rejected: ${reason ?? ''}` : state.charAt(0).toUpperCase() + state.slice(1);
        }
      }
      const post = responsePost(event.data.post_id as string);
      if (post) {
        if (state === 'approved') {
          announce(`Your ${kindText(post.kind)} for ${post.company_name} was approved.`);
        } else if (state === 'rejected') {
          announce(`Your ${kindText(post.kind)} for ${post.company_name} was rejected: ${reason ?? ''}.`);
        }
      }
    }
  });
  onReload(() => void reload());

  function kindText(kind: string): string {
  if (kind === 'pay_report') return 'pay report';
  if (kind === 'interview_note') return 'interview note';
  return 'review';
}

let known: MyPost[] = [];
  function responsePost(id: string): MyPost | undefined {
    return known.find((post) => post.id === id);
  }
  known = (await api.get<{ posts: MyPost[] }>('/api/me/posts')).posts;
}
