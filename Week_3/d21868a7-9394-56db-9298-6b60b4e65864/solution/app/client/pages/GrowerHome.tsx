import { ClipboardList } from "lucide-react";
import { useState } from "react";
import { AllocationCounter, Page } from "../components/Shell.tsx";
import { WINDOW_STATUS_LABEL, api, capitalised, navigate, useOrderChanges, usePoll } from "../lib.ts";
import type { DeliveryWindow, Order } from "../types.ts";
import { WindowLabel } from "../components/WindowLabel.tsx";

export function GrowerHome() {
  const orders = usePoll(() => api<{ orders: Order[] }>("/api/orders"), []);
  const [status, setStatus] = useState("");
  useOrderChanges(orders.data?.orders, setStatus);
  const turnouts = usePoll(() => api<{ turnouts: { code: string; channel_id: string }[] }>("/api/turnouts"), []);
  const windows = usePoll(() => api<{ windows: DeliveryWindow[] }>("/api/windows"), []);
  const labels = new Map((windows.data?.windows ?? []).map((w) => [w.id, w.label]));
  const channels = new Set((turnouts.data?.turnouts ?? []).map((t) => t.channel_id));
  const mine = (windows.data?.windows ?? []).filter((w) => channels.has(w.channel_id) && w.status !== "closed");

  return (
    <Page
      title="Windows on your channels"
      lead={
        <div className="grower-top">
          <AllocationCounter />
        <section aria-labelledby="orders-heading" className="table-host">
          <h2 id="orders-heading" className="panel-title">Your orders</h2>
          {orders.data === null ? (
            <p className="muted">Loading…</p>
          ) : orders.data.orders.length === 0 ? (
            <p className="empty"><ClipboardList size={18} aria-hidden="true" /> No orders yet. Pick a window below to order water.</p>
          ) : (
            <table className="table" aria-labelledby="orders-heading">
              <thead>
                <tr><th scope="col">Order</th><th scope="col" className="code">Turnout</th><th scope="col">Window</th><th scope="col" className="n">Volume (ML)</th><th scope="col" className="n">Rate (ML/day)</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {orders.data.orders.map((o) => (
                  <tr key={o.number}>
                    <td data-label="Order"><a className="link" href={`/orders/${o.number}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${o.number}`); }}>{o.number}</a></td>
                    <td data-label="Turnout" className="code">{o.turnout}</td>
                    <td data-label="Window">{labels.get(o.window_id) ?? o.window_id}</td>
                    <td data-label="Volume (ML)" className="n num">{o.volume_ml}</td>
                    <td data-label="Rate (ML/day)" className="n num">{o.rate_ml_day}</td>
                    <td data-label="Status"><span className={`badge badge-${o.status}`}>{capitalised(o.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p role="status" aria-label="Order status" className="status-line">{status}</p>
        </section>
        </div>
      }
    >
        <section aria-label="Windows on your channels">
          <ul className="rows">
            {mine.map((w) => (
              <li key={w.id} className="row-item">
                <div>
                  <p className="row-title">{w.channel_name}</p>
                  <p className="muted"><WindowLabel label={w.label} /></p>
                  <p>
                    <span className="badge">{WINDOW_STATUS_LABEL[w.status]}</span>
                    {w.restriction_cap_ml_day && <span className="badge badge-alert">Restricted</span>}
                  </p>
                </div>
                <div className="row-end">
                  <p className="num row-figure">{w.remaining_ml} <span className="unit">ML</span></p>
                  <a
                    className="btn btn-ink btn-small"
                    href={`/grower/orders/new?window=${w.id}`}
                    aria-label={`Order in ${w.channel_name}, ${w.label}`}
                    onClick={(e) => { e.preventDefault(); navigate(`/grower/orders/new?window=${w.id}`); }}
                  >
                    Order
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
    </Page>
  );
}
