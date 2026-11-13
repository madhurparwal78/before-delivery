import { useState } from "react";
import { Figure, FigureStack } from "../components/Figures.tsx";
import { Page } from "../components/Shell.tsx";
import { api, capitalised, takeFlash, useOrderChanges, usePoll } from "../lib.ts";
import type { DeliveryWindow, Order, User } from "../types.ts";

const CONFLICT_LINE = {
  restriction: "Moved back by a restriction.",
  lapsed: "Lapsed when the window closed.",
} as const;

export function OrderPage({ number, user }: { number: string; user: User }) {
  const [status, setStatus] = useState(() => takeFlash(`order:${number}`));
  const [busy, setBusy] = useState(false);
  const order = usePoll(() => api<{ order: Order }>(`/api/orders/${encodeURIComponent(number)}`), [number]);
  const o = order.data?.order;
  const win = usePoll(
    () => (o ? api<{ window: DeliveryWindow }>(`/api/windows/${o.window_id}`) : Promise.resolve({ ok: false as const, status: 400, error: {} })),
    [o?.window_id],
  );
  const w = win.data?.window;
  useOrderChanges(o ? [o] : undefined, setStatus);

  const cancel = async () => {
    setBusy(true);
    setStatus("Cancelling.");
    const reply = await api<{ order: Order }>(`/api/orders/${encodeURIComponent(number)}/cancel`, { method: "POST" });
    setBusy(false);
    setStatus(reply.ok ? `Order ${number} is now ${capitalised(reply.data.order.status)}.` : reply.error.message ?? "");
    order.reload();
    win.reload();
  };

  if (order.failure?.status === 404) {
    return (
      <Page title={`Order ${number}`}>
        <p>There is no order {number} in your reach.</p>
      </Page>
    );
  }

  const lead = (
    <section className="lead" aria-label="Window remaining">
      <FigureStack>
        <Figure label="Window remaining" value={w?.remaining_ml ?? "…"} unit="ML" size="xl" />
      </FigureStack>
    </section>
  );

  return (
    <Page title={`Order ${number}`} lead={lead}>
      {o ? (
        <div className="record card-sheet">
          <div className="record-status">
            <div role="group" aria-label="Order state" className="order-state">
              <span className={`badge badge-${o.status}`}>{capitalised(o.status)}</span>
            </div>
            {o.closed_after_flow && <span className="badge">Closed after flow</span>}
          </div>
          <dl className="facts">
            <div><dt>Turnout</dt><dd>{o.turnout}</dd></div>
            <div><dt>Window</dt><dd>{w ? `${w.channel_name}, ${w.label}` : o.window_id}</dd></div>
            <div><dt>Volume</dt><dd className="num">{o.volume_ml} ML</dd></div>
            <div><dt>Flow rate</dt><dd className="num">{o.rate_ml_day} ML/day</dd></div>
            <div><dt>Gate worked by</dt><dd>{o.holder_code}</dd></div>
            <div><dt>Standby operator</dt><dd>{o.standby_code ?? "No standby"}</dd></div>
            {o.conflict && (
              <div><dt>Conflict</dt><dd className="alert-text">{CONFLICT_LINE[o.conflict]}</dd></div>
            )}
            {o.rationed && (
              <div><dt>Ration</dt><dd className="num">Rationed from {o.requested_ml} ML.</dd></div>
            )}
          </dl>
          {user.role === "grower" && (o.status === "requested" || o.status === "scheduled") && (
            <button type="button" className="btn btn-ink" onClick={cancel} disabled={busy}>Cancel order</button>
          )}
        </div>
      ) : (
        <p className="muted">Loading…</p>
      )}
      <p role="status" aria-label="Order status" className="status-line">{status}</p>
    </Page>
  );
}
