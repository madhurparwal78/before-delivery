import { STATUS_COPY } from '../../domain/copy.ts';
import { sanitiseStory } from '../../domain/story.ts';
import { formatCopenhagenInstant, parseInstant } from '../../domain/time.ts';
import { openDialog, setFocusAfterSuccess } from '../dialogs.ts';
import { announce, staleCopy } from '../feedback.ts';
import { DURATIONS, reducedMotion } from '../motion.ts';
import { request, RequestFailed } from '../net.ts';
import { control, onAction, onOpen, pageData, valueOf } from '../ui.ts';

interface Look {
  id: string;
  position: number;
  title: string;
}

interface LooksAnswer {
  items: Look[];
  orderVersion: number;
}

interface LookbookData {
  screen: 'lookbook';
  dropId: string;
  orderVersion: number;
}

export function startLookbookScreen(): void {
  const data = pageData<LookbookData>();
  let orderVersion = data.orderVersion;

  onOpen('open-add-look', (button) => openDialog('Add look', button));

  onAction(
    'upload-look',
    async () => {
      const input = document.querySelector<HTMLInputElement>('[data-field-control="lookImage"]');
      const form = new FormData();
      const file = input?.files?.[0];
      if (file !== undefined) form.set('file', file);
      form.set('title', valueOf('lookTitle'));
      form.set('altText', control('altText')?.value ?? '');
      return request<{ orderVersion: number }>(
        `/api/drops/${encodeURIComponent(data.dropId)}/looks`,
        { method: 'POST', formData: form },
      );
    },
    {
      region: 'Lookbook status',
      dialog: 'Add look',
      success: STATUS_COPY.lookAdded,
      own: (failure) =>
        failure.status === 413
          ? STATUS_COPY.lookTooLarge
          : failure.code === 'storage_unavailable'
            ? STATUS_COPY.lookStorageDown
            : null,
      map: (path) => (path === 'file' ? 'lookImage' : path === 'title' ? 'lookTitle' : path),
      reload: true,
    },
  );

  const list = document.querySelector<HTMLElement>('[data-looks-list]');
  if (list === null) return;

  const cards = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('[data-look-id]')];
  const renumber = (): void => {
    const all = cards();
    for (const [index, card] of all.entries()) {
      const counter = card.querySelector<HTMLElement>('[data-look-position]');
      if (counter !== null) counter.textContent = `${index + 1} / ${all.length}`;
    }
  };
  const titleOf = (card: HTMLElement): string =>
    card.querySelector<HTMLElement>('.look-card__title')?.textContent?.trim() ?? '';
  const positionOf = (card: HTMLElement): string => {
    const all = cards();
    return `${all.indexOf(card) + 1} / ${all.length}`;
  };

  const save = async (): Promise<void> => {
    const ids = cards().map((card) => card.dataset['lookId'] ?? '');
    try {
      const answer = await request<LooksAnswer>(
        `/api/drops/${encodeURIComponent(data.dropId)}/looks/order`,
        { method: 'PUT', body: { orderVersion, lookIds: ids } },
      );
      orderVersion = answer.orderVersion;
      announce('Lookbook status', STATUS_COPY.lookOrderSaved);
    } catch (error) {
      if (!(error instanceof RequestFailed)) return;
      if (error.failure.status === 412) {
        const current = error.failure.current as LooksAnswer | undefined;
        if (current !== undefined) {
          orderVersion = current.orderVersion;
          rollbackOrder(list, current.items);
          renumber();
        }
        announce(
          'Lookbook status',
          `${staleCopy(error.failure)} ${STATUS_COPY.lookStaleTail}`,
        );
        return;
      }
      announce('Lookbook status', error.failure.message);
    }
  };

  let lifted: HTMLElement | null = null;
  let startIndex = 0;

  list.addEventListener('keydown', (event) => {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-look-move]');
    if (handle === null || handle === undefined) return;
    const card = handle.closest<HTMLElement>('[data-look-id]');
    if (card === null) return;

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (lifted === null) {
        lifted = card;
        startIndex = cards().indexOf(card);
        card.dataset['lifted'] = 'true';
        announce('Lookbook status', STATUS_COPY.lookLift(titleOf(card), positionOf(card)));
        return;
      }
      delete card.dataset['lifted'];
      lifted = null;
      announce('Lookbook status', STATUS_COPY.lookDrop(titleOf(card), positionOf(card)));
      void save();
      return;
    }

    if (event.key === 'Escape' && lifted !== null) {
      event.preventDefault();
      const all = cards();
      const reference = all[startIndex] ?? null;
      list.insertBefore(card, reference);
      delete card.dataset['lifted'];
      lifted = null;
      renumber();
      announce('Lookbook status', STATUS_COPY.lookCancel(titleOf(card), positionOf(card)));
      handle.focus();
      return;
    }

    const earlier = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const later = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    if (lifted === null || (!earlier && !later)) return;
    event.preventDefault();
    const all = cards();
    const index = all.indexOf(card);
    const target = earlier ? index - 1 : index + 1;
    if (target < 0 || target >= all.length) return;
    const neighbour = all[target] as HTMLElement;
    slide(card, neighbour, () => {
      if (earlier) list.insertBefore(card, neighbour);
      else list.insertBefore(neighbour, card);
    });
    renumber();
    announce('Lookbook status', STATUS_COPY.lookMove(titleOf(card), positionOf(card)));
    handle.focus();
  });

  let dragging: HTMLElement | null = null;
  let holdTimer = 0;
  list.addEventListener('pointerdown', (event) => {
    const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-look-move]');
    if (handle === null || handle === undefined) return;
    const card = handle.closest<HTMLElement>('[data-look-id]');
    if (card === null) return;
    const begin = (): void => {
      dragging = card;
      card.dataset['lifted'] = 'true';
      announce('Lookbook status', STATUS_COPY.lookLift(titleOf(card), positionOf(card)));
    };
    if (event.pointerType === 'touch') {
      holdTimer = window.setTimeout(begin, 333);
    } else {
      begin();
    }
    handle.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', (event) => {
    if (dragging === null) return;
    const under = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-look-id]');
    if (under === null || under === undefined || under === dragging) return;
    const all = cards();
    const moveEarlier = all.indexOf(under) < all.indexOf(dragging);
    slide(dragging, under, () => {
      if (moveEarlier) list.insertBefore(dragging as HTMLElement, under);
      else list.insertBefore(under, dragging as HTMLElement);
    });
    renumber();
  });
  list.addEventListener('pointerup', () => {
    window.clearTimeout(holdTimer);
    if (dragging === null) return;
    const card = dragging;
    delete card.dataset['lifted'];
    dragging = null;
    announce('Lookbook status', STATUS_COPY.lookDrop(titleOf(card), positionOf(card)));
    void save();
  });
}

function slide(card: HTMLElement, neighbour: HTMLElement, reorder: () => void): void {
  if (reducedMotion()) {
    reorder();
    return;
  }
  const before = card.getBoundingClientRect();
  const otherBefore = neighbour.getBoundingClientRect();
  reorder();
  for (const [node, box] of [
    [card, before],
    [neighbour, otherBefore],
  ] as const) {
    const after = node.getBoundingClientRect();
    node.animate(
      [
        { transform: `translate(${box.left - after.left}px, ${box.top - after.top}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: DURATIONS.state, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
}

function rollbackOrder(list: HTMLElement, items: readonly Look[]): void {
  for (const look of items) {
    const card = list.querySelector<HTMLElement>(`[data-look-id="${look.id}"]`);
    if (card !== null) list.append(card);
  }
}

interface StoryData {
  screen: 'story';
  dropId: string;
  version: number;
}

export function startStoryScreen(): void {
  const data = pageData<StoryData>();
  let version = data.version;
  const editor = document.querySelector<HTMLElement>('[data-story-editor]');
  if (editor === null) return;

  const commands: Record<string, () => void> = {
    'format-h2': () => document.execCommand('formatBlock', false, 'h2'),
    'format-h3': () => document.execCommand('formatBlock', false, 'h3'),
    'format-bold': () => document.execCommand('bold'),
    'format-italic': () => document.execCommand('italic'),
    'format-ul': () => document.execCommand('insertUnorderedList'),
    'format-ol': () => document.execCommand('insertOrderedList'),
  };
  for (const [action, run] of Object.entries(commands)) {
    document.querySelector<HTMLElement>(`[data-action="${action}"]`)?.addEventListener('click', () => {
      editor.focus();
      run();
    });
  }

  onOpen('open-add-link', (button) => openDialog('Add link', button));
  setFocusAfterSuccess('Add link', () => editor);
  onOpen('add-link', () => {
    const address = valueOf('linkAddress');
    const dialog = document.querySelector<HTMLDialogElement>('[data-dialog="Add link"]');
    dialog?.close();
    editor.focus();
    if (address !== '') document.execCommand('createLink', false, address);
  });

  onAction(
    'save-story',
    async () =>
      request<{ version: number; savedAt: string }>(
        `/api/drops/${encodeURIComponent(data.dropId)}/story`,
        { method: 'PUT', body: { version, html: sanitiseStory(editor.innerHTML) } },
      ),
    {
      region: 'Story status',
      success: (result) => {
        const saved = result as { savedAt: string };
        const at = parseInstant(saved.savedAt);
        return STATUS_COPY.storySaved(at === null ? '' : formatCopenhagenInstant(at));
      },
      own: (failure) => {
        if (failure.status !== 412) return null;
        const current = failure.current as { version: number } | undefined;
        if (current !== undefined) version = current.version;
        return `${staleCopy(failure)} ${STATUS_COPY.storyStaleTail}`;
      },
      after: (result) => {
        version = (result as { version: number }).version;
      },
    },
  );

  onOpen('open-publish', (button) => openDialog('Publish story', button));
  onAction(
    'publish-story',
    async () =>
      request<{ version: number }>(
        `/api/drops/${encodeURIComponent(data.dropId)}/story/publish`,
        { method: 'POST', body: { version } },
      ),
    {
      region: 'Story status',
      dialog: 'Publish story',
      success: STATUS_COPY.storyPublished,
      own: (failure) => {
        if (failure.status !== 412) return null;
        const current = failure.current as { version: number } | undefined;
        if (current !== undefined) version = current.version;
        return `${staleCopy(failure)} ${STATUS_COPY.storyStaleTail}`;
      },
      after: (result) => {
        version = (result as { version: number }).version;
      },
    },
  );
}

interface PreviewsData {
  screen: 'previews';
  dropId: string;
}

export function startPreviewsScreen(): void {
  const data = pageData<PreviewsData>();
  let chosen = '';
  let chosenName = '';

  onOpen('open-send-preview', (button) => openDialog('Send preview', button));

  onAction(
    'send-preview',
    async () => {
      const editorName = valueOf('editorName');
      await request(`/api/drops/${encodeURIComponent(data.dropId)}/previews`, {
        method: 'POST',
        body: { editorName, editorEmail: valueOf('editorEmail'), outlet: valueOf('outlet') },
      });
      return editorName;
    },
    {
      region: 'Preview status',
      dialog: 'Send preview',
      focusAfter: '[data-action="open-send-preview"]',
      success: (result) => STATUS_COPY.previewCreated(result as string),
      reload: true,
    },
  );

  for (const [action, dialogName] of [
    ['open-revoke', 'Revoke link'],
    ['open-regenerate', 'Regenerate link'],
  ] as const) {
    document.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        `[data-action="${action}"]`,
      );
      if (button === null || button === undefined) return;
      chosen = button.dataset['previewId'] ?? '';
      chosenName =
        button
          .closest('tr')
          ?.querySelector('td')
          ?.textContent?.trim() ?? '';
      openDialog(dialogName, button);
    });
  }

  onAction(
    'revoke-link',
    async () => request(`/api/previews/${encodeURIComponent(chosen)}/revoke`, { method: 'POST' }),
    {
      region: 'Preview status',
      dialog: 'Revoke link',
      success: STATUS_COPY.previewRevoked,
      own: (failure) => (failure.code === 'preview_revoked' ? failure.message : null),
      reload: true,
    },
  );

  onAction(
    'regenerate-link',
    async () =>
      request(`/api/previews/${encodeURIComponent(chosen)}/regenerate`, { method: 'POST' }),
    {
      region: 'Preview status',
      dialog: 'Regenerate link',
      success: () => STATUS_COPY.previewRegenerated(chosenName),
      own: (failure) => (failure.code === 'preview_revoked' ? failure.message : null),
      reload: true,
    },
  );
}
