import type { CommentNode, Pin, ReactionType } from '../shared/types.js';
import { copy } from '../shared/copy.js';
import { counterText, overLimit } from '../shared/copy.js';
import { codePoints } from '../shared/text.js';
import {
  ApiFailure,
  announce,
  api,
  busy,
  clear,
  el,
  failureMessage,
  navigate,
  reducedMotion,
  showAlert,
  state,
  timeElement,
} from './core.js';
import { clearFieldErrors, fieldError, labelledField, openDialog, openSaveDialog } from './dialogs.js';
import { onLive, unwatch, watch } from './live.js';
import { dimOtherCards, cardImage } from './grid.js';

const REACTION_LABELS: { type: ReactionType; label: string }[] = [
  { type: 'love', label: 'Love' },
  { type: 'idea', label: 'Idea' },
  { type: 'wow', label: 'Wow' },
  { type: 'thanks', label: 'Thanks' },
];

export interface PinViewHandle {
  element: HTMLElement;
  pin: Pin;
  refreshCounts(counts: { saves: number; comments: number; reactions: number }): void;
  reload(): Promise<void>;
}

function creditNode(pin: Pin): HTMLElement {
  const line = el('p', { class: 'credit-line' });
  const saved = pin.saved_from;
  if (!saved) {
    line.textContent = pin.owner.name;
    return line;
  }
  if (saved.pin_id !== null) {
    line.append(el('a', { href: `/pin/${saved.pin_id}`, text: `Saved from ${saved.user_name}` }));
    return line;
  }
  line.textContent = saved.removed
    ? `Saved from ${saved.user_name} · ${copy.originalRemoved}`
    : `Saved from ${saved.user_name}`;
  return line;
}

export function renderPinView(
  pin: Pin,
  options: { dialog: boolean; onClose?: () => void },
): PinViewHandle {
  let current = pin;
  const root = el('div', { class: 'exhibit' });
  const figure = el('div', { class: 'exhibit-image' });
  const image = el('img', {
    src: current.image.variants.at(-1)?.url ?? current.image.original_url,
    alt: current.alt,
  });
  figure.append(image);
  const panel = el('div', { class: 'exhibit-panel' });
  root.append(figure, panel);

  const savesLine = el('p', { class: 'meta', text: copy.saves(current.saves) });
  const commentsCount = el('p', { class: 'meta', text: copy.comments(current.comments) });
  const reactionsCount = el('p', { class: 'meta', text: copy.reactions(current.reactions) });

  const paintPanel = (): void => {
    clear(panel);
    if (options.dialog) {
      const close = el('button', { type: 'button', class: 'secondary', text: 'Close' });
      close.addEventListener('click', () => options.onClose?.());
      panel.append(close);
    }
    panel.append(el('h1', { class: 'exhibit-title', text: current.title }));
    if (current.description.length > 0) {
      panel.append(el('p', { class: 'exhibit-description', text: current.description }));
    }
    if (current.tags.length > 0) {
      const tags = el('p', { class: 'tags' });
      for (const tag of current.tags) {
        tags.append(el('a', { href: `/search?tag=${encodeURIComponent(tag)}`, text: `#${tag}` }));
        tags.append(document.createTextNode(' '));
      }
      panel.append(tags);
    }
    if (current.source && current.source_host) {
      panel.append(
        el(
          'p',
          { class: 'source' },
          el('a', { href: current.source, rel: 'noreferrer noopener', text: current.source_host }),
        ),
      );
    }
    panel.append(creditNode(current));
    panel.append(el('p', { class: 'alt-text', text: current.alt }));
    panel.append(timeElement(current.created_at));
    panel.append(savesLine, commentsCount, reactionsCount);

    const reactButton = el('button', { type: 'button', class: 'secondary', text: 'React' });
    reactButton.addEventListener('click', () => openReactionMenu(current, reactButton, (updated) => {
      current = { ...current, my_reaction: updated.mine, reactions: updated.reactions };
      reactionsCount.textContent = copy.reactions(updated.reactions);
    }));
    const saveButton = el('button', { type: 'button', class: 'primary', text: 'Save' });
    saveButton.addEventListener('click', () => {
      void openSaveDialog(current, saveButton);
    });
    const actions = el('div', { class: 'row' }, reactButton, saveButton);
    if (state.user && current.owner.id === state.user.id) {
      const edit = el('button', { type: 'button', class: 'secondary', text: 'Edit pin' });
      edit.addEventListener('click', () => openEditPinDialog(current, edit, handle));
      actions.append(edit);
    }
    panel.append(actions);
    panel.append(commentsSection(current, commentsCount));
  };

  const handle: PinViewHandle = {
    element: root,
    get pin() {
      return current;
    },
    refreshCounts: (counts) => {
      savesLine.textContent = copy.saves(counts.saves);
      commentsCount.textContent = copy.comments(counts.comments);
      reactionsCount.textContent = copy.reactions(counts.reactions);
    },
    reload: async () => {
      current = await api.get<Pin>(`/api/pins/${current.id}`);
      image.src = current.image.variants.at(-1)?.url ?? current.image.original_url;
      image.alt = current.alt;
      paintPanel();
    },
  };

  paintPanel();
  return handle;
}

function openReactionMenu(
  pin: Pin,
  opener: HTMLButtonElement,
  onChange: (result: { mine: ReactionType | null; reactions: number }) => void,
): void {
  const existing = document.querySelector('.menu-overlay');
  if (existing) existing.remove();
  const overlay = el('div', { class: 'menu-overlay' });
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': 'Reactions' });
  const items: HTMLElement[] = REACTION_LABELS.map((entry) => {
    const item = el('div', {
      class: 'menu-item',
      role: 'menuitemradio',
      tabindex: '-1',
      'aria-checked': pin.my_reaction === entry.type ? 'true' : 'false',
      text: entry.label,
    });
    item.addEventListener('click', () => {
      void choose(entry.type);
    });
    menu.append(item);
    return item;
  });

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opener.focus();
  };

  const choose = async (type: ReactionType): Promise<void> => {
    try {
      const result = await api.put<{ mine: ReactionType | null; reactions: number }>(
        `/api/pins/${pin.id}/reaction`,
        { type },
      );
      onChange(result);
      close();
    } catch (error) {
      showAlert(failureMessage(error));
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!overlay.isConnected) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      items[index]?.click();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  };

  overlay.append(menu);
  const rect = opener.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  const checked = items.find((item) => item.getAttribute('aria-checked') === 'true');
  (checked ?? items[0]).focus();
}

function commentsSection(pin: Pin, countNode: HTMLElement): HTMLElement {
  const section = el('section', { class: 'comments' });
  const list = el('div', { class: 'comment-list' });
  const input = el('textarea', { 'aria-label': 'Add a comment', rows: '2' });
  const counter = el('p', {
    class: 'counter',
    text: counterText(0, state.config.limits.comment_max),
  });
  const post = el('button', { type: 'button', class: 'secondary', text: 'Post' });

  const paint = async (): Promise<void> => {
    const data = await api.get<{ count: number; comments: CommentNode[] }>(
      `/api/pins/${pin.id}/comments`,
    );
    countNode.textContent = copy.comments(data.count);
    clear(list);
    for (const comment of data.comments) {
      list.append(commentRow(pin, comment, paint));
      for (const reply of comment.replies ?? []) {
        const row = commentRow(pin, reply, paint);
        row.classList.add('reply');
        list.append(row);
      }
    }
  };

  input.addEventListener('input', () => {
    const used = codePoints(input.value);
    const max = state.config.limits.comment_max;
    counter.textContent = used > max ? overLimit(used, max) : counterText(used, max);
  });

  post.addEventListener('click', () => {
    void busy(post, 'Posting', async () => {
      try {
        await api.post(`/api/pins/${pin.id}/comments`, { text: input.value, parent: null });
        input.value = '';
        counter.textContent = counterText(0, state.config.limits.comment_max);
        await paint();
      } catch (error) {
        if (error instanceof ApiFailure && error.field === 'text') {
          fieldError(input, `Comments are 1 to ${state.config.limits.comment_max} characters.`);
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });

  section.append(list, labelledField('Add a comment', input), counter, post);
  void paint();
  return section;
}

function commentRow(
  pin: Pin,
  comment: CommentNode,
  refresh: () => Promise<void>,
): HTMLElement {
  const row = el('div', { class: 'comment' });
  row.append(el('p', { class: 'comment-author', text: comment.author.name }));
  row.append(
    el('p', { class: 'comment-text', text: comment.deleted ? copy.deletedComment : comment.text ?? '' }),
  );
  row.append(timeElement(comment.created_at));
  if (!comment.deleted) {
    const reply = el('button', {
      type: 'button',
      class: 'secondary',
      text: `Reply to ${comment.author.name}`,
    });
    reply.addEventListener('click', () => {
      if (row.querySelector('textarea')) return;
      const input = el('textarea', { 'aria-label': `Reply to ${comment.author.name}`, rows: '2' });
      const send = el('button', { type: 'button', class: 'secondary', text: 'Post reply' });
      send.addEventListener('click', () => {
        void busy(send, 'Posting', async () => {
          try {
            await api.post(`/api/pins/${pin.id}/comments`, {
              text: input.value,
              parent: comment.id,
            });
            await refresh();
          } catch (error) {
            if (error instanceof ApiFailure && error.field === 'text') {
              fieldError(input, `Comments are 1 to ${state.config.limits.comment_max} characters.`);
            } else {
              showAlert(failureMessage(error));
            }
          }
        });
      });
      row.append(labelledField(`Reply to ${comment.author.name}`, input), send);
      input.focus();
    });
    row.append(reply);
    if (state.user && (comment.author.id === state.user.id || pin.owner.id === state.user.id)) {
      const remove = el('button', { type: 'button', class: 'secondary', text: 'Delete comment' });
      remove.addEventListener('click', () => {
        void (async () => {
          try {
            await api.del(`/api/comments/${comment.id}`);
            await refresh();
          } catch (error) {
            showAlert(failureMessage(error));
          }
        })();
      });
      row.append(remove);
    }
  }
  return row;
}

export function openEditPinDialog(
  pin: Pin,
  opener: HTMLElement | null,
  view: PinViewHandle,
): void {
  const dialog = openDialog({ label: 'Edit pin', opener });
  let version = pin.version;
  const title = el('input', { type: 'text', 'aria-label': 'Title', value: pin.title });
  const description = el('textarea', { 'aria-label': 'Description', rows: '3' });
  description.value = pin.description;
  const alt = el('input', { type: 'text', 'aria-label': 'Alt text', value: pin.alt });
  const source = el('input', {
    type: 'text',
    'aria-label': 'Source link',
    value: pin.source ?? '',
  });
  const save = el('button', { type: 'button', class: 'secondary', text: 'Save changes' });
  const remove = el('button', { type: 'button', class: 'danger', text: 'Delete pin' });
  const conflict = el('div', { class: 'conflict' });

  save.addEventListener('click', () => {
    clearFieldErrors(dialog.body);
    clear(conflict);
    void busy(save, 'Saving', async () => {
      try {
        const updated = await api.patch<Pin>(`/api/pins/${pin.id}`, {
          version,
          title: title.value,
          description: description.value,
          alt: alt.value,
          source: source.value.trim() === '' ? null : source.value,
        });
        version = updated.version;
        announce('Pin updated');
        dialog.close();
        await view.reload();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'version_conflict') {
          const latest = error.body.current as Pin;
          const alert = el('div', { role: 'alert', class: 'inline-alert' });
          alert.append(el('p', { text: 'This pin was changed somewhere else.' }));
          const load = el('button', { type: 'button', class: 'secondary', text: 'Load latest' });
          load.addEventListener('click', () => {
            version = latest.version;
            title.value = latest.title;
            description.value = latest.description;
            alt.value = latest.alt;
            source.value = latest.source ?? '';
            clear(conflict);
          });
          alert.append(load);
          conflict.append(alert);
        } else if (error instanceof ApiFailure && error.field === 'title') {
          fieldError(title, 'Add a title.');
        } else if (error instanceof ApiFailure && error.field === 'alt') {
          fieldError(alt, 'Add alt text so everyone knows what this pin shows.');
        } else if (error instanceof ApiFailure && error.field === 'source') {
          fieldError(source, 'Use a link that starts with http:// or https://.');
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });

  remove.addEventListener('click', () => {
    void busy(remove, 'Deleting', async () => {
      try {
        const operation = await api.del<{ id: number; deadline: string }>(`/api/pins/${pin.id}`);
        dialog.close();
        const { showBulkToast } = await import('./dialogs.js');
        showBulkToast('delete', 1, '', operation.id, operation.deadline);
        navigate('/');
      } catch (error) {
        showAlert(failureMessage(error));
      }
    });
  });

  dialog.body.append(
    conflict,
    labelledField('Title', title),
    labelledField('Description', description),
    labelledField('Alt text', alt),
    labelledField('Source link', source),
    el('div', { class: 'row' }, save, remove),
  );
  title.focus();
}

export interface ExhibitSession {
  pinId: number;
  handle: PinViewHandle;
  close(options?: { silent?: boolean }): void;
}

let openExhibit: ExhibitSession | null = null;
let returnPath: string | null = null;
let suppressedPath: string | null = null;

export function currentExhibit(): ExhibitSession | null {
  return openExhibit;
}

export function exhibitReturnPath(): string | null {
  return returnPath;
}

export function consumeSuppressed(path: string): boolean {
  if (suppressedPath !== null && suppressedPath === path) {
    suppressedPath = null;
    return true;
  }
  suppressedPath = null;
  return false;
}

/** Opening a pin from a grid pushes /pin/<id> and plays Lamp-carry. */
export function openPinFromGrid(pin: Pin, card: HTMLElement): ExhibitSession {
  returnPath = `${location.pathname}${location.search}`;
  window.history.pushState({ exhibit: pin.id }, '', `/pin/${pin.id}`);
  return openPinExhibit(pin, card);
}

const CARRY_MS = 520;
const CROSSFADE_MS = 120;

export function openPinExhibit(pin: Pin, card: HTMLElement): ExhibitSession {
  const scrollY = window.scrollY;
  const sourceImage = cardImage(card);
  const startRect = (sourceImage ?? card).getBoundingClientRect();
  const overlay = el('div', { class: 'exhibit-overlay' });
  const panel = el('div', {
    class: 'exhibit-panel-wrap',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': pin.title,
  });
  overlay.append(panel);

  const requestClose = (): void => {
    session.close();
    if (location.pathname === `/pin/${pin.id}` && returnPath !== null) {
      suppressedPath = returnPath;
      window.history.back();
    }
  };

  const handle = renderPinView(pin, {
    dialog: true,
    onClose: requestClose,
  });
  panel.append(handle.element);
  document.body.append(overlay);
  document.body.classList.add('exhibit-open');
  dimOtherCards(card, true);

  const exhibitImage = handle.element.querySelector('img');
  const reduced = reducedMotion();
  let ghost: HTMLElement | null = null;

  if (!reduced && sourceImage && exhibitImage) {
    const targetRect = exhibitImage.getBoundingClientRect();
    ghost = sourceImage.cloneNode(true) as HTMLElement;
    ghost.className = 'carry';
    ghost.style.position = 'fixed';
    ghost.style.left = `${startRect.left}px`;
    ghost.style.top = `${startRect.top}px`;
    ghost.style.width = `${startRect.width}px`;
    ghost.style.height = `${startRect.height}px`;
    ghost.style.transformOrigin = '0 0';
    ghost.style.zIndex = '60';
    document.body.append(ghost);
    exhibitImage.style.visibility = 'hidden';
    const animation = ghost.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)' },
        {
          transform: `translate(${targetRect.left - startRect.left}px, ${targetRect.top - startRect.top}px) scale(${targetRect.width / startRect.width}, ${targetRect.height / startRect.height})`,
        },
      ],
      { duration: CARRY_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    );
    void animation.finished.then(() => {
      exhibitImage.style.visibility = '';
      ghost?.remove();
      ghost = null;
    });
    panel.classList.add('text-in');
  } else {
    overlay.classList.add('crossfade');
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !document.querySelector('.overlay, .menu-overlay')) {
      event.preventDefault();
      requestClose();
    }
  };

  watch({ pin: pin.id });
  const offLive = onLive((message) => {
    if (message.type === 'counts' && message.pin_id === pin.id) {
      handle.refreshCounts(message);
    }
    if (message.type === 'pin_changed' && message.pin_id === pin.id) {
      void handle.reload();
    }
  });

  const session: ExhibitSession = {
    pinId: pin.id,
    handle,
    close: (options = {}) => {
      if (openExhibit !== session) return;
      openExhibit = null;
      offLive();
      unwatch({ pin: pin.id });
      document.removeEventListener('keydown', onKey, true);
      const finish = (): void => {
        overlay.remove();
        document.body.classList.remove('exhibit-open');
        dimOtherCards(null, false);
        window.scrollTo({ top: scrollY, behavior: 'auto' });
        if (card.isConnected) {
          const rect = card.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) {
            card.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
          card.focus({ preventScroll: true });
        }
      };
      if (!options.silent && !reducedMotion() && sourceImage && exhibitImage) {
        const endRect = sourceImage.getBoundingClientRect();
        const fromRect = exhibitImage.getBoundingClientRect();
        const back = exhibitImage.cloneNode(true) as HTMLElement;
        back.className = 'carry';
        back.style.position = 'fixed';
        back.style.left = `${fromRect.left}px`;
        back.style.top = `${fromRect.top}px`;
        back.style.width = `${fromRect.width}px`;
        back.style.height = `${fromRect.height}px`;
        back.style.transformOrigin = '0 0';
        back.style.zIndex = '60';
        back.style.visibility = 'visible';
        document.body.append(back);
        overlay.remove();
        dimOtherCards(null, false);
        const animation = back.animate(
          [
            { transform: 'translate(0px, 0px) scale(1, 1)' },
            {
              transform: `translate(${endRect.left - fromRect.left}px, ${endRect.top - fromRect.top}px) scale(${endRect.width / fromRect.width}, ${endRect.height / fromRect.height})`,
            },
          ],
          { duration: CARRY_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
        );
        void animation.finished.then(() => {
          back.remove();
          finish();
        });
        return;
      }
      if (!options.silent && reducedMotion()) {
        window.setTimeout(finish, CROSSFADE_MS);
        return;
      }
      finish();
    },
  };

  document.addEventListener('keydown', onKey, true);
  openExhibit = session;
  window.setTimeout(() => {
    const close = panel.querySelector<HTMLElement>('button');
    close?.focus();
  }, reduced ? CROSSFADE_MS : 40);
  return session;
}
