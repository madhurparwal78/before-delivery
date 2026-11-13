import { useCallback, useEffect, useRef, useState } from "react";
import { STAFF_COPY } from "../../../shared/copy.js";
import type { BoxState, PaymentState } from "../../../shared/domain.js";
import { Button, TextField } from "../ui.js";
import { call, failureText, say, sleep } from "./desk.js";
import { humanise } from "./format.js";
import { StaffList, type Column } from "./List.js";
import type { Address, PackerOrder, StaffHit } from "./types.js";

/** An order row, or a box without an order when the search found one. */
interface PackRow {
  key: string;
  number: number;
  plate: string;
  boxState: BoxState;
  reference: string | null;
  recipientName: string | null;
  address: Address | null;
  paymentState: PaymentState | null;
  trackingCode: string | null;
}

const FOLLOW_SECONDS = 30;

const fromOrder = (order: PackerOrder): PackRow => ({ ...order, key: order.reference });
const fromHit = (hit: StaffHit): PackRow => ({
  key: hit.reference ?? `box-${hit.number}`, number: hit.number, plate: hit.plate, boxState: hit.state, reference: hit.reference,
  recipientName: hit.recipientName, address: null, paymentState: null, trackingCode: null,
});

export const PackingPage = () => {
  const [orders, setOrders] = useState<PackerOrder[]>([]);
  const [hits, setHits] = useState<StaffHit[] | null>(null);
  const [query, setQuery] = useState("");
  const action = useRef(0);
  const searches = useRef(0);

  const load = useCallback(async (): Promise<PackerOrder[] | null> => {
    try {
      const reply = await call<{ orders: PackerOrder[] }>("GET", "/api/staff/orders");
      setOrders(reply.body.orders);
      return reply.body.orders;
    } catch (error) {
      say(failureText(error), true);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      action.current += 1;
    };
  }, [load]);

  const search = async (text: string): Promise<void> => {
    setQuery(text);
    const turn = ++searches.current;
    if (text.trim() === "") {
      setHits(null);
      say(null);
      return;
    }
    try {
      const reply = await call<{ hits: StaffHit[]; degraded: boolean }>("GET", `/api/staff/search?q=${encodeURIComponent(text.trim())}`);
      if (turn !== searches.current) return;
      setHits(reply.body.hits);
      say(reply.body.degraded ? STAFF_COPY.searchFallback : null);
    } catch (error) {
      if (turn === searches.current) say(failureText(error), true);
    }
  };

  /** Watches the list until the courier is booked: packed is told as soon as it is seen, shipped ends the watch. */
  const follow = async (reference: string, number: number, turn: number): Promise<void> => {
    let toldPacked = false;
    for (let second = 0; second < FOLLOW_SECONDS; second += 1) {
      const found = (await load())?.find((order) => order.reference === reference);
      if (turn !== action.current) return;
      if (found?.boxState === "shipped") {
        say(STAFF_COPY.shipped(number));
        return;
      }
      if (found?.boxState === "packed" && !toldPacked) {
        say(STAFF_COPY.packed(number));
        toldPacked = true;
      }
      await sleep(1000);
      if (turn !== action.current) return;
    }
  };

  const pack = async (reference: string, number: number): Promise<void> => {
    const turn = ++action.current;
    say(STAFF_COPY.packing(number));
    try {
      await call("POST", `/api/staff/orders/${reference}/pack`);
    } catch (error) {
      say(failureText(error), true);
      await load();
      return;
    }
    await follow(reference, number, turn);
  };

  const putBack = async (number: number): Promise<void> => {
    action.current += 1;
    try {
      await call("POST", `/api/staff/boxes/${number}/back-on-shelf`);
      say(STAFF_COPY.backOnShelf(number));
    } catch (error) {
      say(failureText(error), true);
    }
    await load();
  };

  const rows = hits
    ? hits.map((hit) => {
        const order = orders.find((candidate) => candidate.reference === hit.reference);
        return order ? fromOrder(order) : fromHit(hit);
      })
    : orders.map(fromOrder);

  const columns: Column<PackRow>[] = [
    {
      header: "Box",
      cell: (row) => (
        <>
          <span className="staff-box"><strong>{row.number}</strong> {row.plate}</span>
          {row.reference ? <span className="staff-sub">{row.reference}</span> : null}
        </>
      ),
    },
    {
      header: "Recipient",
      cell: (row) => row.recipientName === null ? <span className="muted">No order</span> : (
        <>
          <span>{row.recipientName}</span>
          {row.address ? <span className="staff-sub">{row.address.street}, {row.address.postcode} {row.address.city}</span> : null}
        </>
      ),
    },
    { header: "Box state", cell: (row) => humanise(row.boxState) },
    { header: "Payment", cell: (row) => row.paymentState ? humanise(row.paymentState) : <span className="muted">none</span> },
    { header: "Tracking", cell: (row) => row.trackingCode ? <code>{row.trackingCode}</code> : <span className="muted">not booked</span> },
    {
      header: "Actions",
      actions: true,
      cell: (row) => {
        const { reference } = row;
        return (
          <div className="staff-actions">
            {reference !== null && row.boxState === "claimed" ? <Button variant="primary" onClick={() => void pack(reference, row.number)}>Pack</Button> : null}
            {row.boxState === "returned" ? <Button onClick={() => void putBack(row.number)}>Back on the shelf</Button> : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <TextField label="Search boxes" type="search" autoComplete="off" value={query} onChange={(event) => void search(event.target.value)} />
      <StaffList label="Orders" rows={rows} rowKey={(row) => row.key} columns={columns} empty={query ? "Nothing on the shelf matches that." : "No orders are waiting."} />
    </>
  );
};
