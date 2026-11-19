import { el } from './dom.js';
import type { Suggestion, Thread, PersonShape } from '../shared/types.js';

export interface MarginModel {
  orphans: (Suggestion | Thread)[];
  fileCards: (Suggestion | Thread)[];
}

/** The review order of one file's cards, merged by from then creation then id. */
export function documentOrder(suggestions: Suggestion[], threads: Thread[], fileId: string): (Suggestion | Thread)[] {
  const items: (Suggestion | Thread)[] = [
    ...suggestions.filter((s) => s.fileId === fileId && s.status !== 'orphaned'),
    ...threads.filter((t) => t.fileId === fileId && !t.orphaned),
  ];
  items.sort((x, y) => {
    const fx = x.from ?? 0;
    const fy = y.from ?? 0;
    if (fx !== fy) return fx - fy;
    const xIsSuggestion = 'inserted' in x;
    const yIsSuggestion = 'inserted' in y;
    if (xIsSuggestion !== yIsSuggestion) return xIsSuggestion ? -1 : 1;
    const cx = createdAt(x);
    const cy = createdAt(y);
    if (cx !== cy) return cx < cy ? -1 : 1;
    return x.id < y.id ? -1 : 1;
  });
  return items;
}

function createdAt(item: Suggestion | Thread): string {
  if ('inserted' in item) return item.createdAt;
  return item.comments[0]?.createdAt ?? '';
}

export function orphansOf(suggestions: Suggestion[], threads: Thread[]): (Suggestion | Thread)[] {
  const orphanSuggestions = suggestions.filter((s) => s.status === 'orphaned');
  const orphanThreads = threads.filter((t) => t.orphaned && t.status !== 'resolved');
  return [...orphanSuggestions, ...orphanThreads];
}

export function isSuggestion(item: Suggestion | Thread): item is Suggestion {
  return 'inserted' in item;
}

export function itemAuthor(item: Suggestion | Thread): PersonShape {
  if (isSuggestion(item)) return item.author;
  return item.comments[0]?.author ?? { id: '', displayName: '', handle: '' };
}

export function stubText(item: Suggestion | Thread): string {
  if (isSuggestion(item)) {
    if (item.status === 'accepted') return `Accepted by ${item.resolvedBy?.displayName ?? ''}`;
    return `Rejected by ${item.resolvedBy?.displayName ?? ''}`;
  }
  return `Resolved by ${item.resolvedBy?.displayName ?? ''}`;
}

/** Card component: one suggestion or thread in the margin. */
export interface CardCallbacks {
  onAccept?: (s: Suggestion) => void;
  onReject?: (s: Suggestion) => void;
  onReply?: (t: Thread, body: string) => void;
  onResolve?: (t: Thread) => void;
  onFocus?: (item: Suggestion | Thread) => void;
  canDecide: boolean;
  canReply: boolean;
  canResolve: boolean;
  shareMode: boolean;
  focusedId?: string;
  pendingId?: string;
}

export function cardNode(item: Suggestion | Thread, cbs: CardCallbacks): HTMLElement {
  const isS = isSuggestion(item);
  const author = itemAuthor(item);
  const article = el('article', {
    class: `card${cbs.focusedId === item.id ? ' focused' : ''}`,
    'aria-label': isS ? `Suggestion by ${author.displayName}` : `Comment by ${author.displayName}`,
    tabindex: '-1',
    onclick: () => cbs.onFocus?.(item),
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      if (kev.key === 'Enter' || kev.key === ' ') {
        kev.preventDefault();
        cbs.onFocus?.(item);
      } else if (kev.key === 'ArrowDown' || kev.key === 'ArrowUp') {
        kev.preventDefault();
        const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card-id]'))
          .filter((n) => !n.dataset.stub);
        const idx = cards.findIndex((n) => n.dataset.cardId === item.id);
        const next = kev.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (next >= 0 && next < cards.length) cards[next].focus();
      }
    },
    'data-card-id': item.id,
    id: `card-${item.id}`,
  }) as HTMLElement;
  article.setAttribute('data-stub', '');
  const decided = isS ? item.status === 'accepted' || item.status === 'rejected' : item.status === 'resolved';
  if (decided) {
    article.dataset.stub = 'true';
    article.appendChild(el('p', { class: 'stub' }, stubText(item)));
    return article;
  }
  article.dataset.stub = 'false';

  const head = el('h3', {}, `${author.displayName} `,
    cbs.shareMode ? el('span', { class: 'meta' }, '') : el('span', { class: 'meta' }, `@${author.handle}`));
  article.appendChild(head);

  const quoted = isS ? item.deleted : quoteOf(item);
  article.appendChild(el('blockquote', { class: 'quote' }, quoted));

  if (isS) {
    article.appendChild(el('p', { class: 'diff' },
      el('del', { class: 'suggest-del' }, item.deleted),
      ' ',
      el('ins', { class: 'suggest-ins' }, item.inserted),
    ));
    const actions = el('div', { class: 'actions' });
    if (cbs.canDecide && !cbs.shareMode) {
      actions.appendChild(el('button', {
        disabled: cbs.pendingId === item.id,
        onclick: () => cbs.onAccept?.(item),
      }, 'Accept'));
      actions.appendChild(el('button', {
        disabled: cbs.pendingId === item.id,
        onclick: () => cbs.onReject?.(item),
      }, 'Reject'));
    }
    if (actions.childNodes.length > 0) article.appendChild(actions);
    if (cbs.pendingId === item.id) {
      article.appendChild(el('p', { class: 'meta' }, isS ? 'Accepting suggestion…' : 'Rejecting suggestion…'));
    }
    return article;
  }

  const list = el('ul', { class: 'comments-list' });
  for (const comment of item.comments) {
    list.appendChild(el('li', {},
      el('div', { class: 'meta' }, cbs.shareMode ? comment.author.displayName : `${comment.author.displayName} @${comment.author.handle}`),
      el('div', { class: 'comment-body' }, comment.body),
    ));
  }
  article.appendChild(list);

  if (!cbs.shareMode) {
    if (cbs.canReply) {
      const replyId = `reply-${item.id}`;
      const textarea = el('textarea', {
        id: replyId, 'aria-label': 'Reply', rows: '2', placeholder: 'Reply',
      }) as HTMLTextAreaElement;
      const postBtn = el('button', { onclick: () => cbs.onReply?.(item, textarea.value) }, 'Post reply');
      article.appendChild(el('div', { class: 'field' },
        textarea,
        postBtn,
      ));
    }
    if (cbs.canResolve) {
      article.appendChild(el('div', { class: 'actions' },
        el('button', { onclick: () => cbs.onResolve?.(item) }, 'Resolve thread'),
      ));
    }
  }
  return article;
}

function quoteOf(t: Thread): string {
  return t.quote;
}
