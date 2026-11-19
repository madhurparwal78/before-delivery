import { useEffect, useRef } from 'react';
import { api } from '../../api/client.ts';
import type { InboxResponse } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { setUnread, useUnread } from '../../shell/events.ts';
import { utcMinute } from '../../shell/extract-state.tsx';
import { EmptyState } from '../../ui/empty-state.tsx';
import { Status } from '../../ui/live.tsx';
import '../upload/data-pages.css';
import './inbox.css';

/** Reads the inbox and marks it read; the items keep the read flags they had when the page opened. */
async function openInbox(): Promise<InboxResponse> {
  const inbox = await api.get<InboxResponse>('/api/inbox');
  const read = await api.post<{ unread: number }>('/api/inbox/read');
  setUnread(read.unread);
  return inbox;
}

export function InboxPage() {
  const inbox = useLoad(openInbox, []);
  const unread = useUnread();
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    if (unread > 0) void inbox.reload();
  }, [unread]);

  if (inbox.error) return <ErrorPage error={inbox.error} />;
  const items = inbox.data?.items;

  return (
    <div className="data-page inbox-page">
      <div className="page-head">
        <h1 id="inbox-heading">Inbox</h1>
      </div>
      <Status name="Announcements" text="" />
      <section className="inbox" aria-labelledby="inbox-heading">
        <ul aria-label="Inbox items" className="inbox-items">
          {(items ?? []).map((item) => (
            <li key={item.id} className="card inbox-item" data-read={item.read}>
              <p>{item.text}</p>
              <p className="muted">{utcMinute(item.created_at)} UTC</p>
            </li>
          ))}
        </ul>
        {items && items.length === 0 ? <EmptyState headline="Your inbox is empty." sticker="blob" /> : null}
        {items === undefined ? (
          <div className="card skeleton" aria-hidden="true">
            <span />
            <span />
          </div>
        ) : null}
      </section>
    </div>
  );
}
