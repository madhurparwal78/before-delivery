import { ChevronDown, MousePointerClick, PanelLeft, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Figure, FigureStack } from "../components/Figures.tsx";
import { Modal } from "../components/Modal.tsx";
import { WINDOW_STATUS_LABEL, api, capitalised, districtTime, navigate, pollMark, useLayout, useLocation, usePoll, useRevealed, type Layout, type Reply } from "../lib.ts";
import type { Channel, DeliveryWindow, GateCard, Notice, Order, Restriction } from "../types.ts";
import { WindowLabel } from "../components/WindowLabel.tsx";

type Tab = "capacity" | "orders" | "restrictions";
const TABS: { id: Tab; label: string }[] = [
  { id: "capacity", label: "Capacity" },
  { id: "orders", label: "Orders" },
  { id: "restrictions", label: "Restrictions" },
];
const COLUMNS: Record<Layout, number> = { desk: 4, tablet: 2, phone: 1 };
const MARK_MS = 2000;

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset"].includes(target.type);
}

/** Writes the board state to the address in the published order, adding one history entry. */
function boardHref(channels: string | null, window: string | null, tab: string | null): string {
  const parts = [["channels", channels], ["window", window], ["tab", tab]].filter(([, v]) => v) as [string, string][];
  return `/board${parts.length ? `?${parts.map(([k, v]) => `${k}=${v}`).join("&")}` : ""}`;
}

export function Board() {
  const layout = useLayout();
  const { query } = useLocation();
  const channelsParam = query.get("channels");
  const selectedId = query.get("window");
  const tabParam = query.get("tab");
  const tab: Tab = tabParam === "orders" || tabParam === "restrictions" ? tabParam : "capacity";
  const [railOpen, setRailOpen] = useState(layout === "desk");
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState("");
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const toggleRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const previous = useRef(new Map<string, string>());

  const channels = usePoll(() => api<{ channels: Channel[] }>("/api/channels"), [], 10_000);
  const windows = usePoll(() => api<{ windows: DeliveryWindow[] }>("/api/windows"), []);
  const revealed = useRevealed();

  useEffect(() => setRailOpen(layout === "desk"), [layout]);

  useEffect(() => {
    if (!windows.data) return;
    const changed = windows.data.windows.filter((w) => {
      const before = previous.current.get(w.id);
      return before !== undefined && before !== w.remaining_ml;
    });
    previous.current = new Map(windows.data.windows.map((w) => [w.id, w.remaining_ml]));
    if (!changed.length) return;
    const ids = changed.map((w) => w.id);
    setMarked((m) => new Set([...m, ...ids]));
    const timer = setTimeout(() => setMarked((m) => new Set([...m].filter((id) => !ids.includes(id)))), MARK_MS);
    return () => clearTimeout(timer);
  }, [windows.data]);

  const allChannels = channels.data?.channels ?? [];
  const shownChannels = channelsParam === null ? allChannels.map((c) => c.id) : channelsParam.split(",").filter(Boolean);
  const visible = (windows.data?.windows ?? []).filter((w) => shownChannels.includes(w.channel_id));
  const selected = (windows.data?.windows ?? []).find((w) => w.id === selectedId) ?? null;

  const go = (next: { channels?: string | null; window?: string | null; tab?: string | null }) =>
    navigate(boardHref(
      next.channels !== undefined ? next.channels : channelsParam,
      next.window !== undefined ? next.window : selectedId,
      next.tab !== undefined ? next.tab : tabParam,
    ));

  // Cells are memoised on what they show, so a poll, an announcement or an open dialog repaints only
  // the cells whose figures changed rather than the whole grid.
  const goRef = useRef(go);
  goRef.current = go;
  const selectWindow = useCallback((id: string) => goRef.current({ window: id }), []);

  const toggleChannel = (id: string, on: boolean) => {
    const next = allChannels.map((c) => c.id).filter((c) => (c === id ? on : shownChannels.includes(c)));
    go({ channels: next.join(",") });
  };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== "r" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!selectedId || publishing || isTextField(event.target)) return;
      event.preventDefault();
      setPublishing(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, publishing]);

  const rows: DeliveryWindow[][] = [];
  for (let i = 0; i < visible.length; i += COLUMNS[layout]) rows.push(visible.slice(i, i + COLUMNS[layout]));

  const rail = (
    <fieldset className="rail-list">
      <legend className="rail-legend">Channels on the board</legend>
      {allChannels.map((c) => (
        <label key={c.id} className="check">
          <input type="checkbox" checked={shownChannels.includes(c.id)} onChange={(e) => toggleChannel(c.id, e.target.checked)} />
          <span>{c.name}</span>
        </label>
      ))}
    </fieldset>
  );

  const detail = selected && (
    <WindowDetail
      key={selected.id}
      window={selected}
      tab={tab}
      onTab={(next) => go({ tab: next })}
      publishRef={publishRef}
      onPublish={() => setPublishing(true)}
      announce={setStatus}
      onChange={windows.reload}
      windowsSeq={windows.seq}
    />
  );

  return (
    <main className={`page page-board${revealed ? "" : " page-pending"}`} id="main" aria-busy={!revealed}>
      <div className="board-toolbar">
        <button
          ref={toggleRef}
          type="button"
          className="btn btn-quiet"
          aria-expanded={railOpen}
          aria-controls={layout === "phone" ? undefined : "channel-rail"}
          onClick={() => setRailOpen((open) => !open)}
        >
          <PanelLeft size={18} aria-hidden="true" />
          Channels
        </button>
        <h1 className="board-title">Channel board</h1>
        <p role="status" aria-label="Board status" className="status-line board-status">{status}</p>
      </div>
      <div className={`board-body board-${layout}${railOpen ? " rail-open" : ""}`}>
        {railOpen && layout !== "phone" && (
          <section id="channel-rail" className="rail" role="region" aria-label="Channel rail">
            {rail}
          </section>
        )}
        <div className="grid-pane">
          {windows.data === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div role="grid" aria-label="Window grid" className="window-grid">
              {rows.map((row, index) => (
                <div role="row" key={index} className={`grid-row cols-${COLUMNS[layout]}`}>
                  {row.map((w) => (
                    <WindowCell key={w.id} window={w} selected={w.id === selectedId} marked={marked.has(w.id)} onSelect={selectWindow} cellRefs={cellRefs} />
                  ))}
                </div>
              ))}
            </div>
          )}
          {windows.data !== null && visible.length === 0 && <p className="empty">No windows on the chosen channels.</p>}
        </div>
        {layout === "desk" && (
          <section className="detail-pane" role="region" aria-label="Window detail">
            {detail ?? <p className="detail-empty empty"><MousePointerClick size={18} aria-hidden="true" /> Select a window</p>}
          </section>
        )}
      </div>
      {layout === "phone" && railOpen && (
        <Modal label="Channels" variant="drawer" returnFocus={toggleRef} onClose={() => setRailOpen(false)}>
          <div className="drawer-head">
            <h2 className="panel-title">Channels</h2>
            <button type="button" className="btn btn-quiet btn-icon" aria-label="Close channels" onClick={() => setRailOpen(false)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {rail}
        </Modal>
      )}
      {layout !== "desk" && selected && (
        <Modal
          label="Window detail"
          variant={layout === "phone" ? "full" : "sheet"}
          returnFocus={{ current: cellRefs.current.get(selected.id) ?? null }}
          onClose={() => go({ window: null })}
        >
          <div className="sheet-head">
            <h2 className="panel-title">Window detail</h2>
            <button type="button" className="btn btn-quiet btn-icon" aria-label="Close window detail" onClick={() => go({ window: null })}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {detail}
        </Modal>
      )}
      {publishing && selected && (
        <PublishDialog
          window={selected}
          returnFocus={publishRef}
          onClose={() => setPublishing(false)}
          announce={setStatus}
        />
      )}
    </main>
  );
}

interface CellProps {
  window: DeliveryWindow;
  selected: boolean;
  marked: boolean;
  onSelect: (id: string) => void;
  cellRefs: RefObject<Map<string, HTMLButtonElement>>;
}

const sameCell = (a: CellProps, b: CellProps) =>
  a.selected === b.selected && a.marked === b.marked && a.onSelect === b.onSelect &&
  a.window.id === b.window.id && a.window.channel_name === b.window.channel_name && a.window.label === b.window.label &&
  a.window.remaining_ml === b.window.remaining_ml && a.window.status === b.window.status &&
  a.window.restriction_cap_ml_day === b.window.restriction_cap_ml_day;

const WindowCell = memo(function WindowCell({ window: w, selected, marked, onSelect, cellRefs }: CellProps) {
  const ref = useCallback((el: HTMLButtonElement | null) => {
    if (el) cellRefs.current.set(w.id, el);
    else cellRefs.current.delete(w.id);
  }, [cellRefs, w.id]);
  return (
    <div role="gridcell" className="grid-cell">
      <button
        ref={ref}
        type="button"
        className={`cell${selected ? " is-selected" : ""}`}
        aria-label={`${w.channel_name}, ${w.label}, ${w.remaining_ml} ML remaining`}
        aria-pressed={selected}
        onClick={() => onSelect(w.id)}
      >
        {/* The button's name is its aria-label. The tags draw their words from data-tag, so the
            button's visible text stays part of that name (WCAG 2.5.3); the words themselves sit
            in the cell, after the button. */}
        <span className="cell-channel">{w.channel_name}</span>{" "}
        <span className="cell-label"><WindowLabel label={w.label} /></span>{" "}
        <span className="cell-tags" aria-hidden="true">
          <span className={`badge badge-window-${w.status}`} data-tag={WINDOW_STATUS_LABEL[w.status]} />
          {w.restriction_cap_ml_day && <span className="badge badge-alert" data-tag="Restricted" />}
        </span>
        <span className={`cell-figure num${marked ? " is-changed" : ""}`}>
          {w.remaining_ml}{" "}
          <span className="unit">ML</span>
        </span>
      </button>
      <span className="visually-hidden">
        {WINDOW_STATUS_LABEL[w.status]}
        {w.restriction_cap_ml_day && ", Restricted"}
      </span>
    </div>
  );
}, sameCell);

interface DetailProps {
  window: DeliveryWindow;
  tab: Tab;
  onTab: (tab: Tab) => void;
  publishRef: RefObject<HTMLButtonElement | null>;
  onPublish: () => void;
  announce: (text: string) => void;
  onChange: () => void;
  windowsSeq: number;
}

/** What the detail shows around a Schedule, Close, Reopen or Ration: the server's figures from before
 * the request while it is pending, then the figures the reply (or the re-read after a 409) returned,
 * at once, until the polls asked after that moment have answered. */
interface Held {
  window: DeliveryWindow;
  orders: Order[];
  pending: boolean;
  mark: number;
}

interface Settled {
  window: DeliveryWindow | null;
  orders: (rows: Order[]) => Order[];
}

const ACTION_LABEL = { schedule: "Schedule", close: "Close", reopen: "Reopen" } as const;

const NOTICE_KIND: Record<Notice["kind"], string> = { conflict: "Conflict", restriction: "Restriction", ration: "Ration", lapse: "Lapse" };

/** A row's actions, decided only from the server's last order, window and card figures: Schedule on a
 * requested order, Close on a requested, scheduled or running one, Reopen on one closed after flow whose
 * finish card is still open; a closed window offers no Schedule and no Reopen. */
function rowActions(o: Order, windowClosed: boolean, finishOpen: boolean): ("schedule" | "close" | "reopen")[] {
  const actions: ("schedule" | "close" | "reopen")[] = [];
  if (o.status === "requested" && !windowClosed) actions.push("schedule");
  if (o.status === "requested" || o.status === "scheduled" || o.status === "running") actions.push("close");
  if (o.status === "closed" && o.closed_after_flow && finishOpen && !windowClosed) actions.push("reopen");
  return actions;
}

/** The Window orders Status cell: the status label, `Closed (lapsed)` for a lapsed order. */
const statusLabel = (o: Order) => (o.status === "closed" && o.conflict === "lapsed" ? "Closed (lapsed)" : capitalised(o.status));

interface RationReply {
  window: DeliveryWindow;
  rationed: { order_number: string; requested_ml: string; volume_ml: string }[];
  left_requested: string[];
}

function Expander({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const id = `expander-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="expander">
      <button type="button" className="expander-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span>{title}</span>
        <ChevronDown size={18} aria-hidden="true" className="expander-chevron" />
      </button>
      {open && <div id={id} className="expander-body">{children}</div>}
    </div>
  );
}

function WindowDetail({ window: polled, tab, onTab, publishRef, onPublish, announce, onChange, windowsSeq }: DetailProps) {
  const [open, setOpen] = useState({ details: true, cards: false, notices: false });
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const [rationing, setRationing] = useState(false);
  const rationRef = useRef<HTMLButtonElement>(null);
  const orders = usePoll(() => api<{ orders: Order[] }>(`/api/orders?window=${polled.id}`), [polled.id]);
  const cards = usePoll(() => api<{ cards: GateCard[] }>(`/api/gate-cards?window=${polled.id}`), [polled.id]);
  const notices = usePoll(() => api<{ notices: Notice[] }>(`/api/windows/${polled.id}/notices`), [polled.id]);
  const restriction = usePoll(
    () => (polled.restriction_id === null
      ? Promise.resolve({ ok: false as const, status: 404, error: {} })
      : api<{ restriction: Restriction; moved_orders: string[] }>(`/api/restrictions/${polled.restriction_id}`)),
    [polled.restriction_id],
  );

  useEffect(() => {
    if (held && !held.pending && orders.seq > held.mark && windowsSeq > held.mark) setHeld(null);
  }, [held, orders.seq, windowsSeq]);
  const w = held?.window ?? polled;
  const orderRows = held?.orders ?? orders.data?.orders ?? [];

  const removeHolder = async (card: GateCard) => {
    setBusy(true);
    announce("Handing over.");
    const reply = await api<{ card: GateCard }>(`/api/gate-cards/${card.id}/remove-holder`, { method: "POST" });
    setBusy(false);
    announce(reply.ok ? `Gate card for ${card.turnout} handed to ${reply.data.card.holder_code}.` : reply.error.message ?? "");
    cards.reload();
    orders.reload();
  };

  /** Runs one board order action: rows and counters hold the server's last figures while it is
   * pending, then take the reply's figures, or on any error the re-read window and its orders. */
  const act = async (pendingCopy: string, request: () => Promise<Reply<unknown>>, settle: (data: unknown) => { copy: string } & Settled) => {
    if (held?.pending) return;
    const before = { window: w, orders: orderRows };
    setHeld({ ...before, pending: true, mark: Infinity });
    announce(pendingCopy);
    const reply = await request();
    let after: Settled;
    if (reply.ok) {
      const { copy, ...settled } = settle(reply.data);
      after = settled;
      announce(copy);
    } else {
      announce(reply.error.message ?? "");
      const [reread, window] = await Promise.all([
        api<{ orders: Order[] }>(`/api/orders?window=${w.id}`),
        api<{ window: DeliveryWindow }>(`/api/windows/${w.id}`),
      ]);
      after = { window: window.ok ? window.data.window : null, orders: (rows) => (reread.ok ? reread.data.orders : rows) };
    }
    setHeld({ window: after.window ?? before.window, orders: after.orders(before.orders), pending: false, mark: pollMark() });
    orders.reload();
    cards.reload();
    onChange();
  };

  const move = (o: Order, action: "schedule" | "close" | "reopen") =>
    act(
      `Updating order ${o.number}.`,
      () => api<{ order: Order; window: DeliveryWindow }>(`/api/orders/${o.number}/${action}`, { method: "POST" }),
      (data) => {
        const { order, window } = data as { order: Order; window: DeliveryWindow };
        return {
          copy: `Order ${o.number} is now ${statusLabel(order)}.`,
          window,
          orders: (rows) => rows.map((row) => (row.number === order.number ? order : row)),
        };
      },
    );

  const ration = () =>
    act(
      "Rationing.",
      () => api<RationReply>(`/api/windows/${w.id}/ration`, { method: "POST" }),
      (data) => {
        const { window, rationed, left_requested } = data as RationReply;
        const shares = new Map(rationed.map((r) => [r.order_number, r]));
        return {
          copy: `Window rationed. ${rationed.length} orders scheduled, ${left_requested.length} left requested.`,
          window,
          orders: (rows) =>
            rows.map((row) => {
              const share = shares.get(row.number);
              return share ? { ...row, status: "scheduled", volume_ml: share.volume_ml, requested_ml: share.requested_ml, rationed: true, conflict: null } : row;
            }),
        };
      },
    );

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length]!;
    onTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const cardList = cards.data?.cards ?? [];
  const finishOpen = (o: Order) => cardList.some((c) => c.order_number === o.number && c.kind === "finish" && c.state === "open");
  const windowClosed = w.status === "closed";
  const requestedCount = orderRows.filter((o) => o.status === "requested").length;

  return (
    <div className="detail">
      <p className="detail-heading">
        <span className="detail-channel">{w.channel_name}</span>
        <span className="muted"><WindowLabel label={w.label} /></span>
      </p>
      {/* Every change of the server's values runs over 0.6 s (Motion and effects); around an order action
          the counters hold the pre-request figures, then run to the reply's (or re-read's) (Feedback states). */}
      <FigureStack>
        <Figure label="Remaining ML" value={w.remaining_ml} unit="ML" size="xl" animate />
        <Figure label="Delivered ML" value={w.delivered_ml} unit="ML" size="lg" animate />
        <Figure label="Channel flow" value={w.channel_flow_ml_day} unit="ML/day" size="lg" animate />
      </FigureStack>
      <button ref={publishRef} type="button" className="btn btn-ink btn-block" onClick={onPublish}>
        Publish restriction
      </button>
      <div role="tablist" aria-label="Window views" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === tab ? 0 : -1}
            className="tab"
            onClick={() => onTab(t.id)}
            onKeyDown={onTabKey}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
        {tab === "capacity" && (
          <>
            <Expander title="Window details" open={open.details} onToggle={() => setOpen((o) => ({ ...o, details: !o.details }))}>
              <dl className="facts facts-tight">
                <div><dt>Opens</dt><dd>{districtTime(w.opens_at)}</dd></div>
                <div><dt>Closes</dt><dd>{districtTime(w.closes_at)}</dd></div>
                <div><dt>Hours</dt><dd className="num">{w.hours}</dd></div>
                <div><dt>Status</dt><dd>{WINDOW_STATUS_LABEL[w.status]}</dd></div>
                <div><dt>Table cap</dt><dd className="num">{w.table_cap_ml_day} ML/day</dd></div>
                <div><dt>Effective cap</dt><dd className="num">{w.effective_cap_ml_day} ML/day</dd></div>
                <div><dt>Cap volume</dt><dd className="num">{w.cap_volume_ml} ML</dd></div>
                <div><dt>Committed</dt><dd className="num">{w.committed_ml} ML</dd></div>
                <div><dt>Rostered operator</dt><dd>{w.rostered_operator}</dd></div>
              </dl>
              <a className="link" href={`/channels/${w.channel_id}/capacity`} onClick={(e) => { e.preventDefault(); navigate(`/channels/${w.channel_id}/capacity`); }}>
                Edit capacity table
              </a>
            </Expander>
            <Expander title="Gate cards" open={open.cards} onToggle={() => setOpen((o) => ({ ...o, cards: !o.cards }))}>
              <ul className="rows">
                {cardList.filter((c) => c.state !== "spent").map((c) => (
                  <li key={c.id} className="row-item">
                    <div>
                      <p className="row-title">{c.turnout} · {c.kind === "start" ? "Start" : "Finish"}</p>
                      <p className="muted">Holder {c.holder_code} · {c.state === "open" ? "Open" : "Waiting for the store"}</p>
                    </div>
                    {c.state === "open" && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-small"
                        aria-label={`Remove holder ${c.turnout}`}
                        disabled={busy}
                        onClick={() => removeHolder(c)}
                      >
                        Remove holder
                      </button>
                    )}
                  </li>
                ))}
                {cards.data && !cards.data.cards.some((c) => c.state !== "spent") && <li className="muted">No open gate cards.</li>}
              </ul>
            </Expander>
            <Expander title="Notices" open={open.notices} onToggle={() => setOpen((o) => ({ ...o, notices: !o.notices }))}>
              <ul className="rows">
                {(notices.data?.notices ?? []).map((n, i) => (
                  <li key={i} className="row-item">
                    <div>
                      <p className="row-title">{NOTICE_KIND[n.kind]} · {n.grower_name}</p>
                      <p className="muted">{n.subject}</p>
                    </div>
                    <span className={`badge${n.state === "queued" ? " badge-alert" : ""}`}>{n.state === "queued" ? "Queued" : "Sent"}</span>
                  </li>
                ))}
                {notices.data?.notices.length === 0 && <li className="muted">No notices for this window.</li>}
              </ul>
            </Expander>
          </>
        )}
        {tab === "orders" && (
          <>
            {!windowClosed && requestedCount > 0 && (
              <button
                ref={rationRef}
                type="button"
                className="btn btn-ink btn-block"
                aria-disabled={held?.pending ? true : undefined}
                onClick={() => !held?.pending && setRationing(true)}
              >
                Ration window
              </button>
            )}
            <table className="table orders-table" aria-label="Window orders">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Turnout</th>
                  <th scope="col">Grower</th>
                  <th scope="col" className="n">Volume (ML)</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderRows.map((o) => {
                  const actions = rowActions(o, windowClosed, finishOpen(o));
                  return (
                    <tr key={o.number}>
                      <th scope="row" className="code" data-label="Order">{o.number}</th>
                      <td className="code" data-label="Turnout">{o.turnout}</td>
                      <td data-label="Grower">{o.grower_name}</td>
                      <td className="n num" data-label="Volume (ML)">
                        <span className="volume-stack">
                          {o.volume_ml}{" "}
                          {o.rationed && <span className="cell-sub">Asked {o.requested_ml} ML</span>}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className="badges">
                          <span className={`badge badge-${o.status}`}>{statusLabel(o)}</span>
                          {o.closed_after_flow && <span className="badge">After flow</span>}
                        </span>
                      </td>
                      <td data-label={actions.length ? "Actions" : undefined}>
                        <span className="row-actions">
                          {actions.map((name) => {
                            const label = ACTION_LABEL[name];
                            return (
                              <button
                                key={name}
                                type="button"
                                className="btn btn-quiet btn-small"
                                aria-label={`${label} order ${o.number}`}
                                aria-disabled={held?.pending ? true : undefined}
                                onClick={() => move(o, name)}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {orders.data?.orders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">No orders in this window.</td>
                  </tr>
                )}
              </tbody>
            </table>
            {rationing && (
              <Modal role="alertdialog" labelledBy="ration-heading" returnFocus={rationRef} onClose={() => setRationing(false)}>
                <div className="modal-body">
                  <h2 id="ration-heading" className="modal-title">Ration <WindowLabel label={w.label} /></h2>
                  <p>Share {w.remaining_ml} ML among {requestedCount} requested orders in proportion to what each asked for.</p>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-commit"
                      onClick={() => {
                        setRationing(false);
                        void ration();
                      }}
                    >
                      Ration
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setRationing(false)}>Cancel</button>
                  </div>
                </div>
              </Modal>
            )}
          </>
        )}
        {tab === "restrictions" && (restriction.data ? (
          <div className="restriction-summary">
            <p><span className="badge badge-alert">Restricted</span> <span className="num">{restriction.data.restriction.cap_ml_day} ML/day</span></p>
            <p>{restriction.data.restriction.reason}</p>
            <p className="muted">Effective {districtTime(restriction.data.restriction.effective_at)}</p>
            <p>Moved orders: {restriction.data.moved_orders.length ? restriction.data.moved_orders.join(", ") : "none"}</p>
            <a className="link" href={`/restrictions/${w.restriction_id}`} onClick={(e) => { e.preventDefault(); navigate(`/restrictions/${w.restriction_id}`); }}>
              Open the restriction
            </a>
          </div>
        ) : (
          <p className="muted">{w.restriction_id === null ? "No restriction on this window." : "Loading…"}</p>
        ))}
      </div>
    </div>
  );
}

function PublishDialog({ window: w, returnFocus, onClose, announce }: { window: DeliveryWindow; returnFocus: RefObject<HTMLButtonElement | null>; onClose: () => void; announce: (text: string) => void }) {
  const [cap, setCap] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem("");
    announce("Publishing restriction.");
    const reply = await api<{ restriction: Restriction; window: DeliveryWindow; moved_orders: string[] }>(`/api/windows/${w.id}/restrictions`, {
      method: "POST",
      body: { cap_ml_day: cap.trim(), reason },
    });
    setBusy(false);
    if (reply.ok) {
      onClose();
      navigate(`/restrictions/${reply.data.restriction.id}`);
      return;
    }
    if (reply.error.errors) {
      setErrors(reply.error.errors);
      announce("Check the cap and reason.");
    } else {
      setProblem(reply.error.message ?? "");
      announce(reply.error.message ?? "");
    }
  };

  return (
    <Modal labelledBy="publish-heading" returnFocus={returnFocus} onClose={onClose}>
      <form className="modal-body" onSubmit={submit} noValidate>
        <h2 id="publish-heading" className="modal-title">Publish restriction</h2>
        <p className="muted">{w.channel_name}, {w.label}. Current cap {w.effective_cap_ml_day} ML/day.</p>
        <div className="field">
          <label className="field-label" htmlFor="restriction-cap">Cap (ML/day)</label>
          <input id="restriction-cap" type="text" inputMode="decimal" className="num-input" value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={Boolean(errors.cap_ml_day)} />
          {errors.cap_ml_day && <p className="field-error">{errors.cap_ml_day}</p>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="restriction-reason">Reason</label>
          <input id="restriction-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={Boolean(errors.reason)} />
          {errors.reason && <p className="field-error">{errors.reason}</p>}
        </div>
        {problem && <p className="field-error">{problem}</p>}
        <div className="modal-actions">
          <button type="submit" className="btn btn-commit" disabled={busy}>Publish</button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
