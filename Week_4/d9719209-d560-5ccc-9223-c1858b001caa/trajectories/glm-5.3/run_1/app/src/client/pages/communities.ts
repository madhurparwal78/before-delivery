/* The communities directory and the creation form. */
import { api, announce, el, type Me, ApiFailure } from '../lib.js';
import { navigate } from '../lib.js';
import type { Community } from '../ui.js';
import { formatTime } from './community.js';

export async function renderCommunitiesPage(frame: HTMLElement, me: Me | null): Promise<void> {
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);
  feedCol.append(el('header', { class: 'post-head' },
    el('h1', {}, 'Communities'),
    el('a', { class: 'btn', href: '/communities/new' }, 'Create community'),
  ));
  const list = el('div', { class: 'card-list' });
  feedCol.append(list);

  let cursor: string | null = null;
  const load = async (): Promise<void> => {
    const page = await api<{ items: Community[]; nextCursor: string | null }>(`/api/communities${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`);
    for (const c of page.items) {
      const joinBtn = el('button', { class: 'btn', type: 'button', 'aria-pressed': c.viewer.joined ? 'true' : 'false' }, c.viewer.joined ? 'Joined' : 'Join');
      joinBtn.addEventListener('click', () => {
        void (async () => {
          const method = joinBtn.getAttribute('aria-pressed') === 'true' ? 'DELETE' : 'PUT';
          const res = await api<{ joined: boolean; memberCount: number }>(`/api/communities/${c.name}/membership`, { method });
          joinBtn.setAttribute('aria-pressed', res.joined ? 'true' : 'false');
          joinBtn.textContent = res.joined ? 'Joined' : 'Join';
          const count = document.getElementById(`members-${c.name}`);
          if (count !== null) count.textContent = `${res.memberCount} ${res.memberCount === 1 ? 'member' : 'members'}`;
        })();
      });
      list.append(el('article', { id: `community-${c.name}`, class: 'post-card' },
        el('div', { class: 'card-main' },
          el('h3', { class: 'card-title' }, el('a', { href: `/c/${c.name}` }, `c/${c.name}`)),
          el('p', { class: 'card-byline' }, c.title, el('span', { class: 'sep' }, '·'), el('span', { class: 'num', id: `members-${c.name}` }, `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`)),
          el('div', { class: 'card-meta' }, joinBtn),
        ),
      ));
    }
    cursor = page.nextCursor;
  };
  await load();
  void me;
}

export async function renderCreateCommunityPage(frame: HTMLElement, me: Me | null): Promise<void> {
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);
  if (me === null) {
    feedCol.append(el('p', { class: 'empty' }, el('a', { href: '/login' }, 'Sign in'), ' to create a community.'));
    return;
  }
  const name = el('input', { class: 'input', type: 'text', 'aria-label': 'Name' });
  const title = el('input', { class: 'input', type: 'text', 'aria-label': 'Title' });
  const description = el('textarea', { class: 'textarea', 'aria-label': 'Description' });
  const errs: Record<string, HTMLElement> = { name: el('span', {}), title: el('span', {}), description: el('span', {}) };
  const typeGroup = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Type' });
  const publicRadio = el('input', { type: 'radio', name: 'c-type', id: 'type-public', value: 'public' });
  const restrictedRadio = el('input', { type: 'radio', name: 'c-type', id: 'type-restricted', value: 'restricted' });
  publicRadio.checked = true;
  typeGroup.append(el('label', { class: 'radio-opt', for: 'type-public' }, publicRadio, 'Public'));
  typeGroup.append(el('label', { class: 'radio-opt', for: 'type-restricted' }, restrictedRadio, 'Restricted'));

  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Create community');
  const form = el('form', { class: 'panel', novalidate: true },
    el('h1', {}, 'Create community'),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Name'), name, errs.name),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Title'), title, errs.title),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Description'), description, errs.description),
    typeGroup,
    el('div', { class: 'dialog-actions' }, btn),
  );
  feedCol.append(form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void (async () => {
      btn.textContent = 'Creating...';
      try {
        const type = form.querySelector<HTMLInputElement>('input[name="c-type"]:checked')?.value ?? 'public';
        const created = await api<Community>('/api/communities', { method: 'POST', body: JSON.stringify({ name: name.value.trim(), title: title.value.trim(), description: description.value, type }) });
        navigate(`/c/${created.name}`);
      } catch (err) {
        btn.textContent = 'Create community';
        if (err instanceof ApiFailure) {
          if (err.code === 'NOT_ELIGIBLE') { announce(err.message, true); return; }
          let first: HTMLElement | null = null;
          for (const [field, message] of Object.entries(err.fields)) {
            const target = errs[field];
            if (target === undefined) continue;
            target.replaceChildren(el('span', { class: 'field-error' }, message));
            if (first === null) first = field === 'name' ? name : field === 'title' ? title : description;
          }
          first?.focus();
        }
      }
    })();
  });
  void formatTime;
}
