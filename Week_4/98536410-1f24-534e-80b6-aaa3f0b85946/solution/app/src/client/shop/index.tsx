// /shop/<code>: stock, till sales, holds, opening hours, collection and returns for one shop, kept live.
import { useCallback, useEffect, useRef, useState } from "react";
import { Status } from "../controls";
import { ApiFailure, api, apiText } from "../lib/api";
import { formatCountdown } from "../lib/format";
import { useInterval } from "../lib/hooks";
import { useMedia } from "../lib/media";
import { dropScreen, loadScreen, saveScreen } from "../lib/persist";
import { useMe } from "../session";
import { NotFound } from "../screens/notfound";
import type { ReturnStatus } from "../../shared/transitions";
import type { Hold, Hours, Order, OrderRow, ReturnRecord, StockLine, Shop } from "../types";
import { HoursEditor } from "./hours";
import { OrdersTable, type ReturnMemory, type RowAction } from "./orders";
import { ReturnDialog, ReturnsTable } from "./returns";
import { Section } from "./section";
import { CountDialog, StockTable, TillDialog } from "./stock";

const POLL_MS = 5000;
const WIDE = "(min-width: 700px)";
const ERROR_COPY = "Something went wrong. Try again.";
const SECTIONS_KEY = "shop-sections";
const SECTION_NAMES = ["Orders", "Active holds", "Stock", "Opening hours", "Returns"] as const;

export function ShopScreen({ code }: { code: string }) {
  const me = useMe();
  const wide = useMedia(WIDE);
  const [shop, setShop] = useState<Shop | null>(null);
  const [missing, setMissing] = useState(!me.store_ids.includes(code));
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [holds, setHolds] = useState<{ hold: Hold; at: number }[]>([]);
  const [stock, setStock] = useState<StockLine[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [hours, setHours] = useState<Hours | null>(null);
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState<string[]>(() => loadScreen<string[]>(me.user.id, SECTIONS_KEY) ?? ["Orders"]);
  const [count, setCount] = useState<{ open: boolean; line: StockLine | null }>({ open: false, line: null });
  const [till, setTill] = useState(false);
  const [returnMemory, setReturnMemory] = useState<ReturnMemory | null>(() => loadScreen<ReturnMemory>(me.user.id, `return-dialog:${code}`));
  const [returnOrder, setReturnOrder] = useState<Order | null>(null);
  const [focusOrder, setFocusOrder] = useState<string | null>(null);
  const [focusReturn, setFocusReturn] = useState<string | null>(null);
  const ordersTable = useRef<HTMLDivElement | null>(null);
  const returnsTable = useRef<HTMLDivElement | null>(null);
  const countOpener = useRef<HTMLElement | null>(null);
  const tillOpener = useRef<HTMLButtonElement | null>(null);
  const returnOpener = useRef<HTMLElement | null>(null);
  const restoredReturn = useRef(returnMemory !== null);

  const readOrders = useCallback(async () => {
    const answer = await api<{ orders: OrderRow[] }>("GET", `/api/orders?store_id=${code}&limit=100`);
    setOrders(answer.orders);
  }, [code]);
  const readStock = useCallback(async () => setStock((await api<{ lines: StockLine[] }>("GET", `/api/stores/${code}/stock`)).lines), [code]);
  const readReturns = useCallback(async () => setReturns((await api<{ returns: ReturnRecord[] }>("GET", `/api/returns?store_id=${code}`)).returns), [code]);
  const readHours = useCallback(async () => setHours(await api<Hours>("GET", `/api/stores/${code}/hours`)), [code]);

  const readAll = useCallback(() => Promise.allSettled([
    readOrders(),
    readStock(),
    readReturns(),
    api<{ holds: Hold[] }>("GET", `/api/stores/${code}/holds`).then((answer) => setHolds(answer.holds.map((hold) => ({ hold, at: performance.now() })))),
  ]), [code, readOrders, readReturns, readStock]);

  useEffect(() => {
    if (missing) return;
    const shopAnswer = api<Shop>("GET", `/api/stores/${code}`).then(setShop, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    });
    void Promise.allSettled([shopAnswer, readAll(), readHours()]).then(() => setReady(true));
  }, [code, missing, readAll, readHours]);
  useInterval(readAll, POLL_MS, !missing);

  // focus follows an action to the next legal action of the same row, or to the table
  useEffect(() => {
    if (!focusOrder) return;
    const row = ordersTable.current?.querySelector<HTMLElement>(`[data-order-id="${focusOrder}"]`);
    (row?.querySelector<HTMLElement>("button") ?? ordersTable.current)?.focus();
    setFocusOrder(null);
  }, [focusOrder, orders]);
  useEffect(() => {
    if (!focusReturn) return;
    const row = returnsTable.current?.querySelector<HTMLElement>(`[data-return-id="${focusReturn}"]`);
    (row?.querySelector<HTMLElement>("button") ?? returnsTable.current)?.focus();
    setFocusReturn(null);
  }, [focusReturn, returns]);

  // the return dialog's order, and a restored dialog
  useEffect(() => {
    if (returnMemory) api<Order>("GET", `/api/orders/${returnMemory.orderId}`).then(setReturnOrder, () => undefined);
    else setReturnOrder(null);
  }, [returnMemory?.orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const changeReturn = (patch: Partial<ReturnMemory>) => {
    setReturnMemory((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      saveScreen(me.user.id, `return-dialog:${code}`, next);
      return next;
    });
  };
  const closeReturn = () => {
    dropScreen(me.user.id, `return-dialog:${code}`);
    restoredReturn.current = false;
    setReturnMemory(null);
  };

  async function actOnOrder(order: OrderRow, action: RowAction, opener: HTMLElement) {
    if (action.to === "return") {
      returnOpener.current = opener;
      const memory = { orderId: order.id, quantities: {}, reason: "", focus: null, scroll: 0 };
      saveScreen(me.user.id, `return-dialog:${code}`, memory);
      setReturnMemory(memory);
      return;
    }
    setMessage("Saving...");
    try {
      const answer = await api<Order>("POST", `/api/orders/${order.id}/transitions`, { to: action.to });
      setOrders((current) => current.map((row) => (row.id === order.id ? { ...row, status: answer.status } : row)));
      setMessage(`Order ${order.number} is now ${answer.status}.`);
      void readStock();
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.code === "invalid_transition" ? `That step is not possible for order ${order.number} now.` : ERROR_COPY);
      await readOrders().catch(() => undefined);
    }
    setFocusOrder(order.id);
  }

  async function actOnReturn(record: ReturnRecord, to: ReturnStatus) {
    setMessage("Saving...");
    try {
      const answer = await api<ReturnRecord>("POST", `/api/returns/${record.id}/transitions`, { to });
      setReturns((current) => current.map((row) => (row.id === record.id ? answer : row)));
      setMessage(`Return ${record.number} is now ${answer.status}.`);
      void readStock();
      void readOrders();
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.code === "invalid_transition" ? `That step is not possible for return ${record.number} now.` : ERROR_COPY);
      await readReturns().catch(() => undefined);
    }
    setFocusReturn(record.id);
  }

  async function showLabel(record: ReturnRecord) {
    setMessage("Preparing label...");
    try {
      const text = await apiText("POST", `/api/returns/${record.id}/label`, {});
      setLabels((current) => ({ ...current, [record.id]: text }));
      setMessage("");
    } catch {
      setMessage("Return labels are paused until storage returns.");
    }
  }

  async function requestReturn(lines: { sku: string; quantity: number }[], reason: string): Promise<Record<string, string> | null> {
    if (!returnOrder) return null;
    setMessage("Saving...");
    try {
      const made = await api<ReturnRecord>("POST", `/api/orders/${returnOrder.id}/returns`, { lines, reason });
      setMessage(`Return ${made.number} requested.`);
      closeReturn();
      void readReturns();
      return null;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        const raw = (error.body.errors ?? {}) as Record<string, string>;
        const mapped: Record<string, string> = {};
        for (const [field, text] of Object.entries(raw)) {
          const match = /^lines\.(\d+)\.quantity$/.exec(field);
          if (match) mapped[`lines.${lines[Number(match[1])]?.sku}`] = "More than can be returned.";
          else if (field === "reason") mapped.reason = "Give a reason.";
          else if (field === "lines") mapped.reason = mapped.reason ?? text;
        }
        setMessage(ERROR_COPY);
        return mapped;
      }
      setMessage(error instanceof ApiFailure && error.code === "invalid_transition" ? `That step is not possible for order ${returnOrder.number} now.` : ERROR_COPY);
      return {};
    }
  }

  async function saveCount(line: StockLine, counted: number): Promise<boolean> {
    setMessage("Saving...");
    try {
      await api("POST", `/api/stores/${code}/stock/${line.sku}/count`, { on_hand: counted });
      setMessage("Count saved.");
      void readStock();
      return true;
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.code === "below_held" ? `${error.body.held} units are held for collection; the count cannot be lower.` : ERROR_COPY);
      return false;
    }
  }

  async function sell(key: string, sku: string, quantity: number): Promise<boolean> {
    setMessage("Saving...");
    try {
      await api("POST", `/api/stores/${code}/till-sales`, { sku, quantity }, { "Request-Key": key });
      setMessage("Till sale recorded.");
      void readStock();
      return true;
    } catch (error) {
      setMessage(error instanceof ApiFailure && error.code === "stock_conflict" ? `Only ${error.body.remaining} left at ${shop?.name}.` : ERROR_COPY);
      return false;
    }
  }

  const toggle = (name: string) => {
    const next = open.includes(name) ? open.filter((candidate) => candidate !== name) : [...open, name];
    setOpen(next);
    saveScreen(me.user.id, SECTIONS_KEY, next);
  };
  const section = (name: (typeof SECTION_NAMES)[number], className: string, body: React.ReactNode) => (
    <Section name={name} wide={wide} open={open.includes(name)} onToggle={() => toggle(name)} className={className}>{body}</Section>
  );

  if (missing) return <NotFound />;
  if (!ready) return <main className="shop-page" aria-busy="true" />;
  return (
    <main className="shop-page">
      <h1>{shop?.name ?? ""}</h1>
      <Status label="Shop updates" text={message} />
      <div className="shop-grid">
        {section("Orders", "sec-orders", (
          <OrdersTable orders={orders} tableRef={ordersTable} onAct={(order, action, opener) => void actOnOrder(order, action, opener)} />
        ))}
        {section("Active holds", "sec-holds", (
          <div className={`charcoal-panel scroll-x${holds.length === 0 ? " table-empty" : ""}`}>
            {holds.length === 0 ? <p className="table-blank">No active holds.</p> : null}
            <table aria-label="Active holds">
              <thead><tr><th scope="col">Hold</th><th scope="col">Items</th><th scope="col">Time left</th></tr></thead>
              <tbody>
                {holds.map(({ hold }) => (
                  <tr key={hold.id}>
                    <td>{hold.id.slice(0, 8)}</td>
                    <td>{hold.lines.map((line) => `${line.sku} × ${line.quantity}`).join(", ")}</td>
                    <td>{formatCountdown(hold.seconds_left)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {section("Stock", "sec-stock", (
          <>
            <button ref={tillOpener} type="button" className="btn" onClick={() => setTill(true)}>Record till sale</button>
            <StockTable lines={stock} onCount={(line, opener) => { countOpener.current = opener; setCount({ open: true, line }); }} />
          </>
        ))}
        {section("Opening hours", "sec-hours", (
          <HoursEditor shopId={code} shopName={shop?.name ?? ""} hours={hours} announce={setMessage} onPublished={() => void readHours()} />
        ))}
        {section("Returns", "sec-returns", (
          <ReturnsTable returns={returns} labels={labels} tableRef={returnsTable} onAct={(record, to) => void actOnReturn(record, to)} onLabel={(record) => void showLabel(record)} onPaused={setMessage} />
        ))}
      </div>
      <CountDialog line={count.line} open={count.open} opener={countOpener} onClose={() => setCount((current) => ({ ...current, open: false }))} save={saveCount} />
      <TillDialog lines={stock} open={till} opener={tillOpener} onClose={() => setTill(false)} sell={sell} />
      <ReturnDialog
        order={returnOrder} open={returnMemory !== null && returnOrder !== null} restored={restoredReturn.current} memory={returnMemory}
        opener={returnOpener} onClose={closeReturn} onChange={changeReturn} submit={requestReturn}
      />
    </main>
  );
}
