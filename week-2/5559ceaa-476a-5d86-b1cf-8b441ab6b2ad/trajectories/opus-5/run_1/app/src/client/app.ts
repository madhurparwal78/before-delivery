import type { ProjectListEntry, User } from '../shared/api.js';
import { copy } from './copy.js';
import { openDialog } from './dialog.js';
import { clear, el, on } from './dom.js';
import { api, RequestFailed } from './net.js';
import { StatusBoard } from './workspace/status.js';
import { mountWorkspace, type WorkspaceHandle } from './workspace/index.js';

const root = document.getElementById('root');
let erasureNotice = false;
let mounted: WorkspaceHandle | null = null;

function navigate(path: string): void {
  if (location.pathname !== path) history.pushState(null, '', path);
  void render();
}

function show(...nodes: Node[]): void {
  mounted?.dispose();
  mounted = null;
  if (root === null) return;
  clear(root);
  root.append(...nodes);
}

// ---------- sign-in ----------

function signInScreen(): void {
  const statuses = new StatusBoard();
  const field = el('input', { type: 'email', id: 'sign-in-email', 'aria-label': 'Email' });
  const send = el('button', { type: 'submit' }, ['Email me a sign-in link']);
  const status = statuses.create('Sign-in status');
  const form = el('form', {}, [
    el('div', { class: 'field' }, [el('label', { for: 'sign-in-email' }, ['Email']), field]),
    send,
    status,
  ]);

  on(form, 'submit', (event) => {
    event.preventDefault();
    void (async () => {
      send.disabled = true;
      statuses.pending('Sign-in status', copy.signIn.pending);
      try {
        await api('/api/auth/magic-link', { method: 'POST', body: { email: field.value.trim() } });
        statuses.set('Sign-in status', copy.signIn.success);
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        if (cause.code === 'validation') statuses.error('Sign-in status', copy.signIn.fieldError);
        else if (cause.code === 'mail_unavailable') {
          statuses.error('Sign-in status', copy.signIn.mailOutage);
        } else statuses.error('Sign-in status', copy.generic);
      } finally {
        send.disabled = false;
      }
    })();
  });

  show(
    el('div', { class: 'card-screen' }, [
      el('div', { class: 'card' }, [el('h1', {}, ['Relay Bench']), form]),
    ]),
  );
  if (erasureNotice) {
    erasureNotice = false;
    statuses.set('Sign-in status', copy.signIn.erased);
  }
}

function verifyScreen(): void {
  const statuses = new StatusBoard();
  const finish = el('button', { type: 'button' }, ['Finish signing in']);
  const status = statuses.create('Sign-in status');

  on(finish, 'click', () => {
    void (async () => {
      const token = new URL(location.href).searchParams.get('token') ?? '';
      finish.disabled = true;
      statuses.pending('Sign-in status', copy.signIn.finishPending);
      try {
        const verified = await api<{ landing: string }>('/api/auth/verify', {
          method: 'POST',
          body: { token },
        });
        navigate(verified.landing);
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        if (cause.code === 'link_used') statuses.error('Sign-in status', copy.signIn.used);
        else if (cause.code === 'link_expired') {
          statuses.error('Sign-in status', copy.signIn.expired);
        } else if (cause.code === 'link_not_found') {
          statuses.error('Sign-in status', copy.signIn.unknown);
        } else statuses.error('Sign-in status', copy.generic);
      } finally {
        finish.disabled = false;
      }
    })();
  });

  show(
    el('div', { class: 'card-screen' }, [
      el('div', { class: 'card' }, [el('h1', {}, ['Relay Bench']), finish, status]),
    ]),
  );
}

// ---------- account menu ----------

function accountMenu(user: User): (host: HTMLElement) => void {
  return (host) => {
    const button = el('button', { type: 'button', class: 'quiet', 'aria-expanded': 'false' }, [
      'Account',
    ]);
    const wrap = el('div', { class: 'menu-wrap' }, [button]);

    on(button, 'click', () => {
      const existing = wrap.querySelector('[role="menu"]');
      if (existing !== null) {
        existing.remove();
        button.setAttribute('aria-expanded', 'false');
        return;
      }
      const items: HTMLElement[] = [];
      const signOut = el('button', { type: 'button', role: 'menuitem', tabindex: '-1' }, [
        'Sign out',
      ]);
      on(signOut, 'click', () => {
        void (async () => {
          await api('/api/auth/sign-out', { method: 'POST' });
          navigate('/sign-in');
        })();
      });
      items.push(signOut);
      if (user.kind === 'learner') {
        const erase = el('button', { type: 'button', role: 'menuitem', tabindex: '-1' }, [
          'Erase my account',
        ]);
        on(erase, 'click', () => openEraseDialog());
        items.push(erase);
      }
      const menu = el('div', { role: 'menu', 'aria-label': 'Account' }, items);
      wrap.append(menu);
      button.setAttribute('aria-expanded', 'true');
      items[0]?.focus();
      on(menu, 'keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        menu.remove();
        button.setAttribute('aria-expanded', 'false');
        button.focus();
      });
    });

    host.append(wrap);
  };
}

function openEraseDialog(): void {
  const statuses = new StatusBoard();
  const confirm = el('input', { type: 'text', id: 'erase-confirm', 'aria-label': 'Type ERASE to confirm' });
  const erase = el('button', { type: 'button', class: 'danger' }, ['Erase account']);
  const cancel = el('button', { type: 'button' }, ['Cancel']);
  const status = statuses.create('Account status');
  const dialog = openDialog(
    {
      role: 'alertdialog',
      name: 'Erase your account?',
      heading: 'Erase your account?',
      destructive: true,
    },
    () => [
      el('div', { class: 'field' }, [
        el('label', { for: 'erase-confirm' }, ['Type ERASE to confirm']),
        confirm,
      ]),
      el('div', { class: 'dialog-actions' }, [erase, cancel]),
      status,
    ],
  );

  on(cancel, 'click', () => dialog.close());
  on(erase, 'click', () => {
    void (async () => {
      if (confirm.value !== 'ERASE') {
        statuses.error('Account status', copy.account.confirmError);
        return;
      }
      erase.disabled = true;
      statuses.pending('Account status', copy.account.pending);
      try {
        await api('/api/me', { method: 'DELETE', body: { confirm: 'ERASE' } });
        erasureNotice = true;
        dialog.close();
        navigate('/sign-in');
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        if (cause.code === 'storage_unavailable') {
          statuses.error('Account status', copy.account.storageOutage);
        } else if (cause.code === 'validation') {
          statuses.error('Account status', copy.account.confirmError);
        } else statuses.error('Account status', copy.generic);
      } finally {
        erase.disabled = false;
      }
    })();
  });
}

// ---------- projects ----------

async function projectsScreen(user: User): Promise<void> {
  const loaded = await api<{ projects: ProjectListEntry[] }>('/api/projects');
  const topbar = el('div', { class: 'topbar' }, [el('span', { class: 'brand' }, ['Relay Bench'])]);
  accountMenu(user)(topbar);

  const page = el('div', { class: 'page' }, [el('h1', {}, ['Projects'])]);
  if (loaded.projects.length === 0) {
    page.append(el('p', { class: 'empty' }, ['No projects yet']));
  } else {
    const list = el('div', { role: 'list', 'aria-label': 'Projects' });
    for (const project of loaded.projects) {
      const link = el('a', { href: `/projects/${project.id}` }, [project.title]);
      on(link, 'click', (event) => {
        event.preventDefault();
        navigate(`/projects/${project.id}`);
      });
      list.append(
        el('div', { role: 'listitem', class: 'project-row' }, [
          link,
          el('span', { class: 'meta' }, [project.kind === 'group' ? 'Group' : 'One-to-one']),
          el('span', { class: 'meta numeral' }, [String(project.student_count)]),
          el('span', { class: 'meta' }, [project.role === 'mentor' ? 'Mentor' : 'Student']),
        ]),
      );
    }
    page.append(list);
  }

  if (user.kind === 'mentor') {
    const newProject = el('button', { type: 'button' }, ['New project']);
    on(newProject, 'click', () => openNewProjectDialog());
    page.append(newProject);
  }

  show(topbar, page);
}

function openNewProjectDialog(): void {
  const title = el('input', { type: 'text', id: 'project-title', 'aria-label': 'Project title' });
  const oneToOne = el('input', { type: 'radio', name: 'kind', 'aria-label': 'One-to-one', checked: true });
  const group = el('input', { type: 'radio', name: 'kind', 'aria-label': 'Group' });
  const create = el('button', { type: 'button' }, ['Create project']);
  const dialog = openDialog(
    { role: 'dialog', name: 'New project', heading: 'New project' },
    () => [
      el('div', { class: 'field' }, [
        el('label', { for: 'project-title' }, ['Project title']),
        title,
      ]),
      el('label', {}, [oneToOne, ' One-to-one']),
      el('label', {}, [group, ' Group']),
      el('div', { class: 'dialog-actions' }, [create]),
    ],
  );

  on(create, 'click', () => {
    void (async () => {
      create.disabled = true;
      try {
        const created = await api<{ project: { id: string } }>('/api/projects', {
          method: 'POST',
          body: { title: title.value.trim(), kind: group.checked ? 'group' : 'one_to_one' },
        });
        dialog.close();
        navigate(`/projects/${created.project.id}`);
      } finally {
        create.disabled = false;
      }
    })();
  });
}

// ---------- routing ----------

async function render(): Promise<void> {
  const path = location.pathname;
  if (path === '/sign-in') {
    signInScreen();
    return;
  }
  if (path === '/auth/verify') {
    verifyScreen();
    return;
  }

  const me = await api<{ user: User }>('/api/me').catch(() => null);
  if (me === null) {
    history.replaceState(null, '', '/sign-in');
    signInScreen();
    return;
  }

  const workspace = /^\/projects\/([^/]+)$/.exec(path);
  if (workspace !== null) {
    try {
      const handle = await mountWorkspace(
        me.user,
        workspace[1] ?? '',
        navigate,
        accountMenu(me.user),
      );
      show(handle.node);
      mounted = handle;
      return;
    } catch {
      navigate('/');
      return;
    }
  }
  if (path !== '/') {
    history.replaceState(null, '', '/');
  }
  await projectsScreen(me.user);
}

window.addEventListener('popstate', () => void render());
void render();
