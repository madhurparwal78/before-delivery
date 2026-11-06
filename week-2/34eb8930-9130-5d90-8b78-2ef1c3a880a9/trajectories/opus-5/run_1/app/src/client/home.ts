import { ApiError, api, type SessionPerson } from './api.js';
import { clear, el, escapeCloses, trapFocus } from './dom.js';
import { noticesControl } from './notices.js';
import { announce, hideBanner, navigate, renderInto, showBanner } from './shell.js';
import type { Connection } from './socket.js';
import type { DocumentSummary, Role } from '../shared/types.js';

const roleLabel = (role: Role): string => role.charAt(0).toUpperCase() + role.slice(1);

function changedLabel(updatedAt: string): string {
  return new Date(updatedAt).toLocaleString();
}

function documentRow(
  summary: DocumentSummary,
  onDelete: ((summary: DocumentSummary) => void) | null,
): HTMLElement {
  return el('li', { class: 'doc-row' }, [
    el(
      'a',
      {
        class: 'doc-link',
        href: `/d/${summary.id}`,
        onclick: (event: Event) => {
          event.preventDefault();
          navigate(`/d/${summary.id}`);
        },
      },
      [summary.title],
    ),
    el('span', { class: 'doc-client', text: summary.client }),
    el('span', { class: 'doc-role', text: roleLabel(summary.role) }),
    el('span', { class: 'doc-changed', text: changedLabel(summary.updatedAt) }),
    onDelete
      ? el('button', {
          type: 'button',
          class: 'chrome-button danger',
          'aria-label': `Delete ${summary.title}`,
          text: 'Delete',
          onclick: () => onDelete(summary),
        })
      : null,
  ]);
}

export function renderHome(person: SessionPerson, connection: Connection): void {
  const notices = noticesControl(connection);
  const search = el('input', { type: 'search', id: 'home-search', 'aria-label': 'Search proposals', placeholder: 'Search proposals' });
  const recentList = el('ul', { class: 'doc-list', 'aria-label': 'Recent proposals' });
  const ownList = el('ul', { class: 'doc-list', 'aria-label': person.isConsultant ? 'My proposals list' : 'Shared with me list' });
  const resultsList = el('ul', { class: 'doc-list', 'aria-label': 'Search results' });
  const recentRegion = el('section', { role: 'region', 'aria-label': 'Recent' }, [
    el('h2', { text: 'Recent' }),
    recentList,
  ]);
  const ownRegion = el('section', { role: 'region', 'aria-label': person.isConsultant ? 'My proposals' : 'Shared with me' }, [
    el('h2', { text: person.isConsultant ? 'My proposals' : 'Shared with me' }),
    ownList,
  ]);
  const resultsRegion = el('section', { class: 'results', hidden: true }, [resultsList]);

  const newButton = person.isConsultant
    ? el('button', { type: 'button', class: 'primary', text: 'New proposal', onclick: () => openCreateDialog(newButton) })
    : null;

  const signOut = el('button', {
    type: 'button',
    class: 'chrome-button',
    text: 'Sign out',
    onclick: () => {
      void api.signOut().then(() => navigate('/sign-in', { replace: true }));
    },
  });

  const page = el('div', { class: 'home' }, [
    el('header', { class: 'menu-bar' }, [
      el('span', { class: 'brand', text: 'Quillmere Drafts' }),
      el('div', { class: 'menu-right' }, [notices.button, signOut]),
    ]),
    el('main', { class: 'home-main' }, [
      el('h1', { text: 'Documents' }),
      el('div', { class: 'home-tools' }, [search, newButton]),
      recentRegion,
      ownRegion,
      resultsRegion,
    ]),
  ]);

  let searchTimer: number | null = null;
  let announceTimer: number | null = null;

  async function loadLists(): Promise<void> {
    const [recent, own] = await Promise.all([
      api.documents('recent'),
      api.documents(person.isConsultant ? 'mine' : 'shared'),
    ]);
    clear(recentList);
    for (const summary of recent.documents) recentList.appendChild(documentRow(summary, null));
    clear(ownList);
    for (const summary of own.documents) {
      ownList.appendChild(documentRow(summary, person.isConsultant ? confirmDelete : null));
    }
  }

  async function runSearch(): Promise<void> {
    const term = search.value.trim();
    const active = term.length > 0;
    resultsRegion.toggleAttribute('hidden', !active);
    recentRegion.toggleAttribute('hidden', active);
    ownRegion.toggleAttribute('hidden', active);
    if (!active) return;
    const result = await api.documents(undefined, term);
    clear(resultsList);
    for (const summary of result.documents) {
      resultsList.appendChild(documentRow(summary, person.isConsultant && summary.role === 'owner' ? confirmDelete : null));
    }
    if (announceTimer !== null) clearTimeout(announceTimer);
    const count = result.documents.length;
    announceTimer = window.setTimeout(() => {
      announce(count === 0 ? 'No proposals match' : count === 1 ? '1 proposal' : `${count} proposals`);
    }, 333);
  }

  search.addEventListener('input', () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void runSearch(), 100);
  });

  function openCreateDialog(opener: HTMLElement | null): void {
    const title = el('input', { type: 'text', id: 'new-title' });
    const client = el('input', { type: 'text', id: 'new-client' });
    const titleError = el('p', { class: 'field-error' });
    const clientError = el('p', { class: 'field-error' });
    const create = el('button', { type: 'submit', class: 'primary', text: 'Create' });
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    const form = el(
      'form',
      {
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'New proposal',
        onsubmit: (event: Event) => {
          event.preventDefault();
          void submit();
        },
      },
      [
        el('h2', { text: 'New proposal' }),
        el('div', { class: 'field' }, [el('label', { for: 'new-title', text: 'Title' }), title, titleError]),
        el('div', { class: 'field' }, [el('label', { for: 'new-client', text: 'Client' }), client, clientError]),
        el('div', { class: 'dialog-actions' }, [
          create,
          el('button', { type: 'button', class: 'chrome-button', text: 'Cancel', onclick: close }),
        ]),
      ],
    );
    const backdrop = el('div', { class: 'backdrop' }, [form]);
    trapFocus(form);
    escapeCloses(form, close);
    document.body.appendChild(backdrop);
    title.focus();

    async function submit(): Promise<void> {
      titleError.textContent = '';
      clientError.textContent = '';
      create.disabled = true;
      create.textContent = 'Creating';
      try {
        const summary = await api.createDocument(title.value, client.value);
        close();
        navigate(`/d/${summary.id}`);
      } catch (error) {
        if (error instanceof ApiError && error.fields) {
          titleError.textContent = error.fields.title ?? '';
          clientError.textContent = error.fields.client ?? '';
          (error.fields.title ? title : client).focus();
        }
        create.disabled = false;
        create.textContent = 'Create';
      }
    }
  }

  function confirmDelete(summary: DocumentSummary): void {
    const opener = document.activeElement as HTMLElement | null;
    const deleteButton = el('button', { type: 'button', class: 'primary danger', text: 'Delete' });
    const close = (): void => {
      backdrop.remove();
      opener?.focus();
    };
    const dialog = el('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Delete proposal' }, [
      el('h2', { text: 'Delete proposal' }),
      el('p', { text: `Delete “${summary.title}”? Everyone with access loses it at once.` }),
      el('div', { class: 'dialog-actions' }, [
        deleteButton,
        el('button', { type: 'button', class: 'chrome-button', text: 'Cancel', onclick: close }),
      ]),
    ]);
    const backdrop = el('div', { class: 'backdrop' }, [dialog]);
    trapFocus(dialog);
    escapeCloses(dialog, close);
    document.body.appendChild(backdrop);
    deleteButton.addEventListener('click', () => {
      void (async () => {
        hideBanner('delete');
        deleteButton.disabled = true;
        deleteButton.textContent = 'Deleting';
        try {
          await api.deleteDocument(summary.id);
          close();
          announce(`Deleted ${summary.title}`);
          await loadLists();
          await runSearch();
        } catch (error) {
          if (error instanceof ApiError && error.status === 503) {
            showBanner('delete', "Quillmere can't reach storage, so the proposal wasn't deleted. Try again in a minute.");
          }
          deleteButton.disabled = false;
          deleteButton.textContent = 'Delete';
        }
      })();
    });
    const cancel = dialog.querySelector<HTMLElement>('.chrome-button');
    cancel?.focus();
  }

  connection.onFrame((frame) => {
    if (frame.type === 'lists_changed') {
      void loadLists();
      void runSearch();
    }
  });

  renderInto(page);
  void loadLists();
}
