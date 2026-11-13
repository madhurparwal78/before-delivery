import { ApiFailure, NetworkFailure, api } from './api.js';
import { el, trapFocus } from './dom.js';
import { realtime } from './realtime.js';
import { fmtCount } from '../shared/i18n/index.js';
import { CHAT_MAX } from '../shared/constants.js';
import { graphemeLength } from '../shared/text.js';
import type { AppContext } from './state.js';
import type { ChatMessage } from '../shared/types.js';

const CHAT_PAGE = 100;
const CHAT_LOG_LIMIT = 100;

interface ChatPanel {
  element: HTMLElement;
  destroy(): void;
}

/** One chat panel, shown as a side panel or inside the phone drawer. */
function createChat(ctx: AppContext, channel: string, drawer: boolean): ChatPanel {
  const log = el('div', { class: 'messages', role: 'log', 'aria-label': ctx.t('log.messages') });
  const input = el('input', {
    type: 'text',
    id: `chat-input-${channel}`,
    'aria-label': ctx.t('field.message'),
    'aria-describedby': `chat-counter-${channel}`,
  }) as HTMLInputElement;
  const counter = el('span', { class: 'counter', id: `chat-counter-${channel}` });
  const sendButton = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.send'),
  ]) as HTMLButtonElement;
  const status = el('div', {
    class: 'live-region',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': ctx.t('status.chatStatus'),
  });

  const shown = new Set<string>();
  let lastShownSeq = 0;

  const appendMessage = (message: ChatMessage): void => {
    if (shown.has(message.id)) return;
    shown.add(message.id);
    lastShownSeq = Math.max(lastShownSeq, message.seq);
    log.append(
      el('p', { class: `message message-${message.kind}` }, [
        message.kind === 'user'
          ? el('span', { class: 'author', text: `${message.author?.display_name ?? ''}: ` })
          : null,
        el('span', { class: 'body', text: message.text }),
      ]),
    );
    log.scrollTop = log.scrollHeight;
  };

  const refreshCounter = (): void => {
    const used = graphemeLength(input.value.trim());
    counter.textContent = `${fmtCount(ctx.locale, used)}/${fmtCount(ctx.locale, CHAT_MAX)}`;
    const over = used > CHAT_MAX;
    counter.classList.toggle('over-limit', over);
    if (over) status.textContent = ctx.t('fb.chatLimit');
  };

  interface Outgoing {
    clientMessageId: string;
    body: string;
  }

  const queue: Outgoing[] = [];
  let pumping = false;

  const stopPending = (): void => {
    sendButton.removeAttribute('aria-disabled');
    sendButton.textContent = ctx.t('btn.send');
  };

  /** Clears the field only while it still holds the text that was sent. */
  const clearField = (body: string): void => {
    if (input.value.trim() !== body) return;
    input.value = '';
    refreshCounter();
  };

  const drop = (attempt: Outgoing): void => {
    const index = queue.indexOf(attempt);
    if (index >= 0) queue.splice(index, 1);
  };

  /** Waits until the browser reports it is back online, or two seconds, whichever comes first. */
  const untilRetry = (): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        window.clearTimeout(timer);
        window.removeEventListener('online', done);
        resolve();
      };
      const timer = window.setTimeout(done, 2000);
      window.addEventListener('online', done);
    });

  /**
   * Each message keeps its client message ID until the server stores it, so a
   * cooldown or a dropped connection never loses it and never stores it twice.
   */
  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    while (queue.length > 0) {
      const attempt = queue[0];
      try {
        const { message } = await api.post<{ message: ChatMessage }>(
          `/api/chat/${channel}/messages`,
          { client_message_id: attempt.clientMessageId, body: attempt.body },
        );
        drop(attempt);
        clearField(attempt.body);
        status.textContent = '';
        appendMessage(message);
      } catch (failure) {
        if (failure instanceof NetworkFailure) {
          await untilRetry();
          continue;
        }
        // A refused message was not stored: its text stays in the field to send again.
        drop(attempt);
        status.textContent =
          failure instanceof ApiFailure
            ? (failure.fieldMessage('body') ?? failure.localisedMessage)
            : ctx.t('fb.generic');
      }
    }
    stopPending();
    pumping = false;
  };

  const send = (): void => {
    if (queue.length > 0) return;
    const body = input.value.trim();
    const used = graphemeLength(body);
    if (used < 1 || used > CHAT_MAX) {
      status.textContent = ctx.t('fb.chatLimit');
      return;
    }
    queue.push({ clientMessageId: crypto.randomUUID(), body });
    sendButton.setAttribute('aria-disabled', 'true');
    sendButton.textContent = ctx.t('fb.pending');
    void pump();
  };

  input.addEventListener('input', refreshCounter);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) return;
    send();
  });
  sendButton.addEventListener('click', send);
  refreshCounter();

  const panel = el('div', { class: 'chat-panel' }, [
    log,
    el('div', { class: 'chat-compose' }, [
      el('label', { class: 'field', for: input.id }, [
        el('span', { text: ctx.t('field.message') }),
        input,
        counter,
      ]),
      sendButton,
    ]),
    status,
  ]);

  const offEvent = realtime.onEvent((event) => {
    if (event.stream !== `chat:${channel}`) return;
    const payload = event.event as { kind: string; message?: ChatMessage };
    if (payload.kind !== 'chat_message' || payload.message === undefined) return;
    appendMessage(payload.message);
    const sent = queue.find((entry) => entry.body === payload.message?.body);
    if (sent !== undefined) {
      drop(sent);
      clearField(sent.body);
      if (queue.length === 0) stopPending();
    }
  });

  /** Reads every message after the newest one shown, page by page; the log keeps the latest 100. */
  const catchUp = async (): Promise<void> => {
    try {
      for (;;) {
        const after = lastShownSeq;
        const { messages } = await api.get<{ messages: ChatMessage[] }>(
          `/api/chat/${channel}/messages?after_seq=${after}`,
        );
        for (const message of messages) {
          appendMessage(message);
          lastShownSeq = Math.max(lastShownSeq, message.seq);
          realtime.seen(`chat:${channel}`, message.seq);
          realtime.markShown(message.id);
        }
        while (log.children.length > CHAT_LOG_LIMIT) log.firstElementChild?.remove();
        if (messages.length < CHAT_PAGE) return;
      }
    } catch {
      // The next (re)connection catches up again.
    }
  };
  // One catch-up at a time; a request made while one runs starts another when it ends.
  let catching = false;
  let again = false;
  const requestCatchUp = async (): Promise<void> => {
    if (catching) {
      again = true;
      return;
    }
    catching = true;
    do {
      again = false;
      await catchUp();
    } while (again);
    catching = false;
  };
  void requestCatchUp();
  const offOpen = realtime.onOpen(() => void requestCatchUp());

  if (!drawer) {
    return {
      element: el('aside', { class: 'chat-side paper-card' }, [panel]),
      destroy: () => {
        offEvent();
        offOpen();
      },
    };
  }

  const dialog = el('div', {
    class: 'chat-drawer',
    role: 'dialog',
    'aria-label': ctx.t('dialog.chat'),
  }, [panel]);
  const toggle = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.openChat'),
  ]) as HTMLButtonElement;

  let open = false;
  const applyDrawer = (): void => {
    dialog.hidden = !open;
    dialog.inert = !open;
    toggle.textContent = open ? ctx.t('btn.closeChat') : ctx.t('btn.openChat');
  };
  toggle.addEventListener('click', () => {
    open = !open;
    applyDrawer();
    if (open) input.focus();
    else toggle.focus();
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
      applyDrawer();
      toggle.focus();
      return;
    }
    trapFocus(dialog, event);
  });
  applyDrawer();

  return {
    element: el('div', { class: 'chat-drawer-host' }, [toggle, dialog]),
    destroy: () => {
      offEvent();
      offOpen();
    },
  };
}

/** Phones get the drawer; wider screens get the side panel. */
export function chatForViewport(ctx: AppContext, channel: string): ChatPanel {
  return createChat(ctx, channel, window.matchMedia('(max-width: 767px)').matches);
}
