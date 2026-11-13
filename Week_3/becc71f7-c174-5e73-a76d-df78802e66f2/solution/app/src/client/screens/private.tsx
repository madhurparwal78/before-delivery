// The pages reached from a mail or by the public: hold page, consignor page, appointments, and the staff sign-in.
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, brusselsDate } from "../../shared/brussels";
import type { Choice, HoldPage, Portal, PortalPiece, SessionBody, SlotWeek } from "../../shared/api";
import { HELD_BACK_REASON, labelOf, PIECE_STATUSES, SIZES } from "../../shared/catalog";
import { formatDate, formatDateTime, formatMoney, formatMonth, formatTime } from "../../shared/format";
import { api, request } from "../api";
import { useAction, useDialog, useFields, usePoll, type DialogControl } from "../hooks";
import { announce, focusHeading, navigate, recallPlace, setQuery, useAddress } from "../state";
import { MainAction, PublicBar } from "../ui/bars";
import { Dialog } from "../ui/Dialog";
import { Garment } from "../ui/Garment";
import { Button, DialogForm, GoneScreen, Heading, NotFound, Problems, Skeleton, TableFrame, TextField } from "../ui/kit";
import { Tag } from "../ui/Tag";

export function HoldPageScreen({ token }: { token: string }) {
  const poll = usePoll(() => api<{ hold: HoldPage }>(`/api/holds/by-token/${token}`), token);
  const action = useAction();
  const hold = poll.data?.hold;
  if (poll.failure) {
    return (
      <>
        <PublicBar plain />
        <NotFound />
      </>
    );
  }
  const letGo = (): Promise<void> =>
    action.run(async () => {
      await api(`/api/holds/by-token/${token}/release`, { method: "POST" });
      announce("Hold released.");
      await poll.refresh();
    });
  return (
    <>
      <PublicBar plain />
      <main className="center-column">
        {hold ? (
          <>
            <Heading>{hold.piece.description}</Heading>
            <div className="hold-piece">
              <div className="card-image">
                {hold.piece.photoUrl ? <img className="piece-photo" src={hold.piece.photoUrl} alt={hold.piece.description} /> : <Garment category={hold.piece.category} seed={hold.piece.tagCode} />}
              </div>
              <Tag currentCents={hold.piece.currentPriceCents} previousCents={null} />
            </div>
            <p className="brand">
              {hold.piece.brand}, size {labelOf(SIZES, hold.piece.size)}
            </p>
            <p className="num">{hold.piece.tagCode}</p>
            <Problems action={action} />
            {hold.status === "active" ? (
              <>
                <p className="lead num">Held until {formatDateTime(hold.endsAt)}</p>
                <p className="num">{Math.floor(hold.secondsLeft / 60)} minutes left</p>
              </>
            ) : hold.status === "released" ? (
              <p className="lead">This hold was let go.</p>
            ) : (
              <p className="lead">This hold has ended.</p>
            )}
            <p>{hold.shopAddress}</p>
            <MainAction>
              <Button action={action} kind="primary" disabled={hold.status !== "active"} onClick={() => void letGo()}>
                Let the hold go
              </Button>
            </MainAction>
          </>
        ) : (
          <Skeleton />
        )}
      </main>
    </>
  );
}

function PortalPieceRow({ piece, choice, onChoose }: { piece: PortalPiece; choice: Choice | null; onChoose: (choice: Choice) => void }) {
  const station = piece.stations.find((candidate) => candidate.station === piece.station)?.label;
  if (piece.shareCents !== null) {
    return (
      <li className="portal-piece sold">
        <p className="num">{piece.tagCode}</p>
        <p className="portal-title">{piece.description}</p>
        <p>
          Sold · your share <span className="num">{formatMoney(piece.shareCents)}</span>
        </p>
      </li>
    );
  }
  return (
    <li className="portal-piece">
      {piece.currentPriceCents !== null && <Tag currentCents={piece.currentPriceCents} previousCents={piece.previousPriceCents} inline />}
      <p className="num">{piece.tagCode}</p>
      <p className="portal-title">{piece.description}</p>
      <p className="muted">
        {station} · {labelOf(PIECE_STATUSES, piece.status)}
      </p>
      {piece.choiceOpen && (
        <div className="radio-group grid" role="radiogroup" aria-label={`${piece.tagCode}: at the end of its period`}>
          <p className="radio-title" aria-hidden="true">
            At the end of its period
          </p>
          <div className="radio-options">
            {(
              [
                ["return", "Return to me"],
                ["donate", "Donate"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="radio">
                <input type="radio" name={`choice-${piece.id}`} value={value} checked={choice === value} onChange={() => onChoose(value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export function ConsignorPage({ token }: { token: string }) {
  const poll = usePoll(() => api<Portal>(`/api/portal/${token}`), token);
  const action = useAction();
  const [changes, setChanges] = useState<Record<string, Choice>>({});
  const save = useRef<HTMLButtonElement>(null);
  const data = poll.data;

  if (poll.failure?.code === "page_ended") {
    return (
      <>
        <PublicBar plain />
        <GoneScreen heading="This page has ended. Ask the shop for a new link." />
      </>
    );
  }
  if (poll.failure) {
    return (
      <>
        <PublicBar plain />
        <NotFound />
      </>
    );
  }
  const saveChoices = (): Promise<void> =>
    action.run(async () => {
      const choices = Object.entries(changes).map(([pieceId, choice]) => ({ pieceId, choice }));
      await api(`/api/portal/${token}/choices`, { method: "PUT", json: { choices } });
      setChanges({});
      await poll.refresh();
      announce("Choices saved.");
      action.focusAfter(save.current);
    });
  return (
    <>
      <PublicBar plain />
      <main className="center-column consignor">
        {data ? (
          <>
            <Heading>Hello {data.consignor.name}</Heading>
            <p className="lead">{data.consignor.ibanValid ? <span className="num">Paid to the account ending {data.consignor.ibanLast4}</span> : HELD_BACK_REASON}</p>
            <p className="muted num">This page works until {formatDateTime(data.pageEndsAt)}.</p>
            <Problems action={action} />
            <h2>Your pieces</h2>
            <ul className="portal-pieces" role="list">
              {data.pieces.map((piece) => (
                <PortalPieceRow key={piece.id} piece={piece} choice={changes[piece.id] ?? piece.choice} onChoose={(choice) => setChanges((current) => ({ ...current, [piece.id]: choice }))} />
              ))}
            </ul>
            {data.pieces.length === 0 && <p className="muted">No pieces with the shop right now.</p>}
            <h2>Earnings by month</h2>
            <TableFrame name="Earnings by month">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="amount">Your share</th>
                </tr>
              </thead>
              <tbody>
                {data.earnings.map((earning) => (
                  <tr key={earning.month}>
                    <td>{formatMonth(earning.month)}</td>
                    <td className="amount num">{formatMoney(earning.shareCents)}</td>
                  </tr>
                ))}
                {data.earnings.length === 0 && (
                  <tr>
                    <td colSpan={2} className="muted">
                      Nothing sold yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </TableFrame>
            <MainAction>
              <Button ref={save} action={action} kind="primary" onClick={() => void saveChoices()}>
                Save choices
              </Button>
            </MainAction>
          </>
        ) : (
          <Skeleton />
        )}
      </main>
    </>
  );
}

function BookingForm({ startsAt, control, onBooked }: { startsAt: string; control: DialogControl; onBooked: () => Promise<void> }) {
  const action = useAction();
  const form = useFields(control.name, { name: "", email: "" });
  const submit = async (): Promise<void> => {
    await api("/api/appointments", { method: "POST", json: { startsAt, ...form.values } });
    await onBooked();
    announce(`Booked for ${formatDateTime(startsAt)}. The confirmation is on its way by mail.`);
    control.close({ returnFocus: false });
    focusHeading();
  };
  return (
    <DialogForm action={action} submit="Confirm booking" onSubmit={submit} onCancel={() => control.close()}>
      <p className="lead num">{formatDateTime(startsAt)}</p>
      <div className="choice-grid">
        <TextField form={form} action={action} name="name" label="Your name" autoComplete="name" />
        <TextField form={form} action={action} name="email" type="email" label="Email" autoComplete="email" />
      </div>
    </DialogForm>
  );
}

export function Appointments() {
  const { search } = useAddress();
  const week = new URLSearchParams(search).get("week") ?? "";
  const poll = usePoll(() => api<SlotWeek>(`/api/appointment-slots${week ? `?week=${week}` : ""}`), week);
  const [selected, setSelected] = useState<string | null>(null);
  const booking = useDialog("Book slot");
  const data = poll.data;
  const failed = poll.failure;

  if (failed) {
    return (
      <>
        <PublicBar />
        <NotFound />
      </>
    );
  }
  const days = data ? [1, 2, 3, 4, 5].map((offset) => addDays(data.weekStart, offset)) : [];
  return (
    <>
      <PublicBar />
      <main className="page">
        {data ? (
          <>
            <div className="screen-head">
              <Heading className="num">Week of {formatDate(data.weekStart)}</Heading>
              <div className="week-buttons">
                <Button disabled={!data.previousWeek} onClick={() => setQuery(`/appointments?week=${data.previousWeek}`)}>
                  <ChevronLeft aria-hidden="true" size={18} /> Previous week
                </Button>
                <Button disabled={!data.nextWeek} onClick={() => setQuery(`/appointments?week=${data.nextWeek}`)}>
                  Next week <ChevronRight aria-hidden="true" size={18} />
                </Button>
                <MainAction>
              <button
                ref={(element) => {
                  booking.opener.current = element;
                }}
                type="button"
                className="button primary"
                disabled={!selected}
                onClick={booking.open}
              >
                Book slot
              </button>
            </MainAction>
              </div>
            </div>
            <p className="muted">Choose a twenty-minute slot to bring your pieces to the shop.</p>
            <div className="week">
              {days.map((day) => {
                const slots = data.slots.filter((slot) => brusselsDate(new Date(slot.startsAt)) === day);
                return (
                  <div key={day} className="day" role="group" aria-label={formatDate(day)}>
                    <p className="day-title num">{formatDate(day)}</p>
                    {slots.length === 0 && <p className="muted">No slots this day.</p>}
                    <div className="slots">
                      {slots.map((slot) => (
                        <button key={slot.startsAt} type="button" className="slot num" aria-label={formatDateTime(slot.startsAt)} aria-pressed={selected === slot.startsAt} disabled={!slot.free} onClick={() => setSelected(slot.startsAt)}>
                          {formatTime(slot.startsAt)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {selected && (
              <Dialog control={booking}>
                <BookingForm
                  startsAt={selected}
                  control={booking}
                  onBooked={async () => {
                    await poll.refresh();
                    setSelected(null);
                  }}
                />
              </Dialog>
            )}
          </>
        ) : (
          <Skeleton />
        )}
      </main>
    </>
  );
}

export function CancelAppointment({ token }: { token: string }) {
  const poll = usePoll(() => api<{ appointment: { startsAt: string; status: string } }>(`/api/appointments/by-token/${token}`), token);
  const action = useAction();
  const appointment = poll.data?.appointment;
  if (poll.failure) {
    return (
      <>
        <PublicBar />
        <NotFound />
      </>
    );
  }
  const cancel = (): Promise<void> =>
    action.run(async () => {
      await api(`/api/appointments/by-token/${token}/cancel`, { method: "POST" });
      await poll.refresh();
      announce("Your appointment is cancelled.");
    });
  return (
    <>
      <PublicBar />
      <main className="center-column">
        <Heading>Your intake appointment</Heading>
        {appointment ? (
          <>
            <p className="lead num">{formatDateTime(appointment.startsAt)}</p>
            <Problems action={action} />
            {appointment.status === "cancelled" && <p>This appointment is cancelled.</p>}
            <MainAction>
              <Button action={action} kind="primary" disabled={appointment.status === "cancelled"} onClick={() => void cancel()}>
                Cancel appointment
              </Button>
            </MainAction>
          </>
        ) : (
          <Skeleton />
        )}
      </main>
    </>
  );
}

export function SignIn() {
  const action = useAction();
  const form = useFields("Sign in", { email: "", password: "" }, ["password"]);
  const submit = (): Promise<void> =>
    action.run(async () => {
      const response = await request("/api/session", { method: "POST", json: form.values });
      const { homeRoute } = (await response.json()) as SessionBody;
      navigate(recallPlace() ?? homeRoute);
    });
  return (
    <>
      <PublicBar plain />
      <main className="center-column sign-in">
        <Heading>Staff sign-in</Heading>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!action.pending) void submit();
          }}
        >
          <Problems action={action} />
          <TextField form={form} action={action} name="email" type="email" label="Email" autoComplete="username" />
          <TextField form={form} action={action} name="password" type="password" label="Password" autoComplete="current-password" />
          <MainAction>
            <Button action={action} kind="primary" type="submit">
              Sign in
            </Button>
          </MainAction>
        </form>
      </main>
    </>
  );
}
