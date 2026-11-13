import type { ConversationRecord } from '../../shared/types.js';
import { copy, say } from '../copy.js';
import {
  conversationList,
  lastLetterLine,
  peerName,
  previewLine,
  requestCount,
  state,
} from '../data/store.js';
import { contactAvatar } from './avatar.js';
import { el, sheet } from './dom.js';
import { postmark, type Postmark } from './postmark.js';

interface RowView {
  item: HTMLElement;
  name: HTMLElement;
  line: HTMLElement;
  marks: HTMLElement;
  plate: HTMLElement;
  mark: Postmark | null;
  photoFor: string | null;
}

export interface ListView {
  element: HTMLElement;
  update: () => void;
}

export function emptyState(text: string): HTMLElement {
  const { outer, inner } = sheet({ class: 'empty-sheet' });
  inner.append(el('p', { class: 'empty-copy', testid: 'empty-state', text }));
  return outer;
}

function buildRow(record: ConversationRecord, testid: string): RowView {
  const name = el('span', { class: 'row-name' });
  const line = el('span', { class: 'row-line' });
  const marks = el('span', { class: 'row-marks' });
  const plate = el('span', { class: 'row-plate' });
  const link = el(
    'a',
    {
      class: 'row-link',
      testid,
      data: { conversationId: record.id },
      attrs: { href: `/letters/${record.id}` },
    },
    [plate, el('span', { class: 'row-body' }, [name, line, marks])],
  );
  return {
    item: el('li', { class: 'row' }, [link]),
    name,
    line,
    marks,
    plate,
    mark: null,
    photoFor: null,
  };
}

function paintRow(view: RowView, record: ConversationRecord): void {
  view.name.textContent = peerName(record);
  const letter = lastLetterLine(record.id);
  view.line.textContent = letter === null ? '' : previewLine(letter);

  const profile = state.peerProfiles.get(record.peer.id) ?? null;
  const photoId = profile?.photo?.blob_id ?? null;
  if (view.photoFor !== photoId || view.plate.childElementCount === 0) {
    view.photoFor = photoId;
    view.plate.replaceChildren(contactAvatar(profile));
  }

  view.marks.replaceChildren();
  if (letter !== null) {
    view.mark = postmark(letter);
    view.marks.append(view.mark.element);
  }
  if (record.muted_until !== null) {
    view.marks.append(el('span', { class: 'muted-mark', text: 'Muted' }));
  }
  if (record.unread > 0) {
    view.marks.append(
      el('span', {
        class: 'unread',
        testid: 'unread-badge',
        text: record.unread > 99 ? '99+' : String(record.unread),
      }),
    );
  }
}

function listView(options: {
  status: 'accepted' | 'request';
  label: string;
  testid: string;
  empty: string;
  withRequestsLink: boolean;
}): ListView {
  const element = el('div', { class: 'list-screen' });
  const requestsHolder = el('div', { class: 'requests-holder' });
  const list = el('ul', {
    class: 'rows',
    attrs: { role: 'list', 'aria-label': options.label },
  });
  const emptyHolder = el('div', { class: 'empty-holder' });
  element.append(requestsHolder, list, emptyHolder);
  const rows = new Map<string, RowView>();

  function update(): void {
    const records = conversationList(options.status);

    requestsHolder.replaceChildren();
    if (options.withRequestsLink) {
      const count = requestCount();
      if (count > 0) {
        requestsHolder.append(
          el('a', {
            class: 'requests-link',
            text: say.requestsLink(count),
            attrs: { href: '/requests' },
          }),
        );
      }
    }

    emptyHolder.replaceChildren();
    list.hidden = records.length === 0;
    if (records.length === 0) {
      rows.clear();
      list.replaceChildren();
      emptyHolder.append(emptyState(options.empty));
      return;
    }

    const seen = new Set<string>();
    for (const record of records) {
      seen.add(record.id);
      let view = rows.get(record.id);
      if (view === undefined) {
        view = buildRow(record, options.testid);
        rows.set(record.id, view);
      }
      paintRow(view, record);
      list.append(view.item);
    }
    for (const [id, view] of rows) {
      if (seen.has(id)) continue;
      view.item.remove();
      rows.delete(id);
    }
  }

  update();
  return { element, update };
}

export function chatsView(): ListView {
  return listView({
    status: 'accepted',
    label: 'Conversations',
    testid: 'conversation-row',
    empty: copy.empty.chats,
    withRequestsLink: true,
  });
}

export function requestsView(): ListView {
  return listView({
    status: 'request',
    label: 'Letter requests',
    testid: 'request-row',
    empty: copy.empty.requests,
    withRequestsLink: false,
  });
}
