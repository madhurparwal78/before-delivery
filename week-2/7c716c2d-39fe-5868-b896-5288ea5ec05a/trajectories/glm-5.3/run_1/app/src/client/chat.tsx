import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import type { Message } from "./types.ts";

/** A send in flight: the idempotency key is generated once per message. */
interface PendingMessage {
  clientKey: string;
  body: string;
  state: "sending" | "failed";
  serverId?: number;
}

function newKey(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatList(props: { currentChannelId: string | null; onNavigate: (path: string) => void }): React.ReactNode {
  const channels = store.channels;
  const inboxUnread = store.unread.inbox;
  return (
    <div>
      <a
        className="link-plain"
        href="/chat/inbox"
        aria-current={props.currentChannelId === "inbox" ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          props.onNavigate("/chat/inbox");
        }}
      >
        {inboxUnread > 0 ? `Inbox, ${inboxUnread} unread` : "Inbox"}
        {inboxUnread > 0 && (
          <>
            {" "}
            <span className="badge">{inboxUnread}</span>
          </>
        )}
      </a>
      {channels.map((c) => {
        const unread = store.unread.channels[c.id] ?? 0;
        return (
          <a
            key={c.id}
            className="link-plain"
            href={`/chat/${c.id}`}
            aria-current={props.currentChannelId === c.id ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              props.onNavigate(`/chat/${c.id}`);
            }}
          >
            {unread > 0 ? `#${c.name}, ${unread} unread` : `#${c.name}`}
            {unread > 0 && (
              <>
                {" "}
                <span className="badge">{unread}</span>
              </>
            )}
          </a>
        );
      })}
    </div>
  );
}

export function InboxView(): React.ReactNode {
  const [items, setItems] = useState<Message[]>([]);
  useEffect(() => {
    void api.inbox().then(({ data }) => setItems(data.items));
    const off = store.onStreamEvent((name) => {
      if (name === "unread" || name === "message" || name === "reset") {
        void api.inbox().then(({ data }) => setItems(data.items)).catch(() => undefined);
      }
    });
    return off;
  }, []);
  return (
    <div>
      <h1>Inbox</h1>
      {items.length === 0 && <p>You're all caught up.</p>}
      {items.map((m) => (
        <div key={m.id} className="message">
          <span className="author">{store.personName(m.author_id)}</span>
          <span className="time num">{m.created_at}</span>
          <div>{m.body}</div>
        </div>
      ))}
    </div>
  );
}

export function ChannelView(props: {
  channelId: string;
  onNavigate: (path: string) => void;
  isPhone: boolean;
  onBack: () => void;
}): React.ReactNode {
  const { channelId } = props;
  const channel = store.channels.find((c) => c.id === channelId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [threadRoot, setThreadRoot] = useState<number | null>(null);
  const [thread, setThread] = useState<{ root: Message; replies: Message[] } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const lastTypingSent = useRef(0);
  const markedRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    setNotFound(false);
    setThread(null);
    setThreadRoot(null);
    markedRef.current = null;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const { data } = await api.channelMessages(channelId);
        if (cancelled) return;
        setMessages(data.messages);
        setTyping(data.typing);
        // Opening a channel marks it read up to its newest shown message.
        const newest = data.messages.length > 0 ? data.messages[data.messages.length - 1].id : null;
        if (newest !== null && markedRef.current !== channelId) {
          markedRef.current = channelId;
          const { data: counts } = await api.markChannelRead(channelId, newest);
          store.unread = counts;
          store.emitChange();
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "not_found") setNotFound(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  useEffect(() => {
    const off = store.onStreamEvent((name, data) => {
      if (name === "message") {
        const m = data as Message;
        if (m.channel_id !== channelId) return;
        if (m.client_key) {
          // A stream copy of a message still Sending settles it; no second article.
          setPending((list) => {
            const found = list.find((p) => p.clientKey === m.client_key);
            if (found) return list.filter((p) => p.clientKey !== m.client_key);
            return list;
          });
        }
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
        if (m.author_id !== store.me?.id && markedRef.current === channelId) {
          void api.markChannelRead(channelId, m.id).then(({ data: counts }) => {
            store.unread = counts;
            store.emitChange();
          }).catch(() => undefined);
        }
      }
      if (name === "thread_reply") {
        const m = data as Message;
        if (m.channel_id !== channelId) return;
        if (threadRoot !== null && m.thread_root_id === threadRoot) {
          setThread((t) => (t ? { ...t, replies: [...t.replies, m] } : t));
          void api.markThreadRead(threadRoot, m.id).then(({ data: counts }) => {
            store.unread = counts;
            store.emitChange();
          }).catch(() => undefined);
        }
      }
      if (name === "typing") {
        const t = data as { channel_id: string; typing: string[] };
        if (t.channel_id === channelId) setTyping(t.typing.filter((id) => id !== store.me?.id));
      }
      if (name === "message_deleted") {
        const d = data as { id: number; channel_id: string };
        if (d.channel_id === channelId) {
          setMessages((list) => list.filter((m) => m.id !== d.id && m.thread_root_id !== d.id));
        }
      }
      if (name === "unread" || name === "reset") {
        void api.channelMessages(channelId).then(({ data }) => {
          setMessages(data.messages);
          setTyping(data.typing);
        }).catch(() => undefined);
      }
      if (name === "revoked") {
        const r = data as { scope: string; id: string };
        if (r.scope === "channel" && r.id === channelId) setNotFound(true);
      }
    });
    return off;
  }, [channelId, threadRoot]);

  useEffect(() => {
    if (props.isPhone && titleRef.current) titleRef.current.focus();
  }, [channelId, props.isPhone]);

  if (notFound || !channel) {
    return (
      <div className="not-found">
        <h1>Not found</h1>
        <p>That item doesn't exist or isn't shared with you.</p>
      </div>
    );
  }

  const sendMessage = async (): Promise<void> => {
    const text = draft;
    if (text.trim().length === 0) return;
    const key = newKey();
    setDraft("");
    setPending((list) => [...list, { clientKey: key, body: text, state: "sending" }]);
    try {
      const { data } = await api.postMessage(channelId, { body: text }, key);
      setPending((list) => list.filter((p) => p.clientKey !== key));
      setMessages((list) => (list.some((m) => m.id === data.id) ? list : [...list, data]));
      store.announce(text.slice(0, 60));
    } catch (e) {
      if (e instanceof ApiError && e.code === "validation" && e.fields?.body) {
        // A validation error puts the text back into the composer.
        setPending((list) => list.filter((p) => p.clientKey !== key));
        setDraft(text);
        store.announce("Messages can be up to 4000 characters.");
        return;
      }
      if (e instanceof ApiError && e.code === "not_found") {
        setPending((list) => list.filter((p) => p.clientKey !== key));
        setDraft(text);
        return;
      }
      setPending((list) =>
        list.map((p) => (p.clientKey === key ? { ...p, state: "failed" } : p))
      );
    }
  };

  const retry = async (p: PendingMessage): Promise<void> => {
    setPending((list) => list.map((x) => (x.clientKey === p.clientKey ? { ...x, state: "sending" } : x)));
    try {
      const { data } = await api.postMessage(channelId, { body: p.body }, p.clientKey);
      setPending((list) => list.filter((x) => x.clientKey !== p.clientKey));
      setMessages((list) => (list.some((m) => m.id === data.id) ? list : [...list, data]));
    } catch {
      setPending((list) => list.map((x) => (x.clientKey === p.clientKey ? { ...x, state: "failed" } : x)));
    }
  };

  const onTyping = (): void => {
    const now = Date.now();
    if (now - lastTypingSent.current < 1000) return;
    lastTypingSent.current = now;
    void api.typing(channelId).catch(() => undefined);
  };

  const typingLine = (): string => {
    if (typing.length === 0) return "";
    const names = typing.map((id) => store.personName(id)).filter((n) => n.length > 0);
    if (names.length === 0) return "";
    if (names.length === 1) return `${names[0]} is typing`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
    return "Several people are typing";
  };

  const openThread = async (rootId: number): Promise<void> => {
    setThreadRoot(rootId);
    try {
      const { data } = await api.thread(rootId);
      setThread(data);
      const newest = data.replies.length > 0 ? data.replies[data.replies.length - 1].id : rootId;
      const { data: counts } = await api.markThreadRead(rootId, newest);
      store.unread = counts;
      store.emitChange();
    } catch {
      setThreadRoot(null);
    }
  };

  return (
    <div>
      {props.isPhone && <button className="btn" onClick={props.onBack}>Back</button>}
      <h1 ref={titleRef} tabIndex={-1}>{`#${channel.name}`}</h1>
      <button
        className="btn"
        aria-label="Mark channel read"
        onClick={() => {
          const newest = messages.length > 0 ? messages[messages.length - 1].id : 0;
          if (newest) {
            void api.markChannelRead(channelId, newest).then(({ data }) => {
              store.unread = data;
              store.emitChange();
            });
          }
        }}
      >
        Mark channel read
      </button>
      <div className="section-label">Messages</div>
      {messages.length === 0 && pending.length === 0 && `No messages in #${channel.name} yet.`}
      {messages.map((m) => (
        <MessageArticle
          key={m.id}
          message={m}
          onReply={() => void openThread(m.id)}
          onDeleted={(id) => setMessages((list) => list.filter((x) => x.id !== id))}
        />
      ))}
      {pending.map((p) => (
        <div key={p.clientKey} className="message">
          <span className="author">{store.me?.name}</span>
          <div>{p.body}</div>
          {p.state === "sending" && (
            <span className="meta" role="status">
              Sending
            </span>
          )}
          {p.state === "failed" && (
            <>
              <span className="meta field-error">Not sent.</span>{" "}
              <button className="row-btn" onClick={() => void retry(p)}>
                Retry send
              </button>
            </>
          )}
        </div>
      ))}
      <div className="typing-line" role="status" aria-live="polite" aria-label="Typing">
        {typingLine()}
      </div>
      <div className="composer">
        <textarea
          aria-label={`Message #${channel.name}`}
          value={draft}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage();
            }
          }}
        />
        <button className="btn primary" aria-label="Send" onClick={() => void sendMessage()}>
          Send
        </button>
      </div>
      {threadRoot !== null && thread && (
        <ThreadSheet
          channelId={channelId}
          thread={thread}
          onClose={() => {
            setThreadRoot(null);
            setThread(null);
          }}
        />
      )}
    </div>
  );
}

function MessageArticle(props: {
  message: Message;
  onReply: () => void;
  onDeleted: (id: number) => void;
}): React.ReactNode {
  const m = props.message;
  const canDelete = store.me?.role === "owner" || m.author_id === store.me?.id;
  const [uploadStatus, setUploadStatus] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="message">
      <article>
        <span className="author">{store.personName(m.author_id)}</span>
        <span className="time num">{m.created_at}</span>
        <div>{m.body}</div>
        <div>
          <button className="row-btn" aria-label="Reply in thread" onClick={props.onReply}>
            Reply in thread{m.reply_count > 0 ? ` (${m.reply_count})` : ""}
          </button>
          {canDelete && (
            <button
              className="row-btn"
              aria-label="Delete message"
              onClick={() => {
                void api.deleteMessage(m.id).then(() => props.onDeleted(m.id)).catch(() => undefined);
              }}
            >
              Delete message
            </button>
          )}
          {m.author_id === store.me?.id && (
            <>
              <button
                className="row-btn"
                aria-label="Attach file"
                aria-disabled={store.status?.storage === "unavailable"}
                onClick={() => {
                  if (store.status?.storage === "unavailable") {
                    setUploadStatus("Upload failed: storage is unavailable. Nothing was attached.");
                    store.announce("Upload failed: storage is unavailable. Nothing was attached.");
                    return;
                  }
                  fileRef.current?.click();
                }}
              >
                Attach file
              </button>
              <input
                ref={fileRef}
                type="file"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadStatus(`Uploading ${file.name}`);
                  void api
                    .attachFile(`/api/messages/${m.id}/attachments`, file)
                    .then(() => {
                      setUploadStatus(`Attached ${file.name}.`);
                      store.announce(`Attached ${file.name}.`);
                    })
                    .catch((err) => {
                      setUploadStatus(
                        err instanceof ApiError && err.fields?.file
                          ? err.fields.file
                          : "Upload failed: storage is unavailable. Nothing was attached."
                      );
                    });
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
        {m.attachments.map((a) => (
          <a key={a.id} className="attachment-link" href={`/api/attachments/${a.id}`}>
            {a.filename}
          </a>
        ))}
        <span role="status">{uploadStatus}</span>
      </article>
    </div>
  );
}

function ThreadSheet(props: { channelId: string; thread: { root: Message; replies: Message[] }; onClose: () => void }): React.ReactNode {
  const { channelId, thread } = props;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [replies, setReplies] = useState<Message[]>(thread.replies);
  const lastTypingSent = useRef(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReplies(thread.replies);
  }, [thread.root.id]);

  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  const sendReply = async (): Promise<void> => {
    const text = draft;
    if (text.trim().length === 0) return;
    const key = newKey();
    setDraft("");
    setPending((list) => [...list, { clientKey: key, body: text, state: "sending" }]);
    try {
      const { data } = await api.postMessage(channelId, { body: text, thread_root_id: thread.root.id }, key);
      setPending((list) => list.filter((p) => p.clientKey !== key));
      setReplies((list) => (list.some((m) => m.id === data.id) ? list : [...list, data]));
      void api.markThreadRead(thread.root.id, data.id).then(({ data: counts }) => {
        store.unread = counts;
        store.emitChange();
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "validation" && e.fields?.body) {
        setPending((list) => list.filter((p) => p.clientKey !== key));
        setDraft(text);
        store.announce("Messages can be up to 4000 characters.");
        return;
      }
      setPending((list) => list.map((p) => (p.clientKey === key ? { ...p, state: "failed" } : p)));
    }
  };

  const retry = async (p: PendingMessage): Promise<void> => {
    setPending((list) => list.map((x) => (x.clientKey === p.clientKey ? { ...x, state: "sending" } : x)));
    try {
      const { data } = await api.postMessage(channelId, { body: p.body, thread_root_id: thread.root.id }, p.clientKey);
      setPending((list) => list.filter((x) => x.clientKey !== p.clientKey));
      setReplies((list) => (list.some((m) => m.id === data.id) ? list : [...list, data]));
    } catch {
      setPending((list) => list.map((x) => (x.clientKey === p.clientKey ? { ...x, state: "failed" } : x)));
    }
  };

  return (
    <div ref={sheetRef} tabIndex={-1} role="complementary" aria-label="Thread">
      <h2>Thread</h2>
      <div className="message">
        <span className="author">{store.personName(thread.root.author_id)}</span>
        <div>{thread.root.body}</div>
      </div>
      {replies.map((m) => (
        <div key={m.id} className="message">
          <span className="author">{store.personName(m.author_id)}</span>
          <div>{m.body}</div>
        </div>
      ))}
      {pending.map((p) => (
        <div key={p.clientKey} className="message">
          <span className="author">{store.me?.name}</span>
          <div>{p.body}</div>
          {p.state === "sending" && <span className="meta">Sending</span>}
          {p.state === "failed" && (
            <>
              <span className="meta field-error">Not sent.</span>{" "}
              <button className="row-btn" onClick={() => void retry(p)}>
                Retry send
              </button>
            </>
          )}
        </div>
      ))}
      <div className="composer">
        <textarea
          aria-label="Reply"
          value={draft}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            const now = Date.now();
            if (now - lastTypingSent.current > 1000) {
              lastTypingSent.current = now;
              void api.typing(channelId).catch(() => undefined);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendReply();
            }
          }}
        />
        <button className="btn primary" aria-label="Send reply" onClick={() => void sendReply()}>
          Send reply
        </button>
        <button
          className="btn"
          aria-label="Close thread"
          onClick={() => {
            props.onClose();
          }}
        >
          Close thread
        </button>
      </div>
    </div>
  );
}
