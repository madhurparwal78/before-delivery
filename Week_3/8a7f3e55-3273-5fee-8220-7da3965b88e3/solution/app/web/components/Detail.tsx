import { useLayoutEffect, useRef, useState } from "react";
import type { AuditEntry, Booking, SessionUser } from "../../shared/api";
import { isBeforeCheckIn } from "../../shared/status";
import { AssignDialog } from "../dialogs/AssignDialog";
import { CancelDialog } from "../dialogs/CancelDialog";
import { CompleteDialog } from "../dialogs/CompleteDialog";
import { type ApiFailure, apiGet } from "../lib/api";
import { STATUS_LABELS } from "../lib/copy";
import { dateTimeOf, timeOf } from "../lib/format";
import { mySeat } from "../lib/holders";
import { usePolled } from "../lib/refresh";
import { FactsPanel } from "../panels/FactsPanel";
import { PrepPanel } from "../panels/PrepPanel";
import { RotationPanel } from "../panels/RotationPanel";
import { CoordinatorSeats, InterpreterSeats, InterpretersPanel } from "../panels/SeatsPanels";
import { AuditPanel, BillingPanel, ChargeLine } from "../panels/SidePanels";

type Dialog = { kind: "assign"; seat: number } | { kind: "complete" } | { kind: "cancel" } | null;

interface DetailProps {
  booking: Booking;
  user: SessionUser;
  /** Changes whenever the user chooses a row, so the heading takes focus once per choice. */
  focusToken: number;
  onBack: (() => void) | null;
  onBooking: (booking: Booking) => void;
  /** An interpreter withdrew from this booking. */
  onWithdrawn?: () => void;
  /** An interpreter claimed a seat on this booking. */
  /** Whether the interpreter's Open calls still offers this booking; the Claim seat button follows that list. */
  claimable?: boolean;
  onClaimed?: (booking: Booking) => void;
  /** An interpreter's claim on this booking was refused. */
  onClaimRefused?: (failure: ApiFailure) => void;
}

const nothing = (): void => undefined;

/** The selected booking in full, for the signed-in role. */
export function Detail({ booking, user, focusToken, onBack, onBooking, onWithdrawn = nothing, claimable = true, onClaimed = nothing, onClaimRefused = nothing }: DetailProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const seatsHeadingRef = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [seatsFocus, setSeatsFocus] = useState(0);
  const [headingFocus, setHeadingFocus] = useState(0);
  const staff = user.role === "coordinator" || user.role === "billing_manager";
  const audit = usePolled<AuditEntry[]>(staff ? `audit:${booking.id}` : null, async () => (await apiGet<{ entries: AuditEntry[] }>(`/api/bookings/${booking.id}/audit`)).entries);

  useLayoutEffect(() => {
    if (focusToken > 0) headingRef.current?.focus();
  }, [focusToken]);
  useLayoutEffect(() => {
    if (headingFocus > 0) headingRef.current?.focus();
  }, [headingFocus]);
  useLayoutEffect(() => {
    if (seatsFocus > 0) seatsHeadingRef.current?.focus();
  }, [seatsFocus]);

  const held = user.role === "interpreter" && mySeat(booking) !== null;
  const closeDialog = () => setDialog(null);
  // The booking became final while a dialog was open: the dialog closes and focus goes to the heading.
  const finalBooking = () => {
    closeDialog();
    setHeadingFocus((count) => count + 1);
  };

  return (
    <section className="detail" aria-label="Assignment detail">
      {onBack ? (
        <button type="button" className="btn back" onClick={onBack}>
          Back to list
        </button>
      ) : null}
      <header className="detail-head">
        <div className="detail-title">
          <h2 tabIndex={-1} ref={headingRef} data-detail-heading>
            {booking.ref} · {booking.title}
          </h2>
          {(user.role === "requester" || user.role === "coordinator") && isBeforeCheckIn(booking.status) ? (
            <button type="button" className="btn" onClick={() => setDialog({ kind: "cancel" })}>
              Cancel booking
            </button>
          ) : null}
        </div>
        <p className="detail-meta mono">
          {dateTimeOf(booking.start)}–{timeOf(booking.end)} · {booking.org_name} · {STATUS_LABELS[booking.status]}
        </p>
      </header>
      <RotationPanel booking={booking} />
      <FactsPanel booking={booking} />
      {user.role === "coordinator" ? (
        <CoordinatorSeats
          booking={booking}
          headingRef={seatsHeadingRef}
          onBooking={onBooking}
          onAssign={(seat) => setDialog({ kind: "assign", seat })}
          onComplete={() => setDialog({ kind: "complete" })}
        />
      ) : null}
      {user.role === "interpreter" ? <InterpreterSeats booking={booking} headingRef={seatsHeadingRef} onBooking={onBooking} claimable={claimable} onClaimed={onClaimed} onClaimRefused={onClaimRefused} onWithdrawn={onWithdrawn} /> : null}
      {user.role === "requester" || user.role === "billing_manager" ? <InterpretersPanel booking={booking} /> : null}
      <PrepPanel
        booking={booking}
        canUpload={user.role === "requester" || user.role === "coordinator"}
        canDownload={held}
        onUploaded={() => apiGet<Booking>(`/api/bookings/${booking.id}`).then(onBooking, () => undefined)}
      />
      {user.role === "coordinator" ? <BillingPanel booking={booking} /> : null}
      {user.role === "requester" || user.role === "billing_manager" ? <ChargeLine booking={booking} /> : null}
      {staff ? <AuditPanel entries={audit.data} /> : null}

      {dialog?.kind === "assign" ? (
        <AssignDialog
          booking={booking}
          seat={dialog.seat}
          onClose={closeDialog}
          onAssigned={(updated) => {
            onBooking(updated);
            closeDialog();
            setSeatsFocus((count) => count + 1);
          }}
        />
      ) : null}
      {dialog?.kind === "complete" ? (
        <CompleteDialog
          booking={booking}
          onClose={closeDialog}
          onCompleted={(updated) => {
            onBooking(updated);
            closeDialog();
            setHeadingFocus((count) => count + 1);
          }}
          onFinal={finalBooking}
        />
      ) : null}
      {dialog?.kind === "cancel" ? (
        <CancelDialog
          booking={booking}
          onClose={closeDialog}
          onCancelled={(updated) => {
            onBooking(updated);
            closeDialog();
            setHeadingFocus((count) => count + 1);
          }}
          onFinal={finalBooking}
        />
      ) : null}
    </section>
  );
}
