import { copy, inviteStatusText } from '../../shared/copy.js';
import { pagesInOrder } from '../../shared/document.js';
import type { ExportRecord, InviteRecord, MemberRecord } from '../api.js';
import { focusFirst, h, trapFocus } from '../dom.js';
import type { Actions } from './actions.js';
import { type WorkspaceState, currentPage, shownDocument } from './store.js';

const LAYER = (): HTMLElement => {
  const existing = document.getElementById('overlay-layer');
  if (existing) return existing;
  const layer = h('div', { id: 'overlay-layer' });
  document.body.appendChild(layer);
  return layer;
};

export interface OpenPanel {
  root: HTMLElement;
  close(): void;
}

let openPanel: OpenPanel | null = null;
const closeListeners: (() => void)[] = [];

/** Runs whenever any dialog, sheet or menu closes. */
export function onPanelClosed(listener: () => void): void {
  closeListeners.push(listener);
}

export function closeOpenPanel(): void {
  openPanel?.close();
}

export function hasOpenPanel(): boolean {
  return openPanel !== null;
}

interface PanelOptions {
  role: 'dialog' | 'alertdialog' | 'menu';
  label: string;
  opener?: HTMLElement | undefined;
  className?: string;
}

function present(options: PanelOptions, build: (close: () => void) => HTMLElement[]): OpenPanel {
  closeOpenPanel();
  const backdrop = h('div', { class: 'panel-backdrop' });
  const root = h('div', {
    class: `panel ${options.className ?? ''}`.trim(),
    role: options.role,
    'aria-modal': options.role === 'menu' ? null : 'true',
    'aria-label': options.label,
  });
  const close = (): void => {
    if (openPanel?.root !== root) return;
    openPanel = null;
    for (const listener of closeListeners) listener();
    release();
    backdrop.remove();
    root.remove();
    options.opener?.focus();
  };
  root.append(...build(close));
  const release = trapFocus(root, close);
  backdrop.addEventListener('pointerdown', close);
  LAYER().append(backdrop, root);
  focusFirst(root);
  openPanel = { root, close };
  return openPanel;
}

/** A menu always opens fully inside the viewport, flipping when there is no room. */
function placeMenu(root: HTMLElement, anchor: { x: number; y: number }): void {
  root.style.visibility = 'hidden';
  root.style.left = '0px';
  root.style.top = '0px';
  requestAnimationFrame(() => {
    const box = root.getBoundingClientRect();
    const margin = 8;
    let left = anchor.x;
    let top = anchor.y;
    if (left + box.width + margin > window.innerWidth) left = anchor.x - box.width;
    if (top + box.height + margin > window.innerHeight) top = anchor.y - box.height;
    root.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - box.width - margin))}px`;
    root.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - box.height - margin))}px`;
    root.style.visibility = 'visible';
  });
}

export interface MenuItem {
  label: string;
  run(): void;
  disabled?: boolean;
}

export function openMenu(
  label: string,
  items: readonly MenuItem[],
  anchor: { x: number; y: number },
  opener?: HTMLElement,
): void {
  const panel = present({ role: 'menu', label, opener, className: 'menu' }, (close) =>
    items.map((item) => {
      const button = h(
        'button',
        {
          class: 'menu-item',
          type: 'button',
          role: 'menuitem',
          disabled: item.disabled === true,
        },
        item.label,
      );
      button.addEventListener('click', () => {
        close();
        item.run();
      });
      return button;
    }),
  );
  placeMenu(panel.root, anchor);
}

export function openShareDialog(
  actions: Actions,
  data: { members: MemberRecord[]; invites: InviteRecord[]; mailOutage: boolean },
  opener?: HTMLElement,
): void {
  present({ role: 'dialog', label: 'Share', opener, className: 'dialog' }, () => {
    const nodes: HTMLElement[] = [h('h2', {}, 'Share')];
    if (data.mailOutage) {
      nodes.push(h('p', { class: 'banner mail-outage' }, copy.mailOutageBanner));
    }
    const email = h('input', { class: 'field-input', type: 'email', 'aria-label': 'Email' });
    const role = h(
      'select',
      { class: 'field-input', 'aria-label': 'Role' },
      h('option', { value: 'editor' }, 'Editor'),
      h('option', { value: 'viewer' }, 'Viewer'),
    );
    const status = h('p', { class: 'invite-status' });
    const send = h('button', { class: 'thread-button', type: 'button' }, 'Send invite');
    send.addEventListener('click', () => {
      status.textContent = copy.invitePending;
      actions.invite(email.value.trim().toLowerCase(), role.value === 'viewer' ? 'viewer' : 'editor');
      email.value = '';
    });
    nodes.push(
      h('div', { class: 'invite-row' }, h('label', { class: 'field-label' }, 'Email', email), h('label', { class: 'field-label' }, 'Role', role), send),
      status,
    );
    const list = h('ul', { class: 'member-list', role: 'list', 'aria-label': 'Members' });
    for (const member of data.members) {
      const row = h('li', { class: 'member-row' }, h('span', {}, member.name));
      if (member.role !== 'owner') {
        const select = h(
          'select',
          { class: 'field-input', 'aria-label': `Role for ${member.email}` },
          h('option', { value: 'editor', selected: member.role === 'editor' }, 'Editor'),
          h('option', { value: 'viewer', selected: member.role === 'viewer' }, 'Viewer'),
        );
        select.addEventListener('change', () =>
          actions.setMemberRole(member.userId, select.value === 'viewer' ? 'viewer' : 'editor'),
        );
        const remove = h(
          'button',
          { class: 'thread-button', type: 'button', 'aria-label': `Remove ${member.email}` },
          'Remove',
        );
        remove.addEventListener('click', () => actions.removeMember(member.userId));
        row.append(select, h('span', { class: 'member-status' }, inviteStatusText.active), remove);
      } else {
        row.append(h('span', { class: 'member-status' }, inviteStatusText.active));
      }
      list.appendChild(row);
    }
    for (const invite of data.invites) {
      const row = h('li', { class: 'member-row' }, h('span', {}, invite.email));
      const select = h(
        'select',
        { class: 'field-input', 'aria-label': `Role for ${invite.email}` },
        h('option', { value: 'editor', selected: invite.role === 'editor' }, 'Editor'),
        h('option', { value: 'viewer', selected: invite.role === 'viewer' }, 'Viewer'),
      );
      row.append(select, h('span', { class: 'member-status' }, inviteStatusText[invite.status]));
      if (invite.status === 'email_not_sent' || invite.status === 'expired') {
        const resend = h(
          'button',
          { class: 'thread-button', type: 'button', 'aria-label': `Resend invite to ${invite.email}` },
          'Resend',
        );
        resend.addEventListener('click', () => {
          status.textContent = copy.invitePending;
          actions.resendInvite(invite.id);
        });
        row.appendChild(resend);
      }
      const remove = h(
        'button',
        { class: 'thread-button', type: 'button', 'aria-label': `Remove ${invite.email}` },
        'Remove',
      );
      remove.addEventListener('click', () => actions.removeInvite(invite.id));
      row.appendChild(remove);
      list.appendChild(row);
    }
    nodes.push(list);
    return nodes;
  });
}

export function openExportDialog(
  state: WorkspaceState,
  actions: Actions,
  lookup: (page: string) => ExportRecord | null,
  register: (refresh: (() => void) | null) => void,
  opener?: HTMLElement,
): void {
  present({ role: 'dialog', label: 'Export', opener, className: 'dialog' }, () => {
    const doc = shownDocument(state);
    let format: 'png' | 'svg' = 'svg';
    let scale: 1 | 2 = 1;
    let background: 'white' | 'transparent' = 'white';
    let page = currentPage(state).id;
    let sending = false;

    const statusLine = h('p', { class: 'export-status' });
    const link = h('a', { class: 'bar-link', hidden: true, href: '#', download: '' }, 'Download SVG');
    const retry = h('button', { class: 'thread-button', type: 'button', hidden: true }, 'Try again');
    const paused = h('p', { class: 'banner paused', hidden: true }, copy.exportPausedBanner);

    const refresh = (): void => {
      const record = lookup(page);
      const pageName = pagesInOrder(doc).find((candidate) => candidate.id === page)?.name ?? '';
      link.hidden = true;
      retry.hidden = true;
      paused.hidden = true;
      statusLine.textContent = '';
      if (!record) return;
      if (record.status === 'rendering') {
        statusLine.textContent = copy.exportPending(pageName);
        return;
      }
      if (record.status === 'ready') {
        statusLine.textContent = copy.exportReady;
        link.hidden = false;
        link.textContent = record.format === 'svg' ? 'Download SVG' : 'Download PNG';
        link.setAttribute('href', `/api/exports/${record.id}/file`);
        return;
      }
      paused.hidden = false;
      retry.hidden = false;
      retry.onclick = (): void => {
        statusLine.textContent = copy.exportPending(pageName);
        retry.hidden = true;
        actions.retryExport(record.id);
      };
    };

    const scaleGroup = h('div', { role: 'radiogroup', 'aria-label': 'Scale', class: 'radio-row' });
    const radio = (
      group: HTMLElement,
      label: string,
      checked: boolean,
      onPick: () => void,
    ): HTMLElement => {
      const button = h(
        'button',
        { class: 'radio', type: 'button', role: 'radio', 'aria-checked': checked ? 'true' : 'false' },
        label,
      );
      button.addEventListener('click', () => {
        for (const sibling of group.querySelectorAll('[role="radio"]')) {
          sibling.setAttribute('aria-checked', 'false');
        }
        button.setAttribute('aria-checked', 'true');
        onPick();
      });
      return button;
    };

    const formatGroup = h('div', { role: 'radiogroup', 'aria-label': 'Format', class: 'radio-row' });
    formatGroup.append(
      radio(formatGroup, 'PNG', false, () => {
        format = 'png';
        for (const node of scaleGroup.querySelectorAll('button')) node.removeAttribute('disabled');
        refresh();
      }),
      radio(formatGroup, 'SVG', true, () => {
        format = 'svg';
        scale = 1;
        for (const node of scaleGroup.querySelectorAll('button')) node.setAttribute('disabled', '');
        refresh();
      }),
    );
    scaleGroup.append(
      radio(scaleGroup, '1x', true, () => {
        scale = 1;
      }),
      radio(scaleGroup, '2x', false, () => {
        scale = 2;
      }),
    );
    for (const node of scaleGroup.querySelectorAll('button')) node.setAttribute('disabled', '');

    const pageSelect = h('select', { class: 'field-input', 'aria-label': 'Page' });
    for (const candidate of pagesInOrder(doc)) {
      pageSelect.appendChild(
        h('option', { value: candidate.id, selected: candidate.id === page }, candidate.name),
      );
    }
    pageSelect.addEventListener('change', () => {
      page = pageSelect.value;
      refresh();
    });

    const backgroundGroup = h('div', { role: 'radiogroup', 'aria-label': 'Background', class: 'radio-row' });
    backgroundGroup.append(
      radio(backgroundGroup, 'White', true, () => {
        background = 'white';
      }),
      radio(backgroundGroup, 'Transparent', false, () => {
        background = 'transparent';
      }),
    );

    const run = h('button', { class: 'thread-button', type: 'button' }, 'Export');
    run.addEventListener('click', () => {
      // Further presses while the request is unanswered send nothing.
      if (sending) return;
      sending = true;
      statusLine.textContent = copy.exportPending(
        pagesInOrder(doc).find((candidate) => candidate.id === page)?.name ?? '',
      );
      actions.requestExport({ page, format, scale, background });
      window.setTimeout(() => {
        sending = false;
      }, 0);
    });

    refresh();
    register(refresh);
    return [
      h('h2', {}, 'Export'),
      paused,
      h('label', { class: 'field-label' }, 'Format', formatGroup),
      h('label', { class: 'field-label' }, 'Scale', scaleGroup),
      h('label', { class: 'field-label' }, 'Page', pageSelect),
      h('label', { class: 'field-label' }, 'Background', backgroundGroup),
      run,
      statusLine,
      link,
      retry,
    ];
  });
}

export function openSaveVersionDialog(actions: Actions, opener?: HTMLElement): void {
  present({ role: 'dialog', label: 'Save version', opener, className: 'dialog' }, (close) => {
    const name = h('input', { class: 'field-input', type: 'text', 'aria-label': 'Version name' });
    const save = h('button', { class: 'thread-button', type: 'button' }, 'Save');
    save.addEventListener('click', () => {
      const value = name.value.trim();
      close();
      actions.saveVersion(value.length > 0 ? value : null);
    });
    return [
      h('h2', {}, 'Save version'),
      h('label', { class: 'field-label' }, 'Version name', name),
      save,
    ];
  });
}

export function openDeletePageDialog(
  pageId: string,
  actions: Actions,
  opener?: HTMLElement,
): void {
  present({ role: 'alertdialog', label: 'Delete page', opener, className: 'dialog' }, (close) => {
    const confirm = h('button', { class: 'thread-button', type: 'button' }, 'Delete page');
    confirm.addEventListener('click', () => {
      close();
      actions.deletePage(pageId);
    });
    const cancel = h('button', { class: 'thread-button', type: 'button' }, 'Cancel');
    cancel.addEventListener('click', close);
    return [h('h2', {}, 'Delete page'), h('p', {}, 'This removes the page and everything on it.'), confirm, cancel];
  });
}

export function openSignInDialog(
  email: string,
  actions: Actions,
  opener?: HTMLElement,
): void {
  present({ role: 'dialog', label: 'Sign in to continue', opener, className: 'dialog' }, () => {
    const emailField = h('input', {
      class: 'field-input',
      type: 'email',
      'aria-label': 'Email',
      value: email,
      readonly: true,
    });
    const password = h('input', { class: 'field-input', type: 'password', 'aria-label': 'Password' });
    const error = h('p', { class: 'field-error', hidden: true });
    const submit = h('button', { class: 'thread-button', type: 'button' }, 'Sign in');
    submit.addEventListener('click', () => {
      actions.signInAgain(password.value, (message) => {
        error.textContent = message;
        error.hidden = false;
      });
    });
    return [
      h('h2', {}, 'Sign in to continue'),
      h('label', { class: 'field-label' }, 'Email', emailField),
      h('label', { class: 'field-label' }, 'Password', password),
      error,
      submit,
    ];
  });
}

/** Closes the Sign in to continue dialog once the session is back. */
export function closeSignInDialog(): void {
  if (openPanel?.root.getAttribute('aria-label') === 'Sign in to continue') closeOpenPanel();
}

export function openSheetPanel(
  label: 'Layers' | 'Inspector' | 'Comments' | 'History',
  content: HTMLElement,
  opener?: HTMLElement,
): void {
  present({ role: 'dialog', label, opener, className: 'sheet' }, () => [content]);
}
