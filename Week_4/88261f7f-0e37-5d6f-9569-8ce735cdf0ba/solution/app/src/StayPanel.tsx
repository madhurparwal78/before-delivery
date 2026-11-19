import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry, Folio, Stay, TimelineRoom } from "../shared/api";
import { formatMoney } from "../shared/money";
import { notices, statusWords } from "../shared/notices";
import { isFinal, offers } from "../shared/stayStatus";
import { call, get, post, refusalText, type Result } from "./api";
import { Layer } from "./dialogs";
import { ChargeDialog, MoveEntryDialog, PaymentDialog, SplitDialog } from "./FolioDialogs";
import { useSequence } from "./hooks";
import { useLive } from "./live";
import { NightlyTable } from "./NewStay";
import { EmptySheet, FieldMessage, FormErrors, type FieldErrors } from "./ui";

interface Props {
  stayId: string | null;
  open: boolean;
  rooms: TimelineRoom[];
  onClose: () => void;
  setNotice: (text: string) => void;
  onChanged: () => void;
}

const MOVE_LABELS: Record<string, string> = { roomId: "Move to room", fromNight: "Move from night", arrival: "Move from night", version: "Move room" };
const DATE_LABELS: Record<string, string> = { departure: "Departure", guests: "Departure", version: "Departure" };

type Dialog = { kind: "split"; entry: Entry } | { kind: "payment"; folio: Folio } | { kind: "charge"; folio: Folio } | { kind: "move"; entry: Entry };

export function StayPanel({ stayId, open, rooms, onClose, setNotice, onChanged }: Props) {
  const [stay, setStay] = useState<Stay | null>(null);
  const [folioMessage, setFolioMessage] = useState("");
  const [departure, setDeparture] = useState("");
  const [moveRoom, setMoveRoom] = useState("");
  const [moveFrom, setMoveFrom] = useState("");
  const [dateErrors, setDateErrors] = useState<FieldErrors>({});
  const [moveErrors, setMoveErrors] = useState<FieldErrors>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTerms, setCancelTerms] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const sequence = useSequence();

  const load = useCallback(async (): Promise<Stay | null> => {
    if (!stayId) return null;
    const id = sequence.next();
    const answer = await get<Stay>(`/api/stays/${stayId}`);
    if (!sequence.isNewest(id) || !answer.ok) return null;
    setStay(answer.data);
    setDeparture(answer.data.departure);
    return answer.data;
  }, [stayId, sequence]);

  useEffect(() => {
    if (!open || !stayId) return;
    if (loadedFor.current !== stayId) {
      setStay(null);
      setFolioMessage("");
      setDateErrors({});
      setMoveErrors({});
      setMoveRoom("");
      setMoveFrom("");
    }
    loadedFor.current = stayId;
    void load();
  }, [open, stayId, load]);

  useLive(() => {
    if (open) void load();
  });

  const run = useCallback(async (key: string, work: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = key;
    setBusyKey(key);
    try {
      await work();
    } finally {
      busyRef.current = null;
      setBusyKey(null);
    }
  }, []);

  const changeStay = (key: string, pending: string, send: () => Promise<Result<Stay>>, success: (changed: Stay) => string): void =>
    void run(key, async () => {
      setNotice(pending);
      const answer = await send();
      if (!answer.ok) {
        setNotice(refusalText(answer));
        if (answer.status === 409) {
          await load();
          onChanged();
        }
        return;
      }
      setNotice(success(answer.data));
      setStay(answer.data);
      onChanged();
    });

  if (!stayId) return null;
  const guestName = stay?.guest.name ?? "";
  const firstRoom = stay?.segments[0]?.roomNumber ?? "";
  const lastRoom = stay?.segments[stay.segments.length - 1]?.roomNumber ?? "";

  const openDialog = (next: Dialog): void => {
    setDialog(next);
    setDialogOpen(true);
  };
  const folioDone = (): void => {
    void load();
    onChanged();
  };

  const startCancel = (): void =>
    void run("cancel-open", async () => {
      const fresh = await load();
      if (fresh?.cancellation) setCancelTerms(fresh.cancellation.text);
    });

  const confirmCancel = (): void =>
    void run("cancel", async () => {
      const fresh = await load();
      if (fresh && fresh.cancellation?.text !== cancelTerms) {
        setCancelTerms(fresh.cancellation?.text ?? null);
        return;
      }
      setNotice("Cancelling stay…");
      const answer = await post<Stay>(`/api/stays/${stayId}/cancel`);
      if (!answer.ok) {
        setNotice(refusalText(answer));
        setCancelTerms(null);
        await load();
        return;
      }
      const fee = answer.data.folios.flatMap((folio) => folio.entries).find((entry) => entry.description === "Late cancellation fee")?.amountCents ?? 0;
      setNotice(notices.cancelled(answer.data.guest.name, fee));
      setStay(answer.data);
      setCancelTerms(null);
      onChanged();
    });

  const saveDates = (): void =>
    changeStay("dates", "Saving stay…", () => call<Stay>("PATCH", `/api/stays/${stayId}`, { version: stay?.version, departure }), (changed) => notices.stayUpdated(changed.guest.name));

  const submitMove = (): void => {
    const chosen = rooms.find((room) => room.id === moveRoom);
    setMoveErrors({});
    changeStay(
      "move",
      "Moving stay…",
      async () => {
        const answer = await post<Stay>(`/api/stays/${stayId}/move`, { version: stay?.version, roomId: moveRoom, ...(moveFrom.trim() ? { fromNight: moveFrom.trim() } : {}) });
        if (!answer.ok && answer.status === 422) setMoveErrors(answer.errors);
        return answer;
      },
      () => notices.moved(guestName, chosen?.number ?? ""),
    );
  };

  const otherOpen = (folio: Folio): Folio[] => (stay?.folios ?? []).filter((candidate) => candidate.id !== folio.id && candidate.state === "open");
  const editable = stay !== null && !isFinal(stay.status);

  return (
    <>
      <Layer name="Stay" open={open} onClose={onClose} className="panel">
        <div className="panel-head">
          <h2>{stay ? stay.guest.name : "Loading stay…"}</h2>
          <button type="button" className="quiet" onClick={onClose}>Close</button>
        </div>
        {stay ? (
          <div className="panel-body">
            <p className="stay-meta">
              <span className="stay-status" data-status={stay.status}>{statusWords(stay.status)}</span>
              {stay.checkedInOnline ? <span className="badge">Checked in online</span> : null}
              <span>{stay.arrival} to {stay.departure}</span>
              <span>{stay.guests} {stay.guests === 1 ? "guest" : "guests"}</span>
            </p>
            <p className="muted">Rooms: {stay.segments.map((segment) => `${segment.roomNumber} from ${segment.firstNight}`).join(", ")}</p>
            {stay.checkInNight ? <p>Checked in for the night of {stay.checkInNight}</p> : null}
            {stay.cancellation ? <div role="status" aria-label="Cancellation terms" className="terms">{stay.cancellation.text}</div> : null}
            <h3>Nightly breakdown</h3>
            <NightlyTable nightly={stay.nightly} />
            <div className="total-row">
              <span>Stay total</span>
              <span role="status" aria-label="Stay total" className="money total">{formatMoney(stay.totalCents)}</span>
            </div>
            <div className="action-row">
              {offers("check_in", stay.status) ? <button type="button" className="primary" aria-busy={busyKey === "check-in"} onClick={() => changeStay("check-in", "Checking in…", () => post<Stay>(`/api/stays/${stayId}/check-in`), (changed) => notices.checkedIn(changed.guest.name, changed.segments[0]?.roomNumber ?? firstRoom))}>Check in</button> : null}
              {offers("check_out", stay.status) ? <button type="button" className="primary" aria-busy={busyKey === "check-out"} onClick={() => changeStay("check-out", "Checking out…", () => post<Stay>(`/api/stays/${stayId}/check-out`), (changed) => notices.checkedOut(changed.guest.name, changed.segments[changed.segments.length - 1]?.roomNumber ?? lastRoom))}>Check out</button> : null}
              {offers("cancel", stay.status) ? <button type="button" aria-busy={busyKey === "cancel-open"} onClick={startCancel}>Cancel stay</button> : null}
              {offers("cancel", stay.status) ? <button type="button" aria-busy={busyKey === "resend"} onClick={() => changeStay("resend", "Sending check-in link…", () => post<Stay>(`/api/stays/${stayId}/checkin-link`), (changed) => notices.linkSent(changed.guest.name))}>Resend check-in link</button> : null}
              {stay.idPhoto === "received" ? <a href={`/api/stays/${stayId}/id-photo`} target="_blank" rel="noreferrer">View ID photo</a> : null}
            </div>
            {editable ? (
              <>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); saveDates(); }}>
                  <FormErrors errors={dateErrors} labels={DATE_LABELS} onFollow={() => undefined} />
                  <div className="field">
                    <label htmlFor="stay-departure">Departure</label>
                    <input id="stay-departure" type="text" placeholder="YYYY-MM-DD" value={departure} onChange={(event) => setDeparture(event.target.value)} />
                  </div>
                  <button type="submit" aria-busy={busyKey === "dates"}>Save dates</button>
                </form>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); submitMove(); }}>
                  <FormErrors errors={moveErrors} labels={MOVE_LABELS} onFollow={() => undefined} />
                  <div className="field">
                    <label htmlFor="stay-move-room">Move to room</label>
                    <select id="stay-move-room" value={moveRoom} onChange={(event) => setMoveRoom(event.target.value)}>
                      <option value="">Choose</option>
                      {rooms.map((room) => <option key={room.id} value={room.id}>{room.number}</option>)}
                    </select>
                    <FieldMessage message={moveErrors.roomId} />
                  </div>
                  <div className="field">
                    <label htmlFor="stay-move-from">Move from night</label>
                    <input id="stay-move-from" type="text" placeholder="YYYY-MM-DD" value={moveFrom} onChange={(event) => setMoveFrom(event.target.value)} />
                    <FieldMessage message={moveErrors.fromNight ?? moveErrors.arrival} />
                  </div>
                  <button type="submit" aria-busy={busyKey === "move"}>Move room</button>
                </form>
              </>
            ) : null}
            <h3>Folios</h3>
            <div role="status" aria-label="Folio status" className="notice">{folioMessage}</div>
            {stay.folios.map((folio) => (
              <FolioRegion
                key={folio.id}
                folio={folio}
                stay={stay}
                say={setFolioMessage}
                onChanged={folioDone}
                openDialog={openDialog}
                canMove={otherOpen(folio).length > 0}
                sibling={(next) => setStay(next)}
              />
            ))}
            <button type="button" aria-busy={busyKey === "folio"} onClick={() => void run("folio", async () => {
              const answer = await post<Folio>(`/api/stays/${stayId}/folios`, { payerName: stay.guest.name, payerEmail: stay.guest.email });
              setFolioMessage(answer.ok ? `${answer.data.name} added.` : refusalText(answer));
              folioDone();
            })}>Add folio</button>
          </div>
        ) : null}
      </Layer>
      <Layer name="Cancel stay" role="alertdialog" open={cancelTerms !== null} onClose={() => setCancelTerms(null)} className="dialog narrow">
        <h2>Cancel stay</h2>
        <p>{cancelTerms}</p>
        <div className="button-row">
          <button type="button" className="primary" aria-busy={busyKey === "cancel"} onClick={confirmCancel}>Confirm cancellation</button>
          <button type="button" className="quiet" onClick={() => setCancelTerms(null)}>Keep stay</button>
        </div>
      </Layer>
      <SplitDialog entry={dialog?.kind === "split" ? dialog.entry : null} open={dialogOpen && dialog?.kind === "split"} onClose={() => setDialogOpen(false)} say={setFolioMessage} onDone={folioDone} />
      <PaymentDialog folio={dialog?.kind === "payment" ? dialog.folio : null} open={dialogOpen && dialog?.kind === "payment"} onClose={() => setDialogOpen(false)} say={setFolioMessage} onDone={folioDone} />
      <ChargeDialog folio={dialog?.kind === "charge" ? dialog.folio : null} open={dialogOpen && dialog?.kind === "charge"} onClose={() => setDialogOpen(false)} say={setFolioMessage} onDone={folioDone} />
      <MoveEntryDialog
        entry={dialog?.kind === "move" ? dialog.entry : null}
        targets={dialog?.kind === "move" && stay ? stay.folios.filter((folio) => folio.state === "open" && !folio.entries.some((entry) => entry.id === dialog.entry.id)) : []}
        open={dialogOpen && dialog?.kind === "move"}
        onClose={() => setDialogOpen(false)}
        say={setFolioMessage}
        onDone={folioDone}
      />
    </>
  );
}

interface RegionProps {
  folio: Folio;
  stay: Stay;
  say: (text: string) => void;
  onChanged: () => void;
  openDialog: (dialog: Dialog) => void;
  canMove: boolean;
  sibling: (stay: Stay) => void;
}

function FolioRegion({ folio, stay, say, onChanged, openDialog, canMove }: RegionProps) {
  const [payerName, setPayerName] = useState(folio.payerName);
  const [payerEmail, setPayerEmail] = useState(folio.payerEmail);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef(false);
  const letter = folio.name.replace("Folio ", "");
  const closed = folio.state === "closed";
  const reversed = new Set(stay.folios.flatMap((candidate) => candidate.entries).map((entry) => entry.reversesEntryId));

  useEffect(() => {
    setPayerName(folio.payerName);
    setPayerEmail(folio.payerEmail);
  }, [folio.payerName, folio.payerEmail]);

  const run = async (key: string, pending: string, send: () => Promise<Result<unknown>>, done: (data: unknown) => string): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyKey(key);
    say(pending);
    setErrors({});
    const answer = await send();
    if (answer.ok) say(done(answer.data));
    else {
      setErrors(answer.errors);
      say(refusalText(answer));
    }
    busyRef.current = false;
    setBusyKey(null);
    onChanged();
  };

  return (
    <section role="region" aria-label={folio.name} className="folio" data-state={folio.state}>
      <header className="folio-head">
        <h4>{folio.name}</h4>
        <span role="status" aria-label="Invoice state" className="badge">{folio.invoice ? "Issued" : "Draft"}</span>
        <span role="status" aria-label="Mail state" className="badge">{folio.invoice?.mailState === "sent" ? "Sent" : "Not sent"}</span>
      </header>
      <form className="payer-form" onSubmit={(event) => {
        event.preventDefault();
        void run("payer", "Saving payer…", () => call("PATCH", `/api/folios/${folio.id}`, { payerName, payerEmail }), () => "Payer saved.");
      }}>
        <div className="field">
          <label htmlFor={`payer-name-${letter}`}>Payer name</label>
          <input id={`payer-name-${letter}`} type="text" value={payerName} disabled={closed} onChange={(event) => setPayerName(event.target.value)} />
          <FieldMessage message={errors.payerName} />
        </div>
        <div className="field">
          <label htmlFor={`payer-email-${letter}`}>Payer email</label>
          <input id={`payer-email-${letter}`} type="text" value={payerEmail} disabled={closed} onChange={(event) => setPayerEmail(event.target.value)} />
          <FieldMessage message={errors.payerEmail} />
        </div>
        {closed ? null : <button type="submit" aria-busy={busyKey === "payer"}>Save payer</button>}
      </form>
      {folio.entries.length === 0 ? <EmptySheet>No entries yet.</EmptySheet> : null}
      <div className="table-frame" tabIndex={0} role="group" aria-label={`${folio.name} entries, scrollable`}>
        <table aria-label={`${folio.name} entries`} className="ledger">
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="money-head">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {folio.entries.map((entry) => {
              const changeable = !closed && entry.reversesEntryId === null && !reversed.has(entry.id);
              const movable = !closed && canMove;
              return (
                <tr key={entry.id} data-entry-id={entry.id}>
                  <td>{entry.date}</td>
                  <td>{entry.description}</td>
                  <td className="money">{formatMoney(entry.amountCents)}</td>
                  <td className="row-buttons">
                    {entry.kind === "charge" ? (
                      <button type="button" aria-label={`Split ${entry.description}`} aria-disabled={!changeable} onClick={() => changeable && openDialog({ kind: "split", entry })}>Split</button>
                    ) : null}
                    <button type="button" aria-label={`Reverse ${entry.description}`} aria-disabled={!changeable} aria-busy={busyKey === entry.id} onClick={() => changeable && void run(entry.id, "Posting reversal…", () => post(`/api/entries/${entry.id}/reverse`), () => "Reversal posted.")}>Reverse</button>
                    <button type="button" aria-label={`Move ${entry.description}`} aria-disabled={!movable} onClick={() => movable && openDialog({ kind: "move", entry })}>Move</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="balance-row">
        <span>Balance</span>
        <span role="status" aria-label={`Folio ${letter} balance`} className="money total">{formatMoney(folio.balanceCents)}</span>
      </div>
      <div className="action-row">
        {closed ? null : <button type="button" onClick={() => openDialog({ kind: "charge", folio })}>Add charge</button>}
        {closed ? null : <button type="button" onClick={() => openDialog({ kind: "payment", folio })}>Record payment</button>}
        {closed ? null : (
          <button type="button" className="primary" aria-busy={busyKey === "close"} onClick={() => void run("close", "Creating invoice…", () => post<Folio>(`/api/folios/${folio.id}/close`), (data) => `Invoice ${(data as Folio).invoice?.number ?? ""} issued.`)}>Close folio</button>
        )}
        {folio.invoice ? (
          <button type="button" aria-busy={busyKey === "email"} onClick={() => void run("email", "Sending invoice…", () => post(`/api/invoices/${folio.invoice?.id}/email`), () => `Invoice ${folio.invoice?.number} sent to ${folio.invoice?.payerEmail}.`)}>Email invoice</button>
        ) : null}
        {folio.invoice ? <a href={folio.invoice.pdfUrl} target="_blank" rel="noreferrer">Download invoice</a> : null}
      </div>
    </section>
  );
}

