// Chat: inbox and channels with unread badges, honest sends with idempotent retry, threads,
// typing, and live updates from the event stream.
import { Inbox as InboxIcon, Hash, MessageSquareReply, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiFailure, get, type Message } from "../api";
import { useExit } from "../components/exit";
import { Panes } from "../components/Panes";
import { EmptyNote, NotFound, SheetHeader, TitleBlock } from "../components/Sheet";
import { Attachments, Uploader, withAttachment } from "../components/Uploader";
import { showDate, showTime } from "../format";
import { navigate, useLocation } from "../router";
import { useApp } from "../store";

export function ChatModule(props: { rest: string[] }): JSX.Element {
  const app = useApp();
  const location = useLocation();
  const target = props.rest[0] ?? "inbox";
  const inboxLabel = app.unread.inbox > 0 ? `Inbox, ${app.unread.inbox} unread` : "Inbox";

  const list = (
    <nav className="channel-list" aria-label="Channels">
      <a
        href="/chat/inbox"
        aria-label={inboxLabel}
        aria-current={target === "inbox" ? "page" : undefined}
        className="channel-link"
        onClick={(e) => {
          e.preventDefault();
          navigate("/chat/inbox", { state: { pane: "detail" } });
        }}
      >
        <InboxIcon aria-hidden="true" size={18} strokeWidth={1.5} />
        <span>Inbox</span>
        {app.unread.inbox > 0 && <span className="badge mono">{app.unread.inbox}</span>}
      </a>
      <h2 className="list-heading">Channels</h2>
      {app.channels.map((c) => (
        <a
          key={c.id}
          href={`/chat/${c.id}`}
          aria-label={c.unread > 0 ? `#${c.name}, ${c.unread} unread` : `#${c.name}`}
          aria-current={target === c.id ? "page" : undefined}
          className="channel-link"
          onClick={(e) => {
            e.preventDefault();
            navigate(`/chat/${c.id}`);
          }}
        >
          <Hash aria-hidden="true" size={18} strokeWidth={1.5} />
          <span>{c.name}</span>
          {c.unread > 0 && <span className="badge mono">{c.unread}</span>}
        </a>
      ))}
    </nav>
  );

  const detail = props.rest.length > 1 ? <NotFound back="/chat/inbox" /> : target === "inbox" ? <InboxSheet /> : <ChannelSheet channelId={target} />;
  const detailFirst = target !== "inbox" || (location.state as { pane?: string } | null)?.pane === "detail";
  return <Panes list={list} detail={detail} detailFirst={detailFirst} detailKey={`chat-${target}`} />;
}

function InboxSheet(): JSX.Element {
  const app = useApp();
  const [items, setItems] = useState<Message[] | null>(null);
  const inbox = app.unread.inbox;
  useEffect(() => {
    get<{ items: Message[] }>("/api/inbox")
      .then((r) => setItems(r.items))
      .catch(() => undefined);
  }, [inbox]);
  const channelName = (id: string): string => app.channels.find((c) => c.id === id)?.name ?? "channel";
  return (
    <div className="sheet">
      <SheetHeader back="/chat/inbox" />
      <TitleBlock name="Inbox" state={inbox > 0 ? `${inbox} unread` : "Read"} changed={app.workspace.today} />
      <h1>Inbox</h1>
      {items !== null && items.length === 0 && <EmptyNote>You're all caught up.</EmptyNote>}
      <div className="messages">
        {(items ?? []).map((m) => (
          <article key={m.id} className="message">
            <header>
              <strong>{app.nameOf(m.author_id)}</strong>
              <span className="mono muted">
                {`#${channelName(m.channel_id)}`} · {showTime(m.created_at)}
              </span>
            </header>
            <p className="message-body">{m.body}</p>
            <a className="text-link" href={`/chat/${m.channel_id}`} onClick={(e) => (e.preventDefault(), navigate(`/chat/${m.channel_id}`))}>
              {m.thread_root_id ? "Open the thread's channel" : `Open #${channelName(m.channel_id)}`}
            </a>
          </article>
        ))}
      </div>
    </div>
  );
}

interface Pending {
  key: string;
  body: string;
  state: "sending" | "failed";
}

function randomKey(): string {
  return crypto.randomUUID();
}

/** One send pipeline per composer: shows the article at once and retries with the first key. */
function useSender(path: string, extra: Record<string, unknown>, onSent: (message: Message) => void, restore: (body: string) => void): {
  pending: Pending[];
  send: (body: string) => void;
  retry: (item: Pending) => void;
} {
  const app = useApp();
  const [pending, setPending] = useState<Pending[]>([]);
  const post = (item: Pending): void => {
    api<Message>("POST", path, { body: item.body, ...extra }, { "Idempotency-Key": item.key })
      .then((message) => {
        onSent(message);
        setPending((list) => list.filter((p) => p.key !== item.key));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && !error.unreachable) {
          setPending((list) => list.filter((p) => p.key !== item.key));
          restore(item.body);
          if (error.code === "validation") app.announce("Messages can be up to 4000 characters.");
          return;
        }
        setPending((list) => list.map((p) => (p.key === item.key ? { ...p, state: "failed" } : p)));
        app.announce("Not sent.");
      });
  };
  return {
    pending,
    send: (body) => {
      if (body.trim() === "") return;
      const item: Pending = { key: randomKey(), body, state: "sending" };
      setPending((list) => [...list, item]);
      post(item);
    },
    retry: (item) => {
      setPending((list) => list.map((p) => (p.key === item.key ? { ...p, state: "sending" } : p)));
      post({ ...item, state: "sending" });
    },
  };
}

/** The one article for each send. A stored copy (`client_key`) settles an article in Sending; while
 * an article shows the not-sent copy, a stored copy stays out of the list. */
function settle<T extends { client_key: string | null }>(messages: T[], pending: Pending[]): { shown: T[]; waiting: Pending[] } {
  const failed = new Set(pending.filter((p) => p.state === "failed").map((p) => p.key));
  const stored = new Set(messages.map((m) => m.client_key));
  return { shown: messages.filter((m) => m.client_key === null || !failed.has(m.client_key)), waiting: pending.filter((p) => p.state === "failed" || !stored.has(p.key)) };
}

function PendingArticle(props: { item: Pending; onRetry: () => void }): JSX.Element {
  const app = useApp();
  return (
    <article className={`message${props.item.state === "failed" ? " is-failed" : " is-sending"}`}>
      <header>
        <strong>{app.person.name}</strong>
        <span className="send-state">{props.item.state === "failed" ? "Not sent." : "Sending"}</span>
      </header>
      <p className="message-body">{props.item.body}</p>
      {props.item.state === "failed" && (
        <button type="button" className="button" onClick={props.onRetry}>
          Retry send
        </button>
      )}
    </article>
  );
}

function Composer(props: { label: string; sendLabel: string; channelId: string; onSend: (body: string) => void; value: string; setValue: (v: string) => void }): JSX.Element {
  const lastTyping = useRef(-1000);
  const send = (): void => {
    const body = props.value;
    if (body.trim() === "") return;
    props.setValue("");
    props.onSend(body);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className="composer">
      <textarea
        aria-label={props.label}
        className="input"
        rows={2}
        value={props.value}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          props.setValue(e.target.value);
          const now = performance.now();
          if (now - lastTyping.current >= 1000) {
            lastTyping.current = now;
            void api("POST", `/api/channels/${props.channelId}/typing`, {}).catch(() => undefined);
          }
        }}
      />
      <button type="button" className="button primary" onClick={send}>
        <Send aria-hidden="true" size={18} strokeWidth={1.5} />
        {props.sendLabel}
      </button>
    </div>
  );
}

function typingText(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return "Several people are typing";
}

function MessageArticle(props: { message: Message; onReply?: () => void; onDelete: () => void; onAttached: (m: Message) => void }): JSX.Element {
  const app = useApp();
  const { message } = props;
  const mine = message.author_id === app.person.id;
  return (
    <article className="message">
      <header>
        <strong>{app.nameOf(message.author_id)}</strong>
        <span className="mono muted">{showTime(message.created_at)}</span>
        <div className="message-actions">
        {props.onReply && (
          <button type="button" className="button ghost" onClick={props.onReply}>
            <MessageSquareReply aria-hidden="true" size={18} strokeWidth={1.5} />
            Reply in thread
            {message.reply_count > 0 && <span className="mono">{` · ${message.reply_count}`}</span>}
          </button>
        )}
        {(mine || app.isOwner) && (
          <button type="button" className="button ghost" onClick={props.onDelete}>
            <Trash2 aria-hidden="true" size={18} strokeWidth={1.5} />
            Delete message
          </button>
        )}
        {mine && <Uploader path={`/api/messages/${message.id}/attachments`} onUploaded={(a) => props.onAttached({ ...message, attachments: withAttachment(message.attachments, a) })} />}
        </div>
      </header>
      <p className="message-body">{message.body}</p>
      <Attachments attachments={message.attachments} />
    </article>
  );
}

function ChannelSheet(props: { channelId: string }): JSX.Element {
  const app = useApp();
  const { channelId } = props;
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<number | null>(null);
  const channel = app.channels.find((c) => c.id === channelId);
  const name = channel?.name ?? "";

  const markRead = useCallback(
    (list: Message[]) => {
      const newest = list.reduce((max, m) => Math.max(max, m.id), 0);
      if (newest > 0) void api("POST", `/api/channels/${channelId}/read`, { up_to: newest }).catch(() => undefined);
    },
    [channelId],
  );

  const load = useCallback(() => {
    get<{ messages: Message[]; typing: string[] }>(`/api/channels/${channelId}/messages`)
      .then((r) => {
        setMessages(r.messages);
        setTyping(r.typing);
        markRead(r.messages);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      });
  }, [channelId, markRead]);
  useEffect(load, [load]);

  const upsert = useCallback((message: Message) => {
    setMessages((list) => {
      if (!list) return list;
      if (list.some((m) => m.id === message.id)) return list.map((m) => (m.id === message.id ? message : m));
      return [...list, message].sort((a, b) => a.id - b.id);
    });
  }, []);

  const sender = useSender(`/api/channels/${channelId}/messages`, {}, upsert, (body) => setDraft(body));
  const list = useRef<HTMLDivElement>(null);
  const count = (messages?.length ?? 0) + sender.pending.length;

  const opened = useRef(false);

  /** Opens at the newest message and follows new ones while the reader is at the end. */
  useLayoutEffect(() => {
    const node = list.current;
    if (!node || messages === null) return;
    if (!opened.current || node.scrollHeight - node.scrollTop - node.clientHeight < 160) node.scrollTop = node.scrollHeight;
    opened.current = true;
  }, [count, messages === null]);

  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "revoked" && event.data.scope === "channel" && event.data.id === channelId) setMissing(true);
        if (event.name === "reset") load();
        if (event.name === "message" && event.data.channel_id === channelId) {
          const message = event.data;
          upsert(message);
          if (document.visibilityState === "visible") markRead([message]);
        } else if (event.name === "thread_reply" && event.data.channel_id === channelId) {
          const root = event.data.thread_root_id;
          setMessages((list) => list && list.map((m) => (m.id === root ? { ...m, reply_count: m.reply_count + 1 } : m)));
        } else if (event.name === "message_deleted" && event.data.channel_id === channelId) {
          const { id, thread_root_id } = event.data;
          if (thread_root_id === null) {
            setMessages((list) => list && list.filter((m) => m.id !== id));
            setThread((t) => (t === id ? null : t));
          } else setMessages((list) => list && list.map((m) => (m.id === thread_root_id ? { ...m, reply_count: Math.max(0, m.reply_count - 1) } : m)));
        } else if (event.name === "typing" && event.data.channel_id === channelId) {
          setTyping(event.data.typing);
        }
      }),
    [app, channelId, load, markRead, upsert],
  );

  if (missing) return <NotFound back="/chat/inbox" />;

  const remove = (message: Message): void => {
    void api("DELETE", `/api/messages/${message.id}`)
      .then(() => {
        setMessages((list) => list && list.filter((m) => m.id !== message.id));
        if (thread === message.id) setThread(null);
      })
      .catch(() => undefined);
  };

  const others = typing.filter((id) => id !== app.person.id).map((id) => app.nameOf(id));
  const latest = messages?.[messages.length - 1];
  const { shown, waiting } = settle(messages ?? [], sender.pending);

  return (
    <div className="sheet channel-sheet">
      <SheetHeader back="/chat/inbox" />
      <TitleBlock name={`#${name}`} state={channel && channel.unread > 0 ? `${channel.unread} unread` : "Read"} changed={latest ? latest.created_at : null} />
      <h1>{`#${name}`}</h1>
      <div className="messages" aria-busy={messages === null} ref={list}>
        {messages !== null && shown.length === 0 && waiting.length === 0 && <EmptyNote>{`No messages in #${name} yet.`}</EmptyNote>}
        {shown.map((m) => (
          <MessageArticle key={m.id} message={m} onReply={() => setThread(m.id)} onDelete={() => remove(m)} onAttached={upsert} />
        ))}
        {waiting.map((p) => (
          <PendingArticle key={p.key} item={p} onRetry={() => sender.retry(p)} />
        ))}
      </div>
      <p role="status" aria-label="Typing" aria-live="polite" className="typing">
        {typingText(others)}
      </p>
      <Composer label={`Message #${name}`} sendLabel="Send" channelId={channelId} value={draft} setValue={setDraft} onSend={sender.send} />
      <div className="channel-actions">
        <button type="button" className="button ghost" onClick={() => markRead(messages ?? [])}>
          Mark channel read
        </button>
        <span className="mono muted">{latest ? `Last message ${showDate(latest.created_at)}` : ""}</span>
      </div>
      {thread !== null && <ThreadPanel rootId={thread} channelId={channelId} onClose={() => setThread(null)} />}
    </div>
  );
}

function ThreadPanel(props: { rootId: number; channelId: string; onClose: () => void }): JSX.Element {
  const app = useApp();
  const panel = useExit<HTMLElement>("sheet");
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const { rootId, channelId } = props;
  const close = useRef(props.onClose);
  close.current = props.onClose;

  const markRead = useCallback((ids: number[]) => {
    const newest = Math.max(rootId, ...ids);
    void api("POST", `/api/threads/${rootId}/read`, { up_to: newest }).catch(() => undefined);
  }, [rootId]);

  useEffect(() => {
    get<{ root: Message; replies: Message[] }>(`/api/messages/${rootId}/thread`)
      .then((r) => {
        setRoot(r.root);
        setReplies(r.replies);
        markRead(r.replies.map((m) => m.id));
      })
      .catch(() => close.current());
  }, [rootId, markRead]);

  const add = useCallback((message: Message) => {
    setReplies((list) => (list.some((m) => m.id === message.id) ? list : [...list, message].sort((a, b) => a.id - b.id)));
  }, []);

  const sender = useSender(`/api/channels/${channelId}/messages`, { thread_root_id: rootId }, add, (body) => setDraft(body));
  const { shown, waiting } = settle(replies, sender.pending);

  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "thread_reply" && event.data.thread_root_id === rootId) {
          const reply = event.data;
          add(reply);
          if (document.visibilityState === "visible") markRead([reply.id]);
        }
        if (event.name === "message_deleted" && event.data.thread_root_id === rootId) {
          const gone = event.data.id;
          setReplies((list) => list.filter((m) => m.id !== gone));
        }
      }),
    [app, rootId, add, markRead],
  );

  return (
    <aside ref={panel} role="complementary" aria-label="Thread" className="thread">
      <header className="thread-head">
        <h2>Thread</h2>
        <button type="button" className="button ghost" onClick={props.onClose}>
          <X aria-hidden="true" size={18} strokeWidth={1.5} />
          Close thread
        </button>
      </header>
      <div className="messages">
        {root && (
          <article className="message thread-root">
            <header>
              <strong>{app.nameOf(root.author_id)}</strong>
              <span className="mono muted">{showTime(root.created_at)}</span>
            </header>
            <p className="message-body">{root.body}</p>
          </article>
        )}
        {shown.map((m) => (
          <article key={m.id} className="message">
            <header>
              <strong>{app.nameOf(m.author_id)}</strong>
              <span className="mono muted">{showTime(m.created_at)}</span>
            </header>
            <p className="message-body">{m.body}</p>
          </article>
        ))}
        {waiting.map((p) => (
          <PendingArticle key={p.key} item={p} onRetry={() => sender.retry(p)} />
        ))}
      </div>
      <Composer label="Reply" sendLabel="Send reply" channelId={channelId} value={draft} setValue={setDraft} onSend={sender.send} />
    </aside>
  );
}
