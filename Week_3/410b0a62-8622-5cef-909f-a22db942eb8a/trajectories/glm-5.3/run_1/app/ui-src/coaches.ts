import { api, type LinkJson } from './api.js';
import type { AppCtx } from './shell.js';
import { h, clear } from './dom.js';
import { onLiveChange } from './main.js';

export async function renderCoaches(main: HTMLElement, ctx: AppCtx): Promise<void> {
  if (ctx.me?.role !== 'athlete') {
    main.append(notFoundView());
    return;
  }
  const container = h('div', { class: 'page coaches-page' });
  main.append(container);
  const list = h('ul', { class: 'coaches-list', role: 'list', 'aria-label': 'Your coaches' });

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
    const mine = links.filter((l) => l.athlete_id === ctx.me?.id && l.status !== 'removed' && l.status !== 'declined');
    for (const link of mine) {
      const item = h('li', { class: 'coach-item', 'data-link-id': link.id });
      const copy =
        link.status === 'expired' ? `${link.coach_name} — Expired` : link.status === 'requested' ? `${link.coach_name} — Pending` : link.coach_name;
      item.append(h('span', { class: 'coach-name' }, copy));
      if (link.status === 'accepted') {
        const confirmDialog = h(
          'div',
          { class: 'dialog hidden', role: 'dialog', 'aria-label': 'Remove coach?' },
          h('h2', { class: 'dialog-title' }, 'Remove coach?'),
          h('div', { class: 'dialog-actions' },
            h('button', {
              class: 'pill pill-danger',
              onclick: async () => {
                await api.del(`/links/${link.id}`);
                confirmDialog.classList.add('hidden');
                void draw();
              },
            }, 'Remove'),
            h('button', { class: 'pill pill-ghost', onclick: () => confirmDialog.classList.add('hidden') }, 'Keep')
          )
        );
        const removeButton = h(
          'button',
          {
            class: 'pill pill-ghost',
            onclick: () => {
              confirmDialog.classList.remove('hidden');
              confirmDialog.querySelector<HTMLElement>('.pill-danger')?.focus();
            },
          },
          `Remove ${link.coach_name}`
        );
        item.append(removeButton, confirmDialog);
      }
      list.append(item);
    }
  };

  container.append(h('h1', { class: 'screen-title' }, 'Your coaches'), list);
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
