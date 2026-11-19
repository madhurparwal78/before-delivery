import { useEffect } from "react";
import { Composer } from "../Composer";
import { loadThread } from "../data";
import { useLiveEvent } from "../hooks";
import { MessageItem, type MessageAction, OutgoingItem } from "../MessageList";
import type { QuoteDraft } from "../Shell";
import { useStore } from "../store";
import type { Channel, Me, Message } from "../types";

// The root at the top, its replies oldest first, the Reply box at the bottom.
export function ThreadPanel(props: {
  channel: Channel;
  rootId: string;
  me: Me;
  onAction: (action: MessageAction, message: Message) => void;
  quote: QuoteDraft | null;
  onClearQuote: () => void;
}) {
  const { channel, rootId, me } = props;
  const { threads, entries, outbox } = useStore();
  const view = threads[rootId];
  const root = entries[rootId];
  const pending = outbox.filter((o) => o.threadRootId === rootId);

  useEffect(() => {
    void loadThread(rootId, channel.id);
  }, [rootId, channel.id]);
  useLiveEvent((event) => {
    if (event.name === "stream.reset") void loadThread(rootId, channel.id);
  });

  return (
    <section className="panel" aria-labelledby="panel-thread">
      <h2 id="panel-thread" className="panel-title">
        Thread
      </h2>
      {!view || view.status === "loading" ? <p className="panel-note">Loading the thread…</p> : null}
      {view?.status === "not_found" ? <p className="panel-note">That was not found.</p> : null}
      {view?.status === "ready" && root ? (
        <>
          <div className="thread-scroll">
            <MessageItem entry={root} me={me} context="root" onAction={props.onAction} />
            <p className="thread-count">{root.reply_count === 1 ? "1 reply" : `${root.reply_count} replies`}</p>
            {view.nextCursor ? (
              <button className="button button-quiet" type="button" onClick={() => void loadThread(rootId, channel.id, view.nextCursor ?? undefined)}>
                Show earlier replies
              </button>
            ) : null}
            {view.ids.map((id) => {
              const entry = entries[id];
              return entry ? <MessageItem key={id} entry={entry} me={me} context="reply" onAction={props.onAction} /> : null;
            })}
            {pending.map((item) => (
              <OutgoingItem key={item.clientMessageId} item={item} me={me} />
            ))}
          </div>
          {root.deleted ? null : <Composer channel={channel} threadRootId={rootId} quote={props.quote} onClearQuote={props.onClearQuote} />}
        </>
      ) : null}
    </section>
  );
}
