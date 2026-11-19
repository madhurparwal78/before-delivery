import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, EllipsisVertical, Eye, History, ImageOff, type LucideIcon, Pencil, Pin, PinOff, Quote, Reply, RotateCcw, Trash2 } from "lucide-react";
import { deliveryChip } from "./chip";
import { Chip, DeliveryState, RoleChip } from "./components/Chip";
import { MessageText } from "./components/MessageText";
import { alreadyRead, attemptSend, loadOlder, reportRead } from "./data";
import { useTick } from "./hooks";
import { mayDelete, mayEdit, maySeeReceipts, pins } from "./permissions";
import { channelPath, navigate } from "./route";
import { dropOutgoing, getState, type Outgoing, useStore } from "./store";
import { formatWhen } from "../shared/when";
import type { Channel, Entry, Me, Message } from "./types";

export type MessageAction = "reply" | "quote" | "edit" | "delete" | "pin" | "unpin" | "receipts" | "versions";

const NEAR_TOP_PX = 120;
const AT_BOTTOM_PX = 48;

// The channel's top-level history, oldest at the top, then this person's sends still in flight.
export function MessageList(props: {
  channel: Channel;
  me: Me;
  onAction: (action: MessageAction, message: Message) => void;
  onOpenThread: (rootId: string) => void;
  focusTarget: string | null;
  onFocused: () => void;
}) {
  const { channel, me, focusTarget } = props;
  const { histories, entries, outbox } = useStore();
  const view = histories[channel.id];
  const ref = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenNewest, setUnseenNewest] = useState(false);
  const pending = outbox.filter((o) => o.channelId === channel.id && o.threadRootId === null);
  const ids = view?.ids ?? [];
  const newestKey = `${ids.at(-1) ?? ""}|${pending.length}`;
  const firstKey = ids[0] ?? "";
  const keep = useRef<{ first: string; height: number; top: number } | null>(null);

  // Older pages load above without moving what the person is reading.
  useLayoutEffect(() => {
    const el = ref.current;
    const kept = keep.current;
    if (el && kept && kept.first !== "" && kept.first !== firstKey) el.scrollTop = kept.top + (el.scrollHeight - kept.height);
    keep.current = el ? { first: firstKey, height: el.scrollHeight, top: el.scrollTop } : null;
  }, [firstKey]);

  // New messages keep the view pinned to the bottom, or offer the jump when scrolled up.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
    else setUnseenNewest(true);
    // Only a change at the newest end matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestKey]);

  // A search result opens its article: page back until it is loaded, then focus it.
  useEffect(() => {
    if (!focusTarget || !view || view.status !== "ready") return;
    const article = ref.current?.querySelector<HTMLElement>(`[data-message-id="${focusTarget}"]`);
    if (article) {
      article.scrollIntoView({ block: "center" });
      article.focus({ preventScroll: true });
      props.onFocused();
    } else if (view.nextCursor && view.older !== "loading") void loadOlder(channel.id);
    else if (!view.nextCursor) props.onFocused();
  }, [focusTarget, view, channel.id, props]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_PX;
    setAtBottom(bottom);
    if (bottom) setUnseenNewest(false);
    keep.current = { first: firstKey, height: el.scrollHeight, top: el.scrollTop };
    if (el.scrollTop <= NEAR_TOP_PX && view?.nextCursor && view.older === "idle") void loadOlder(channel.id);
  };

  const jump = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setUnseenNewest(false);
    setAtBottom(true);
    el.querySelector<HTMLElement>("article:last-of-type")?.focus({ preventScroll: true });
  };

  return (
    <div className="list-frame">
      <div ref={ref} id="messages" className="message-list" role="region" aria-label="Messages" tabIndex={-1} onScroll={onScroll} data-scroll-root>
        {view?.older === "loading" ? <p className="list-note">Loading older messages…</p> : null}
        {view?.older === "error" ? (
          <p className="list-note list-note-error">
            Could not load older messages.{" "}
            <button className="button button-quiet" type="button" onClick={() => void loadOlder(channel.id)}>
              Try again
            </button>
          </p>
        ) : null}
        {!view || view.status === "loading" ? <Skeleton /> : null}
        {view?.status === "ready" && ids.length === 0 && pending.length === 0 ? <p className="list-empty">No messages here yet. Start the conversation below.</p> : null}
        {ids.map((id) => {
          const entry = entries[id];
          return entry ? <MessageItem key={id} entry={entry} me={me} context="channel" onAction={props.onAction} onOpenThread={props.onOpenThread} /> : null;
        })}
        {pending.map((item) => (
          <OutgoingItem key={item.clientMessageId} item={item} me={me} />
        ))}
      </div>
      {unseenNewest && !atBottom ? (
        <button className="button jump" type="button" onClick={jump}>
          <ArrowDown aria-hidden="true" size={20} />
          Jump to newest messages
        </button>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

// Reports a read once the message has been on screen in a visible tab for a second; an edit
// while it is shown starts a new second for the version now shown.
function useReadReport(ref: React.RefObject<HTMLElement | null>, message: Message | null, mine: boolean): void {
  const version = message?.version;
  const id = message?.id;
  useEffect(() => {
    const el = ref.current;
    if (!el || !id || mine) return;
    const root = el.closest<HTMLElement>("[data-scroll-root]");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let visible = false;
    const fire = () => {
      timer = null;
      const current = getState().entries[id];
      if (current && !current.deleted && !alreadyRead(current)) reportRead(current);
    };
    const update = () => {
      const shouldRun = visible && document.visibilityState === "visible";
      if (shouldRun && timer === null) timer = setTimeout(fire, 1_000);
      if (!shouldRun && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const rootHeight = entry.rootBounds?.height ?? window.innerHeight;
        visible = entry.isIntersecting && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= rootHeight / 2);
        update();
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      if (timer !== null) clearTimeout(timer);
    };
  }, [ref, id, version, mine]);
}

export function MessageItem(props: {
  entry: Entry;
  me: Me;
  context: "channel" | "root" | "reply";
  onAction: (action: MessageAction, message: Message) => void;
  onOpenThread?: (rootId: string) => void;
}) {
  const { entry, me, context } = props;
  const zone = me.workspace.time_zone;
  const ref = useRef<HTMLElement>(null);
  const message = entry.deleted ? null : entry;
  const mine = message?.author.id === me.user.id;
  useReadReport(ref, message, mine);
  const { pendingPins } = useStore();

  if (!message) {
    const time = formatWhen(zone, entry.sent_at);
    return (
      <article ref={ref} className="message message-deleted" aria-label={`Deleted message at ${time}`} tabIndex={0} data-message-id={entry.id}>
        <header className="message-head">
          <span className="author muted">Deleted message</span>
          <time className="stamp" dateTime={entry.sent_at}>
            {time}
          </time>
        </header>
        <p className="message-text muted">This message was deleted.</p>
        {context === "channel" && entry.reply_count > 0 ? (
          <div className="message-foot">
            <button className="button button-quiet" type="button" onClick={() => props.onOpenThread?.(entry.id)}>
              View {entry.reply_count} replies
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  const time = formatWhen(zone, message.sent_at);
  return (
    <article ref={ref} className={`message${mine ? " message-own" : ""}`} aria-label={`${message.author.name} at ${time}`} tabIndex={0} data-message-id={message.id}>
      <header className="message-head">
        <span className="author">{message.author.name}</span>
        <RoleChip role={message.author.role} />
        {message.edited ? <Chip kind="edited" label="Edited" /> : null}
        {message.pinned ? <Chip kind="pinned" label="Pinned" active /> : pendingPins[message.id] ? <Chip kind="pinned" label="Pinned" dimmed /> : null}
        <time className="stamp" dateTime={message.sent_at}>
          {time}
        </time>
        <ActionsMenu message={message} me={me} context={context} onAction={props.onAction} />
      </header>
      {message.quote ? <QuoteBlock quote={message.quote} /> : null}
      {message.text ? <MessageText text={message.text} /> : null}
      {message.attachments.length > 0 ? (
        <ul className="thumbs">
          {message.attachments.map((attachment) => (
            <li key={attachment.id}>
              <Thumb channelId={message.channel_id} attachment={attachment} />
            </li>
          ))}
        </ul>
      ) : null}
      {mine || (context === "channel" && message.reply_count > 0) ? (
        <div className="message-foot">
          {mine ? <DeliveryState chip={deliveryChip(message)} /> : null}
          {context === "channel" && message.reply_count > 0 ? (
            <button className="button button-quiet" type="button" onClick={() => props.onOpenThread?.(message.id)}>
              View {message.reply_count} replies
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Thumb({ channelId, attachment }: { channelId: string; attachment: Message["attachments"][number] }) {
  const [broken, setBroken] = useState(false);
  const href = channelPath(channelId, { photo: attachment.id });
  return (
    <a
      className="thumb"
      href={href}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {broken ? (
        <span className="thumb-missing">
          <ImageOff aria-hidden="true" size={20} />
          <span>{attachment.filename}</span>
        </span>
      ) : (
        <img src={attachment.thumb_url} alt={attachment.filename} onError={() => setBroken(true)} />
      )}
    </a>
  );
}

function QuoteBlock({ quote }: { quote: NonNullable<Message["quote"]> }) {
  if (quote.deleted) return <blockquote className="quote quote-deleted">The quoted message was deleted.</blockquote>;
  return (
    <blockquote className="quote">
      <p className="quote-head">
        <span className="author">{quote.author_name}</span>
        {quote.edited ? <Chip kind="edited" label="Edited" /> : null}
      </p>
      <MessageText text={quote.text} />
    </blockquote>
  );
}

function ActionsMenu({ message, me, context, onAction }: { message: Message; me: Me; context: "channel" | "root" | "reply"; onAction: (action: MessageAction, message: Message) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useTick(1_000, open);
  const viewer = { id: me.user.id, role: me.user.role };

  const items: { action: MessageAction; label: string; glyph: LucideIcon }[] = [];
  if (context === "channel") items.push({ action: "reply", label: "Reply in thread", glyph: Reply });
  items.push({ action: "quote", label: "Quote", glyph: Quote });
  if (mayEdit(viewer, message)) items.push({ action: "edit", label: "Edit", glyph: Pencil });
  if (mayDelete(viewer, message)) items.push({ action: "delete", label: "Delete", glyph: Trash2 });
  if (pins(me.user.role)) items.push(message.pinned ? { action: "unpin", label: "Unpin", glyph: PinOff } : { action: "pin", label: "Pin", glyph: Pin });
  if (maySeeReceipts(viewer, message)) items.push({ action: "receipts", label: "Receipts", glyph: Eye });
  items.push({ action: "versions", label: "Version history", glyph: History });

  // The menu floats on the page layer beside its button, opening upward in the lower half, so
  // no scrolling list or composer can cover it.
  const placeMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const right = Math.max(window.innerWidth - rect.right, 8);
    setPlace(rect.top > window.innerHeight / 2 ? { right, bottom: window.innerHeight - rect.top + 4 } : { right, top: rect.bottom + 4 });
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", placeMenu, true);
    window.addEventListener("resize", placeMenu);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", placeMenu, true);
      window.removeEventListener("resize", placeMenu);
    };
  }, [open]);

  const onKey = (event: React.KeyboardEvent) => {
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (at + (event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
      all[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? all[0] : all.at(-1))?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="menu-anchor">
      <button
        ref={buttonRef}
        className="button button-icon"
        type="button"
        aria-label="Message actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          placeMenu();
          setOpen((value) => !value);
        }}
      >
        <EllipsisVertical aria-hidden="true" size={20} />
      </button>
      {open ? (
        <div ref={menuRef} className="menu" style={place} role="menu" aria-label="Message actions" onKeyDown={onKey}>
          {items.map((item) => (
            <button
              key={item.action}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu-item"
              onClick={() => {
                buttonRef.current?.focus();
                setOpen(false);
                onAction(item.action, message);
              }}
            >
              <item.glyph aria-hidden="true" size={20} />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OutgoingItem({ item, me }: { item: Outgoing; me: Me }) {
  const time = formatWhen(me.workspace.time_zone, item.createdAt);
  return (
    <article className="message message-own message-outgoing" aria-label={`${me.user.name} at ${time}`} tabIndex={0}>
      <header className="message-head">
        <span className="author">{me.user.name}</span>
        <RoleChip role={me.user.role} />
        <time className="stamp">{time}</time>
      </header>
      {item.quote ? <QuoteBlock quote={{ message_id: item.quote.messageId, author_name: item.quote.authorName, text: item.quote.text, edited: false, deleted: false }} /> : null}
      {item.text ? <MessageText text={item.text} /> : null}
      {item.files.length > 0 ? (
        <ul className="outgoing-files">
          {item.files.map((file, i) => (
            <li key={`${file.name}-${i}`}>{file.name}</li>
          ))}
        </ul>
      ) : null}
      <div className="message-foot">
        <DeliveryState chip={{ state: item.state }} />
        {item.state === "failed" ? (
          <>
            <button className="button button-quiet" type="button" onClick={() => void attemptSend(item.clientMessageId)}>
              <RotateCcw aria-hidden="true" size={20} />
              Retry send
            </button>
            <button className="button button-quiet" type="button" onClick={() => dropOutgoing(item.clientMessageId)}>
              <Trash2 aria-hidden="true" size={20} />
              Discard
            </button>
          </>
        ) : null}
      </div>
      {item.state === "failed" && item.failure ? <p className="failure-line">{item.failure}</p> : null}
    </article>
  );
}
