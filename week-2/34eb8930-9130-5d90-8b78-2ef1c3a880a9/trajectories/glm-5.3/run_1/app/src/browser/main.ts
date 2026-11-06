import { h, announce, fmtWhen, openDialog, roleLabel } from './lib/dom.js';
import { api, type DocumentSummary, type Notice, type SessionPerson } from './lib/api.js';
import { socket, startHeartbeat } from './lib/socket.js';
import { mountEditor } from './editor.js';

let me: SessionPerson | null = null;

function renderSignIn(requestedPath: string): void {
  document.body.innerHTML = '';
  const emailInput = h<HTMLInputElement>('input', { type: 'email', id: 'email', autocomplete: 'email' }) as HTMLInputElement;
  const passwordInput = h<HTMLInputElement>('input', { type: 'password', id: 'password', autocomplete: 'current-password' }) as HTMLInputElement;
  const errorBox = h('div', { role: 'alert' });
  const button = h<HTMLButtonElement>('button', { class: 'primary', type: 'submit', text: 'Sign in' }) as HTMLButtonElement;
  const form = h('form', { class: 'sign-in-card', onsubmit: async (e: Event) => {
    e.preventDefault();
    errorBox.textContent = '';
    button.textContent = 'Signing in';
    button.disabled = true;
    try {
      const res = await api.signIn(emailInput.value.trim(), passwordInput.value);
      me = res.person;
      announce('Signed in');
      window.history.replaceState(null, '', requestedPath);
      route();
    } catch (err) {
      button.textContent = 'Sign in';
      button.disabled = false;
      const status = (err as { status?: number }).status;
      if (status === 401) errorBox.textContent = "That email and password don't match.";
      else errorBox.textContent = 'Sign in failed. Try again.';
      emailInput.focus();
    }
  } },
    h('h1', { text: 'Sign in to Quillmere Drafts' }),
    errorBox,
    h('div', { class: 'field' }, h('label', { for: 'email', text: 'Email' }), emailInput),
    h('div', { class: 'field' }, h('label', { for: 'password', text: 'Password' }), passwordInput),
    button,
  );
  document.body.append(h('main', { class: 'sign-in' }, form));
  emailInput.focus();
}

let noticesData: { unread: number; notices: Notice[] } = { unread: 0, notices: [] };

async function refreshNotices(badge: HTMLElement): Promise<void> {
  try {
    noticesData = await api.notices();
  } catch {
    return;
  }
  badge.textContent = '';
  if (noticesData.unread > 0) badge.append(h('span', { class: 'badge', text: String(noticesData.unread) }));
}

function noticesDialogOpener(button: HTMLElement, onOpenDocument: (notice: Notice) => void): void {
  openDialog((close) => {
    const list = h('ul', { class: 'notices-list', 'aria-label': 'Notices' });
    for (const notice of noticesData.notices) {
      const link = h('a', { href: `/d/${notice.documentId}`, text: notice.text, onclick: (e: Event) => {
        e.preventDefault();
        close();
        void api.readNotice(notice.id).catch(() => undefined);
        onOpenDocument(notice);
      } });
      list.append(h('li', {}, notice.read ? null : h('span', { class: 'unread-dot' }), link));
    }
    if (noticesData.notices.length === 0) list.append(h('li', { text: 'No notices yet.' }));
    return h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Notices' },
      h('h2', { text: 'Notices' }),
      list,
      h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: close })),
    );
  }, button);
}

function menuBar(page: 'home' | 'editor', extra: HTMLElement[], onOpenDocument: (n: Notice) => void): HTMLElement {
  const badge = h('span', {});
  const noticesButton = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Notices', onclick: () => noticesDialogOpener(noticesButton, onOpenDocument) }, 'Notices', badge);
  void refreshNotices(noticesButton);
  const bar = h('nav', { class: 'menu-bar' },
    h('span', { class: 'brand', text: 'Quillmere Drafts' }),
    ...extra,
    h('span', { style: 'flex:1' }),
    noticesButton,
    h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Sign out', class: 'quiet', text: 'Sign out', onclick: async () => {
      await api.signOut().catch(() => undefined);
      me = null;
      window.location.href = '/sign-in';
    } }),
  );
  if (page === 'home') {
    socket.onFrame = (f) => {
      if (f.type === 'notice' || f.type === 'lists_changed') void refreshNotices(noticesButton);
    };
  }
  return bar;
}

let homeSearchTimer: number | undefined;

function renderHome(): void {
  document.body.innerHTML = '';
  const container = h('main', { class: 'home' });
  const searchInput = h<HTMLInputElement>('input', { type: 'search', 'aria-label': 'Search proposals', placeholder: 'Search proposals', id: 'home-search' }) as HTMLInputElement;
  const resultsBox = h('div', {});
  const newButton = h<HTMLButtonElement>('button', { type: 'button', class: 'primary', text: 'New proposal' });

  const docRow = (doc: DocumentSummary, showDelete: boolean): HTMLElement =>
    h('li', {},
      h('a', { href: `/d/${doc.id}`, text: doc.title }),
      h('span', { class: 'client', text: doc.client }),
      h('span', { class: 'role-chip', text: roleLabel(doc.role) }),
      h('span', { class: 'when', text: fmtWhen(doc.updatedAt) }),
      showDelete ? h<HTMLButtonElement>('button', { type: 'button', class: 'quiet', 'aria-label': `Delete ${doc.title}`, text: 'Delete', onclick: () => confirmDelete(doc) }) : null,
    );

  const confirmDelete = (doc: DocumentSummary): void => {
    openDialog((close) => {
      const delBtn = h<HTMLButtonElement>('button', { class: 'primary', type: 'button', text: 'Delete', onclick: async () => {
        delBtn.textContent = 'Deleting';
        delBtn.disabled = true;
        try {
          await api.deleteDocument(doc.id);
          announce(`Deleted ${doc.title}`);
          close();
          void loadLists();
        } catch (err) {
          delBtn.textContent = 'Delete';
          delBtn.disabled = false;
          if ((err as { code?: string }).code === 'storage_unavailable') {
            announce("Quillmere can't reach storage, so the proposal wasn't deleted. Try again in a minute.");
          }
        }
      } });
      return h('div', { class: 'alert-dialog', role: 'alertdialog', 'aria-label': 'Delete proposal' },
        h('h2', { text: 'Delete proposal' }),
        h('p', { text: `Delete “${doc.title}”? Everyone with access loses it at once.` }),
        h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Cancel', onclick: close }), delBtn),
      );
    }, null);
  };

  const renderLists = (docs: DocumentSummary[], searching: boolean): void => {
    resultsBox.textContent = '';
    if (searching) {
      const ul = h('ul', { class: 'doc-list', 'aria-label': 'Search results' });
      for (const doc of docs) ul.append(docRow(doc, false));
      if (docs.length === 0) ul.append(h('li', { class: 'client', text: 'No proposals match' }));
      resultsBox.append(h('section', { 'aria-label': 'Search results' }, h('ul', { class: 'visually-hidden', 'aria-label': 'Search results' }), ul));
      return;
    }
    const consultant = me?.isConsultant === true;
    const mineUl = h('ul', { class: 'doc-list' });
    const sharedUl = h('ul', { class: 'doc-list' });
    const recentUl = h('ul', { class: 'doc-list' });
    for (const doc of docs) recentUl.append(docRow(doc, false));
    if (consultant) {
      resultsBox.append(h('section', { class: 'doc-region', 'aria-label': 'Recent' }, h('h2', { text: 'Recent' }), recentUl));
      resultsBox.append(h('section', { class: 'doc-region', 'aria-label': 'My proposals' }, h('h2', { text: 'My proposals' }), mineUl));
    } else {
      resultsBox.append(h('section', { class: 'doc-region', 'aria-label': 'Recent' }, h('h2', { text: 'Recent' }), recentUl));
      resultsBox.append(h('section', { class: 'doc-region', 'aria-label': 'Shared with me' }, h('h2', { text: 'Shared with me' }), sharedUl));
    }
  };

  const loadLists = async (): Promise<void> => {
    const query = searchInput.value.trim();
    const consultant = me?.isConsultant === true;
    try {
      if (query) {
        const res = await api.documents(undefined, query);
        renderLists(res.documents, true);
        return;
      }
      const recent = await api.documents('recent');
      const other = await api.documents(consultant ? 'mine' : 'shared');
      renderLists(recent.documents, false);
      const mineUl = document.querySelector('section[aria-label="My proposals"] ul, section[aria-label="Shared with me"] ul');
      if (mineUl) {
        for (const doc of other.documents) mineUl.append(docRow(doc, consultant && doc.role === 'owner'));
      }
    } catch {
      // signed out or unreachable; keep the current lists
    }
  };

  searchInput.addEventListener('input', () => {
    window.clearTimeout(homeSearchTimer);
    homeSearchTimer = window.setTimeout(async () => {
      const query = searchInput.value.trim();
      if (query === '') {
        await loadLists();
        return;
      }
      const res = await api.documents(undefined, query);
      renderLists(res.documents, true);
      announce(res.documents.length === 0 ? 'No proposals match' : res.documents.length === 1 ? '1 proposal' : `${res.documents.length} proposals`);
    }, 300);
  });

  newButton.addEventListener('click', () => {
    openDialog((close) => {
      const titleInput = h<HTMLInputElement>('input', { type: 'text', 'aria-label': 'Title', id: 'np-title' }) as HTMLInputElement;
      const clientInput = h<HTMLInputElement>('input', { type: 'text', 'aria-label': 'Client', id: 'np-client' }) as HTMLInputElement;
      const errorBox = h('div', { role: 'alert' });
      const createBtn = h<HTMLButtonElement>('button', { class: 'primary', type: 'button', text: 'Create', onclick: async () => {
        createBtn.textContent = 'Creating';
        createBtn.disabled = true;
        errorBox.textContent = '';
        try {
          const doc = await api.createDocument(titleInput.value.trim(), clientInput.value.trim());
          window.location.href = `/d/${doc.id}`;
        } catch (err) {
          createBtn.textContent = 'Create';
          createBtn.disabled = false;
          const fields = (err as { fields?: Record<string, string> }).fields;
          if (fields?.title) {
            errorBox.textContent = fields.title;
            titleInput.focus();
          } else if (fields?.client) {
            errorBox.textContent = fields.client;
            clientInput.focus();
          }
        }
      } });
      return h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'New proposal' },
        h('h2', { text: 'New proposal' }),
        errorBox,
        h('div', { class: 'field' }, h('label', { for: 'np-title', text: 'Title' }), titleInput),
        h('div', { class: 'field' }, h('label', { for: 'np-client', text: 'Client' }), clientInput),
        h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Cancel', onclick: close }), createBtn),
      );
    }, newButton);
  });

  container.append(
    h('h1', { text: 'Documents' }),
    h('div', { class: 'search-row' }, searchInput, me?.isConsultant === true ? newButton : null),
    resultsBox,
  );
  document.body.append(
    menuBar('home', [], (notice) => {
      window.location.href = `/d/${notice.documentId}`;
    }),
    container,
  );
  void loadLists();
}

async function route(): Promise<void> {
  const path = window.location.pathname;
  if (path === '/sign-in') {
    try {
      me = (await api.session()).person;
      window.history.replaceState(null, '', '/');
      route();
      return;
    } catch {
      renderSignIn(path === '/sign-in' ? '/' : path);
      return;
    }
  }
  if (path.startsWith('/d/')) {
    try {
      me = (await api.session()).person;
    } catch {
      renderSignIn(path);
      return;
    }
    const documentId = path.slice('/d/'.length).split('/')[0] ?? '';
    mountEditor(documentId, me!, () => {
      me = null;
      window.location.href = '/sign-in';
    });
    return;
  }
  try {
    me = (await api.session()).person;
  } catch {
    renderSignIn(path === '/' ? '/' : path);
    return;
  }
  if (!socket.connected) {
    socket.connect();
    startHeartbeat();
  }
  renderHome();
}

window.addEventListener('popstate', () => {
  void route();
});

void route();
