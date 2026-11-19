import { useEffect, useRef, useState, type FormEvent } from "react";
import { money, monthLabel, priceLabel } from "../../shared/rules";
import { api, ApiError, type Market, type Order } from "../api";
import { Shell } from "../components/Shell";
import { Banner, Empty, Skeleton, Status, TableScroll } from "../components/ui";
import { COPY } from "../copy";
import { formatInZone } from "../format";
import { Link } from "../router";
import { useMe, useSession } from "../session";
import { NotFoundPage } from "./Errors";

const STATUS_TEXT: Record<Order["status"], string> = {
  resting: "Resting",
  partially_filled: "Partially filled",
  filled: "Filled",
  cancelled: "Cancelled",
  liquidated: "Liquidated",
};

function useMarkets(): Market[] {
  const [markets, setMarkets] = useState<Market[]>([]);
  useEffect(() => {
    api<{ markets: Market[] }>("/api/markets").then((r) => setMarkets(r.markets)).catch(() => undefined);
  }, []);
  return markets;
}

function describe(order: Order, market: Market | undefined): string {
  if (!market || market.kind === "event") return `Buy ${order.outcome === "yes" ? "Yes" : "No"}`;
  return `${order.mode === "spot" ? "Spot" : "Margin"} ${order.side}`;
}

export function OrdersPage() {
  const markets = useMarkets();
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    api<{ orders: Order[] }>("/api/orders?status=all").then((r) => setOrders(r.orders)).catch(() => setOrders([]));
  }, []);
  return (
    <Shell field="slate">
      <div className="page-head">
        <h1>Orders</h1>
      </div>
      <section className="card">
        {orders === null ? (
          <Skeleton rows={4} />
        ) : orders.length === 0 ? (
          <Empty text="No orders yet — pick a level on any market to start." sticker="coin" />
        ) : (
          <TableScroll label="Your orders">
            <table className="table" aria-label="Your orders">
              <thead>
                <tr><th scope="col">Order</th><th scope="col">Market</th><th scope="col">Price</th><th scope="col">Filled</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const market = markets.find((m) => m.id === order.market_id);
                  return (
                    <tr key={order.id}>
                      <td><Link href={`/orders/${order.id}`}>{describe(order, market)} #{order.id.slice(0, 8)}</Link></td>
                      <td>{market?.symbol ?? "—"}</td>
                      <td className="numeric">{priceLabel(market?.kind ?? "event", order.price)}</td>
                      <td className="numeric">{order.filled_quantity} of {order.quantity}</td>
                      <td>{STATUS_TEXT[order.status]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </Shell>
  );
}

export function OrderDetailPage({ id }: { id: string }) {
  const me = useMe();
  const markets = useMarkets();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api<Order>(`/api/orders/${id}`).then(setOrder).catch(() => setMissing(true));
  }, [id]);
  if (missing) return <NotFoundPage />;
  const market = order ? markets.find((m) => m.id === order.market_id) : undefined;
  const kind = market?.kind ?? "event";
  return (
    <Shell field="slate">
      {order === null ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div className="page-head">
            <h1>{describe(order, market)} {market?.symbol ?? ""}</h1>
            <p className="badge">{STATUS_TEXT[order.status]}</p>
          </div>
          <div className="card-grid">
            <div className="card stat-card"><span className="figure-label">Price</span><span className="numeric stat-value">{priceLabel(kind, order.price)}</span></div>
            <div className="card stat-card"><span className="figure-label">Filled</span><span className="numeric stat-value">{order.filled_quantity} of {order.quantity}</span></div>
            <div className="card stat-card"><span className="figure-label">Held now</span><span className="numeric stat-value">{money(order.hold_cents)}</span></div>
          </div>
          <section className="card">
            <h2 className="card-title">Fills</h2>
            {order.fills.length === 0 ? (
              <p className="muted">No fills yet.</p>
            ) : (
              <TableScroll label="Fills">
                <table className="table" aria-label="Fills">
                  <thead>
                    <tr><th scope="col">When</th><th scope="col">Quantity</th><th scope="col">Price</th><th scope="col">Notional</th><th scope="col">Fee</th><th scope="col">Liquidity</th></tr>
                  </thead>
                  <tbody>
                    {order.fills.map((fill) => (
                      <tr key={fill.id}>
                        <td>{me.venue ? formatInZone(fill.filled_at, me.venue.time_zone) : fill.filled_at}</td>
                        <td className="numeric">{fill.quantity}</td>
                        <td className="numeric">{priceLabel(kind, fill.price)}</td>
                        <td className="numeric">{money(fill.notional_cents)}</td>
                        <td className="numeric">{money(fill.fee_cents)}</td>
                        <td>{fill.liquidity === "maker" ? "Maker" : "Taker"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

interface StatementItem {
  id: string;
  month: string;
  created_at: string;
}

export function StatementsPage() {
  const [statements, setStatements] = useState<StatementItem[] | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    api<{ statements: StatementItem[] }>("/api/statements").then((r) => setStatements(r.statements)).catch(() => setStatements([]));
  }, []);
  const open = async (statement: StatementItem) => {
    try {
      const link = await api<{ url: string }>(`/api/statements/${statement.id}/link`);
      setDown(false);
      window.location.assign(link.url);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) setDown(true);
    }
  };
  return (
    <Shell field="slate">
      <div className="page-head">
        <h1>Statements</h1>
        <p className="muted">One PDF per calendar month, opened through a link that lasts a minute.</p>
      </div>
      {down && <Banner>{COPY.statements.unavailable}</Banner>}
      <section className="card">
        {statements === null ? (
          <Skeleton />
        ) : statements.length === 0 ? (
          <Empty text={COPY.statements.empty} sticker="envelope" />
        ) : (
          <ul className="statement-list" aria-label="Statements">
            {statements.map((statement) => (
              <li key={statement.id}>
                <span className="statement-month">{monthLabel(statement.month)}</span>
                <a
                  className="pill pill-small"
                  href={`/statements#${statement.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    void open(statement);
                  }}
                >
                  Download {monthLabel(statement.month)} statement
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

interface DocumentItem {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export function ProfilePage() {
  const me = useMe();
  const { refresh } = useSession();
  const [name, setName] = useState(me.display_name);
  const [status, setStatus] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [documentsDown, setDocumentsDown] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const loadDocuments = () => api<{ documents: DocumentItem[] }>("/api/me/documents").then((r) => setDocuments(r.documents)).catch(() => setDocuments([]));
  useEffect(() => {
    void loadDocuments();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setStatus(COPY.profile.saving);
    try {
      await api("/api/me", { method: "PATCH", body: { display_name: name } });
      setStatus(COPY.profile.saved);
      refresh();
    } catch {
      setStatus(COPY.profile.name);
    }
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = file.current?.files?.[0];
    if (!chosen || chosen.size > 5_000_000) {
      setStatus(COPY.profile.document);
      return;
    }
    const form = new FormData();
    form.append("document", chosen);
    setStatus(COPY.profile.uploading);
    try {
      await api("/api/me/documents", { form });
      setDocumentsDown(false);
      setStatus(COPY.profile.uploaded);
      if (file.current) file.current.value = "";
      void loadDocuments();
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setDocumentsDown(true);
        setStatus("");
      } else setStatus(COPY.profile.document);
    }
  };

  return (
    <Shell field="slate">
      <div className="page-head">
        <h1>Profile</h1>
        <p className="muted">{me.email}</p>
      </div>
      {documentsDown && <Banner>{COPY.profile.documentsDown}</Banner>}
      <Status label="Profile status" message={status} className="page-status" />
      <div className="card-grid two">
        <section className="card">
          <h2 className="card-title">Display name</h2>
          <form className="form" onSubmit={(e) => void save(e)} noValidate>
            <div className="field-row">
              <label htmlFor="display-name">Display name</label>
              <input id="display-name" type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </div>
            <button type="submit" className="pill">Save profile</button>
          </form>
        </section>
        <section className="card">
          <h2 className="card-title">ID documents</h2>
          <form className="form" onSubmit={(e) => void upload(e)}>
            <div className="field-row">
              <label htmlFor="id-document">ID document</label>
              <input ref={file} id="id-document" type="file" accept="application/pdf,image/png,image/jpeg" />
            </div>
            <p className="muted small">A PDF, PNG or JPEG of up to 5,000,000 bytes. Only your venue's market admins can open it.</p>
            <button type="submit" className="pill">Upload ID document</button>
          </form>
          {documents && (
            <TableScroll label="Your documents">
              <table className="table" aria-label="Your documents">
                <thead>
                  <tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Uploaded</th></tr>
                </thead>
                <tbody>
                  {documents.length === 0 && (
                    <tr>
                      <td colSpan={4}>No documents uploaded yet.</td>
                    </tr>
                  )}
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td>{d.filename}</td>
                      <td>{d.content_type.split("/")[1]?.toUpperCase()}</td>
                      <td className="numeric">{d.size_bytes.toLocaleString("en-US")} bytes</td>
                      <td>{me.venue ? formatInZone(d.uploaded_at, me.venue.time_zone) : d.uploaded_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </section>
      </div>
    </Shell>
  );
}
