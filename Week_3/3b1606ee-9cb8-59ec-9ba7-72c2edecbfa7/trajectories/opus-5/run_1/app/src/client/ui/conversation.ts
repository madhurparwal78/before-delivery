import { MAX_LETTER_CHARS } from '../../shared/scheme.js';
import type {
  AttachmentDescriptor,
  ConversationRecord,
  LetterBody,
} from '../../shared/types.js';
import { copy, megabytes, say } from '../copy.js';
import { api } from '../data/api.js';
import { enqueue, pendingLetter, resumeFor, retryUpload } from '../data/outbox.js';
import { preparePhoto, WrongPhotoType } from '../data/photos.js';
import {
  conversationOf,
  emit,
  forgetLetter,
  letterById,
  lettersOf,
  on,
  peerName,
  putLetter,
  state,
  type LocalLetter,
} from '../data/store.js';
import { loadConversationLetters, sendProfileKey } from '../data/sync.js';
import { overCap, sealForUpload } from '../data/uploads.js';
import { countCodePoints } from '../format.js';
import { button, el, onLongPress, openDialog, sheet, withBusy } from './dom.js';
import { fileLetter, photoLetter } from './letterbody.js';
import { announce } from './live.js';
import { foldAndSend, setLoading, unfold } from './motion.js';
import { postmark, strike, type Postmark } from './postmark.js';
import { navigate } from './router.js';
import { openContactCard, sealNumberDialog } from './contactcard.js';
import { moveRowToTop, rowRect } from './rows.js';

interface LetterView {
  article: HTMLElement;
  mark: Postmark;
  state: string;
  signature: string;
  body: HTMLElement;
}

export function conversationScreen(conversationId: string): HTMLElement {
  const record = conversationOf(conversationId);
  const pane = el('div', { class: 'conversation-screen' });
  if (record === null) {
    const { outer, inner } = sheet({ class: 'empty-sheet' });
    inner.append(
      el('p', { class: 'empty-copy', testid: 'empty-state', text: copy.conversationNotFound }),
    );
    pane.append(outer);
    return pane;
  }

  const opened: ConversationRecord = record;
  const views = new Map<string, LetterView>();
  const { outer, inner } = sheet({ class: 'letter-sheet' });
  const heading = el('h2', { class: 'conversation-name' });
  const sealStatus = el('p', { class: 'seal-status' });
  const headerButtons = el('div', { class: 'header-buttons' });
  const header = el('header', { class: 'conversation-header' }, [
    headerButtons,
    el('div', {}, [heading, sealStatus]),
  ]);
  const list = el('ul', { class: 'letters', attrs: { role: 'list', 'aria-label': 'Letters' } });
  const sealChangeRow = el('li', { class: 'seal-change-row' });
  const empty = el('p', {
    class: 'empty-copy',
    testid: 'empty-state',
    text: copy.empty.conversation,
  });
  const stub = el('div', { class: 'stub-holder' });
  const foot = el('div', { class: 'composer-holder' });
  const snackbarHolder = el('div', { class: 'snackbar-holder' });

  inner.append(header, list, empty, stub, foot, snackbarHolder);
  pane.append(outer);

  const composer = buildComposer(conversationId);
  let footMode: 'request' | 'blocked' | 'composer' | null = null;
  let stubFor: string | null = null;

  function current(): ConversationRecord {
    return conversationOf(conversationId) ?? opened;
  }

  function paintHeader(): void {
    const conversation = current();
    const name = peerName(conversation);
    heading.textContent = name;
    sealStatus.textContent =
      conversation.peer.seal === 'verified'
        ? 'Verified'
        : conversation.peer.seal === 'changed'
          ? 'Seal number changed'
          : 'Not verified';
    if (headerButtons.childElementCount === 0) {
      const back = button('Back to letters', () => navigate('/letters'), {
        class: 'back-button narrow-only',
      });
      const card = button('Contact card', () => openContactCard(conversation.id, card), {
        class: 'card-button not-wide',
      });
      headerButtons.append(back, card);
    }
  }

  function paintStub(): void {
    const conversation = current();
    const name = peerName(conversation);
    const wanted = `${conversation.peer.seal}|${name}`;
    // Rebuilding the stub would blur its buttons, so it is rebuilt only when it changes.
    if (wanted === stubFor) return;
    stubFor = wanted;
    stub.replaceChildren();
    if (conversation.peer.seal !== 'changed') return;
    const compare = button('Compare seal numbers', () =>
      sealNumberDialog(conversation.id, compare),
    );
    const accept = button('Accept new seal number', () => {
      void withBusy(accept, async () => {
        await api.seal(conversation.peer.id, conversation.peer.key_id, false);
        const fresh = await api.conversation(conversation.id);
        state.conversations.set(fresh.id, fresh);
        emit('conversations');
        await sendProfileKey(fresh);
        await resumeFor(conversation.id);
        composer.focus();
      });
    }, { class: 'ink-button' });
    stub.append(
      el(
        'section',
        {
          class: 'key-change',
          testid: 'key-change-warning',
          attrs: { role: 'region', 'aria-label': 'Seal number changed' },
        },
        [el('p', { text: say.keyChangeStub(name) }), compare, accept],
      ),
    );
  }

  function paintFoot(): void {
    const conversation = current();
    const mode = conversation.status === 'request'
      ? 'request'
      : conversation.blocked
        ? 'blocked'
        : 'composer';
    // Re-inserting the composer would blur it, so the foot is rebuilt only when it changes.
    if (mode === footMode) return;
    footMode = mode;
    foot.replaceChildren();
    if (conversation.status === 'request') {
      foot.append(requestActions(conversation));
      return;
    }
    if (conversation.blocked) {
      const unblock = button('Unblock', () => {
        void withBusy(unblock, async () => {
          await api.unblock(conversation.peer.id);
          state.conversations.set(
            conversation.id,
            await api.conversation(conversation.id),
          );
          emit('conversations');
        });
      }, { class: 'ink-button' });
      foot.append(
        el('div', { class: 'blocked-foot' }, [
          el('p', { text: say.blockedConversation(peerName(conversation)) }),
          unblock,
        ]),
      );
      return;
    }
    foot.append(composer.element);
  }

  function requestActions(conversation: ConversationRecord): HTMLElement {
    const accept = button('Accept', () => {
      void withBusy(accept, async () => {
        const updated = await api.accept(conversation.id);
        state.conversations.set(updated.id, updated);
        emit('conversations');
        await sendProfileKey(updated);
      });
    }, { class: 'ink-button' });
    const remove = button('Delete', () => {
      void withBusy(remove, async () => {
        await api.deleteConversation(conversation.id);
        state.conversations.delete(conversation.id);
        emit('conversations');
        navigate('/letters');
      });
    });
    const block = button('Block', () => {
      void withBusy(block, async () => {
        await api.block(conversation.peer.id);
        state.conversations.delete(conversation.id);
        emit('conversations');
        navigate('/letters');
      });
    });
    return el(
      'section',
      {
        class: 'request-actions',
        attrs: { role: 'region', 'aria-label': 'Letter request' },
      },
      [accept, remove, block],
    );
  }

  function letterArticle(letter: LocalLetter): LetterView {
    const mark = postmark(letter);
    const body = el('div', { class: 'letter-body' });
    const actions = button('Letter actions', () => openLetterActions(letter.id, actions));
    const article = el(
      'article',
      {
        class: 'letter',
        testid: 'letter',
        data: {
          letterId: letter.id,
          direction: letter.direction,
          delivery: letter.state,
        },
      },
      [body, el('div', { class: 'letter-foot' }, [mark.element, actions])],
    );
    onLongPress(article, () => openLetterActions(letter.id, actions));
    const view: LetterView = {
      article,
      mark,
      state: letter.state,
      signature: signatureOf(letter),
      body,
    };
    paintBody(view, letter);
    return view;
  }

  function signatureOf(letter: LocalLetter): string {
    return [
      letter.retractedAt ?? '',
      letter.uploading ? 'up' : '',
      letter.failure ?? '',
      letter.refused ?? '',
      letter.body === null ? 'sealed' : letter.body.kind,
      letter.body !== null && 'text' in letter.body ? letter.body.text : '',
    ].join('|');
  }

  function paintBody(view: LetterView, letter: LocalLetter): void {
    const conversation = current();
    const name = peerName(conversation);
    view.body.replaceChildren();

    if (letter.retractedAt !== null) {
      view.body.append(
        el('p', {
          class: 'letter-text retracted',
          text:
            letter.direction === 'sent'
              ? copy.deletedForEveryoneSent
              : copy.deletedForEveryoneReceived,
        }),
      );
      return;
    }

    const letterBody = letter.body;
    if (letterBody === null) {
      view.body.append(el('p', { class: 'letter-text', text: '' }));
      return;
    }

    if (letterBody.kind === 'image') {
      view.body.append(photoLetter(letter, letterBody.attachment, name));
      if (letterBody.text !== '') {
        view.body.append(el('p', { class: 'letter-text', text: letterBody.text }));
      }
    } else if (letterBody.kind === 'file') {
      view.body.append(fileLetter(letterBody.attachment));
    } else if (letterBody.kind === 'text') {
      view.body.append(el('p', { class: 'letter-text', text: letterBody.text }));
    }

    if (letter.uploading) {
      view.body.append(el('p', { class: 'letter-note', text: 'Uploading...' }));
    }
    if (letter.state === 'failed' && letter.failure === 'upload') {
      const retry = button('Retry upload', () => void retryUpload(letter.id));
      view.body.append(el('p', { class: 'letter-note', text: copy.uploadFailed }), retry);
    }
    if (letter.refused !== null) {
      view.body.append(el('p', { class: 'letter-note', text: letter.refused }));
    }
  }

  function paintLetters(): void {
    const letters = lettersOf(conversationId).filter(
      (letter) => letter.letterClass === 'letter',
    );
    empty.hidden = letters.length > 0;
    for (const [id, view] of views) {
      if (!letters.some((letter) => letter.id === id)) {
        view.article.closest('li')?.remove();
        views.delete(id);
      }
    }
    let newestUnopened: LetterView | null = null;
    for (const letter of letters) {
      const existing = views.get(letter.id);
      if (existing === undefined) {
        const view = letterArticle(letter);
        views.set(letter.id, view);
        list.append(el('li', { class: 'letter-item' }, [view.article]));
        if (letter.direction === 'received') newestUnopened = view;
        continue;
      }
      existing.article.dataset['delivery'] = letter.state;
      const changed = existing.state !== letter.state;
      existing.mark.update(letter, changed && letter.direction === 'sent');
      existing.state = letter.state;
      const signature = signatureOf(letter);
      if (signature !== existing.signature) {
        existing.signature = signature;
        paintBody(existing, letter);
      }
    }
    if (newestUnopened !== null) unfold(newestUnopened.article);

    const conversation = current();
    sealChangeRow.replaceChildren();
    if (conversation.peer.seal === 'changed') {
      sealChangeRow.append(el('p', { text: say.keyChangeRow(peerName(conversation)) }));
      list.append(sealChangeRow);
    } else {
      sealChangeRow.remove();
    }
  }

  function openLetterActions(letterId: string, opener: HTMLButtonElement): void {
    const letter = letterById(letterId);
    if (letter === null) return;
    openDialog({
      label: 'Letter actions',
      opener,
      build: (dialog) => {
        const forMe = button('Delete for me', () => {
          dialog.close();
          void deleteForMe(letterId);
        });
        const cancel = button('Cancel', () => dialog.close());
        const holder = el('div', { class: 'dialog-actions' }, [forMe, cancel]);
        void api
          .letter(letterId)
          .then((fresh) => {
            if (!fresh.can_retract) return;
            const forEveryone = button('Delete for everyone', () => {
              dialog.close();
              void api.retract(letterId);
            });
            holder.insertBefore(forEveryone, cancel);
          })
          .catch(() => undefined);
        return [holder];
      },
    });
  }

  async function deleteForMe(letterId: string): Promise<void> {
    const letter = letterById(letterId);
    if (letter === null) return;
    letter.deletedForMe = true;
    emit('letter', letter);
    announce(copy.letterDeleted);

    let undone = false;
    const undo = button('Undo', () => {
      undone = true;
      letter.deletedForMe = false;
      emit('letter', letter);
      announce(copy.letterRestored);
      snackbarHolder.replaceChildren();
      composer.focus();
    });
    snackbarHolder.replaceChildren(
      el('div', { class: 'snackbar', testid: 'snackbar' }, [
        el('span', { text: copy.letterDeleted }),
        undo,
      ]),
    );
    window.setTimeout(() => {
      snackbarHolder.replaceChildren();
      if (undone) return;
      void forgetLetter(letter);
    }, state.config.timers.undo_ms);
  }

  function buildComposer(id: string): {
    element: HTMLElement;
    focus: () => void;
  } {
    const input = el('textarea', {
      class: 'composer-input',
      attrs: { 'aria-label': 'Write a letter', rows: '3' },
    });
    const pinned = el('div', { class: 'pinned-holder' });
    const errors = el('div', { class: 'slip-holder' });
    const photoInput = el('input', {
      class: 'file-input',
      attrs: {
        type: 'file',
        'aria-label': 'Photo',
        accept: 'image/jpeg,image/png,image/webp',
        tabindex: '-1',
      },
    });
    const fileInput = el('input', {
      class: 'file-input',
      attrs: { type: 'file', 'aria-label': 'File', tabindex: '-1' },
    });
    const send = button('Send', () => void submit(), { class: 'ink-button send' });
    let attachment: {
      descriptor: AttachmentDescriptor;
      blobId: string;
      sealed: Uint8Array;
      kind: 'image' | 'file';
    } | null = null;
    let sealing = false;

    function setError(text: string | null): void {
      errors.replaceChildren();
      if (text !== null) errors.append(el('p', { class: 'slip', text }));
    }

    input.addEventListener('input', () => {
      const tooLong = countCodePoints(input.value) > MAX_LETTER_CHARS;
      send.disabled = tooLong;
      setError(tooLong ? copy.tooLong : null);
    });

    input.addEventListener('keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.key !== 'Enter' || key.shiftKey) return;
      key.preventDefault();
      void submit();
    });

    photoInput.addEventListener('change', () => {
      const file = photoInput.files?.[0];
      photoInput.value = '';
      if (file === undefined) return;
      void preparePhoto(file)
        .then(async (prepared) => {
          if (overCap(prepared.bytes.length)) {
            setError(say.fileOverCap(megabytes(state.config.attachment_max_bytes)));
            return;
          }
          const upload = await sealForUpload(prepared.bytes, file.name, prepared.type, {
            width: prepared.width,
            height: prepared.height,
            thumb: prepared.thumb,
          });
          attachment = {
            descriptor: upload.descriptor,
            blobId: upload.blobId,
            sealed: upload.sealed,
            kind: 'image',
          };
          setError(null);
          pinned.replaceChildren(el('p', { class: 'pinned', text: file.name }));
        })
        .catch((error: unknown) => {
          setError(error instanceof WrongPhotoType ? copy.wrongPhotoType : copy.somethingWrong);
        });
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file === undefined) return;
      if (overCap(file.size)) {
        setError(say.fileOverCap(megabytes(state.config.attachment_max_bytes)));
        return;
      }
      void file.arrayBuffer().then(async (buffer) => {
        const upload = await sealForUpload(
          new Uint8Array(buffer),
          file.name,
          file.type === '' ? 'application/octet-stream' : file.type,
        );
        attachment = {
          descriptor: upload.descriptor,
          blobId: upload.blobId,
          sealed: upload.sealed,
          kind: 'file',
        };
        setError(null);
        pinned.replaceChildren(el('p', { class: 'pinned', text: file.name }));
      });
    });

    async function submit(): Promise<void> {
      if (sealing) return;
      const text = input.value;
      if (text.trim() === '' && attachment === null) return;
      if (countCodePoints(text) > MAX_LETTER_CHARS) return;
      sealing = true;
      const chosen = attachment;
      attachment = null;
      input.value = '';
      pinned.replaceChildren();
      setError(null);
      input.focus();

      const letterId = crypto.randomUUID();
      const body: LetterBody =
        chosen === null
          ? { v: 1, kind: 'text', text }
          : chosen.kind === 'image'
            ? { v: 1, kind: 'image', text, attachment: chosen.descriptor }
            : { v: 1, kind: 'file', text: '', attachment: chosen.descriptor };

      const letter = pendingLetter(letterId, id, body, 'letter', chosen !== null);
      await putLetter(letter);
      sealing = false;

      moveRowToTop(id);
      const target = rowRect(id) ?? list.getBoundingClientRect();
      void foldAndSend(input, text, { rect: target });

      await enqueue({
        id: letterId,
        conversationId: id,
        peerId: current().peer.id,
        letterClass: 'letter',
        body,
        attachment:
          chosen === null
            ? null
            : {
                blobId: chosen.blobId,
                kind: chosen.kind,
                sealed: chosen.sealed.buffer as ArrayBuffer,
                stored: false,
              },
      });
    }

    const element = el('div', { class: 'composer' }, [
      pinned,
      errors,
      input,
      el('div', { class: 'composer-buttons' }, [
        button('Attach photo', () => photoInput.click()),
        button('Attach file', () => fileInput.click()),
        send,
      ]),
      photoInput,
      fileInput,
    ]);
    return { element, focus: () => input.focus() };
  }

  paintHeader();
  paintLetters();
  paintStub();
  paintFoot();

  setLoading(outer, true);
  void loadConversationLetters(conversationId)
    .catch(() => undefined)
    .then(() => setLoading(outer, false));

  on('conversations', () => {
    if (!pane.isConnected) return;
    if (conversationOf(conversationId) === null) return;
    paintHeader();
    paintStub();
    paintFoot();
  });
  on('letter', (detail) => {
    if (!pane.isConnected) return;
    const letter = detail as LocalLetter | undefined;
    if (letter !== undefined && letter.conversationId !== conversationId) return;
    paintLetters();
  });
  on('posted', (detail) => {
    if (!pane.isConnected) return;
    const letter = detail as LocalLetter;
    const view = views.get(letter.id);
    if (view !== undefined) strike(view.mark, letter);
  });

  return pane;
}
