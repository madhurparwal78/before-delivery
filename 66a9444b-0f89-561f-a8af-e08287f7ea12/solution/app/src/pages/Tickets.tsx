// My tickets: the signed-in person's orders, their waitlist entries and any open offers with claim deadlines.
import { useCallback, useEffect, useState } from "react";
import { deadlineText, dateText } from "../../shared/brussels.ts";
import { euro } from "../../shared/money.ts";
import { api } from "../api.ts";
import { openCheckout } from "../checkout/actions.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { Gate, ScreenHeader } from "../components/Screen.tsx";
import { copy } from "../copy.ts";
import { navigate } from "../router.ts";
import { useSession } from "../session.tsx";
import { checkoutFeedback } from "../state/feedback.ts";
import type { Order, WaitlistEntry } from "../types.ts";

const REFRESH_MS = 10_000;
export const statusName = (status: string) => status.replace(/_/g, " ");

export function Tickets() {
  const { user } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[] | null>(null);
  const load = useCallback(async () => {
    const [o, w] = await Promise.all([api.get<{ orders: Order[] }>("/api/orders"), api.get<{ entries: WaitlistEntry[] }>("/api/waitlist")]);
    if (o.ok) setOrders(o.data.orders);
    if (w.ok) setWaitlist(w.data.entries);
  }, []);
  useEffect(() => {
    if (!user) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [user, load]);

  const claim = async (entry: WaitlistEntry) => {
    const r = await api.post(`/api/waitlist/${entry.id}/claim`);
    if (r.ok) {
      checkoutFeedback.clear();
      openCheckout();
    } else if (r.error === "offer_lapsed") checkoutFeedback.problem(copy.offerLapsed(entry.offer_expires_at ?? new Date().toISOString()));
    void load();
  };

  return (
    <div className="screen" data-ground="screen">
      <ScreenHeader title="My tickets" lede="Your orders, passes and waitlist places." />
      <Gate user={user} roles={["visitor", "group_booker"]}>
        <div className="grid screen__body screen__body--split">
          <section aria-labelledby="orders-head" className="panel">
            <h2 id="orders-head" className="panel__title">Orders</h2>
            {orders && orders.length === 0 && <EmptyState text="No orders yet. Hold seats or pick passes from the programme." action="Browse the programme" />}
            <table aria-label="My orders" className="ruled figures cards">
              <thead hidden={!orders?.length}><tr><th scope="col">Ref</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead>
              <tbody>
                {orders?.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Ref"><a href={`/orders/${o.id}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${o.id}`); }}>{o.ref}</a></td>
                    <td data-label="Date">{dateText(Date.parse(o.created_at))}</td>
                    <td data-label="Status"><span className="badge" data-state={o.status}>{statusName(o.status)}</span></td>
                    <td data-label="Total">{euro(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-labelledby="waitlist-head" className="panel">
            <h2 id="waitlist-head" className="panel__title">Waitlist</h2>
            {waitlist && waitlist.length === 0 && <EmptyState compact text="You're not waiting for any seats. Sold-out sessions offer a waitlist." />}
            <ul aria-label="My waitlist" className="waitlist">
              {waitlist?.map((w) => (
                <li key={w.id} className="waitlist__item">
                  <span className="waitlist__title">{w.title}</span>
                  {w.status === "waiting" && <span className="figures">Number {w.position} on the waitlist</span>}
                  {w.status === "offered" && w.offer_expires_at && (
                    <>
                      <span className="figures waitlist__deadline">Claim by {deadlineText(Date.parse(w.offer_expires_at))}</span>
                      <button type="button" className="button button--primary" onClick={() => void claim(w)}>Claim seat for {w.title}</button>
                    </>
                  )}
                  {w.status === "lapsed" && <span>Offer lapsed — the seat went to the next person.</span>}
                  {w.status === "claimed" && <span>Seat claimed</span>}
                  {w.status === "closed" && <span>Closed — the session was cancelled</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Gate>
    </div>
  );
}
