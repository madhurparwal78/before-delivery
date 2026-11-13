// Channels: the list and one channel's live log and composer.
import { h, clear } from '../dom.js';
import { api, ApiFailure, apiErrorMessage } from '../api.js';
import { alertBand, announce } from '../feedback.js';
import { live, onReload } from '../live.js';
import { monthYear } from '../format.js';
import type { ChannelPost } from '../types.js';
import type { PageContext } from '../app.js';

export function channelsPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  const list = h('ul', { role: 'list', 'aria-label': 'Channels' });
  main.appendChild(h('h1', {}, 'Channels'));
  main.appendChild(list);
  void api.get<{ channels: { slug: string; name: string }[] }>('/api/channels').then((response) => {
    for (const channel of response.channels) {
      list.appendChild(h('li', {}, h('a', { href: `/channels/${channel.slug}` }, channel.name)));
    }
  });
  void ctx;
  return main;
}

export function channelPage(ctx: PageContext): HTMLElement {
  const main = h('main', { class: 'narrow' });
  const slug = ctx.params['1'] ?? ctx.params.slug ?? '';
  void buildChannel(main, slug);
  return main;
}

async function buildChannel(main: HTMLElement, slug: string): Promise<void> {
  const channelsResponse = await api.get<{ channels: { slug: string; name: string }[] }>('/api/channels');
  const channelMaybe = channelsResponse.channels.find((entry) => entry.slug === slug);
  if (!channelMaybe) {
    main.appendChild(h('h1', {}, 'Page not found'));
    return;
  }
  const channel = channelMaybe;
  main.appendChild(h('h1', {}, channel.name));
  const log = h('div', { role: 'log', 'aria-label': `Posts in ${channel.name}`, class: 'channel-log' });
  const composer = h('textarea', { id: 'composer', rows: '3', 'aria-label': 'Write a post' }) as HTMLTextAreaElement;
  const post = h('button', { class: 'solid-button', type: 'button' }, 'Post');
  main.appendChild(log);
  main.appendChild(composer);
  main.appendChild(post);

  async function reload(): Promise<void> {
    const response = await api.get<{ posts: ChannelPost[] }>(`/api/channels/${slug}/posts`);
    clear(log);
    for (const item of response.posts) {
      log.appendChild(postItem(item));
    }
  }

  function postItem(item: ChannelPost): HTMLElement {
    const article = h('article', { 'data-id': item.id, class: 'channel-post' });
    article.appendChild(h('p', { class: 'muted' }, `${item.author_label} · ${monthYear(item.posted_month)}`));
    article.appendChild(h('p', {}, item.body));
    if (item.quote && 'title' in item.quote) {
      article.appendChild(
        h('blockquote', {}, h('p', {}, item.quote.title), h('p', {}, item.quote.excerpt)),
      );
    } else if (item.quote && 'removed' in item.quote) {
      article.appendChild(h('blockquote', {}, 'Quoted review removed.'));
    }
    return article;
  }

  async function send(): Promise<void> {
    try {
      await api.post(`/api/channels/${slug}/posts`, { body: composer.value });
      composer.value = '';
      composer.focus();
      announce(`Posted in ${channel.name}.`);
      await reload();
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.body.field) {
          alertBand(err.body.message);
          return;
        }
        alertBand(err.body.message);
      } else {
        alertBand(apiErrorMessage(err));
      }
    }
  }

  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });
  post.addEventListener('click', () => void send());

  await reload();
  live.subscribe((event) => {
    if (event.type === 'channel.post' && event.data.channel_slug === slug) {
      const item = event.data.post as ChannelPost;
      log.appendChild(postItem(item));
      announce(`New post in ${channel.name}`);
    }
  });
  onReload(() => void reload());
}
