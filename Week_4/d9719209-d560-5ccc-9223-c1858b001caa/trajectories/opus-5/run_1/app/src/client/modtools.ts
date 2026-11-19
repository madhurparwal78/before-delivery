import { modLogRow } from '../shared/render.js';
import type { ModLogEntryView } from '../shared/types.js';
import { request } from './api.js';
import { alertAnnounce, announce, on, qs, qsa } from './dom.js';
import { page } from './state.js';

function initTabs(): void {
  const tablist = qs('[data-mod-tabs]');
  if (!tablist) return;
  const tabs = qsa<HTMLElement>('[role="tab"]', tablist);
  const select = (tab: HTMLElement) => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
      candidate.tabIndex = selected ? 0 : -1;
      const panel = qs<HTMLElement>(`[data-mod-panel="${candidate.dataset.modTab}"]`);
      if (panel) panel.hidden = !selected;
    }
    tab.focus();
  };
  for (const tab of tabs) on(tab, 'click', () => select(tab));
  on(tablist, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowLeft') {
      keyboard.preventDefault();
      select(tabs[(index + (keyboard.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
    } else if (keyboard.key === 'Home') {
      keyboard.preventDefault();
      select(tabs[0]);
    } else if (keyboard.key === 'End') {
      keyboard.preventDefault();
      select(tabs[tabs.length - 1]);
    }
  });
}

function initModeratorForms(): void {
  const community = page.community;
  if (!community) return;

  const addForm = qs<HTMLFormElement>('[data-add-moderator]');
  if (addForm) {
    on(addForm, 'submit', (event) => {
      event.preventDefault();
      const username = qs<HTMLInputElement>('input[name="username"]', addForm)?.value.trim() ?? '';
      void request(`/api/communities/${community.name}/moderators`, {
        method: 'POST',
        body: { username },
      }).then((result) => {
        if (result.ok) window.location.reload();
        else alertAnnounce(result.error?.message ?? 'That did not work');
      });
    });
  }

  const approveForm = qs<HTMLFormElement>('[data-approve-poster]');
  if (approveForm) {
    on(approveForm, 'submit', (event) => {
      event.preventDefault();
      const username = qs<HTMLInputElement>('input[name="username"]', approveForm)?.value.trim() ?? '';
      void request(`/api/communities/${community.name}/approved/${username}`, { method: 'PUT' }).then((result) => {
        if (result.ok) window.location.reload();
        else alertAnnounce(result.error?.message ?? 'That did not work');
      });
    });
  }

  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const removeModerator = target?.closest<HTMLElement>('[data-remove-moderator]');
    if (removeModerator) {
      void request(
        `/api/communities/${community.name}/moderators/${removeModerator.dataset.removeModerator}`,
        { method: 'DELETE' },
      ).then((result) => {
        if (result.ok) window.location.reload();
        else alertAnnounce(result.error?.message ?? 'That did not work');
      });
      return;
    }
    const removeApproval = target?.closest<HTMLElement>('[data-remove-approval]');
    if (removeApproval) {
      void request(`/api/communities/${community.name}/approved/${removeApproval.dataset.removeApproval}`, {
        method: 'DELETE',
      }).then((result) => {
        if (result.ok) window.location.reload();
      });
    }
  });

  const showNames = qs<HTMLInputElement>('[data-show-mod-names]');
  if (showNames) {
    on(showNames, 'change', () => {
      void request(`/api/communities/${community.name}`, {
        method: 'PATCH',
        body: { showModNames: showNames.checked },
      }).then((result) => {
        if (result.ok) announce('Setting saved');
      });
    });
  }
}

function initLogPaging(): void {
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-load-log]');
    const table = qs<HTMLElement>('[data-mod-log]');
    const body = qs<HTMLElement>('[data-mod-log-body]');
    const footer = qs<HTMLElement>('[data-mod-log-footer]');
    if (!button || !table || !body || !footer) return;
    const community = table.dataset.community ?? '';
    void request<{ items: ModLogEntryView[]; nextCursor: string | null }>(
      `/api/communities/${community}/modlog?cursor=${button.dataset.cursor ?? ''}`,
    ).then((result) => {
      if (!result.ok || !result.data) return;
      const showModerator = qsa<HTMLElement>('th', table).some((header) => header.textContent === 'Moderator');
      const showPrivate = qsa<HTMLElement>('th', table).some((header) => header.textContent === 'Private note');
      body.insertAdjacentHTML(
        'beforeend',
        result.data.items.map((entry) => modLogRow(entry, { showModerator, showPrivate, communityName: community }).value).join(''),
      );
      footer.innerHTML = result.data.nextCursor
        ? `<button type="button" data-load-log data-cursor="${result.data.nextCursor}">Load more entries</button>`
        : '';
    });
  });
}

export function initModTools(): void {
  initTabs();
  initModeratorForms();
  initLogPaging();
}
