// The desk at /desk: one frame for broker, beekeepers and growers (brief: Screens and layout).
// DOM order is the Tab order: skip link, Sign out, Orchards, rail, Order, blocks, ledger actions, then the
// placements or the beekeeper's Open orders and My drops.

import { FileText, Map as MapIcon, MapPin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  orderStatusLabel,
  type AnyOrder,
  type BeekeeperOrderListItem,
  type BrokerOrder,
  type Drop,
  type OrchardSummary,
  type OrderListItem,
  type Settlement,
  type SettlementStatus,
} from "../../shared/api.js";
import { countyName, humanDate } from "../../shared/format.js";
import { get, post } from "../api.js";
import { useFeedback } from "../feedback.js";
import { navigate, useInterval, useLocation } from "../hooks.js";
import { Legend, PlatMap, PlatOutline, PlatPlaceholder } from "../PlatMap.js";
import { toTenths, useStrength, type BlockFigures } from "../strength.js";
import { Button } from "../ui/forms.js";
import { CommitDialog, LogDropDialog, MyDrops, OpenOrders } from "./beekeeper.js";
import { CancelDialog, NewOrchardDialog, NewOrderDialog, SendLinkDialog, SettleDialog } from "./broker.js";
import { Ledger, LinkStatus } from "./Ledger.js";
import { Placements } from "./Placements.js";
import { DeskHeader, OrchardsToggle, useAction, useSession } from "./session.js";
import { Empty } from "./tables.js";

const POLL_MS = 3000;

type DialogState = { seq?: number; opener: HTMLElement | null } & (
  | { kind: "newOrchard" | "newOrder" | "sendLink" | "cancel" }
  | { kind: "settle"; split: Settlement }
  | { kind: "commit"; order: BeekeeperOrderListItem }
  | { kind: "logDrop"; drop: Drop }
);

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1199px)").matches);
  useEffect(() => {
    const list = window.matchMedia("(max-width: 1199px)");
    const change = () => setNarrow(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return narrow;
}

function settlementOf(order: OrderListItem | AnyOrder): SettlementStatus {
  return "settlement_status" in order ? order.settlement_status : "none";
}

function figuresOf(order: AnyOrder): BlockFigures[] {
  return order.blocks.map((block) => ({ id: block.id, name: block.name, average: toTenths(block.average_frames), tier: block.tier }));
}

function payableOf(order: AnyOrder): number {
  return "payable_cents" in order ? order.payable_cents : 0;
}

/** Holds the canvas head and map boxes while the orchards load: the same fields, nothing in them. */
function CanvasPlaceholder() {
  return (
    <>
      <div className="canvas-head" aria-hidden="true">
        <div>
          <p className="orchard-title placeholder-line">&nbsp;</p>
          <p className="orchard-meta">&nbsp;</p>
        </div>
        <div className="field order-picker">
          <label>Order</label>
          <select disabled tabIndex={-1}>
            <option>&nbsp;</option>
          </select>
        </div>
      </div>
      <PlatPlaceholder blocks={[]} />
      <Legend />
    </>
  );
}

export function Desk() {
  const user = useSession();
  const feedback = useFeedback();
  const { search } = useLocation();
  const strength = useStrength();
  const { load, apply } = strength;
  const { busy, run } = useAction();
  const narrow = useNarrow();
  const [orchards, setOrchards] = useState<OrchardSummary[] | null>(null);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [detail, setDetail] = useState<AnyOrder | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLElement>(null);
  const loadedOrder = useRef<string | null>(null);
  const wantedOrder = useRef<string | null>(null);
  const lastOrders = useRef<OrderListItem[]>([]);

  const orchardId = search.get("orchard") ?? orchards?.[0]?.id ?? null;
  const orchard = orchards?.find((entry) => entry.id === orchardId) ?? null;
  const orderId = orchard ? (orchard.orders.find((entry) => entry.id === search.get("order"))?.id ?? orchard.orders[0]?.id ?? null) : null;
  wantedOrder.current = orderId;

  useEffect(() => {
    document.title = "Desk · Swarmline Bloom Desk";
  }, []);

  const loadLists = useCallback(async () => {
    if (!user) return;
    const [orchardList, orderList] = await Promise.all([get<OrchardSummary[]>("/api/orchards"), get<OrderListItem[]>("/api/orders")]);
    if (orchardList.ok) setOrchards(orchardList.data);
    if (orderList.ok) {
      lastOrders.current = orderList.data;
      setOrders(orderList.data);
    }
    if (user.role === "beekeeper") {
      const mine = await get<Drop[]>("/api/drops");
      if (mine.ok) setDrops(mine.data);
    }
  }, [user]);

  const loadDetail = useCallback(
    async (id: string | null) => {
      if (id === null) {
        loadedOrder.current = null;
        setDetail(null);
        return;
      }
      wantedOrder.current = id;
      const result = await get<AnyOrder>(`/api/orders/${id}`);
      // A slow answer for an order no longer on screen is dropped.
      if (!result.ok || wantedOrder.current !== id) return;
      setDetail(result.data);
      if (loadedOrder.current === id) apply(figuresOf(result.data), payableOf(result.data));
      else load(figuresOf(result.data), payableOf(result.data));
      loadedOrder.current = id;
    },
    [load, apply],
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadLists(), loadDetail(orderId)]);
  }, [loadLists, loadDetail, orderId]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    setSelectedBlock(null);
    void loadDetail(orderId);
  }, [orderId, loadDetail]);

  // Broker and grower desks follow samples and settlements made elsewhere; beekeepers refresh on their own actions.
  const live = user !== null && user.role !== "beekeeper";
  useInterval(
    () => {
      if (dialogOpen) return;
      void get<OrderListItem[]>("/api/orders").then((result) => {
        if (!result.ok) return;
        for (const order of result.data) {
          const before = lastOrders.current.find((entry) => entry.id === order.id);
          if (before && settlementOf(before) === "queued" && settlementOf(order) === "settled") feedback.update(`${order.orchard.name} settled.`);
        }
        lastOrders.current = result.data;
        setOrders(result.data);
      });
      void loadDetail(orderId);
    },
    POLL_MS,
    live,
  );

  const chooseOrchard = (id: string) => {
    navigate(`/desk?orchard=${encodeURIComponent(id)}`);
    if (drawer) {
      setDrawer(false);
      requestAnimationFrame(() => toggle.current?.focus());
    }
  };

  useEffect(() => {
    if (drawer) rail.current?.querySelector<HTMLElement>("a")?.focus();
  }, [drawer]);

  // Each opening is a fresh form: a new key resets its fields and reads its defaults again.
  const openDialog = (state: DialogState) => {
    setDialog({ ...state, seq: (dialog?.seq ?? 0) + 1 });
    setDialogOpen(true);
  };
  const closeDialog = () => setDialogOpen(false);

  const statusLabel = useMemo(() => {
    const byOrchard = new Map<string, string>();
    for (const order of orders) {
      if (!byOrchard.has(order.orchard.id)) byOrchard.set(order.orchard.id, orderStatusLabel(order.status, settlementOf(order)));
    }
    return byOrchard;
  }, [orders]);

  if (!user) {
    return (
      <div className="desk is-loading">
        {/* no header until the session is known: drawing it without the name would move it when the name arrives */}
        <p className="loading-line">Reading the desk…</p>
      </div>
    );
  }

  const ref = detail?.ref ?? "";
  const stateCopy = () => `That can't be done while ${ref} is ${detail ? orderStatusLabel(detail.status, settlementOf(detail)) : ""}.`;
  const orderAction = (key: "open" | "place", pending: string, success: string, refusal: (code: string | undefined, status: number) => string | undefined) =>
    void run(key, {
      pending,
      call: () => post<BrokerOrder>(`/api/orders/${detail?.id}/${key}`),
      success: () => success,
      refusal: (failure) => refusal(failure.error?.error, failure.status),
      stateLabel: stateCopy,
      then: refresh,
    }).then((result) => (result.ok ? undefined : refresh()));

  const brokerActions = (
    <div className="actions">
      {detail?.status === "draft" ? (
        <Button
          variant="primary"
          busy={busy === "open"}
          onClick={() =>
            orderAction("open", `Opening ${ref}…`, `${ref} is open to beekeepers. Deposit invoice recorded.`, (_code, status) =>
              status === 503 ? `Billing is unreachable, so ${ref} is still a draft. Try again in a minute.` : undefined,
            )
          }
        >
          Open order
        </Button>
      ) : null}
      {detail?.status === "filled" ? (
        <Button
          variant="primary"
          busy={busy === "place"}
          onClick={() =>
            orderAction("place", `Marking ${ref} placed…`, `${ref} placed. The grower's placement confirmation is on its way.`, (code) =>
              code === "drops_not_delivered" ? `Every drop on ${ref} must be delivered first.` : undefined,
            )
          }
        >
          Mark placed
        </Button>
      ) : null}
      {detail?.status === "placed" ? (
        <Button variant="primary" onClick={(event) => openDialog({ kind: "sendLink", opener: event.currentTarget })}>
          Send inspection link
        </Button>
      ) : null}
      {detail?.status === "inspected" && settlementOf(detail) === "none" ? (
        <Button
          variant="primary"
          busy={busy === "split"}
          onClick={(event) => {
            const opener = event.currentTarget;
            void run("split", {
              pending: "",
              call: () => get<Settlement>(`/api/orders/${detail.id}/settlement`),
              success: () => "",
              then: (split) => openDialog({ kind: "settle", opener, split }),
            });
          }}
        >
          Settle orchard
        </Button>
      ) : null}
      {detail && ["draft", "open", "filled"].includes(detail.status) ? (
        <Button onClick={(event) => openDialog({ kind: "cancel", opener: event.currentTarget })}>Cancel order</Button>
      ) : null}
      <div className="season-setup">
        <Button onClick={(event) => openDialog({ kind: "newOrchard", opener: event.currentTarget })}>New orchard</Button>
        <Button onClick={(event) => openDialog({ kind: "newOrder", opener: event.currentTarget })}>New order</Button>
      </div>
    </div>
  );

  const blocks = detail && orchard ? detail.blocks.map((block) => ({ id: block.id, name: block.name, acres: orchard.blocks.find((entry) => entry.id === block.id)?.acres ?? 1 })) : [];
  const selected = detail?.blocks.find((block) => block.id === selectedBlock) ?? null;

  return (
    <div className={`desk role-${user.role}`}>
      <DeskHeader user={user} skipTarget="plat-map" />
      <OrchardsToggle ref={toggle} open={drawer} onClick={() => setDrawer((open) => !open)} />
      {narrow && drawer ? <div className="scrim" onClick={() => setDrawer(false)} /> : null}
      <div className="desk-grid">
        <nav
          id="orchard-rail"
          ref={rail}
          className={`rail${drawer ? " is-open" : ""}`}
          aria-label="Orchards"
          inert={narrow && !drawer}
          onKeyDown={(event) => {
            if (event.key === "Escape" && drawer) {
              setDrawer(false);
              toggle.current?.focus();
            }
          }}
        >
          <h2 className="rail-title">Orchards</h2>
          {orchards === null ? (
            <ul className="rail-list" aria-hidden="true">
              <li className="skeleton-row" />
              <li className="skeleton-row" />
              <li className="skeleton-row" />
            </ul>
          ) : orchards.length === 0 ? (
            <Empty icon={<MapIcon aria-hidden="true" size={20} strokeWidth={1.5} />}>No orchards yet.</Empty>
          ) : (
            <ul className="rail-list">
              {orchards.map((entry) => (
                <li key={entry.id} className={entry.id === orchardId ? "is-current" : undefined}>
                  {/* The link is named by the orchard alone; its hit area stretches over the whole row. */}
                  <a
                    className="rail-name"
                    href={`/desk?orchard=${encodeURIComponent(entry.id)}`}
                    aria-describedby={`rail-meta-${entry.id}`}
                    aria-current={entry.id === orchardId ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      chooseOrchard(entry.id);
                    }}
                  >
                    {entry.name}
                  </a>
                  <span className="rail-meta" id={`rail-meta-${entry.id}`}>
                    {countyName(entry.county)} <span className="status-chip">{statusLabel.get(entry.id) ?? "No orders"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <section className="canvas-top" aria-label="Plat map and order">
          {orchard === null ? (
            orchards === null ? (
              <CanvasPlaceholder />
            ) : null
          ) : (
            <>
              <div className="canvas-head">
                <div>
                  <h1 className="orchard-title">{orchard.name}</h1>
                  <p className="orchard-meta">
                    {countyName(orchard.county)}{orchard.grower && user.role === "broker" ? ` · ${orchard.grower.name}` : ""}
                  </p>
                </div>
                {orchard.orders.length > 0 ? (
                  <div className="field order-picker">
                    <label htmlFor="order-picker">Order</label>
                    <select id="order-picker" value={orderId ?? ""} onChange={(event) => navigate(`/desk?orchard=${encodeURIComponent(orchard.id)}&order=${encodeURIComponent(event.target.value)}`)}>
                      {orchard.orders.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.ref} · bloom {humanDate(entry.bloom_start)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              {orchard.orders.length === 0 ? (
                <>
                  <Empty icon={<MapPin aria-hidden="true" size={20} strokeWidth={1.5} />}>
                    No orders for this orchard yet.{user.role === "broker" ? " Draft one with New order in the ledger." : ""}
                  </Empty>
                  <PlatOutline blocks={orchard.blocks} note="No order yet" />
                </>
              ) : detail && detail.id === orderId ? (
                <>
                  <PlatMap
                    id="plat-map"
                    orchardName={orchard.name}
                    blocks={blocks}
                    shown={strength.shown.blocks}
                    selectedId={selectedBlock}
                    onSelect={setSelectedBlock}
                    reduced={strength.reduced}
                  />
                  <Legend />
                </>
              ) : (
                <>
                  <PlatPlaceholder blocks={orchard.blocks} />
                  <Legend />
                </>
              )}
            </>
          )}
        </section>

        <aside className="ledger" aria-label="Ledger">
          {orderId === null && orchards !== null ? (
            <>
              <p className="empty">The ledger fills in once this orchard has an order.</p>
              {user.role === "broker" ? brokerActions : null}
            </>
          ) : (
            <Ledger
              user={user}
              order={detail && detail.id === orderId ? detail : null}
              shown={strength.shown}
              notes={strength.notes}
              reduced={strength.reduced}
              actions={user.role === "broker" && detail && detail.id === orderId ? brokerActions : null}
              footer={
                detail ? (
                  <>
                    {user.role === "broker" ? <LinkStatus order={detail} /> : null}
                    {"report_available" in detail && detail.report_available ? (
                      <a className="report-link" href={`/api/orders/${detail.id}/report`} target="_blank" rel="noreferrer">
                        <FileText aria-hidden="true" size={18} strokeWidth={1.5} />
                        Inspection report (PDF)
                      </a>
                    ) : null}
                  </>
                ) : null
              }
            />
          )}
        </aside>

        <section className="canvas-bottom" aria-label="Drops">
          {selected && detail ? <Placements user={user} order={detail} blockId={selected.id} blockName={selected.name} /> : null}
          {user.role === "beekeeper" ? (
            <>
              <OpenOrders
                orders={orders.filter((order): order is BeekeeperOrderListItem => order.status === "open" && "hives_remaining" in order)}
                onCommit={(order, opener) => openDialog({ kind: "commit", order, opener })}
              />
              <MyDrops drops={drops} onLog={(drop, opener) => openDialog({ kind: "logDrop", drop, opener })} />
            </>
          ) : null}
        </section>
      </div>

      {dialog?.kind === "newOrchard" ? (
        <NewOrchardDialog
          key={dialog.seq}
          open={dialogOpen}
          opener={dialog.opener}
          onClose={closeDialog}
          onSaved={async (created) => {
            await loadLists();
            navigate(`/desk?orchard=${encodeURIComponent(created.id)}`);
            closeDialog();
          }}
        />
      ) : null}
      {dialog?.kind === "newOrder" && orchards ? (
        <NewOrderDialog
          key={dialog.seq}
          open={dialogOpen}
          opener={dialog.opener}
          orchards={orchards}
          defaultOrchard={orchardId}
          onClose={closeDialog}
          onSaved={async (created) => {
            await loadLists();
            navigate(`/desk?orchard=${encodeURIComponent(created.orchard.id)}&order=${encodeURIComponent(created.id)}`);
            await loadDetail(created.id);
            closeDialog();
          }}
        />
      ) : null}
      {dialog?.kind === "sendLink" && detail ? (
        <SendLinkDialog key={dialog.seq} open={dialogOpen} opener={dialog.opener} order={detail} onClose={closeDialog} onSent={() => refresh().then(closeDialog)} />
      ) : null}
      {dialog?.kind === "settle" && detail ? (
        <SettleDialog key={dialog.seq} open={dialogOpen} opener={dialog.opener} order={detail} split={dialog.split} onClose={closeDialog} onSettled={() => refresh().then(closeDialog)} />
      ) : null}
      {dialog?.kind === "cancel" && detail ? (
        <CancelDialog key={dialog.seq} open={dialogOpen} opener={dialog.opener} order={detail} onClose={closeDialog} onDone={() => refresh().then(closeDialog)} />
      ) : null}
      {dialog?.kind === "commit" ? (
        <CommitDialog
          key={dialog.seq}
          open={dialogOpen}
          opener={dialog.opener}
          order={dialog.order}
          onClose={closeDialog}
          onRefused={(remaining) => {
            setOrders((list) => list.map((entry) => (entry.id === dialog.order.id && "hives_remaining" in entry ? { ...entry, hives_remaining: remaining } : entry)));
            setDetail((current) => (current && current.id === dialog.order.id && "hives_remaining" in current ? { ...current, hives_remaining: remaining } : current));
          }}
          onCommitted={() => refresh().then(closeDialog)}
        />
      ) : null}
      {dialog?.kind === "logDrop" ? (
        <LogDropDialog key={dialog.seq} open={dialogOpen} opener={dialog.opener} drop={dialog.drop} onClose={closeDialog} onLogged={() => refresh().then(closeDialog)} />
      ) : null}
    </div>
  );
}

