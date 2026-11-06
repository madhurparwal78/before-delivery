import { Search as SearchIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Link } from "../lib/router";
import type { Order, Subscription } from "../lib/types";
import { longDate, money } from "../../shared/format";
import { failureOf, OrderStatusBadge } from "./shared";

// Finds orders by exact order number or customer email, and that customer's subscriptions.

interface Results {
  orders: Order[];
  subscriptions: Subscription[];
}

/** The subscription's state in the words the subscription page uses. */
function stateText(subscription: Subscription): string {
  switch (subscription.state) {
    case "active":
      return "Active";
    case "paused":
      return subscription.pause ? `Paused until ${longDate(subscription.pause.resumes_on)}` : "Paused";
    case "past_due":
      return "Payment overdue";
    case "cancel_pending":
      return subscription.billing_end_date ? `Ends on ${longDate(subscription.billing_end_date)}` : "Ends";
    case "cancelled":
      return "Cancelled";
  }
}

export function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const found = await api<Results>("GET", `/api/staff/search?q=${encodeURIComponent(query.trim())}`);
      setResults(found);
      if (found.orders.length === 0 && found.subscriptions.length === 0) setMessage("No orders or subscriptions match that search.");
    } catch (error) {
      setMessage(failureOf(error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="office-page">
      <h1>Search</h1>
      <form role="search" className="search-form" onSubmit={(event) => void submit(event)}>
        <input
          type="search"
          aria-label="Find an order or subscription"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          <SearchIcon size={18} aria-hidden="true" />
          Search
        </button>
      </form>
      <p role="status" aria-label="Search status" className="status-line">
        {message}
      </p>
      {results && results.orders.length > 0 && (
        <section aria-labelledby="search-orders" className="search-group">
          <h2 id="search-orders">Orders</h2>
          <ul className="result-list">
            {results.orders.map((order) => (
              <li key={order.number} className="result-row">
                <Link href={`/office/orders/${order.number}`} className="num result-link">
                  {order.number}
                </Link>
                <span className="result-name">{order.ship_to.name}</span>
                <span className="num">{money(order.total_cents)}</span>
                <OrderStatusBadge status={order.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {results && results.subscriptions.length > 0 && (
        <section aria-labelledby="search-subscriptions" className="search-group">
          <h2 id="search-subscriptions">Subscriptions</h2>
          <ul className="result-list">
            {results.subscriptions.map((subscription) => (
              <li key={subscription.id} className="result-row">
                <span className="result-link">{subscription.plan_label}</span>
                <span>{stateText(subscription)}</span>
                <span>
                  Next renewal <span className="num">{longDate(subscription.next_renewal_date)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
