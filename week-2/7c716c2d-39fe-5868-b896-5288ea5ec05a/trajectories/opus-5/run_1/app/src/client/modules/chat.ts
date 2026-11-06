import { api, ApiCallError } from '../api.js';
import { copy } from '../copy.js';
import { clear, el, setText } from '../dom.js';
import { timeOfInstant } from '../format.js';
import { type Route } from '../router.js';
import {
  announce,
  focusDetailTitle,
  notFoundSheet,
  titleBlock,
  type ModuleContext,
  type ModuleHandle,
} from '../shell.js';
import { onStreamEvent } from '../stream.js';
import { isOwner, nameOf, state, subscribe } from '../store.js';
import { attachmentsPanel, uploadReport } from '../uploads.js';
import type { Message } from '../../shared/types.js';

type Draft = { clientKey: string; body: string; threadRootId: number | null; failed: boolean };

export function chatModule(context: ModuleContext): ModuleHandle {
  let channelId: string | null = null;
  let messages: Message[] = [];
  let typing: string[] = [];
  let threadRoot: Message | null = null;
  let threadReplies: Message[] = [];
  let notFound = false;
  let wantFocus = false;
  const drafts = new Map<string, Draft>();

  const channelList = el('div', { class: 'rows chat-list' });
  context.list.append(channelList);

  const sheet = el('div', { class: 'sheet chat-sheet' });
  context.detail.append(sheet);

  const articles = el('div', { class: 'messages' });
  const typingLine = el('p', { class: 'typing mono', role: 'status', 'aria-live': 'polite', 'aria-label': 'Typing' });
  const composer = el('textarea', { class: 'composer', rows: '2' });
  const sendButton = el('button', { type: 'button', text: 'Send' });
  const markRead = el('button', { type: 'button', text: 'Mark channel read' });
  const threadPanel = el('aside', { class: 'thread', role: 'complementary', 'aria-label': 'Thread' });
  const report = uploadReport();

  function channelName(id: string | null): string {
    return state.channels.find((channel) => channel.id === id)?.name ?? '';
  }

  function renderChannels(): void {
    clear(channelList);
    const inboxCount = state.unread.inbox;
    const inbox = el('a', {
      href: '/chat/inbox',
      class: 'row chat-row',
      text: inboxCount === 0 ? 'Inbox' : `Inbox, ${inboxCount} unread`,
    });
    if (channelId === null) inbox.setAttribute('aria-current', 'true');
    channelList.append(inbox);
    for (const channel of state.channels) {
      const count = state.unread.channels[channel.id] ?? 0;
      const link = el('a', {
        href: `/chat/${channel.id}`,
        class: 'row chat-row',
        text: count === 0 ? `#${channel.name}` : `#${channel.name}, ${count} unread`,
      });
      if (channel.id === channelId) link.setAttribute('aria-current', 'true');
      channelList.append(link);
    }
  }

  async function loadChannel(id: string): Promise<void> {
    try {
      const result = await api<{ messages: Message[]; typing: string[] }>('GET', `/api/channels/${id}/messages`);
      messages = result.messages;
      typing = result.typing;
      notFound = false;
      renderSheet();
      await markChannelRead();
    } catch (error) {
      if (error instanceof ApiCallError && error.code === 'not_found') {
        notFound = true;
        renderSheet();
      }
    }
  }

  async function loadInbox(): Promise<void> {
    try {
      const result = await api<{ items: Message[] }>('GET', '/api/inbox');
      messages = result.items;
      renderSheet();
    } catch {
      // The notices report the outage.
    }
  }

  async function markChannelRead(): Promise<void> {
    if (channelId === null) return;
    const newest = messages.filter((message) => message.thread_root_id === null).at(-1);
    if (newest === undefined) return;
    await api('POST', `/api/channels/${channelId}/read`, { body: { up_to: newest.id } }).catch(() => undefined);
  }

  function renderSheet(): void {
    clear(sheet);
    if (notFound) {
      sheet.append(notFoundSheet());
      return;
    }
    if (channelId === null) {
      sheet.append(
        titleBlock('Inbox', 'Mentions and replies', ''),
        el('h1', { class: 'display', 'data-detail-title': 'true', text: 'Inbox' }),
      );
      if (messages.length === 0) {
        sheet.append(el('p', { class: 'empty', text: copy.emptyInbox }));
        return;
      }
      const items = el('div', { class: 'messages' });
      for (const message of messages) items.append(inboxArticle(message));
      sheet.append(items);
      return;
    }

    const name = channelName(channelId);
    composer.setAttribute('aria-label', `Message #${name}`);
    sheet.append(
      titleBlock(`#${name}`, `${messages.length} messages`, ''),
      el('h1', { class: 'display', 'data-detail-title': 'true', text: `#${name}` }),
      markRead,
      articles,
      typingLine,
      el('div', { class: 'composer-row' }, [composer, sendButton]),
      el('div', { class: 'attach-report' }, [report.progress, report.status]),
    );
    renderMessages();
    renderTyping();
    if (threadRoot !== null) sheet.append(threadPanel);
    if (wantFocus) {
      wantFocus = false;
      focusDetailTitle();
    }
  }

  function renderMessages(): void {
    clear(articles);
    const visible = messages.filter((message) => message.thread_root_id === null);
    if (visible.length === 0 && drafts.size === 0) {
      articles.append(el('p', { class: 'empty', text: copy.emptyChannel(channelName(channelId)) }));
    }
    for (const message of visible) articles.append(messageArticle(message));
    for (const draft of drafts.values()) {
      if (draft.threadRootId === null) articles.append(draftArticle(draft));
    }
  }

  function messageArticle(message: Message): HTMLElement {
    const article = el('article', { class: 'message', 'data-id': String(message.id) });
    if (message.client_key !== null) article.setAttribute('data-client-key', message.client_key);
    const reply = el('button', { type: 'button', text: 'Reply in thread' });
    reply.setAttribute('aria-label', 'Reply in thread');
    reply.addEventListener('click', () => {
      void openThread(message.id);
    });
    article.append(
      el('span', { class: 'author', text: nameOf(message.author_id) }),
      el('span', { class: 'stamp mono', text: timeOfInstant(message.created_at) }),
      el('p', { class: 'body', text: message.body }),
      el('span', { class: 'replies mono', text: message.reply_count === 0 ? '' : `${message.reply_count} replies` }),
      reply,
    );
    if (message.author_id === state.person?.id || isOwner()) {
      const remove = el('button', { type: 'button', text: 'Delete message' });
      remove.addEventListener('click', () => {
        void api('DELETE', `/api/messages/${message.id}`)
          .then(() => {
            messages = messages.filter((entry) => entry.id !== message.id);
            renderMessages();
          })
          .catch(() => undefined);
      });
      article.append(remove);
    }
    if (message.attachments.length > 0 || message.author_id === state.person?.id) {
      article.append(
        attachmentsPanel({
          parentPath: `/api/messages/${message.id}/attachments`,
          attachments: message.attachments,
          report,
          onAttached: (attachment) => {
            message.attachments = [...message.attachments, attachment];
          },
        }),
      );
    }
    return article;
  }

  function inboxArticle(message: Message): HTMLElement {
    const article = el('article', { class: 'message', 'data-id': String(message.id) }, [
      el('span', { class: 'author', text: nameOf(message.author_id) }),
      el('span', { class: 'stamp mono', text: `#${channelName(message.channel_id)}` }),
      el('p', { class: 'body', text: message.body }),
    ]);
    const open = el('a', { href: `/chat/${message.channel_id}`, text: 'Open channel' });
    article.append(open);
    return article;
  }

  function draftArticle(draft: Draft): HTMLElement {
    const article = el('article', { class: 'message sending', 'data-client-key': draft.clientKey }, [
      el('span', { class: 'author', text: state.person?.name ?? '' }),
      el('p', { class: 'body', text: draft.body }),
      el('span', { class: 'send-state', text: draft.failed ? copy.notSent : copy.sending }),
    ]);
    if (draft.failed) {
      const retry = el('button', { type: 'button', text: 'Retry send' });
      retry.addEventListener('click', () => {
        void send(draft);
      });
      article.append(retry);
    }
    return article;
  }

  async function send(draft: Draft): Promise<void> {
    draft.failed = false;
    drafts.set(draft.clientKey, draft);
    if (draft.threadRootId === null) renderMessages();
    else renderThread();
    const path = channelId === null ? null : `/api/channels/${channelId}/messages`;
    if (path === null) return;
    try {
      const message = await api<Message>('POST', path, {
        body: draft.threadRootId === null ? { body: draft.body } : { body: draft.body, thread_root_id: draft.threadRootId },
        idempotencyKey: draft.clientKey,
      });
      drafts.delete(draft.clientKey);
      settle(message);
    } catch (error) {
      if (!(error instanceof ApiCallError)) return;
      if (error.code === 'validation') {
        drafts.delete(draft.clientKey);
        composer.value = draft.body;
        announce(copy.messageTooLong);
      } else if (error.code === 'not_found') {
        drafts.delete(draft.clientKey);
        composer.value = draft.body;
      } else {
        draft.failed = true;
      }
      if (draft.threadRootId === null) renderMessages();
      else renderThread();
    }
  }

  function settle(message: Message): void {
    if (message.thread_root_id === null) {
      if (!messages.some((entry) => entry.id === message.id)) messages = [...messages, message];
      else messages = messages.map((entry) => (entry.id === message.id ? message : entry));
      renderMessages();
      void markChannelRead();
      return;
    }
    if (threadRoot !== null && message.thread_root_id === threadRoot.id) {
      if (!threadReplies.some((entry) => entry.id === message.id)) threadReplies = [...threadReplies, message];
      renderThread();
    }
    messages = messages.map((entry) =>
      entry.id === message.thread_root_id ? { ...entry, reply_count: entry.reply_count + 1 } : entry,
    );
    renderMessages();
  }

  function renderTyping(): void {
    const names = typing
      .filter((personId) => personId !== state.person?.id)
      .map((personId) => nameOf(personId));
    if (names.length === 0) setText(typingLine, '');
    else if (names.length === 1) setText(typingLine, copy.typingOne(names[0] ?? ''));
    else if (names.length === 2) setText(typingLine, copy.typingTwo(names[0] ?? '', names[1] ?? ''));
    else setText(typingLine, copy.typingMany);
  }

  async function openThread(rootId: number): Promise<void> {
    const result = await api<{ root: Message; replies: Message[] }>('GET', `/api/messages/${rootId}/thread`).catch(
      () => null,
    );
    if (result === null) return;
    threadRoot = result.root;
    threadReplies = result.replies;
    renderSheet();
    renderThread();
    const newest = [result.root, ...result.replies].at(-1);
    if (newest !== undefined) {
      await api('POST', `/api/threads/${rootId}/read`, { body: { up_to: newest.id } }).catch(() => undefined);
    }
  }

  function renderThread(): void {
    const root = threadRoot;
    if (root === null) return;
    clear(threadPanel);
    const close = el('button', { type: 'button', text: 'Close thread' });
    close.addEventListener('click', () => {
      threadRoot = null;
      threadReplies = [];
      renderSheet();
    });
    const replyBox = el('textarea', { class: 'composer', rows: '2' });
    replyBox.setAttribute('aria-label', 'Reply');
    const replyButton = el('button', { type: 'button', text: 'Send reply' });
    replyButton.addEventListener('click', () => {
      const body = replyBox.value;
      if (body.trim() === '') return;
      replyBox.value = '';
      void send({ clientKey: newKey(), body, threadRootId: root.id, failed: false });
    });
    replyBox.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        replyButton.click();
      }
    });
    threadPanel.append(close, messageArticle(root));
    for (const reply of threadReplies) threadPanel.append(messageArticle(reply));
    for (const draft of drafts.values()) {
      if (draft.threadRootId === root.id) threadPanel.append(draftArticle(draft));
    }
    threadPanel.append(el('div', { class: 'composer-row' }, [replyBox, replyButton]));
  }

  function newKey(): string {
    return crypto.randomUUID();
  }

  sendButton.addEventListener('click', () => {
    const body = composer.value;
    if (body.trim() === '') return;
    composer.value = '';
    void send({ clientKey: newKey(), body, threadRootId: null, failed: false });
  });
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendButton.click();
    }
  });
  let lastTyping = 0;
  composer.addEventListener('input', () => {
    if (channelId === null || Date.now() - lastTyping < 1000) return;
    lastTyping = Date.now();
    void api('POST', `/api/channels/${channelId}/typing`, { body: {} }).catch(() => undefined);
  });
  markRead.addEventListener('click', () => {
    void markChannelRead();
  });

  const unsubscribeStore = subscribe((keys) => {
    if (keys.has('unread') || keys.has('channels') || keys.has('members')) renderChannels();
  });

  const unsubscribeStream = onStreamEvent((event) => {
    if (event.name === 'reset') {
      if (channelId === null) void loadInbox();
      else void loadChannel(channelId);
      return;
    }
    if (event.name === 'revoked' && event.data.scope === 'channel') {
      if (event.data.id === channelId) {
        notFound = true;
        renderSheet();
      }
      return;
    }
    if (event.name === 'message' || event.name === 'thread_reply') {
      const message = event.data as unknown as Message;
      if (message.client_key !== null && drafts.has(message.client_key)) {
        const draft = drafts.get(message.client_key);
        if (draft !== undefined && draft.failed) return;
        drafts.delete(message.client_key);
      }
      if (message.channel_id !== channelId) return;
      settle(message);
      return;
    }
    if (event.name === 'message_deleted') {
      const id = Number(event.data.id);
      messages = messages.filter((message) => message.id !== id);
      threadReplies = threadReplies.filter((message) => message.id !== id);
      if (threadRoot?.id === id) {
        threadRoot = null;
        renderSheet();
      } else {
        renderMessages();
        renderThread();
      }
      return;
    }
    if (event.name === 'typing' && event.data.channel_id === channelId) {
      typing = (event.data.typing as string[]) ?? [];
      renderTyping();
    }
  });

  return {
    id: 'chat',
    firstPane: 'list',
    route(route: Route) {
      const target = route.segments.length > 2 ? 'unknown path' : route.segments[1] ?? 'inbox';
      const wanted = target === 'inbox' ? null : target;
      if (wanted !== channelId) {
        wantFocus = wanted !== null;
        channelId = wanted;
        messages = [];
        threadRoot = null;
        threadReplies = [];
        notFound = false;
      }
      renderChannels();
      renderSheet();
      if (channelId === null) void loadInbox();
      else {
        if (!state.channels.some((channel) => channel.id === channelId)) {
          notFound = true;
          renderSheet();
        } else {
          void loadChannel(channelId);
        }
      }
      if (route.segments.length > 1) context.openDetail(null);
    },
    destroy() {
      unsubscribeStore();
      unsubscribeStream();
      clear(context.list);
      clear(context.detail);
    },
  };
}
