import { monthYear } from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, post } from '../core/api';
import { el, focus, on } from '../core/dom';
import { onLive, onLiveReload } from '../core/live';
import type { Cleanup, PageContext } from '../core/router';
import { fieldError, clearFieldErrors, pageAlert, working } from '../core/shell';

interface ChannelPost {
  id: string;
  channel_slug: string;
  body: string;
  posted_month: string;
  author_label: string;
  quote: { review_id: string; company_slug: string; title: string; excerpt: string } | { removed: true } | null;
}

export async function renderChannels(container: HTMLElement): Promise<Cleanup> {
  const channels = await get<{ channels: Array<{ slug: string; name: string }> }>('/api/channels');
  const list = el('ul', { 'aria-label': 'Channels', class: 'plain-list' });
  for (const channel of channels.channels) {
    list.append(
      el('li', { 'data-id': channel.slug }, [el('a', { href: `/channels/${channel.slug}`, text: channel.name })]),
    );
  }
  container.append(el('div', { class: 'narrow-page' }, [el('h1', { text: 'Channels' }), list]));
  return () => undefined;
}

function postArticle(item: ChannelPost): HTMLElement {
  const article = el('article', { 'data-id': item.id, class: 'channel-post' }, [
    el('p', { class: 'review-byline', text: `${item.author_label} · ${monthYear(item.posted_month)}` }),
    el('p', { class: 'channel-body', text: item.body }),
  ]);
  if (item.quote && 'removed' in item.quote) {
    article.append(el('p', { class: 'quote removed', text: 'Quoted review removed.' }));
  } else if (item.quote) {
    article.append(
      el('blockquote', { class: 'quote' }, [
        el('p', { text: item.quote.title }),
        el('p', { text: item.quote.excerpt }),
      ]),
    );
  }
  return article;
}

export async function renderChannel(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const slug = ctx.params['slug'] as string;
  const channels = await get<{ channels: Array<{ slug: string; name: string }> }>('/api/channels');
  const channel = channels.channels.find((candidate) => candidate.slug === slug);
  const name = channel?.name ?? slug;

  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: name })]);
  container.append(page);
  const alert = pageAlert(page);
  const log = el('div', { role: 'log', 'aria-label': `Posts in ${name}`, class: 'channel-log' });
  const composer = el('textarea', { 'aria-label': 'Write a post', class: 'textbox', rows: '3' });
  const postButton = el('button', { type: 'button', class: 'solid-button', text: 'Post' });
  const form = el('form', { class: 'stack composer' }, [composer, postButton]);
  page.append(log, form);

  const seen = new Set<string>();
  const appendPost = (item: ChannelPost): void => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    log.append(postArticle(item));
  };

  const load = async (): Promise<void> => {
    const posts = await get<{ posts: ChannelPost[] }>(`/api/channels/${slug}/posts`);
    seen.clear();
    log.replaceChildren();
    for (const item of posts.posts) appendPost(item);
  };
  await load();

  const send = (): void => {
    const body = composer.value;
    if (body.trim() === '') return;
    const done = working(postButton);
    clearFieldErrors(form);
    void post<ChannelPost>(`/api/channels/${slug}/posts`, { body })
      .then((created) => {
        appendPost(created);
        composer.value = '';
        focus(composer);
        announce(`Posted in ${name}.`);
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        if (failure?.fields?.['body']) fieldError(composer, failure.fields['body']);
        else if (failure?.error === 'contains_email' || failure?.error === 'contains_phone')
          fieldError(composer, failure.message);
        else alert(failure?.message ?? 'Something went wrong.');
      })
      .finally(done);
  };

  on(postButton, 'click', send);
  on(form, 'submit', (event) => event.preventDefault());
  on(composer, 'keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  const stopLive = onLive((messages, replayed) => {
    const mine = messages.filter((message) => message.type === 'channel.post' && message.data['channel_slug'] === slug);
    if (mine.length === 0) return;
    let added = 0;
    for (const message of mine) {
      const item = message.data['post'] as ChannelPost;
      if (seen.has(item.id)) continue;
      appendPost(item);
      added += 1;
    }
    if (added === 0) return;
    if (replayed) announce(added === 1 ? `1 new post in ${name}` : `${added} new posts in ${name}`);
    else announce(`New post in ${name}`);
  });
  const stopReload = onLiveReload(() => void load());
  return () => {
    stopLive();
    stopReload();
  };
}
