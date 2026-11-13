// The inbox feed: alert items newest first, acknowledged in place, added to cases.
import { useState } from "react";
import { api } from "../lib/api";
import { useShown } from "../lib/format";
import { useLive } from "../lib/live";
import { useAppState } from "../lib/store";
import { Button, EmptyBand, LoadFailed, Skeleton } from "../lib/ui";
import { useResource } from "../lib/useResource";
import { Link } from "../lib/router";
import { AddToCaseDialog, type CaseTarget } from "./AddToCase";

interface InboxItem {
  id: number;
  rule: number;
  group: string;
  text: string;
  at: string;
  acknowledged_by: string | null;
}

export function InboxPage() {
  const list = useResource(() => api.get<{ items: InboxItem[] }>("/api/inbox"), []);
  const [adding, setAdding] = useState<CaseTarget | null>(null);
  const shown = useShown();
  const editor = useAppState((s) => s.me?.space.role !== "viewer");

  useLive(["inbox"], (data) => {
    const item = data.item as InboxItem;
    list.set((current) => {
      const items = current?.items ?? [];
      return { items: items.some((i) => i.id === item.id) ? items.map((i) => (i.id === item.id ? item : i)) : [item, ...items] };
    });
  });

  const acknowledge = async (item: InboxItem): Promise<void> => {
    const updated = await api.post<InboxItem>(`/api/inbox/${item.id}/ack`);
    list.set((current) => ({ items: (current?.items ?? []).map((i) => (i.id === updated.id ? { ...i, acknowledged_by: updated.acknowledged_by } : i)) }));
  };

  return (
    <div className="stack">
      <h1>Inbox</h1>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {list.data?.items.length === 0 ? <EmptyBand line="Nothing in the inbox."><Link to="/alerts" className="btn btn-primary">Alerts</Link></EmptyBand> : null}
      {list.data && list.data.items.length > 0 ? (
        <div role="feed" aria-label="Inbox" className="stack">
          {list.data.items.map((item) => (
            <article key={item.id} className="card inbox-item" aria-label={item.text}>
              <p className="mono">{item.text}</p>
              <p className="small muted mono">{shown(item.at)}</p>
              {item.acknowledged_by ? <p className="small">Acknowledged by {item.acknowledged_by}</p> : null}
              <div className="item-actions">
                <Button disabled={!editor} onClick={() => void acknowledge(item)}>Acknowledge</Button>
                <Button disabled={!editor} onClick={() => setAdding({ inbox_item: item.id, title: item.text })}>Add to case</Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {adding ? <AddToCaseDialog target={adding} onClose={() => setAdding(null)} /> : null}
    </div>
  );
}
