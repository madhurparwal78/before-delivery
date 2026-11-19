import { formatTime } from '../../shared/format';
import { firstName } from '../../shared/format';
import { api, newIdempotencyKey } from '../api';
import { announce, h, isPhone, qs } from '../dom';
import { richText } from '../components/text';
import { cfg, currentMember, on, refreshCounters } from '../state';
import { S } from '../strings';

type Conversation = {
  id: string;
  other: { id: string; name: string; handle: string; photo_url: string | null };
  last_message: { text: string; sent_at: string; sender_id: string } | null;
  unread_count: number;
};

type Message = {
  id: string;
  sender_id: string;
  text: string;
  sent_at: string;
  read_at: string | null;
};

type Waiting = {
  key: string;
  text: string;
  failed: boolean;
  failureText: string;
  attempts: number;
};

export function messagingView(
  conversationId: string | null,
  withHandle: string | null,
  navigate: (path: string) => void,
): HTMLElement {
  const page = h('div', { class: isPhone() ? 'messaging phone' : 'messaging' });
  const listPane = h('div', { class: 'pane list-pane' });
  const threadPane = h('div', { class: 'pane thread-pane' });
  let conversations: Conversation[] = [];
  let openId: string | null = conversationId;
  let messages: Message[] = [];
  let outbox: Waiting[] = [];
  let other: Conversation['other'] | null = null;
  let connected = true;
  let typingUntil = 0;
  let typingName = '';
  let lastTypingSent = 0;
  let listScroll = 0;
  let focusComposer = false;

  if (isPhone()) {
    page.append(openId ? threadPane : listPane);
  } else {
    page.append(listPane, threadPane);
  }

  void start();

  const offMessage = on('message', (data) => {
    void onIncoming(String(data.conversation_id), String(data.sender_id), String(data.sender_name));
  });
  const offTyping = on('typing', (data) => {
    if (String(data.conversation_id) !== openId) return;
    typingName = String(data.name);
    typingUntil = Date.now() + cfg().typing_timeout_ms;
    drawThread();
    window.setTimeout(drawThread, cfg().typing_timeout_ms + 50);
  });
  const offRead = on('read', (data) => {
    if (String(data.conversation_id) === openId) void loadMessages();
  });
  const onOnline = (): void => {
    drawThread();
    void drainOutbox();
  };
  const onOffline = (): void => drawThread();
  const onVisible = (): void => void markRead();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);

  const observer = new MutationObserver(() => {
    if (!document.contains(page)) {
      offMessage();
      offTyping();
      offRead();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return page;

  async function start(): Promise<void> {
    if (withHandle) {
      const profile = await api.get<{ id: string; name: string }>(
        `/api/profiles/${encodeURIComponent(withHandle)}`,
      );
      if (!profile.ok) {
        threadPane.replaceChildren(
          h('p', { class: 'big-sentence small', text: S.empty.profileUnavailable }),
        );
        return;
      }
      const created = await api.post<{ id: string; error?: string }>('/api/conversations', {
        member_id: profile.body.id,
      });
      if (created.ok) {
        navigate(`/messaging/${created.body.id}`);
        return;
      }
      connected = false;
      other = { id: profile.body.id, name: profile.body.name, handle: withHandle, photo_url: null };
      await loadConversations();
      drawThread();
      return;
    }
    await loadConversations();
    if (openId) await loadMessages();
    drawThread();
  }

  async function loadConversations(): Promise<void> {
    const result = await api.get<{ conversations: Conversation[] }>('/api/conversations');
    if (!result.ok) return;
    conversations = result.body.conversations;
    const open = conversations.find((entry) => entry.id === openId);
    if (open) other = open.other;
    drawList();
  }

  async function loadMessages(): Promise<void> {
    if (!openId) return;
    const result = await api.get<{ messages: Message[] }>(`/api/conversations/${openId}/messages`);
    if (!result.ok) {
      threadPane.replaceChildren(
        h('p', { class: 'big-sentence small', text: S.empty.profileUnavailable }),
      );
      return;
    }
    messages = result.body.messages;
    drawThread();
    await markRead();
  }

  async function markRead(): Promise<void> {
    if (!openId || document.visibilityState !== 'visible') return;
    const me = currentMember();
    const incoming = messages.filter((message) => me && message.sender_id !== me.id);
    const last = incoming[incoming.length - 1];
    if (!last || last.read_at) return;
    const result = await api.post(`/api/conversations/${openId}/read`, { up_to: last.id });
    if (result.ok) {
      void loadConversations();
      void refreshCounters();
      await loadMessages();
    }
  }

  async function onIncoming(id: string, senderId: string, senderName: string): Promise<void> {
    const me = currentMember();
    await loadConversations();
    if (id === openId) {
      typingUntil = 0;
      await loadMessages();
      if (me && senderId !== me.id) {
        announce('Messaging announcements', S.announce.newMessage(senderName));
      }
    }
    void refreshCounters();
  }

  function drawList(): void {
    const list = h('ul', { 'aria-label': 'Conversations', class: 'card-list' });
    for (const conversation of conversations) {
      const link = h(
        'a',
        {
          href: `/messaging/${conversation.id}`,
          'data-unread': String(conversation.unread_count),
          class: conversation.id === openId ? 'conversation current' : 'conversation',
        },
        [
          h('span', { class: 'person-name', text: conversation.other.name }),
          conversation.last_message
            ? h('span', { class: 'muted', text: conversation.last_message.text })
            : null,
          conversation.unread_count > 0
            ? h('span', { class: 'tabular', text: `${conversation.unread_count} unread` })
            : null,
        ],
      );
      list.append(h('li', {}, [link]));
    }
    listPane.replaceChildren(
      h('h1', { class: 'page-title', text: 'Messaging' }),
      conversations.length === 0
        ? h('div', { class: 'empty' }, [
            h('p', { class: 'big-sentence', text: S.empty.inbox }),
            h('a', { href: '/network', class: 'link underline' }, ['Go to My network']),
          ])
        : list,
    );
    listPane.scrollTop = listScroll;
  }

  function drawThread(): void {
    threadPane.replaceChildren();
    if (!other) {
      if (!isPhone()) threadPane.append(h('p', { class: 'muted', text: 'Pick a conversation.' }));
      return;
    }
    const region = h('section', {
      'aria-label': `Conversation with ${other.name}`,
      class: 'thread',
    });
    if (isPhone()) {
      region.append(
        h(
          'button',
          {
            type: 'button',
            class: 'button quiet',
            click: () => {
              const leaving = openId;
              openId = null;
              navigate('/messaging');
              window.setTimeout(() => {
                const link = qs<HTMLElement>(`a[href="/messaging/${leaving}"]`);
                link?.focus();
              }, 0);
            },
          },
          ['Back to conversations'],
        ),
      );
    }

    const connection = h('p', {
      role: 'status',
      'aria-label': 'Connection',
      class: 'muted',
      text: navigator.onLine ? '' : S.messaging.offline,
    });
    region.append(connection);

    const log = h('div', { role: 'log', 'aria-label': 'Messages', class: 'log' });
    const me = currentMember();
    const myRead = messages.filter((message) => me && message.sender_id === me.id && message.read_at);
    const lastRead = myRead[myRead.length - 1];
    for (const message of messages) {
      const node = h('div', {
        class: 'message',
        'data-message-id': message.id,
        'data-sender-id': message.sender_id,
        'data-read': message.read_at ? 'true' : 'false',
      });
      node.append(richText(message.text));
      log.append(node);
      if (lastRead && message.id === lastRead.id && message.read_at) {
        log.append(
          h('p', {
            class: 'muted seen',
            text: S.messaging.seen(formatTime(new Date(message.read_at), cfg().time_zone)),
          }),
        );
      }
    }
    for (const entry of outbox) {
      const node = h('div', {
        class: 'message pending',
        'data-pending': entry.failed ? 'false' : 'true',
        'data-failed': entry.failed ? 'true' : 'false',
      });
      node.append(richText(entry.text));
      node.append(
        h('p', {
          class: 'muted',
          text: entry.failed
            ? entry.failureText
            : navigator.onLine
              ? S.messaging.sending
              : S.messaging.waiting,
        }),
      );
      if (entry.failed) {
        node.append(
          h(
            'button',
            {
              type: 'button',
              class: 'text-button',
              click: () => {
                entry.failed = false;
                drawThread();
                void drainOutbox();
              },
            },
            ['Retry sending'],
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'text-button',
              click: () => {
                outbox = outbox.filter((item) => item !== entry);
                drawThread();
              },
            },
            ['Delete unsent message'],
          ),
        );
      }
      log.append(node);
    }
    region.append(log);

    if (typingUntil > Date.now()) {
      region.append(
        h('p', { role: 'status', class: 'muted', text: S.messaging.typing(firstName(typingName)) }),
      );
    }

    if (!connected) {
      region.append(
        h('p', { class: 'big-sentence small', text: S.placeholder.messageRefusal(other.name) }),
      );
      threadPane.append(region);
      return;
    }

    const field = h('textarea', {
      'aria-label': 'Write a message',
      class: 'input',
      rows: '2',
      keydown: (event: Event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key !== 'Enter' || keyEvent.shiftKey) return;
        keyEvent.preventDefault();
        send();
      },
      input: () => {
        if (!navigator.onLine || !openId) return;
        if (Date.now() - lastTypingSent < 1000) return;
        lastTypingSent = Date.now();
        void api.post(`/api/conversations/${openId}/typing`);
      },
    }) as HTMLTextAreaElement;
    const sendButton = h('button', { type: 'button', class: 'button', click: () => send() }, [
      'Send',
    ]);
    region.append(h('div', { class: 'row' }, [field, sendButton]));
    threadPane.append(region);
    log.scrollTop = log.scrollHeight;
    if (focusComposer) {
      focusComposer = false;
      field.focus();
    }

    function send(): void {
      const text = field.value;
      if (text.trim() === '') return;
      field.value = '';
      focusComposer = true;
      outbox.push({
        key: newIdempotencyKey(),
        text,
        failed: false,
        failureText: '',
        attempts: 0,
      });
      drawThread();
      void drainOutbox();
    }
  }

  /** Waiting messages send one at a time in typed order, each with its own key. */
  async function drainOutbox(): Promise<void> {
    if (!openId || !navigator.onLine) return;
    const next = outbox.find((entry) => !entry.failed);
    if (!next) return;
    const result = await api.post<{ error?: string }>(
      `/api/conversations/${openId}/messages`,
      { text: next.text },
      { 'Idempotency-Key': next.key },
    );
    if (result.ok) {
      outbox = outbox.filter((entry) => entry !== next);
      announce('Messaging announcements', S.announce.messageSent);
      await loadMessages();
      await loadConversations();
      void drainOutbox();
      return;
    }
    if (result.networkError) {
      next.attempts += 1;
      const delay = next.attempts === 1 ? 1000 : next.attempts === 2 ? 2000 : next.attempts === 3 ? 4000 : 8000;
      drawThread();
      window.setTimeout(() => void drainOutbox(), delay);
      return;
    }
    next.failed = true;
    next.failureText =
      result.body.error === 'not_connected' ? S.messaging.notSentNotConnected : S.messaging.notSent;
    announce('Messaging announcements', S.announce.messageNotSent);
    drawThread();
    void drainOutbox();
  }
}
