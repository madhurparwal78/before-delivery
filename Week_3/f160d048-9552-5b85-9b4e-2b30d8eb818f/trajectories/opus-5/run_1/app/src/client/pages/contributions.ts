import { KIND_LABELS, type PostKind, type PostState } from '../../shared/reference';
import { announce } from '../core/announce';
import { failureOf, get, patch, remove } from '../core/api';
import { el, focus, on, trapFocus } from '../core/dom';
import { onLive } from '../core/live';
import type { Cleanup } from '../core/router';
import { clearFieldErrors, fieldError, pageAlert, working } from '../core/shell';

interface MyPost {
  id: string;
  kind: PostKind;
  label: string;
  company_name: string;
  state: PostState;
  reason: string | null;
  posted_month: string;
  editable: boolean;
}

const STATE_TEXT: Readonly<Record<PostState, string>> = {
  pending: 'Pending',
  claimed: 'Claimed',
  approved: 'Approved',
  rejected: 'Rejected',
};

function stateText(post: MyPost): string {
  return post.state === 'rejected' ? `Rejected: ${post.reason ?? ''}` : STATE_TEXT[post.state];
}

function field(labelText: string, input: HTMLElement, key: string): HTMLElement {
  input.id = `edit-${key}-${Math.random().toString(36).slice(2, 7)}`;
  return el('div', { class: 'field' }, [el('label', { for: input.id, text: labelText }), input]);
}

/** The author retypes the kind's fields; a saved edit returns the post to pending. */
function openEditor(
  post: MyPost,
  host: HTMLElement,
  alert: (message: string | null) => unknown,
  reload: () => Promise<void>,
): void {
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const add = (labelText: string, key: string, node: HTMLInputElement | HTMLTextAreaElement): HTMLElement => {
    inputs.set(key, node);
    return field(labelText, node, key);
  };
  const text = (rows?: string): HTMLTextAreaElement => el('textarea', { class: 'textbox', rows: rows ?? '3' });
  const line = (): HTMLInputElement => el('input', { type: 'text', class: 'textbox' });
  const number = (): HTMLInputElement => el('input', { type: 'number', class: 'textbox' });

  const fields: HTMLElement[] = [];
  if (post.kind === 'review') {
    fields.push(
      add('Overall rating', 'overall', number()),
      add('Work-life balance rating', 'work_life', number()),
      add('Pay rating', 'pay', number()),
      add('Management rating', 'management', number()),
      add('Title', 'title', line()),
      add('Pros', 'pros', text('4')),
      add('Cons', 'cons', text('4')),
    );
  } else if (post.kind === 'pay_report') {
    fields.push(
      add('Role', 'role_family', line()),
      add('City', 'city', line()),
      add('Annual pay in rupees', 'annual_pay', number()),
      add('Years of experience', 'years_experience', number()),
    );
  } else {
    fields.push(
      add('Role', 'role_family', line()),
      add('Difficulty rating', 'difficulty', number()),
      add('Outcome', 'outcome', line()),
      add('What happened', 'text', text('4')),
    );
  }

  const save = el('button', { type: 'button', class: 'solid-button', text: 'Save changes' });
  const form = el('form', { class: 'stack' }, [...fields, save]);
  host.replaceChildren(form);
  focus(inputs.values().next().value ?? save);

  on(save, 'click', () => {
    const done = working(save);
    const body: Record<string, unknown> = {};
    for (const [key, node] of inputs) {
      body[key] = node instanceof HTMLInputElement && node.type === 'number' ? Number(node.value) : node.value;
    }
    void patch(`/api/posts/${post.id}`, body)
      .then(async () => {
        host.replaceChildren();
        announce(`Changes saved. Your ${KIND_LABELS[post.kind]} is waiting for a moderator.`);
        await reload();
      })
      .catch((error: unknown) => {
        const failure = failureOf(error);
        clearFieldErrors(form);
        if (failure?.fields) {
          for (const [key, message] of Object.entries(failure.fields)) {
            const node = inputs.get(key);
            if (node) fieldError(node, message);
          }
          return;
        }
        alert(failure?.message ?? 'Something went wrong.');
      })
      .finally(done);
  });
}

export async function renderMyContributions(container: HTMLElement): Promise<Cleanup> {
  const page = el('div', { class: 'narrow-page' }, [el('h1', { text: 'My contributions' })]);
  container.append(page);
  const alert = pageAlert(page);
  const list = el('ul', { 'aria-label': 'My contributions', class: 'plain-list' });
  page.append(list);

  let posts: MyPost[] = [];

  const confirmDelete = (post: MyPost, opener: HTMLElement): void => {
    const deleteButton = el('button', { type: 'button', class: 'solid-button', text: 'Delete post' });
    const keepButton = el('button', { type: 'button', class: 'nav-action', text: 'Keep post' });
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Delete this post?', class: 'sheet' },
      [
        el('p', { text: 'This removes it from every page and count.' }),
        el('div', { class: 'row' }, [deleteButton, keepButton]),
      ],
    );
    const backdrop = el('div', { class: 'backdrop' }, [dialog]);
    document.body.append(backdrop);
    const release = trapFocus(dialog);
    const shut = (): void => {
      release();
      backdrop.remove();
      focus(opener);
    };
    on(keepButton, 'click', shut);
    on(dialog, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        shut();
      }
    });
    on(deleteButton, 'click', () => {
      const done = working(deleteButton);
      void remove(`/api/posts/${post.id}`)
        .then(async () => {
          shut();
          announce('Post deleted.');
          await load();
        })
        .catch((error: unknown) => alert(failureOf(error)?.message ?? 'Something went wrong.'))
        .finally(done);
    });
    focus(deleteButton);
  };

  const paint = (): void => {
    list.replaceChildren();
    for (const post of posts) {
      const item = el('li', { 'data-id': post.id, class: 'contribution' }, [
        el('p', { class: 'contribution-label', text: post.label }),
        el('p', { class: 'contribution-state', text: stateText(post) }),
      ]);
      const row = el('div', { class: 'row' });
      const editHost = el('div', { class: 'edit-host' });
      if (post.editable) {
        const edit = el('button', {
          type: 'button',
          class: 'nav-action',
          'aria-label': `Edit ${post.label}`,
          text: 'Edit',
        });
        on(edit, 'click', () => openEditor(post, editHost, alert, load));
        row.append(edit);
      }
      if (post.state !== 'claimed') {
        const deleteButton = el('button', {
          type: 'button',
          class: 'nav-action',
          'aria-label': `Delete ${post.label}`,
          text: 'Delete',
        });
        on(deleteButton, 'click', () => confirmDelete(post, deleteButton));
        row.append(deleteButton);
      }
      item.append(row, editHost);
      list.append(item);
    }
  };

  async function load(): Promise<void> {
    posts = (await get<{ posts: MyPost[] }>('/api/me/posts')).posts;
    paint();
  }
  await load();

  const stopLive = onLive((messages) => {
    for (const message of messages) {
      if (message.type !== 'post.state') continue;
      const id = String(message.data['post_id']);
      const state = String(message.data['state']) as PostState;
      const post = posts.find((candidate) => candidate.id === id);
      if (!post) continue;
      post.state = state;
      post.reason = (message.data['reason'] as string | null) ?? null;
      paint();
      if (state === 'approved') announce(`Your ${KIND_LABELS[post.kind]} for ${post.company_name} was approved.`);
      if (state === 'rejected') {
        announce(`Your ${KIND_LABELS[post.kind]} for ${post.company_name} was rejected: ${post.reason ?? ''}.`);
      }
    }
  });
  return stopLive;
}
