import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Night, Quote, RatePlan, Stay, TimelineRoom } from "../shared/api";
import { digitsToInteger } from "../shared/digits";
import { notices } from "../shared/notices";
import { call, get, newIdempotencyKey, post, refusalText } from "./api";
import { Layer } from "./dialogs";
import { useBusy, useSequence } from "./hooks";
import { FieldMessage, FormErrors, Money, type FieldErrors } from "./ui";

export interface NewStayRequest { roomId?: string; arrival?: string }

const LABELS: Record<string, string> = {
  "guest.name": "Guest name",
  "guest.email": "Guest email",
  arrival: "Arrival",
  departure: "Departure",
  guests: "Guests",
  roomId: "Room",
  ratePlanId: "Rate plan",
};
const QUOTE_DELAY_MS = 150;

interface Props {
  request: NewStayRequest;
  open: boolean;
  rooms: TimelineRoom[];
  onClose: () => void;
  onCreated: (stay: Stay) => void;
  setNotice: (text: string) => void;
}

export function NewStay({ request, open, rooms, onClose, onCreated, setNotice }: Props) {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [arrival, setArrival] = useState(request.arrival ?? "");
  const [departure, setDeparture] = useState("");
  const [guests, setGuests] = useState("1");
  const [roomId, setRoomId] = useState(request.roomId ?? "");
  const [planId, setPlanId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [nightly, setNightly] = useState<Night[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, guard] = useBusy();
  const sequence = useSequence();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void get<{ ratePlans: RatePlan[] }>("/api/rate-plans").then((answer) => answer.ok && setPlans(answer.data.ratePlans));
  }, []);

  useEffect(() => {
    const complete = /^\d{4}-\d{2}-\d{2}$/.test(arrival) && /^\d{4}-\d{2}-\d{2}$/.test(departure) && roomId !== "" && planId !== "";
    if (!complete) {
      setNightly([]);
      setTotal(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const id = sequence.next();
      const answer = await call<Quote>("POST", "/api/stays/quote", { arrival, departure, guests: guestCount(guests), roomId, ratePlanId: planId });
      if (!sequence.isNewest(id)) return;
      setNightly(answer.ok ? answer.data.nightly : []);
      setTotal(answer.ok ? answer.data.totalCents : null);
    }, QUOTE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [arrival, departure, guests, roomId, planId, sequence]);

  const follow = (field: string): void => {
    root.current?.querySelector<HTMLElement>(`[id="field-${field}"]`)?.focus();
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void guard(async () => {
      setNotice("Creating stay…");
      setErrors({});
      const answer = await post<Stay>(
        "/api/stays",
        { guest: { name, email, phone }, arrival, departure, guests: guestCount(guests), roomId, ratePlanId: planId },
        { "Idempotency-Key": newIdempotencyKey() },
      );
      if (answer.ok) {
        const room = answer.data.segments[0]?.roomNumber ?? "";
        setNotice(notices.stayCreatedWithLink(answer.data.guest.name, room, answer.data.checkinLinkState));
        onCreated(answer.data);
        return;
      }
      if (answer.status === 422) {
        setErrors(answer.errors);
        setNotice("");
      } else setNotice(refusalText(answer));
    });
  };

  return (
    <Layer name="New stay" open={open} onClose={onClose} className="dialog">
      <div ref={root}>
        <h2>New stay</h2>
        <FormErrors errors={errors} labels={LABELS} onFollow={follow} />
        <form onSubmit={submit} noValidate>
          <div className="field-grid">
            <Field id="guest.name" label="Guest name" error={errors["guest.name"]}>
              <input id="field-guest.name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field id="guest.email" label="Guest email" error={errors["guest.email"]}>
              <input id="field-guest.email" type="text" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            <Field id="guest.phone" label="Guest phone">
              <input id="field-guest.phone" type="text" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </Field>
            <Field id="arrival" label="Arrival" error={errors.arrival}>
              <input id="field-arrival" type="text" placeholder="YYYY-MM-DD" value={arrival} onChange={(event) => setArrival(event.target.value)} />
            </Field>
            <Field id="departure" label="Departure" error={errors.departure}>
              <input id="field-departure" type="text" placeholder="YYYY-MM-DD" value={departure} onChange={(event) => setDeparture(event.target.value)} />
            </Field>
            <Field id="guests" label="Guests" error={errors.guests}>
              <input id="field-guests" type="number" value={guests} onChange={(event) => setGuests(event.target.value)} />
            </Field>
            <Field id="roomId" label="Room" error={errors.roomId}>
              <select id="field-roomId" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                <option value="">Choose</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{room.number}</option>)}
              </select>
            </Field>
            <Field id="ratePlanId" label="Rate plan" error={errors.ratePlanId}>
              <select id="field-ratePlanId" value={planId} onChange={(event) => setPlanId(event.target.value)}>
                <option value="">Choose</option>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            </Field>
          </div>
          <NightlyTable nightly={nightly} />
          <div className="total-row">
            <span>Stay total</span>
            <span role="status" aria-label="Stay total" className="money total">{total === null ? "—" : <Money cents={total} />}</span>
          </div>
          <div className="button-row">
            <button type="submit" className="primary" aria-busy={busy}>Create stay</button>
            <button type="button" className="quiet" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </Layer>
  );
}

/** A whole number from the Guests field, or zero so the server answers with its own message. */
function guestCount(text: string): number {
  return /^\d{1,2}$/.test(text.trim()) ? digitsToInteger(text.trim()) : 0;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field" data-field={id}>
      <label htmlFor={`field-${id}`}>{label}</label>
      {children}
      <FieldMessage message={error} />
    </div>
  );
}

export function NightlyTable({ nightly }: { nightly: Night[] }) {
  return (
    <div className="table-frame breakdown" tabIndex={0} role="group" aria-label="Nightly breakdown, scrollable">
      <table aria-label="Nightly breakdown" className="ledger">
        {nightly.length === 0 ? <caption className="muted">Choose dates, a room and a rate plan to see the nightly prices.</caption> : null}
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className="money-head">Room</th>
            <th scope="col" className="money-head">Tax</th>
            <th scope="col" className="money-head">City tax</th>
            <th scope="col" className="money-head">Night total</th>
          </tr>
        </thead>
        <tbody>
          {nightly.map((night) => (
            <tr key={night.date}>
              <td>{night.date}</td>
              <td className="money">{<Money cents={night.roomCents} />}</td>
              <td className="money"><Money cents={night.taxCents} /></td>
              <td className="money"><Money cents={night.cityTaxCents} /></td>
              <td className="money"><Money cents={night.totalCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
