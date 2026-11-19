import {
  apiJson, ApiFailure, escapeHtml, euro, formatCountdown, idemKey, openEvents, renderBanners,
  ServerClock, watchStatus, DEAD_LINK, type FloorResponse,
} from "./shared.js";

interface OfferResponse {
  status: "offered";
  date: string;
  time: string;
  starts_at: string;
  party_size: number;
  table_id: string;
  room: string;
  expires_at: string;
  server_now: string;
  deposit_cents: number;
}

interface Booking {
  reference: string;
  table_id: string;
  room: string;
  party_size: number;
  deposit: { amount_cents: number; state: string };
}

interface ClaimResponse { booking: Booking; manage_url: string; }

const clock = new ServerClock();

async function main(): Promise<void> {
  const token = location.pathname.split("/").pop() ?? "";
  const stateEl = document.getElementById("offer-state") as HTMLElement;
  const detailsEl = document.getElementById("offer-details") as HTMLElement;
  const planEl = document.getElementById("plan") as HTMLElement;
  const statusRegion = document.getElementById("status-region") as HTMLElement;
  const bannerSlot = document.getElementById("banner-slot") as HTMLElement;
  const summary = document.getElementById("summary-line") as HTMLElement;

  const floor = await apiJson<FloorResponse>("/api/floor");

  let offer: OfferResponse | null = null;

  const drawPlan = (): void => {
    if (!offer) return;
    const html = floor.rooms.map((room) => `
      <div class="plan-room">
        <h3>${escapeHtml(room.name)}</h3>
        <div class="plan-canvas">
          ${room.tables.map((t) => {
            const isOffered = offer !== null && (offer.table_id === t.table_id || offer.table_id.includes(t.table_id));
            const state = isOffered ? "Offered to you" : "Free";
            return `<div class="table-cell" data-round="${t.max_seats <= 2}" data-table="${t.table_id}">
              <div class="table-btn ${t.max_seats <= 2 ? "round" : ""} ${isOffered ? "status-held" : "status-fits"}"
                aria-label="Table ${t.table_id}, ${room.name}, ${t.min_seats} to ${t.max_seats} seats, ${state}">
                <span class="tid">${t.table_id}</span>
                <span class="seats">${t.min_seats} to ${t.max_seats} seats</span>
                <span class="state">${state}</span>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`).join("");
    planEl.innerHTML = html;
  };

  const drawDetails = (): void => {
    if (!offer) return;
    const depositLine = offer.deposit_cents > 0
      ? `A deposit of €${euro(offer.deposit_cents)} is charged if you claim this table.`
      : "No deposit is charged for this table.";
    detailsEl.innerHTML = `
      <dl style="margin:0 0 18px;">
        <div><dt style="font-weight:600">Room</dt><dd style="margin:0 0 10px;">${escapeHtml(offer.room)}</dd></div>
        <div><dt style="font-weight:600">Table</dt><dd style="margin:0 0 10px;">${escapeHtml(offer.table_id)}</dd></div>
        <div><dt style="font-weight:600">Date and time</dt><dd style="margin:0 0 10px;">${escapeHtml(offer.date)} · ${escapeHtml(offer.time)}</dd></div>
        <div><dt style="font-weight:600">Party</dt><dd style="margin:0 0 10px;">${offer.party_size} ${offer.party_size === 1 ? "guest" : "guests"}</dd></div>
        <div><dt style="font-weight:600">Deposit</dt><dd style="margin:0 0 10px;">${depositLine}</dd></div>
      </dl>
      <div class="countdown" id="offer-countdown"></div>
      <p><button class="btn" id="claim-btn">Claim table</button></p>`;

    const claimBtn = document.getElementById("claim-btn") as HTMLButtonElement;
    claimBtn.addEventListener("click", () => void claim(claimBtn));

    const row = document.getElementById("offer-countdown") as HTMLElement;
    const bar = document.createElement("progress");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Offer time remaining");
    bar.max = Math.round((new Date(offer.expires_at).getTime() - new Date(offer.server_now).getTime()) / 1000);
    const label = document.createElement("span");
    label.className = "label";
    row.replaceChildren(bar, label);
    setInterval(() => {
      if (!offer) return;
      const remainingMs = new Date(offer.expires_at).getTime() - clock.now().getTime();
      const seconds = Math.max(0, Math.floor(remainingMs / 1000));
      bar.value = seconds;
      label.textContent = `Offer ends in ${formatCountdown(seconds)}`;
      if (seconds <= 0) {
        stateEl.textContent = "This offer has ended.";
        claimBtn.disabled = true;
      }
    }, 1000);
  };

  async function claim(btn: HTMLButtonElement): Promise<void> {
    if (!offer) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Claiming...";
    try {
      const resp = await apiJson<ClaimResponse>(`/api/offers/${token}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey() },
        body: JSON.stringify({}),
      });
      const url = new URL(resp.manage_url);
      location.href = url.pathname;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = original;
      if (e instanceof ApiFailure) {
        if (e.status === 410) {
          stateEl.textContent = e.code === "offer_claimed" ? DEAD_LINK : "This offer has ended.";
          return;
        }
        if (e.status === 503) {
          renderBannerNow();
          return;
        }
        if (e.code === "payment_failed") {
          statusRegion.textContent = "Your deposit didn't go through, so nothing was booked. Your table is still held.";
          return;
        }
      }
      statusRegion.textContent = "We couldn't claim that table. Please try again.";
    }
  }

  function renderBannerNow(): void {
    void apiJson<{ holds: "ok" | "paused"; deposits: "ok" | "paused" }>("/api/status")
      .then((s) => renderBanners(bannerSlot, s, false)).catch(() => undefined);
  }

  try {
    offer = await apiJson<OfferResponse>(`/api/offers/${token}`);
    clock.sync(offer.server_now);
    summary.textContent = `A table is yours to claim · ${offer.table_id} · ${offer.time}`;
    drawDetails();
    drawPlan();
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 410) {
      stateEl.textContent = e.code === "offer_claimed" ? DEAD_LINK : "This offer has ended.";
    } else {
      stateEl.textContent = "We couldn't load this offer. Refresh to try again.";
    }
    return;
  }

  openEvents(`/api/floor/events?date=${offer.date}`, (data) => {
    const type = String(data.type ?? "");
    const tables = (data.table_ids ?? []) as string[];
    if (type === "offer.claimed" && offer && tables.includes(offer.table_id.split("+")[0])) {
      stateEl.textContent = DEAD_LINK;
      const btn = document.getElementById("claim-btn") as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
    }
    if (type === "offer.lapsed" && offer && tables.includes(offer.table_id.split("+")[0])) {
      stateEl.textContent = "This offer has ended.";
      const btn = document.getElementById("claim-btn") as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
    }
  });

  watchStatus((s) => renderBanners(bannerSlot, s, false));
}

void main();
