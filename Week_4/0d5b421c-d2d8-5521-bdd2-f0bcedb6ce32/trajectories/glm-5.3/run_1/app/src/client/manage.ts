import {
  apiJson, ApiFailure, escapeHtml, euro, idemKey, renderBanners, trapFocus, watchStatus, DEAD_LINK,
} from "./shared.js";

interface Booking {
  reference: string;
  status: string;
  source: string;
  date: string;
  time: string;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  name: string;
  deposit: { amount_cents: number; state: string };
}

interface ManageResponse {
  booking: Booking;
  server_now: string;
  refund_if_cancelled_now: boolean;
}

function depositLine(b: Booking): string {
  const amount = euro(b.deposit.amount_cents);
  if (b.deposit.state === "none") return "No deposit";
  if (b.deposit.state === "paid") return `Deposit €${amount} paid`;
  if (b.deposit.state === "refunded") return `Refunded: €${amount}`;
  return `Deposit kept: €${amount}`;
}

async function main(): Promise<void> {
  const token = location.pathname.split("/").pop() ?? "";
  const stateEl = document.getElementById("manage-state") as HTMLElement;
  const detailsEl = document.getElementById("manage-details") as HTMLElement;
  const summary = document.getElementById("summary-line") as HTMLElement;
  const statusRegion = document.getElementById("status-region") as HTMLElement;
  const bannerSlot = document.getElementById("banner-slot") as HTMLElement;
  const dialogSlot = document.getElementById("cancel-dialog-slot") as HTMLElement;

  let booking: Booking | null = null;
  let cancelledHeadingShown = false;

  const render = (b: Booking, heading: string, cancelledLine: string | null): void => {
    const dl = `
      <p style="font-size:28px; font-weight:600; margin:0 0 12px;" id="manage-heading">${escapeHtml(heading)}</p>
      <p>Reference ${escapeHtml(b.reference)}</p>
      <p>Table ${escapeHtml(b.table_id)}, ${escapeHtml(b.room)}</p>
      <p>${escapeHtml(depositLine(b))}</p>`;
    if (cancelledLine !== null) {
      detailsEl.innerHTML = dl;
      return;
    }
    detailsEl.innerHTML = `${dl}
      <p><button class="btn btn-quiet" id="cancel-btn">Cancel booking</button></p>`;
    const btn = document.getElementById("cancel-btn") as HTMLButtonElement;
    btn.addEventListener("click", () => openDialog());
  };

  const openDialog = (): void => {
    if (!booking) return;
    const amount = euro(booking.deposit.amount_cents);
    const preview = booking.deposit.amount_cents === 0
      ? "There is no deposit on this booking."
      : refundIf
        ? `Cancelling now refunds your €${amount} deposit in full.`
        : `Cancelling now keeps your €${amount} deposit.`;

    dialogSlot.innerHTML = `
      <div class="overlay" id="cancel-overlay">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Cancel this booking">
          <h2>Cancel this booking</h2>
          <p id="refund-preview">${escapeHtml(preview)}</p>
          <p class="mini-state" id="dialog-error" role="alert"></p>
          <div class="actions">
            <button class="btn btn-quiet" id="keep-btn">Keep booking</button>
            <button class="btn" id="yes-btn">Yes, cancel</button>
          </div>
        </div>
      </div>`;
    const overlay = document.getElementById("cancel-overlay") as HTMLElement;
    const keepBtn = document.getElementById("keep-btn") as HTMLButtonElement;
    const yesBtn = document.getElementById("yes-btn") as HTMLButtonElement;
    let pending = false;
    let restore: (() => void) | null = null;

    const close = (): void => {
      if (pending) return;
      restore?.();
      dialogSlot.innerHTML = "";
      const cancelBtn = document.getElementById("cancel-btn") as HTMLButtonElement | null;
      cancelBtn?.focus();
    };

    restore = trapFocus(overlay, () => close(), keepBtn);
    keepBtn.addEventListener("click", close);

    yesBtn.addEventListener("click", async () => {
      if (pending || !booking) return;
      pending = true;
      yesBtn.setAttribute("aria-disabled", "true");
      keepBtn.setAttribute("aria-disabled", "true");
      const original = yesBtn.textContent;
      yesBtn.textContent = "Cancelling...";
      try {
        const resp = await apiJson<{ booking: Booking }>(`/api/manage/${token}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey() },
          body: JSON.stringify({}),
        });
        const b = resp.booking;
        restore?.();
        dialogSlot.innerHTML = "";
        const line = b.deposit.state === "refunded"
          ? `Booking cancelled. Your €${euro(b.deposit.amount_cents)} deposit has been refunded.`
          : b.deposit.state === "retained"
            ? `Booking cancelled. Your €${euro(b.deposit.amount_cents)} deposit has been kept.`
            : "Booking cancelled. No deposit was taken.";
        detailsEl.innerHTML = `
          <h1 id="cancelled-heading" style="font-size:28px; font-weight:600;">Booking cancelled</h1>
          <p>${escapeHtml(depositLine(b))}</p>`;
        const heading = document.getElementById("cancelled-heading") as HTMLElement;
        heading.setAttribute("tabindex", "-1");
        heading.focus();
        statusRegion.textContent = line;
        cancelledHeadingShown = true;
        booking = b;
      } catch (e) {
        pending = false;
        yesBtn.setAttribute("aria-disabled", "false");
        keepBtn.setAttribute("aria-disabled", "false");
        yesBtn.textContent = original;
        if (e instanceof ApiFailure) {
          if (e.status === 503) {
            const errEl = document.getElementById("dialog-error");
            if (errEl) errEl.textContent = "We couldn't reach our payments system, so your booking is unchanged. Please try again shortly.";
            renderBannerNow();
            yesBtn.focus();
            return;
          }
          if (e.status === 410) {
            restore?.();
            dialogSlot.innerHTML = "";
            stateEl.textContent = DEAD_LINK;
            return;
          }
          if (e.status === 409) {
            const errEl = document.getElementById("dialog-error");
            if (errEl) errEl.textContent = "That booking has already changed.";
            yesBtn.focus();
            return;
          }
        }
        const errEl = document.getElementById("dialog-error");
        if (errEl) errEl.textContent = "We couldn't cancel that booking. Please try again.";
        yesBtn.focus();
      }
    });
  };

  let refundIf = false;

  function renderBannerNow(): void {
    void apiJson<{ holds: "ok" | "paused"; deposits: "ok" | "paused" }>("/api/status")
      .then((s) => renderBanners(bannerSlot, s, false)).catch(() => undefined);
  }

  try {
    const resp = await apiJson<ManageResponse>(`/api/manage/${token}`);
    booking = resp.booking;
    refundIf = resp.refund_if_cancelled_now;
    summary.textContent = `${booking.table_id} · ${booking.time} · ${booking.party_size} ${booking.party_size === 1 ? "guest" : "guests"}`;
    render(booking, "You're booked", null);
    const heading = document.getElementById("manage-heading") as HTMLElement;
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 410) {
      stateEl.textContent = DEAD_LINK;
    } else {
      stateEl.textContent = "We couldn't load this booking. Refresh to try again.";
    }
    return;
  }

  watchStatus((s) => renderBanners(bannerSlot, s, false));
  void cancelledHeadingShown;
}

void main();
