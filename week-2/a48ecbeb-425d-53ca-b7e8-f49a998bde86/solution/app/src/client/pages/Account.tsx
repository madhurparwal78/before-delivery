import { FileText, LogOut, MapPin, Package, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { money, longDate, PROVINCE_NAMES, torontoDay } from "../../shared/format";
import { api, ApiFailure } from "../lib/api";
import { Link, navigate } from "../lib/router";
import type { Address, Order, OrderStatus, Subscription } from "../lib/types";
import { useShop } from "../state/shop";
import { cadenceText, stateText } from "./Subscription";
import "./account.css";

const STORE_DOWN = "The shop can't update right now. Try again in a moment.";

const ORDER_STATUS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  picking: "Picking",
  packed: "Packed",
  shipped: "Shipped",
  refunded: "Refunded",
};

const REFUND_STATUS: Record<Order["refund_status"], string> = {
  none: "",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
};

interface AccountData {
  orders: Order[];
  subscriptions: Subscription[];
  addresses: Address[];
}

/** A sprig of mate leaves, drawn for empty lists. */
function Sprig() {
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 56 C40 50 70 36 110 10" />
      <path d="M38 47 C30 36 32 24 44 18 C48 30 46 40 38 47 Z" fill="currentColor" fillOpacity="0.18" />
      <path d="M62 37 C58 24 64 12 78 10 C78 22 72 32 62 37 Z" fill="currentColor" fillOpacity="0.18" />
      <path d="M52 42 C62 50 76 50 84 42 C74 36 62 36 52 42 Z" fill="currentColor" fillOpacity="0.18" />
      <circle cx="100" cy="22" r="5" fill="var(--ceibo)" stroke="none" />
    </svg>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <div className="empty">
      <Sprig />
      <p>{children}</p>
    </div>
  );
}

function addressLine(address: Address): string {
  const street = address.line2 ? `${address.line1}, ${address.line2}` : address.line1;
  return `${street}, ${address.city}, ${PROVINCE_NAMES[address.province] ?? address.province} ${address.postal_code}`;
}

export function AccountPage() {
  const { user, userOutage, refreshUser } = useShop();
  const [data, setData] = useState<AccountData | null>(null);
  const [outage, setOutage] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const isCustomer = user?.role === "customer";

  useEffect(() => {
    if (user === null && !userOutage) navigate("/sign-in?next=/account", true);
  }, [user, userOutage]);

  useEffect(() => {
    if (!isCustomer) return;
    let live = true;
    Promise.all([
      api<{ orders: Order[] }>("GET", "/api/orders"),
      api<{ subscriptions: Subscription[] }>("GET", "/api/subscriptions"),
      api<{ addresses: Address[] }>("GET", "/api/addresses"),
    ])
      .then(([o, s, a]) => {
        if (live) setData({ orders: o.orders, subscriptions: s.subscriptions, addresses: a.addresses });
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (error instanceof ApiFailure && error.status === 401) navigate("/sign-in?next=/account", true);
        else setOutage(true);
      });
    return () => {
      live = false;
    };
  }, [isCustomer]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api("POST", "/api/auth/sign-out");
      await refreshUser();
      navigate("/");
    } catch {
      setSigningOut(false);
      setOutage(true);
    }
  };

  if (userOutage || outage) {
    return (
      <div className="page page-narrow">
        <h1>Your account</h1>
        <div className="panel">
          <p className="status-line" role="status">
            {STORE_DOWN}
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page page-narrow" aria-busy="true">
        <h1>Your account</h1>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <h1>Your account</h1>
      <p className="lede">
        Signed in as {user.name}, {user.email}.
      </p>
      {!isCustomer && (
        <p className="panel staff-note">
          Staff accounts work in the <Link href="/office">back office</Link>.
        </p>
      )}
      {/* One placeholder until every list has arrived, so no section pushes another down as it fills. */}
      {isCustomer && data === null && (
        <div className="account-sections" aria-busy="true">
          <div className="skeleton record-skeleton" />
        </div>
      )}
      {isCustomer && data !== null && (
        <div className="account-sections">
          <section className="panel" aria-labelledby="orders-heading">
            <h2 id="orders-heading">Orders</h2>
            {data.orders.length === 0 ? (
              <Empty>No orders yet. Your first crate will show here.</Empty>
            ) : (
              <ul className="record-list">
                {data.orders.map((order) => (
                  <li key={order.number}>
                    <Package aria-hidden="true" />
                    <div className="record-main">
                      <strong className="num">{order.number}</strong>
                      <span>
                        Placed {longDate(torontoDay(new Date(order.placed_at)))} · {ORDER_STATUS[order.status]}
                        {order.refund_status !== "none" && ` · ${REFUND_STATUS[order.refund_status]}`}
                      </span>
                    </div>
                    <span className="num record-total">{money(order.total_cents)}</span>
                    <span className="record-links">
                      <Link className="text-link" href={order.thank_you_url}>
                        View<span className="sr-only"> order {order.number}</span>
                      </Link>
                      <a className="text-link" href={order.invoice_url}>
                        <FileText aria-hidden="true" size={18} />
                        Download invoice (PDF)<span className="sr-only"> for {order.number}</span>
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="subscriptions-heading">
            <h2 id="subscriptions-heading">Auto-delivery</h2>
            {data.subscriptions.length === 0 ? (
              <Empty>No auto-delivery yet. Turn on subscribe and save at checkout to start one.</Empty>
            ) : (
              <ul className="record-list">
                {data.subscriptions.map((sub) => (
                  <li key={sub.id}>
                    <Repeat aria-hidden="true" />
                    <div className="record-main">
                      <strong>{sub.plan_label}</strong>
                      <span>
                        {cadenceText(sub.cadence)} · {stateText(sub)}
                      </span>
                      {sub.state !== "cancelled" && sub.state !== "cancel_pending" && (
                        <span>Next renewal {longDate(sub.next_renewal_date)}</span>
                      )}
                    </div>
                    <Link className="text-link" href={`/account/subscriptions/${sub.id}`}>
                      Manage<span className="sr-only"> {sub.plan_label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="addresses-heading">
            <h2 id="addresses-heading">Saved addresses</h2>
            {data.addresses.length === 0 ? (
              <Empty>No saved addresses yet. Add one at checkout.</Empty>
            ) : (
              <ul className="record-list">
                {data.addresses.map((address) => (
                  <li key={address.id}>
                    <MapPin aria-hidden="true" />
                    <div className="record-main">
                      <strong>{address.name}</strong>
                      <span>{addressLine(address)}</span>
                    </div>
                    {address.is_default && <span className="badge badge-applied">Default address</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {!(isCustomer && data === null) && (
        <p>
          <button type="button" className="btn btn-cream" onClick={() => void signOut()} disabled={signingOut}>
            <LogOut aria-hidden="true" size={18} />
            Sign out
          </button>
        </p>
      )}
    </div>
  );
}
