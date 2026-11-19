import { useEffect, useRef, useState } from "react";
import type { Booking, ManageResponse } from "../../shared/api.js";
import { formatDayLabel, guestsLabel } from "../../shared/calendar.js";
import { formatEuros } from "../../shared/euros.js";
import { get, post } from "../api.js";
import { useAnnouncer } from "../announce.js";
import { AlertIcon } from "../components/Icons.js";
import { ModalDialog } from "../components/ModalDialog.js";
import { OneSentence, Page } from "../components/Shell.js";
import { CANCEL_DOWN, DEAD_MANAGE, depositLine } from "../copy.js";

type View = { kind: "loading" } | { kind: "dead" } | { kind: "ready"; data: ManageResponse; booking: Booking };

function refundPreview(data: ManageResponse): string {
  const { amount_cents } = data.booking.deposit;
  if (amount_cents === 0) return "There is no deposit on this booking.";
  const amount = formatEuros(amount_cents);
  return data.refund_if_cancelled_now
    ? `Cancelling now refunds your €${amount} deposit in full.`
    : `Cancelling now keeps your €${amount} deposit.`;
}

function cancelAnnouncement(booking: Booking): string {
  const amount = formatEuros(booking.deposit.amount_cents);
  if (booking.deposit.state === "refunded") return `Booking cancelled. Your €${amount} deposit has been refunded.`;
  if (booking.deposit.state === "retained") return `Booking cancelled. Your €${amount} deposit has been kept.`;
  return "Booking cancelled. No deposit was taken.";
}

export function ManagePage({ token }: { token: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useAnnouncer(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void get<ManageResponse>(`/api/manage/${token}`).then((outcome) =>
      setView(outcome.ok ? { kind: "ready", data: outcome.body, booking: outcome.body.booking } : { kind: "dead" }),
    );
  }, [token]);

  const status = view.kind === "ready" ? view.booking.status : null;
  useEffect(() => {
    if (status !== null) heading.current?.focus();
  }, [status]);

  if (view.kind === "loading") return <OneSentence>Loading your booking...</OneSentence>;
  if (view.kind === "dead") return <OneSentence>{DEAD_MANAGE}</OneSentence>;

  const { data, booking } = view;
  const cancelled = booking.status === "cancelled_refunded" || booking.status === "cancelled_retained";

  const cancel = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(null);
    const outcome = await post<{ booking: Booking }>(`/api/manage/${token}/cancel`, {}, { keyed: true });
    setPending(false);
    if (outcome.ok) {
      setAsking(false);
      setView({ kind: "ready", data, booking: outcome.body.booking });
      live.announce(cancelAnnouncement(outcome.body.booking));
    } else if (outcome.failure.code === "link_expired") {
      setView({ kind: "dead" });
    } else {
      setError(outcome.failure.code === "deposits_paused" ? CANCEL_DOWN : outcome.failure.message);
      window.setTimeout(() => confirmButton.current?.focus(), 0);
    }
  };

  const close = (): void => {
    setAsking(false);
    window.setTimeout(() => opener.current?.focus(), 0);
  };

  return (
    <Page
      summary={`${formatDayLabel(booking.date)} · ${booking.time} · ${guestsLabel(booking.party_size)}`}
      summaryLevel="p"
      live={{ label: "Booking updates", messages: live.messages }}
      narrow
    >
      <div className="stack">
        <h1 className="heading-large heading-focus" tabIndex={-1} ref={heading}>
          {cancelled ? "Booking cancelled" : "You're booked"}
        </h1>
        <p>Reference {booking.reference}</p>
        <p>
          Table {booking.table_id}, {booking.room}
        </p>
        <p>{depositLine(booking.deposit)}</p>
        {booking.status === "booked" && (
          <div className="actions">
            <button type="button" className="button" ref={opener} onClick={() => setAsking(true)}>
              Cancel booking
            </button>
          </div>
        )}
      </div>
      {asking && (
        <ModalDialog labelId="cancel-title" pending={pending} onClose={close}>
          <h2 id="cancel-title">Cancel this booking</h2>
          <p className="note">{refundPreview(data)}</p>
          {error !== null && (
            <p role="alert" className="field-error note">
              <AlertIcon />
              <span>{error}</span>
            </p>
          )}
          <div className="actions">
            <button type="button" className="button" data-initial-focus aria-disabled={pending} onClick={() => !pending && close()}>
              Keep booking
            </button>
            <button type="button" className="button button-solid" ref={confirmButton} aria-disabled={pending} onClick={() => void cancel()}>
              {pending ? "Cancelling..." : "Yes, cancel"}
            </button>
          </div>
        </ModalDialog>
      )}
    </Page>
  );
}
