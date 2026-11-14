import type { FormDetail } from '../../shared/types.ts';
import { M42, M51, M53 } from '../../shared/messages.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { h, replaceChildren } from '../lib/dom.ts';
import { alertText, announce } from '../lib/live.ts';
import { showFormState } from '../lib/shell.ts';
import type { Context } from './context.ts';
import { openInvite } from './invite-dialog.ts';
import { openSettings } from './settings-dialog.ts';

// The top bar: the form title, who else is editing, whether live editing is on, and the form-level actions.
// `#form-state` sits in the owner frame just above it and follows the same server state.

export function topbar(context: Context): HTMLElement {
  const { store, sync } = context;
  const owner = store.detail.role === 'owner';
  const title = h('h1', { class: 'builder-title' });
  const presence = h('p', { id: 'presence' });
  const liveStatus = h('p', { id: 'live-status' });
  const notice = h('p', { id: 'notice' });
  const problems = h('ul', { class: 'problems' });
  const publish = h('button', { type: 'button', class: 'primary' }, 'Publish');
  const openLive = h('a', { class: 'button', href: `/f/${store.detail.slug}` }, 'Open live form');
  const settings = h('button', { type: 'button' }, 'Form settings');
  const invite = h('button', { type: 'button' }, 'Invite editor');
  const saveChanges = h('button', { type: 'button' }, 'Save changes');

  function show(): void {
    title.textContent = store.draft.title;
    document.title = `${store.draft.title} - Nightform`;
    showFormState(store.detail.state);
    openLive.hidden = store.detail.edition === null;
    saveChanges.hidden = sync.live;
    liveStatus.textContent = sync.live ? '' : M53;
  }

  function showPresence(): void {
    const others = sync.editors.filter((editor) => editor.id !== store.me.id);
    presence.textContent = others.length > 0 ? M51(others.map((editor) => editor.name).join(', ')) : '';
  }

  async function publishDraft(): Promise<void> {
    if (publish.getAttribute('aria-busy') === 'true') return;
    publish.setAttribute('aria-busy', 'true');
    replaceChildren(problems);
    try {
      if (!sync.live && !(await sync.save())) return;
      const { edition } = await api<{ edition: number }>('POST', `/api/forms/${store.detail.id}/publish`, {});
      store.replaceDetail(await api<FormDetail>('GET', `/api/forms/${store.detail.id}`));
      announce(M42(edition));
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      alertText(error.message);
      replaceChildren(problems, error.items.map((item) => h('li', { class: 'error-text' }, `${item.key}: ${item.message}`)));
    } finally {
      publish.removeAttribute('aria-busy');
    }
  }

  publish.addEventListener('click', () => { void publishDraft(); });
  settings.addEventListener('click', () => openSettings(context, settings));
  invite.addEventListener('click', () => openInvite(context, invite));
  saveChanges.addEventListener('click', () => { void sync.save(); });
  sync.presence.listen(showPresence);
  sync.notice.listen((text) => { notice.textContent = text; });
  sync.status.listen(show);
  store.detailed.listen(show);
  store.drafted.listen(show);
  show();
  showPresence();

  return h('header', { class: 'topbar' },
    title,
    h('div', { class: 'topbar-actions' }, owner ? publish : null, openLive, owner ? settings : null, owner ? invite : null, saveChanges),
    h('div', { class: 'topbar-status' }, presence, liveStatus),
    notice,
    problems);
}
