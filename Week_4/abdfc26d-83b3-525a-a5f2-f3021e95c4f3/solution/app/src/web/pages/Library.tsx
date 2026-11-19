import { useEffect, useState } from "react";
import { seedHash, seedUniform } from "../../shared/rules";
import { api, type Order } from "../api";
import { LiveCanvas } from "../components/LiveCanvas";
import { EmptyState, Icon, LiveStatus, useAnnouncer } from "../components/ui";
import { copy, money } from "../copy";
import { Link } from "../router";
import { useReducedMotion } from "../session";

const STATE_WORDS: Record<Order["state"], string> = {
  held: "Held",
  paying: "Paying",
  paid: "Paid",
  invoiced: "Invoiced",
  receipted: "Receipted",
  refunded: "Refunded",
  expired: "Expired",
  failed: "Payment failed",
};
const DOWNLOADABLE: Order["state"][] = ["paid", "invoiced", "receipted", "refunded"];

export function Library() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const announcer = useAnnouncer();
  const reduced = useReducedMotion();
  useEffect(() => {
    void api<{ orders: Order[] }>("GET", "/api/me/orders").then((r) => r.ok && setOrders(r.data.orders));
  }, []);

  const download = async (order: Order, kind: "export" | "invoice") => {
    const result = await api<{ url: string }>("GET", `/api/orders/${order.id}/${kind}`);
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    if (result.status === 503) announcer.say(copy.storageDown);
    else if (result.error.code === "invoice_pending") announcer.say(copy.invoicePending(String(result.error.invoice_number ?? order.invoice_number)));
    else announcer.say(result.error.message);
  };

  const actions = (order: Order) =>
    DOWNLOADABLE.includes(order.state) ? (
      <div className="row-actions">
        <button type="button" className="button button-ghost" onClick={() => void download(order, "export")}>
          <Icon name="download" size={16} />
          Download export
        </button>
        <button type="button" className="button button-ghost" onClick={() => void download(order, "invoice")}>
          <Icon name="download" size={16} />
          Download invoice
        </button>
      </div>
    ) : null;

  const thumb = (order: Order) => (
    <LiveCanvas
      program={{ kind: "house", slug: order.piece_slug }}
      slug={order.piece_slug}
      still={reduced}
      scale={0.75}
      className="thumb-canvas"
      scene={() => ({ seed: seedUniform(seedHash(order.piece_slug, order.edition)), uniforms: {}, time: (t) => t })}
    />
  );

  return (
    <div className="page library-page">
      <header className="page-head">
        <p className="eyebrow"><span className="eyebrow-name">Library</span></p>
        <h1 className="display display-md">Your editions.</h1>
      </header>
      <LiveStatus label="Download status" announcer={announcer} />
      {orders === null ? (
        <div className="table-skeleton" aria-busy="true" />
      ) : orders.length === 0 ? (
        <EmptyState sentence="No editions collected yet." action={<Link to="/gallery" className="button button-accent">Browse the gallery</Link>} />
      ) : (
        <>
          <div className="table-scroll library-table">
          <table className="data-table" aria-label="Your editions">
            <thead>
              <tr>
                <th scope="col"><span className="visually-hidden">Edition preview</span></th>
                <th scope="col">Piece</th>
                <th scope="col">State</th>
                <th scope="col">Invoice</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col"><span className="visually-hidden">Downloads</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="thumb-cell">{thumb(order)}</td>
                  <td>
                    <Link to={`/pieces/${order.piece_slug}`} className="table-title">{order.piece_title}</Link>
                    <span className="muted tabular block">Edition {order.edition} of {order.edition_count}</span>
                  </td>
                  <td><span className={`badge badge-${order.state}`}>{STATE_WORDS[order.state]}</span></td>
                  <td className="mono-ish tabular">{order.invoice_number ?? "—"}</td>
                  <td className="num tabular">{order.paid_at ? money(order.gross_cents) : "—"}</td>
                  <td>{actions(order)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <ul className="library-cards" aria-label="Your editions">
            {orders.map((order) => (
              <li key={order.id} className="library-card">
                {thumb(order)}
                <div className="library-card-text">
                  <Link to={`/pieces/${order.piece_slug}`} className="table-title">{order.piece_title}</Link>
                  <span className="muted tabular">Edition {order.edition} of {order.edition_count}</span>
                  <span><span className={`badge badge-${order.state}`}>{STATE_WORDS[order.state]}</span> {order.invoice_number ? <span className="tabular">{order.invoice_number}</span> : null}</span>
                </div>
                {actions(order)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
