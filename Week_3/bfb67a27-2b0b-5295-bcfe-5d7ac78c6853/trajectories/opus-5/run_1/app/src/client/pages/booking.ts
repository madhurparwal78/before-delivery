import { formatMoney } from '../../shared/money.js';
import { apiGet, apiSend, apiUpload, ApiFailure, newIdempotencyKey, renterHeaders } from '../api.js';
import {
  billableDaysLabel,
  cancelledText,
  certificateRejected,
  confirmedText,
  COPY,
  depositLabel,
  heldText,
  holdCountdown,
  repricedText,
} from '../copy.js';
import { openDialog } from '../dialog.js';
import { clear, el } from '../dom.js';
import { mountServiceNotice } from '../notice.js';
import type { Booking } from '../../shared/types.js';

const REFETCH_MS = 30_000;

export async function renderBookingPage(root: HTMLElement, ref: string): Promise<void> {
  clear(root);
  const renterKey = new URLSearchParams(window.location.search).get('key');
  const headers = renterHeaders(renterKey);

  const page = el('div', { class: 'page page-booking' });
  root.append(page);
  mountServiceNotice(page);

  const heading = el('h1', { class: 'booking-heading' });
  const stateBlock = el('div', { class: 'booking-state' });
  const status = el('div', { role: 'status', 'aria-label': 'Booking status', class: 'booking-status' });
  const holdRegion = el('section', { 'aria-label': 'Hold', class: 'hold-region' });
  const depositLine = el('p', { class: 'deposit-line' });
  const rateCardLine = el('p', { class: 'rate-card-line' });
  const figures = el('div', { class: 'booking-figures' });
  const serialList = el('ul', { class: 'serial-list' });
  const confirmButton = el('button', { type: 'button', class: 'button button-primary' }, [
    'Confirm and pay',
  ]);
  const confirmError = el('p', { class: 'field-error' });
  const cancelHost = el('div', { class: 'cancel-host' });

  let booking: Booking | null = null;
  let countdownSeconds = 0;
  let countdownAnchor = 0;
  let confirmInFlight = false;

  const fileInput = el('input', { type: 'file', id: 'certificate-file', accept: 'application/pdf' });
  const certificateStatusLine = el('p', { class: 'certificate-status' });
  const certificateError = el('p', { class: 'field-error' });
  const sendCertificate = el('button', { type: 'button', class: 'button' }, ['Send certificate']);

  const renderCertificate = (current: Booking): void => {
    const certificate = current.certificate;
    if (certificate === null) certificateStatusLine.textContent = COPY.certificateNone;
    else if (certificate.status === 'pending_review') {
      certificateStatusLine.textContent = COPY.certificateUnderReview;
    } else if (certificate.status === 'approved') {
      certificateStatusLine.textContent = COPY.certificateApproved;
    } else {
      certificateStatusLine.textContent = certificateRejected(certificate.reason ?? '');
    }
  };

  const renderStateBlock = (current: Booking): void => {
    clear(stateBlock);
    const show = (text: string, body: string): void => {
      stateBlock.append(el('h2', { class: 'state-heading' }, [text]));
      stateBlock.append(el('p', { class: 'state-text' }, [body]));
    };
    if (current.state === 'quote') show(COPY.heldHeading, heldText(current.ref));
    else if (current.state === 'expired') show(COPY.holdEndedHeading, COPY.holdEndedText);
    else if (current.state === 'cancelled') {
      show(COPY.cancelledHeading, cancelledText(current.totalCents));
    } else {
      show(COPY.confirmedHeading, confirmedText(current.ref, current.renter.email));
    }
  };

  const renderCancel = (current: Booking): void => {
    clear(cancelHost);
    if (current.state !== 'confirmed') return;
    const button = el('button', { type: 'button', class: 'button' }, ['Cancel booking']);
    button.addEventListener('click', () => {
      openDialog('Cancel booking', (close) => [
        el('h2', { class: 'dialog-heading' }, ['Cancel booking']),
        el('p', {}, [`Booking ${current.ref} will be refunded in full.`]),
        el('div', { class: 'dialog-actions' }, [
          confirmCancelButton(close),
          keepButton(close),
        ]),
      ]);
    });
    cancelHost.append(button);
  };

  const confirmCancelButton = (close: () => void): HTMLElement => {
    const button = el('button', { type: 'button', class: 'button button-primary' }, [
      'Cancel booking and refund',
    ]);
    button.addEventListener('click', () => {
      void (async () => {
        try {
          const updated = await apiSend<Booking>(
            'POST',
            `/api/bookings/${ref}/cancel`,
            {},
            headers,
          );
          close();
          apply(updated);
          status.textContent = cancelledText(updated.totalCents);
        } catch (error) {
          if (!(error instanceof ApiFailure)) throw error;
          close();
          status.textContent = error.controlMessage();
        }
      })();
    });
    return button;
  };

  const keepButton = (close: () => void): HTMLElement => {
    const button = el('button', { type: 'button', class: 'button' }, ['Keep booking']);
    button.addEventListener('click', close);
    return button;
  };

  const renderFigures = (current: Booking): void => {
    clear(figures);
    const row = (label: string, value: string, display = false): HTMLElement =>
      el('div', { class: 'figure-row' }, [
        el('span', { class: 'figure-label' }, [label]),
        el('span', { class: display ? 'figure-value numerals-small' : 'figure-value' }, [value]),
      ]);
    figures.append(
      row('Pickup', current.pickupDate),
      row('Return', current.returnDate),
      row('Billable days', billableDaysLabel(current.billableDays), true),
      row('Hire price', formatMoney(current.hirePriceCents), true),
      row('Deposit', formatMoney(current.depositCents), true),
      row('Total', formatMoney(current.totalCents), true),
    );
  };

  const renderSerials = (current: Booking): void => {
    clear(serialList);
    for (const unit of current.units) {
      serialList.append(
        el('li', {}, [`${unit.serial} · ${unit.className} · ${unit.location}`]),
      );
    }
  };

  const renderHold = (current: Booking): void => {
    clear(holdRegion);
    if (current.state !== 'quote' || current.holdSecondsRemaining === null) {
      holdRegion.hidden = true;
      return;
    }
    holdRegion.hidden = false;
    countdownSeconds = current.holdSecondsRemaining;
    countdownAnchor = performance.now();
    holdRegion.append(el('p', { class: 'hold-countdown' }, [holdCountdown(countdownSeconds)]));
  };

  const apply = (current: Booking): void => {
    booking = current;
    heading.textContent = `${current.ref} · ${current.kit.name}`;
    renderStateBlock(current);
    renderHold(current);
    depositLine.textContent = depositLabel(current.paymentStatus);
    rateCardLine.textContent = `Rate card v${current.rateCardVersion}`;
    renderFigures(current);
    renderSerials(current);
    renderCertificate(current);
    renderCancel(current);
    confirmButton.disabled = !current.confirmable || confirmInFlight;
    confirmButton.hidden = current.state !== 'quote';
    fileInput.disabled = !['quote', 'confirmed', 'prepped'].includes(current.state);
    sendCertificate.disabled = fileInput.disabled;
  };

  const reload = async (): Promise<void> => {
    try {
      apply(await apiGet<Booking>(`/api/bookings/${ref}`, headers));
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      status.textContent = error.controlMessage();
    }
  };

  sendCertificate.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    certificateError.textContent = '';
    if (file === undefined) {
      certificateError.textContent = 'Upload the certificate as a PDF';
      return;
    }
    void (async () => {
      certificateStatusLine.textContent = COPY.certificateUploading;
      const form = new FormData();
      form.append('file', file);
      try {
        const updated = await apiUpload<Booking>(
          `/api/bookings/${ref}/certificate`,
          form,
          headers,
        );
        apply(updated);
        status.textContent = COPY.certificateReceived;
        certificateStatusLine.textContent = COPY.certificateUnderReview;
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        certificateError.textContent = error.controlMessage('file');
        status.textContent = error.controlMessage('file');
        if (booking !== null) renderCertificate(booking);
      }
    })();
  });

  confirmButton.addEventListener('click', () => {
    if (confirmInFlight) return;
    confirmInFlight = true;
    confirmError.textContent = '';
    confirmButton.disabled = true;
    confirmButton.textContent = COPY.confirmPending;
    depositLine.textContent = depositLabel('pending');
    void (async () => {
      try {
        const updated = await apiSend<Booking>(
          'POST',
          `/api/bookings/${ref}/confirm`,
          {},
          { ...headers, 'Idempotency-Key': newIdempotencyKey() },
        );
        confirmInFlight = false;
        confirmButton.textContent = 'Confirm and pay';
        apply(updated);
        status.textContent = confirmedText(updated.ref, updated.renter.email);
      } catch (error) {
        confirmInFlight = false;
        confirmButton.textContent = 'Confirm and pay';
        if (!(error instanceof ApiFailure)) throw error;
        const repriced = error.body.error.booking;
        if (error.code === 'quote_repriced' && repriced !== undefined) {
          apply(repriced);
          const message = repricedText(repriced.rateCardEffectiveDate);
          confirmError.textContent = message;
          status.textContent = message;
          return;
        }
        confirmError.textContent = error.controlMessage();
        status.textContent = error.controlMessage();
        await reload();
      }
    })();
  });

  page.append(
    el('div', { class: 'booking-main' }, [
      heading,
      stateBlock,
      status,
      holdRegion,
      depositLine,
      rateCardLine,
      figures,
      el('h2', { class: 'section-heading' }, ['Your units']),
      serialList,
      el('div', { class: 'certificate-section' }, [
        el('h2', { class: 'section-heading' }, ['Certificate of insurance']),
        certificateStatusLine,
        el('label', { class: 'field', for: 'certificate-file' }, [
          el('span', { class: 'field-label' }, ['Certificate of insurance (PDF)']),
          fileInput,
        ]),
        certificateError,
        sendCertificate,
      ]),
      confirmError,
      confirmButton,
      cancelHost,
    ]),
  );

  await reload();

  let reloadedAtZero = false;
  window.setInterval(() => {
    if (booking === null || booking.state !== 'quote') return;
    const elapsed = Math.floor((performance.now() - countdownAnchor) / 1000);
    const remaining = Math.max(0, countdownSeconds - elapsed);
    const line = holdRegion.querySelector('.hold-countdown');
    if (line !== null) line.textContent = holdCountdown(remaining);
    if (remaining > 0) {
      reloadedAtZero = false;
      return;
    }
    if (reloadedAtZero) return;
    reloadedAtZero = true;
    void reload();
  }, 1_000);

  window.setInterval(() => void reload(), REFETCH_MS);
}
