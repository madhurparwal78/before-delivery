import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { rupees } from "../../shared/format";
import { Empty } from "../components/Empty";
import { NotFound } from "../components/NotFound";
import { ApiFailure, failureMessage, get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { ShopperOnly } from "./orders/Gate";
import { dayOf } from "./orders/format";
import { ShipmentCard } from "./orders/ShipmentCard";
import type { Order } from "./orders/types";
import "../styles/orders.css";

const TONES = ["black", "pink", "yellow"] as const;
const INVOICE_POLL_MS = 5000;
const INVOICE_POLLS = 12;

function Detail(): ReactNode {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [problem, setProblem] = useState<{ missing: boolean; message: string } | null>(null);
  const [update, setUpdate] = useState("");
  const [polls, setPolls] = useState(0);
  useTitle("your order");

  const load = useCallback(async (): Promise<void> => {
    try {
      setOrder(await get<Order>(`/api/orders/${id}`));
      setProblem(null);
    } catch (failure) {
      setProblem({ missing: failure instanceof ApiFailure && failure.status === 404, message: failureMessage(failure) });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const preparing = order?.shipments.some((shipment) => shipment.invoice_status === "pending") ?? false;
  useEffect(() => {
    if (!preparing || polls >= INVOICE_POLLS) return undefined;
    const timer = window.setTimeout(() => {
      setPolls((count) => count + 1);
      void load();
    }, INVOICE_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [preparing, polls, load]);

  if (problem?.missing) return <NotFound />;
  if (problem && !order) {
    return (
      <Empty tone="black" sign="box" as="h1">
        {problem.message}
      </Empty>
    );
  }
  if (!order) {
    return (
      <section className="panel panel--ground" aria-busy="true">
        <div className="skeleton" style={{ minHeight: 240 }} />
      </section>
    );
  }

  return (
    <div className="ord">
      <section className="panel panel--black ord__head">
        <h1>your order.</h1>
        <p className="bill">
          <span className="ord__ref">{order.order_id}</span>, placed {dayOf(order.placed_at)}, <span className="amount">{rupees(order.payable_paise)}</span>
        </p>
        <p className="status" role="status" aria-label="Order updates">
          {update}
        </p>
      </section>
      <section className="panel panel--ground">
        <div className="ship-grid">
          {order.shipments.map((shipment, index) => (
            <ShipmentCard
              key={shipment.shipment_id}
              shipment={shipment}
              refunds={order.refunds.filter((refund) => refund.shipment_id === shipment.shipment_id)}
              tone={TONES[index % TONES.length] as (typeof TONES)[number]}
              onChanged={(message) => {
                if (message) setUpdate(message);
                setPolls(0);
                void load();
              }}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default function OrderDetail(): ReactNode {
  return (
    <ShopperOnly>
      <Detail />
    </ShopperOnly>
  );
}
