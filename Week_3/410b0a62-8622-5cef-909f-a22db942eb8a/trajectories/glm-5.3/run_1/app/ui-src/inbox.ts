import { api, type LinkJson } from './api.js';
import type { AppCtx } from './shell.js';
import { h, clear } from './dom.js';
import { onLiveChange } from './main.js';

export async function renderInbox(main: HTMLElement, ctx: AppCtx): Promise<void> {
  if (ctx.me?.role !== 'coach') {
    main.append(notFoundView());
    return;
  }
  const container = h('div', { class: 'page inbox-page' });
  main.append(container);
  const list = h('ul', { class: 'inbox-list', role: 'list', 'aria-label': 'Link requests' });

  const draw = async (): Promise<void> => {
    let links: LinkJson[];
    try {
      links = (await api.get<{ links: LinkJson[] }>('/links')).links;
    } catch {
      clear(container);
      container.append(notFoundView());
      return;
    }
    clear(list);
    const pending = links.filter((l) => l.coach_id === ctx.me?.id && l.status === 'requested');
    for (const link of pending) {
      const item = h('li', { class: 'inbox-item' }, h('span', {}, `${link.athlete_name} wants to join`));
      item.append(
        h('button', {
          class: 'pill pill-primary',
          onclick: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            try {
              await api.post(`/links/${link.id}/accept`, {});
              item.replaceWith(h('li', { class: 'inbox-item settled' }, `${link.athlete_name} is linked.`));
            } catch (err) {
              button.disabled = false;
              void err;
            }
          },
        }, `Accept ${link.athlete_name}`),
        h('button', {
          class: 'pill pill-ghost',
          onclick: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            try {
              await api.post(`/links/${link.id}/decline`, {});
              item.replaceWith(h('li', { class: 'inbox-item settled' }, `${link.athlete_name} was declined.`));
            } catch (err) {
              button.disabled = false;
              void err;
            }
          },
        }, `Decline ${link.athlete_name}`)
      );
      list.append(item);
    }
  };

  container.append(h('h1', { class: 'screen-title' }, 'Inbox'), list);
  await draw();
  onLiveChange((msg) => {
    if (msg.what === 'links') void draw();
  });
}

function notFoundView(): HTMLElement {
  return h(
    'section',
    { class: 'notfound' },
    h('h1', { class: 'display' }, 'Not found'),
    h('p', {}, "This page isn't available to you."),
    h('a', { class: 'pill pill-primary', href: '/' }, 'Back to home')
  );
}
