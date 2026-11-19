import { useRef } from "preact/hooks";
import { api, get } from "../api";
import { useResource, useMount } from "../hooks";
import { navigate } from "../router";
import { announce, openModal, unreadStore } from "../store";
import type { InboxItem, TaskDetail } from "../types";
import { EmptyState, LoadingBlock } from "./NotFound";
import { Pill, Status } from "../ui";
import { DecideDialog } from "../project/Detail";

export function Inbox() {
  const inbox = useResource<{ unread: number; items: InboxItem[] }>(async () => {
    const result = await get<{ unread: number; items: InboxItem[] }>("/api/inbox");
    return result.ok ? result.data : undefined;
  }, [], (e) => e.t === "inbox");
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useMount(() => {
    if (inbox.data) unreadStore.set(inbox.data.unread);
  }, [inbox.data?.unread]);

  if (!inbox.data) return <div class="page narrow inbox-page"><h1>Inbox</h1><LoadingBlock reload={inbox.reload} /></div>;
  const items = inbox.data.items;

  const focusItem = (id: string | undefined) => {
    const el = id ? list.current?.querySelector<HTMLElement>(`[data-item="${id}"]`) : null;
    (el ?? heading.current)?.focus();
  };

  const patch = async (item: InboxItem, body: Record<string, unknown>) => {
    const index = items.findIndex((i) => i.id === item.id);
    const neighbour = items[index + 1] ?? items[index - 1];
    const read = body.read as boolean | undefined;
    const next = body.archived ? items.filter((i) => i.id !== item.id) : items.map((i) => (i.id === item.id ? { ...i, read: read ?? i.read } : i));
    inbox.set({ unread: next.filter((i) => !i.read).length, items: next });
    announce("Inbox status", body.archived ? "Archived" : read ? "Marked as read" : "Marked as unread");
    if (body.archived) queueMicrotask(() => queueMicrotask(() => focusItem(neighbour?.id)));
    await api("PATCH", `/api/inbox/${item.id}`, body);
  };

  const open = async (item: InboxItem) => {
    if (!item.taskId) return;
    const task = await get<TaskDetail>(`/api/tasks/${item.taskId}`);
    if (task.ok) navigate(`/projects/${task.data.projectId}?task=${item.taskId}`);
  };

  const decide = (item: InboxItem) => {
    void (async () => {
      const task = await get<TaskDetail>(`/api/tasks/${item.taskId}`);
      if (!task.ok) return;
      openModal((close) => (
        <DecideDialog task={task.data} close={close} onDecided={(text) => { announce("Approval status", `Decision saved: ${text}`); inbox.reload(); }} />
      ));
    })();
  };

  const keydown = (event: KeyboardEvent) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-item]");
    if (!el) return;
    const item = items.find((i) => i.id === el.dataset.item)!;
    const at = items.indexOf(item);
    const onControl = (event.target as HTMLElement).closest("button, a, input, select, textarea") !== null;
    if (event.key === "ArrowDown" && items[at + 1]) { event.preventDefault(); focusItem(items[at + 1].id); }
    else if (event.key === "ArrowUp" && items[at - 1]) { event.preventDefault(); focusItem(items[at - 1].id); }
    else if (event.key === "Enter" && !onControl) { event.preventDefault(); void open(item); }
    else if (event.key === "m" || event.key === "M") { event.preventDefault(); void patch(item, { read: !item.read }); }
    else if (event.key === "e" || event.key === "E") { event.preventDefault(); void patch(item, { archived: true }); }
  };

  return (
    <div class="page narrow inbox-page">
      <h1>Inbox</h1>
      <Status name="Approval status" />
      {items.length === 0 ? (
        <EmptyState title="Inbox is empty" action="See projects" onAction={() => navigate("/")} />
      ) : (
        <ul class="inbox-list plain-list" aria-label="Inbox" ref={list} onKeyDown={keydown}>
          {items.map((item, i) => (
            <li key={item.id} class={`inbox-item card${item.read ? "" : " is-unread"}`} data-item={item.id} data-read={String(item.read)} tabIndex={i === 0 ? 0 : -1}>
              <span class="item-text">{item.text}</span>
              <span class="muted num">{item.createdAt.slice(0, 16).replace("T", " ")}</span>
              {!item.read && <span class="unread-label">Unread</span>}
              {item.pending && <Pill onClick={() => decide(item)}>Decide</Pill>}
              <span class="item-actions">
                <Pill kind="outline" class="pill-small" tabIndex={-1} onClick={() => void patch(item, { read: !item.read })}>{item.read ? "Mark unread" : "Mark read"}</Pill>
                <Pill kind="outline" class="pill-small" tabIndex={-1} onClick={() => void patch(item, { archived: true })}>Archive</Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
      <h2 ref={heading} tabIndex={-1} class="sr-only">Inbox items</h2>
    </div>
  );
}
