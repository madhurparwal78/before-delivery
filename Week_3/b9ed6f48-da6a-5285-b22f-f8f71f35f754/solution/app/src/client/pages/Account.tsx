// The account page (brief: Screens and layout › Account): membership with the overdue actions,
// orders with receipt links, the saved path and bookmarks.

import { useState, type FormEvent } from "react";
import { api, ApiFailure, newKey, type Bookmark, type ChapterSummary, type Membership, type Order, type Path } from "../api.js";
import { useApi, useChapters } from "../hooks.js";
import { Link } from "../router.js";
import { useApp } from "../state.js";
import { Dialog } from "../components/Dialog.js";
import { EmptyMark, ErrorSummary, Field, Skeleton, type FieldErrors } from "../components/ui.js";
import { COPY, MEMBERSHIP_STATUS_LABELS, NUMERALS, TIER_NAMES, copyFor } from "../../shared/copy.js";
import { formatPrice } from "../../shared/money.js";
import { formatLisbonDate, lisbonDate } from "../../shared/lisbon.js";

const KIND_LABELS: Record<Order["kind"], string> = { ticket: "Ticket", donation: "Donation", membership_join: "Membership", membership_upgrade: "Upgrade" };
const ORDER_STATUS_LABELS: Record<Order["status"], string> = { settled: "Settled", partially_refunded: "Partly refunded", refunded: "Refunded" };

function membershipLine(m: Membership): string | null {
  if (m.status === "overdue" && m.amount_due_minor !== null) return copyFor.overdue(formatPrice(m.amount_due_minor, m.currency));
  if (m.pending?.kind === "downgrade") return copyFor.changesTo(TIER_NAMES[m.pending.tier], formatLisbonDate(m.pending.effective_on));
  if (m.pending?.kind === "cancel") return copyFor.membershipEnds(formatLisbonDate(m.pending.effective_on));
  return null;
}

function MembershipRegion({ onPaid }: { onPaid: () => void }) {
  const app = useApp();
  const loaded = useApi<{ membership: Membership | null }>(`/api/me/membership?for=${app.user?.id ?? ""}`);
  const [cardOpen, setCardOpen] = useState(false);
  const [card, setCard] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [cardMessage, setCardMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const m = loaded.data?.membership ?? null;

  const refusal = (error: unknown, show: (text: string) => void) => {
    if (error instanceof ApiFailure) {
      setErrors(error.error.fields ?? {});
      show(error.error.fields ? COPY.validation : error.error.message);
      app.announce(error.error.message);
    } else show(COPY.billingDown);
  };

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    app.announce(COPY.processing);
    try {
      const result = await api<{ membership: Membership; receipt_email: string }>("/api/me/membership/retry", { body: {}, key: newKey() });
      app.announce(COPY.retryOk);
      if (result.receipt_email === "delayed") app.setServiceNotice(COPY.receiptDelayed);
      onPaid();
    } catch (error) {
      refusal(error, setMessage);
    } finally {
      setBusy(false);
      loaded.reload();
    }
  };

  const saveCard = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setCardMessage("");
    try {
      await api("/api/me/membership/card", { method: "PUT", body: { card_number: card } });
      app.announce(COPY.cardUpdated);
      setCard("");
      setCardOpen(false);
    } catch (error) {
      refusal(error, setCardMessage);
    } finally {
      setBusy(false);
      loaded.reload();
    }
  };

  return (
    <section aria-label="Membership" className="account-section museum-card">
      <p className="catalogue">HRR-MEMBER</p>
      <h2 className="card-title">Membership</h2>
      {loaded.failure ? (
        <p>{loaded.failure.error.message}</p>
      ) : !loaded.data ? (
        <Skeleton lines={3} />
      ) : !m ? (
        <>
          <p className="card-text">You're not a supporter yet. A monthly plan keeps the reading room open.</p>
          <Link href="/support" className="button">
            See the plans
          </Link>
        </>
      ) : (
        <>
          <ErrorSummary errors={{}} message={message} ids={{}} />
          <p className="membership-tier">
            {m.tier_name} <span className={`badge status-${m.status}`}>{MEMBERSHIP_STATUS_LABELS[m.status]}</span>
          </p>
          <p className="figure">
            {copyFor.planPrice(formatPrice(m.price_minor, m.currency))}
            {m.card_last4 && ` · card ending ${m.card_last4}`}
          </p>
          {membershipLine(m) && <p>{membershipLine(m)}</p>}
          {m.next_charge && <p>{copyFor.nextPayment(formatPrice(m.next_charge.amount_minor, m.currency), formatLisbonDate(m.next_charge.on))}</p>}
          {m.status === "overdue" && (
            <div className="actions">
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void retry()}>
                Retry payment
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setErrors({});
                  setCardMessage("");
                  setCardOpen(true);
                }}
              >
                Update card
              </button>
            </div>
          )}
          {m.status !== "overdue" && m.status !== "cancelled" && (
            <button type="button" className="button button-quiet" onClick={(e) => app.openPlan(e.currentTarget)}>
              Manage plan
            </button>
          )}
        </>
      )}
      <Dialog open={cardOpen} label="Update card" onClose={() => setCardOpen(false)}>
        <h2>Update card</h2>
        <p className="dialog-lede">The new card is used for the overdue payment and every payment after it.</p>
        <ErrorSummary errors={errors} message={cardMessage} ids={{ card_number: "update-card" }} />
        <form noValidate onSubmit={(e) => void saveCard(e)}>
          <Field id="update-card" label="Card number" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.currentTarget.value)} error={errors.card_number} />
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              Save card
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function OrdersSection({ version }: { version: number }) {
  const app = useApp();
  const orders = useApi<{ orders: Order[] }>(`/api/me/orders?for=${app.user?.id ?? ""}&v=${version}`);
  return (
    <section aria-label="Orders" className="account-section museum-card">
      <p className="catalogue">HRR-ORDERS</p>
      <h2 className="card-title">Orders and receipts</h2>
      {!orders.data ? (
        <Skeleton lines={3} />
      ) : orders.data.orders.length ? (
        <div className="table-scroll" role="region" aria-label="Orders table" tabIndex={0}>
          <table aria-label="Orders" className="data-table">
            <thead>
              <tr>
                <th scope="col">Receipt</th>
                <th scope="col">Item</th>
                <th scope="col">Amount</th>
                <th scope="col">Date</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <a href={o.receipt_url} aria-label={`Receipt ${o.receipt_number}`} className="figure">
                      {o.receipt_number}
                    </a>
                  </td>
                  <td>
                    <span className="era">{KIND_LABELS[o.kind]}</span> {o.description}
                  </td>
                  <td className="figure">{formatPrice(o.amount_minor, o.currency)}</td>
                  <td>{formatLisbonDate(lisbonDate(Date.parse(o.settled_at)))}</td>
                  <td>{ORDER_STATUS_LABELS[o.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-text">No orders yet. Tickets, donations and membership payments appear here with their receipts.</p>
      )}
    </section>
  );
}

function PathSection({ chapters }: { chapters: ChapterSummary[] | null }) {
  const app = useApp();
  const path = useApi<{ path: Path }>(`/api/me/path?for=${app.user?.id ?? ""}&v=${app.pathVersion}`);
  const resolved = path.data?.path.resolved ?? [];
  const last = chapters?.find((c) => c.number === path.data?.path.last_chapter) ?? null;
  return (
    <section aria-label="Your path" className="account-section museum-card">
      <p className="catalogue">HRR-PATH</p>
      <h2 className="card-title">Your path</h2>
      {path.failure ? (
        <p>{path.failure.error.message}</p>
      ) : !path.data ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <ol className="path-numerals" aria-label="Resolved chapters">
            {NUMERALS.map((numeral, i) => {
              const done = resolved.includes(i + 1);
              return (
                <li key={numeral} className={done ? "is-resolved" : undefined}>
                  <span className="path-numeral">{numeral}</span>
                  <span className="visually-hidden">{done ? "resolved" : "not yet resolved"}</span>
                </li>
              );
            })}
          </ol>
          <p className="card-text">{resolved.length === 1 ? "1 of 8 rooms resolved." : `${resolved.length} of 8 rooms resolved.`}</p>
          {last && (
            <Link href={`/chapters/${last.number}`} className="button button-primary">
              Continue at chapter {last.numeral}
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function BookmarksSection() {
  const app = useApp();
  const listed = useApi<{ bookmarks: Bookmark[] }>(`/api/me/bookmarks?for=${app.user?.id ?? ""}`);
  const [removed, setRemoved] = useState<string[]>([]);
  const bookmarks = (listed.data?.bookmarks ?? []).filter((b) => !removed.includes(b.id));
  const timeline = useApi<{ events: { id: string; chapter: number }[] }>("/api/timeline");
  const hrefFor = (b: Bookmark) => {
    if (b.target_type === "chapter") return `/chapters/${b.target_id.replace("chapter-", "")}`;
    const event = timeline.data?.events.find((e) => e.id === b.target_id);
    return event ? `/chapters/${event.chapter}` : "/timeline";
  };
  const remove = async (b: Bookmark) => {
    try {
      await api(`/api/me/bookmarks/${b.id}`, { method: "DELETE" });
      setRemoved((r) => [...r, b.id]);
      app.announce(COPY.bookmarkRemoved);
    } catch (error) {
      if (error instanceof ApiFailure) app.announce(error.error.message);
    }
  };
  return (
    <section aria-label="Bookmarks" className="account-section museum-card">
      <p className="catalogue">HRR-MARKS</p>
      <h2 className="card-title">Bookmarks</h2>
      {listed.failure ? (
        <p>{listed.failure.error.message}</p>
      ) : !listed.data ? (
        <Skeleton lines={2} />
      ) : bookmarks.length ? (
        <ul className="bookmark-list">
          {bookmarks.map((b) => (
            <li key={b.id}>
              <Link href={hrefFor(b)}>
                <span className="era">{b.target_type === "chapter" ? "Chapter" : "Event"}</span> {b.title}
              </Link>
              <button type="button" className="button button-quiet" aria-label={`Remove bookmark ${b.title}`} onClick={() => void remove(b)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-inline">
          <EmptyMark />
          <p className="card-text">No bookmarks yet. Mark a chapter or a timeline event to keep it here.</p>
        </div>
      )}
    </section>
  );
}

export function AccountPage() {
  const app = useApp();
  const chapters = useChapters(app.user?.id ?? null, app.pathVersion);
  const [ordersVersion, setOrdersVersion] = useState(0);
  if (!app.userLoaded) return <div className="page" aria-busy="true" />;
  if (!app.user)
    return (
      <div className="page account-page">
        <div className="museum-card signed-out-card">
          <h1>Your account</h1>
          <p>{COPY.unauthenticated}</p>
          <button type="button" className="button button-primary" onClick={(e) => app.openSignIn(e.currentTarget)}>
            Sign in
          </button>
        </div>
      </div>
    );
  return (
    <div className="page account-page">
      <header className="page-intro">
        <p className="eyebrow">{app.user.email}</p>
        <h1>Your account</h1>
      </header>
      <div className="account-grid">
        <MembershipRegion onPaid={() => setOrdersVersion((v) => v + 1)} />
        <OrdersSection version={ordersVersion} />
        <PathSection chapters={chapters} />
        <BookmarksSection />
      </div>
    </div>
  );
}
