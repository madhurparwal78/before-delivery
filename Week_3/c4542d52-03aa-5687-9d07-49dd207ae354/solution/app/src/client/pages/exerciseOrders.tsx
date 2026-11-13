import { useState } from "react";
import type { ExerciseOrder, ExerciseOrderState } from "../../shared/types.js";
import { displayInstant, dollars, groupThousands } from "../../shared/format.js";
import { ApiFailure, api } from "../api.js";
import { announce, announceOnce } from "../announce.js";
import { useResource, useSocketGate } from "../hooks.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Band, LabelledValue } from "../ui.js";
import { FailurePage } from "./notFound.js";

const STATE_WORD: Record<ExerciseOrderState, string> = { pending: "Pending", held: "Held", issued: "Issued", cancelled: "Cancelled" };
const TOPICS = ["orders", "grants", "documents"];

export function ExercisePage() {
  const orders = useResource<{ orders: ExerciseOrder[] }>("/api/exercises", TOPICS);
  const { person } = useSession();
  return (
    <main className={orders.data?.orders.length === 0 ? "chapter chapter-empty" : "chapter"}>
      <div className="chapter-band">
        <div className="sheet">
          <p className="note">{person.name}</p>
          <h1 tabIndex={-1}>Exercise</h1>
        </div>
      </div>
      {orders.data && orders.data.orders.length === 0 && (
        <Band tone="black" className="band-fill-inner">
          No exercise orders yet.
        </Band>
      )}
      {orders.data && orders.data.orders.length > 0 && (
        <section className="sheet">
          <p className="note">Newest first.</p>
          <ul role="list" aria-label="Exercise orders" className="rows">
            {orders.data.orders.map((order) => (
              <li key={order.id} className="row-item">
                <Link href={`/exercises/${order.id}`}>{order.id}</Link>
                <span>{STATE_WORD[order.state]}</span>
                <span>{groupThousands(order.options)} options</span>
                <span className="amount">{dollars(order.cost)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export function ExerciseOrderPage({ id }: { id: string }) {
  const { person } = useSession();
  const gate = useSocketGate();
  const order = useResource<ExerciseOrder>(`/api/exercises/${id}`, TOPICS);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  if (order.error) return <FailurePage failure={order.error} />;
  if (!order.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  const current = order.data;
  const holder = current.holder_id === person.id;

  const run = async (path: string, done: (order: ExerciseOrder) => void) => {
    setBusy(true);
    setRefusal(undefined);
    try {
      done(await api<ExerciseOrder>("POST", `/api/exercises/${id}/${path}`, {}));
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === "order_not_cancellable") setRefusal(failure.body.error.message);
    } finally {
      setBusy(false);
      order.reload();
    }
  };

  return (
    <main className="chapter">
      <div className="chapter-band">
        <div className="sheet">
          <p className="note">
            {person.name}
            <br />
            {current.id}
          </p>
          <h1 tabIndex={-1}>{current.id}</h1>
          <p className="state-word">{STATE_WORD[current.state]}</p>
        </div>
      </div>
      <section className="sheet">
        <p className="note">The cost is options times strike, rounded once to the cent.</p>
        <div className="figures">
          <LabelledValue label="Options">{groupThousands(current.options)}</LabelledValue>
          <LabelledValue label="Strike price">{dollars(current.strike)}</LabelledValue>
          <LabelledValue label="Cost">{dollars(current.cost)}</LabelledValue>
          <LabelledValue label="Placed">{displayInstant(current.placed_at)}</LabelledValue>
        </div>
      </section>
      {current.state === "held" && (
        <Band tone="red" role="alert">
          The payment provider can't be reached. Order {current.id} is held under key {current.idempotency_key}. Nothing has been issued.
        </Band>
      )}
      {current.state === "issued" && current.notice?.status === "pending" && (
        <Band tone="red" role="alert">
          The document vault can't be reached. The exercise notice for {current.id} is pending; your shares are issued.
        </Band>
      )}
      {current.payment && (
        <section className="sheet" aria-label="Provider record">
          <p className="note">What Quillon Pay recorded for this order.</p>
          <div className="figures">
            <LabelledValue label="Reference">{current.payment.id}</LabelledValue>
            <LabelledValue label="Amount">{dollars(current.cost)} USD</LabelledValue>
            <LabelledValue label="Confirmed">{current.payment.confirmed_at ? displayInstant(current.payment.confirmed_at) : "Not yet"}</LabelledValue>
          </div>
        </section>
      )}
      {current.notice && (
        <section className="sheet">
          <p className="note">The notice is sealed in the vault under the order id.</p>
          <p className="notice-status">
            Exercise notice {current.notice.status === "sealed" ? "sealed in the vault" : "pending"}
            {current.notice.status === "sealed" && (
              <>
                {" "}
                <Link href={`/documents/${current.notice.document_id}`}>Open the notice</Link>
              </>
            )}
          </p>
        </section>
      )}
      {refusal && (
        <p className="field-error sheet-error">Error: {refusal}</p>
      )}
      {holder && (
        <section className="sheet">
          <div className="actions">
            {current.state === "held" && (
              <button
                type="button"
                className="button button-primary"
                disabled={gate || busy}
                onClick={() => void run("retry", (next) => next.state === "issued" && announceOnce(`order-issued:${next.id}`, `Payment confirmed. ${groupThousands(next.options)} shares issued on grant ${next.grant_id}.`))}
              >
                Retry payment
              </button>
            )}
            {current.state === "issued" && current.notice?.status === "pending" && (
              <button type="button" className="button button-primary" disabled={gate || busy} onClick={() => void run("retry", (next) => next.notice?.status === "sealed" && announceOnce(`order-notice:${next.id}`, `Exercise notice for ${next.id} sealed in the vault.`))}>
                Retry notice
              </button>
            )}
            {(current.state === "pending" || current.state === "held") && (
              <button type="button" className="button button-secondary" disabled={gate || busy} onClick={() => void run("cancel", (next) => announce(`Order ${next.id} cancelled. No shares were issued.`))}>
                Cancel order
              </button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
