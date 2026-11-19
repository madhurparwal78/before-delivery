import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Booking, ManageResponse } from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { LiveRegion, OutageBanners, PinnedTitle } from '../components/Shell';
import { ApiFailure, apiGet, apiPost } from '../lib/api';
import {
  COPY,
  bookingSummaryLine,
  cancelResultAnnouncement,
  depositLine,
  refundPreviewLine,
} from '../lib/format';
import { useOutage } from '../lib/hooks';

export function Manage(): JSX.Element {
  const { token = '' } = useParams();
  const outage = useOutage();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [refundsNow, setRefundsNow] = useState(false);
  const [dead, setDead] = useState(false);
  const [cancelled, setCancelled] = useState<Booking | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const keepButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<ManageResponse>(`/api/manage/${token}`);
      setBooking(response.booking);
      setRefundsNow(response.refund_if_cancelled_now);
    } catch (failure) {
      if (failure instanceof ApiFailure && (failure.status === 410 || failure.status === 404)) {
        setDead(true);
        return;
      }
      setDead(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (booking && !cancelled) headingRef.current?.focus();
  }, [booking, cancelled]);

  const cancel = async (): Promise<void> => {
    setPending(true);
    setDialogError(null);
    try {
      const response = await apiPost<{ booking: Booking }>(
        `/api/manage/${token}/cancel`,
        {},
        `cancel-${token}`,
      );
      setCancelled(response.booking);
      setDialogOpen(false);
      setAnnouncement(cancelResultAnnouncement(response.booking));
      window.setTimeout(() => headingRef.current?.focus(), 0);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 503) {
        outage.reportOutage(failure.code);
        setDialogError(COPY.cancelDepositsPaused);
      } else if (failure instanceof ApiFailure && failure.status === 410) {
        setDialogError(COPY.deadManageLink);
      } else if (failure instanceof ApiFailure) {
        setDialogError(failure.message);
      }
      confirmButtonRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  if (dead) {
    return (
      <div className="page">
        <OutageBanners />
        <PinnedTitle>{COPY.deadManageLink}</PinnedTitle>
      </div>
    );
  }

  const shown = cancelled ?? booking;
  if (!shown) {
    return (
      <div className="page">
        <OutageBanners />
        <PinnedTitle>{COPY.planLoading}</PinnedTitle>
      </div>
    );
  }

  return (
    <div className="page manage">
      <OutageBanners />
      <PinnedTitle heading={false}>
        {bookingSummaryLine(shown.date, shown.time, shown.party_size)}
      </PinnedTitle>
      <LiveRegion label="Booking updates" message={announcement} />
      <h1 className="heading" tabIndex={-1} ref={headingRef}>
        {cancelled ? COPY.cancelledHeading : COPY.bookedHeading}
      </h1>
      <p>{`Reference ${shown.reference}`}</p>
      <p>{`Table ${shown.table_id}, ${shown.room}`}</p>
      <p>{depositLine(shown)}</p>
      {cancelled ? null : (
        <button
          type="button"
          className="button"
          ref={cancelButtonRef}
          onClick={() => {
            setDialogError(null);
            setDialogOpen(true);
          }}
        >
          Cancel booking
        </button>
      )}
      {dialogOpen ? (
        <Dialog
          label="Cancel this booking"
          initialFocusRef={keepButtonRef}
          onEscape={
            pending
              ? undefined
              : () => {
                  setDialogOpen(false);
                  cancelButtonRef.current?.focus();
                }
          }
        >
          <p>{refundPreviewLine(shown, refundsNow)}</p>
          {dialogError ? (
            <p role="alert" className="field-error">
              {dialogError}
            </p>
          ) : null}
          <button
            type="button"
            className="button"
            ref={keepButtonRef}
            aria-disabled={pending ? true : undefined}
            onClick={() => {
              if (pending) return;
              setDialogOpen(false);
              cancelButtonRef.current?.focus();
            }}
          >
            Keep booking
          </button>
          <button
            type="button"
            className="button button--accent"
            ref={confirmButtonRef}
            aria-disabled={pending ? true : undefined}
            onClick={() => {
              if (pending) return;
              void cancel();
            }}
          >
            {pending ? 'Cancelling...' : 'Yes, cancel'}
          </button>
        </Dialog>
      ) : null}
    </div>
  );
}
