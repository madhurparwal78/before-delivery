import {
  apiJson, ApiFailure, escapeHtml, euro, idemKey, lisbonDayStamp, lisbonToday, openEvents,
  renderBanners, trapFocus, watchStatus, type FloorResponse,
} from "./shared.js";

interface HostTable {
  table_id: string;
  room_id: string;
  status: "free" | "held" | "booked" | "seated" | "offered";
  joined_with: string | null;
  hold: { party_size: number; expires_at: string } | null;
  offer: { expires_at: string } | null;
  booking: Booking | null;
}

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

interface HostFloorResponse {
  date: string;
  time: string;
  server_now: string;
  totals: {
    covers_free: number;
    rooms: { room_id: string; name: string; seats: number; covers_free: number }[];
  };
  tables: HostTable[];
}

const SLOT_TIMES = Array.from({ length: 17 }, (_, i) => {
  const total = 18 * 60 + i * 15;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
});

function depositLine(b: Booking): string {
  const amount = euro(b.deposit.amount_cents);
  if (b.deposit.state === "none") return "No deposit";
  if (b.deposit.state === "paid") return `Deposit €${amount} paid`;
  if (b.deposit.state === "refunded") return `Refunded: €${amount}`;
  return `Deposit kept: €${amount}`;
}

function statusWord(b: Booking): string {
  switch (b.status) {
    case "booked": return "Booked";
    case "seated": return "Seated";
    case "completed": return "Completed";
    case "no_show": return "No-show";
    case "cancelled_refunded": return "Cancelled, refunded";
    case "cancelled_retained": return "Cancelled, deposit kept";
    default: return b.status;
  }
}

async function main(): Promise<void> {
  const summary = document.getElementById("summary-line") as HTMLElement;
  const showing = document.getElementById("showing") as HTMLSelectElement;
  const totals = document.getElementById("totals") as HTMLElement;
  const plan = document.getElementById("plan") as HTMLElement;
  const bookingsList = document.getElementById("bookings-list") as HTMLElement;
  const statusRegion = document.getElementById("status-region") as HTMLElement;
  const floorUpdates = document.getElementById("floor-updates") as HTMLElement;
  const bannerSlot = document.getElementById("banner-slot") as HTMLElement;
  const dialogSlot = document.getElementById("dialog-slot") as HTMLElement;
  const signOutBtn = document.getElementById("signout-btn") as HTMLButtonElement;

  const floor = await apiJson<FloorResponse>("/api/floor");
  const params = new URLSearchParams(location.search);
  const timeParam = params.get("time");
  let showingTime: string = timeParam !== null && SLOT_TIMES.includes(timeParam) ? timeParam : "";
  let pendingToken = 0;

  showing.innerHTML = SLOT_TIMES.map((t) => `<option value="${t}">${t}</option>`).join("");

  const syncUrl = (): void => {
    const q = new URLSearchParams(location.search);
    if (showingTime) q.set("time", showingTime);
    else q.delete("time");
    if (openTableId) q.set("table", openTableId);
    else q.delete("table");
    history.replaceState(null, "", `${location.pathname}?${q.toString()}`);
  };

  const drawTotals = (t: HostFloorResponse): void => {
    const lines = [`<p style="font-size:28px; font-weight:600; margin:0 0 12px;">${t.totals.covers_free} covers free at ${t.time}</p>`];
    for (const room of t.totals.rooms) {
      lines.push(`<p class="room-line">${escapeHtml(room.name)}: ${room.covers_free} of ${room.seats} seats free</p>`);
    }
    const html = lines.join("");
    if (totals.innerHTML !== html) totals.innerHTML = html;
  };

  const labelOf = (t: HostTable): string => {
    if (t.status === "seated") return "Seated";
    if (t.status === "booked") return `Booked ${t.booking?.time ?? ""}`;
    if (t.status === "held") return "Held";
    if (t.status === "offered") return "Offered";
    return "Free";
  };

  const drawPlan = (t: HostFloorResponse): void => {
    const byId = new Map(t.tables.map((x) => [x.table_id, x]));
    const html = floor.rooms.map((room) => `
      <div class="plan-room">
        <h3>${escapeHtml(room.name)}</h3>
        <div class="plan-canvas">
          ${room.tables.map((tb) => {
            const state = byId.get(tb.table_id);
            const status = state?.status ?? "free";
            const label = state ? labelOf(state) : "Free";
            const shape = tb.max_seats <= 2 ? "round" : "";
            const cls = status === "seated" ? "status-held" : status === "held" ? "status-taken" : status === "booked" ? "status-fits booked" : status === "offered" ? "offered" : "status-fits";
            return `<div class="table-cell" data-round="${tb.max_seats <= 2}" data-table="${tb.table_id}">
              <button type="button" class="table-btn ${shape} ${cls}" data-table="${tb.table_id}" data-status="${status}"
                aria-label="Table ${tb.table_id}, ${escapeHtml(room.name)}, ${label}">
                <span class="tid">${tb.table_id}</span>
                <span class="seats">${tb.min_seats} to ${tb.max_seats} seats</span>
                <span class="state">${label}</span>
              </button>
            </div>`;
          }).join("")}
        </div>
      </div>`).join("");
    if (plan.innerHTML !== html) plan.innerHTML = html;

    for (const btn of Array.from(plan.querySelectorAll<HTMLButtonElement>("button.table-btn"))) {
      btn.addEventListener("click", () => openTableDialog(btn.dataset.table ?? ""));
      btn.addEventListener("keydown", (e) => {
        const order = floor.rooms.flatMap((r) => r.tables.map((x) => x.table_id));
        const btns = Array.from(plan.querySelectorAll<HTMLButtonElement>("button.table-btn"));
        const idx = order.indexOf(btn.dataset.table ?? "");
        const move = (d: number): void => {
          e.preventDefault();
          const nextId = order[(idx + d + order.length) % order.length];
          btns.find((b) => b.dataset.table === nextId)?.focus();
        };
        if (e.key === "ArrowRight" || e.key === "ArrowDown") move(1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(-1);
        else if (e.key === "Home") { e.preventDefault(); btns[0]?.focus(); }
        else if (e.key === "End") { e.preventDefault(); btns[btns.length - 1]?.focus(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTableDialog(btn.dataset.table ?? ""); }
      });
    }
  };

  const drawBookings = (bs: Booking[]): void => {
    if (bs.length === 0) {
      bookingsList.innerHTML = `<li>No bookings yet tonight.</li>`;
      return;
    }
    bookingsList.innerHTML = bs.map((b) => `
      <li>${b.time} · ${escapeHtml(b.reference)} · ${escapeHtml(b.name)} · Party of ${b.party_size} · Table ${escapeHtml(b.table_id)} · ${statusWord(b)} · ${depositLine(b)}</li>`).join("");
  };

  const loadFloor = async (): Promise<HostFloorResponse | null> => {
    const token = ++pendingToken;
    const q = showingTime ? `?time=${encodeURIComponent(showingTime)}` : "";
    try {
      const t = await apiJson<HostFloorResponse>(`/api/host/floor${q}`);
      if (token !== pendingToken) return null;
      showingTime = t.time;
      if (showing.value !== t.time) showing.value = t.time;
      drawTotals(t);
      drawPlan(t);
      const day = lisbonDayStamp(new Date(`${t.date}T12:00:00Z`));
      summary.textContent = `Tonight · ${day}`;
      syncUrl();
      return t;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) {
        sendToSignIn();
        return null;
      }
      return null;
    }
  };

  const loadBookings = async (): Promise<void> => {
    try {
      const t = await apiJson<{ date: string; bookings: Booking[] }>("/api/host/bookings");
      drawBookings(t.bookings);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) sendToSignIn();
    }
  };

  let sessionEnded = false;

  function sendToSignIn(): void {
    if (sessionEnded) return;
    sessionEnded = true;
    // The request that answered 401 is not sent again, and nothing else takes its place.
    const next = `${location.pathname}${location.search}`;
    location.href = `/host/sign-in?next=${encodeURIComponent(next)}&ended=1`;
  }

  // Showing changes: the plan and totals always describe the last value chosen.
  showing.addEventListener("change", () => {
    showingTime = showing.value;
    syncUrl();
    void loadFloor();
  });

  // Table dialog.
  let openTableId: string | null = params.get("table");

  async function openTableDialog(tableId: string): Promise<void> {
    const t = await loadFloor();
    if (!t) return;
    const table = t.tables.find((x) => x.table_id === tableId);
    if (!table) return;
    openTableId = tableId;
    syncUrl();

    const bookingRef = table.booking?.reference ?? null;
    const canSeat = table.status === "booked";
    const canClear = table.status === "seated" && table.booking?.source === "online" || table.status === "seated";
    const canNoShow = table.status === "booked";
    const canWalkIn = table.status === "free";

    dialogSlot.innerHTML = `
      <div class="overlay" id="table-overlay">
        <div class="dialog" role="dialog" aria-modal="true" aria-label="Table ${tableId}">
          <h2>Table ${tableId}</h2>
          <p class="mini-state" id="table-status">Currently ${labelOf(table)}</p>
          <p class="mini-state" id="dialog-error" role="alert"></p>
          <div class="actions">
            ${canSeat && bookingRef ? `<button class="btn" id="seat-btn">Seat</button>` : ""}
            ${canClear && bookingRef ? `<button class="btn" id="clear-btn">Clear table</button>` : ""}
            ${canNoShow && bookingRef ? `<button class="btn" id="noshow-btn">Mark no-show</button>` : ""}
            ${canWalkIn ? `<button class="btn" id="walkin-btn">Add walk-in</button>` : ""}
            <button class="btn btn-quiet" id="close-btn">Close</button>
          </div>
          <div id="walkin-step" hidden>
            <label class="field" style="margin-top:14px;">
              <span>Walk-in party size</span>
              <select id="walkin-party" aria-label="Walk-in party size">
                ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${n === 2 ? "selected" : ""}>${n}</option>`).join("")}
              </select>
            </label>
            <div class="actions"><button class="btn" id="seat-walkin-btn">Seat walk-in</button></div>
          </div>
        </div>
      </div>`;

    const overlay = document.getElementById("table-overlay") as HTMLElement;
    const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
    let pending = false;
    let restore: (() => void) | null = null;

    const close = (): void => {
      if (pending) return;
      restore?.();
      dialogSlot.innerHTML = "";
      openTableId = null;
      syncUrl();
      const btn = plan.querySelector<HTMLButtonElement>(`button.table-btn[data-table="${tableId}"]`);
      btn?.focus();
    };
    restore = trapFocus(overlay, () => close(), closeBtn);
    closeBtn.addEventListener("click", close);

    const showError = (msg: string): void => {
      const el = document.getElementById("dialog-error");
      if (el) el.textContent = msg;
    };

    const action = async (path: string, body: Record<string, unknown>, errorMap: Record<string, string>): Promise<void> => {
      if (pending) return;
      pending = true;
      try {
        await apiJson(`/api/host${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idemKey() },
          body: JSON.stringify(body),
        });
        restore?.();
        dialogSlot.innerHTML = "";
        openTableId = null;
        await loadFloor();
        await loadBookings();
      } catch (e) {
        pending = false;
        if (e instanceof ApiFailure) {
          if (e.status === 401) { sendToSignIn(); return; }
          const msg = errorMap[e.code ?? ""] ?? "Something went wrong. Please try again.";
          showError(msg);
          if (e.code === "invalid_transition") {
            restore?.();
            dialogSlot.innerHTML = "";
            openTableId = null;
            await loadFloor();
          }
          return;
        }
        showError("Something went wrong. Please try again.");
      }
    };

    document.getElementById("seat-btn")?.addEventListener("click", () => {
      if (bookingRef) void action(`/bookings/${bookingRef}/seat`, {}, {
        invalid_transition: "That table has already changed. The plan is up to date.",
        not_tonight: "That booking isn't for tonight.",
      });
    });
    document.getElementById("clear-btn")?.addEventListener("click", () => {
      if (bookingRef) void action(`/bookings/${bookingRef}/clear`, {}, {
        invalid_transition: "That table has already changed. The plan is up to date.",
      });
    });
    document.getElementById("noshow-btn")?.addEventListener("click", () => {
      if (bookingRef) void action(`/bookings/${bookingRef}/no-show`, {}, {
        invalid_transition: "That table has already changed. The plan is up to date.",
        too_early: eTooEarly(),
      });
    });
    document.getElementById("walkin-btn")?.addEventListener("click", () => {
      const step = document.getElementById("walkin-step") as HTMLElement | null;
      if (step) step.hidden = false;
      (document.getElementById("walkin-party") as HTMLSelectElement | null)?.focus();
    });
    document.getElementById("seat-walkin-btn")?.addEventListener("click", () => {
      const party = Number((document.getElementById("walkin-party") as HTMLSelectElement).value);
      void action("/walk-ins", { table_id: tableId, party_size: party }, {
        table_taken: `Table ${tableId} is no longer free.`,
        table_not_for_party: `Table ${tableId} doesn't seat a party of ${party}.`,
        invalid_transition: "That table has already changed. The plan is up to date.",
      });
    });

    const eTooEarly = (): string => {
      const starts = table.booking ? new Date(table.booking.starts_at) : new Date();
      const from = new Date(starts.getTime() + 15 * 60_000);
      return `You can mark a no-show from ${new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(from)}.`;
    };
  }

  signOutBtn.addEventListener("click", async () => {
    await apiJson("/api/host/session", { method: "DELETE" }).catch(() => undefined);
    location.href = "/host/sign-in";
  });

  // Live floor: announcements for every event, within two seconds.
  const announce = (text: string): void => { floorUpdates.textContent = text; };
  openEvents(`/api/host/events?date=${lisbonToday()}`, (data) => {
    const type = String(data.type ?? "");
    const tables = (data.table_ids ?? []) as string[];
    const t = (data.time as string | undefined) ?? "";
    const n = (data.party_size as number | null) ?? null;
    const ref = (data.reference as string | undefined) ?? "";
    switch (type) {
      case "hold.created": announce(`Table ${tables[0]} held for ${t}.`); break;
      case "hold.expired": announce(`Hold on table ${tables[0]} ended.`); break;
      case "hold.released": announce(`Hold on table ${tables[0]} released.`); break;
      case "booking.created": announce(`Table ${tables[0]} booked for ${t}, party of ${n}.`); break;
      case "booking.cancelled": announce(`Booking ${ref} at table ${tables[0]} cancelled.`); break;
      case "booking.seated": announce(`Table ${tables[0]} seated.`); break;
      case "booking.completed": announce(`Table ${tables[0]} cleared.`); break;
      case "booking.no_show": announce(`Table ${tables[0]} marked no-show.`); break;
      case "walkin.seated": announce(`Walk-in seated at table ${tables[0]}, party of ${n}.`); break;
      case "offer.created": announce(`Table ${tables[0]} offered to the waitlist for ${t}.`); break;
      case "offer.claimed": announce(`Waitlist offer for table ${tables[0]} claimed.`); break;
      case "offer.lapsed": announce(`Waitlist offer for table ${tables[0]} lapsed.`); break;
      default: break;
    }
    void loadFloor();
    void loadBookings();
  });

  watchStatus((s) => renderBanners(bannerSlot, s, true));

  // A periodic host read detects an ended session (the first 401 sends the host
  // to sign-in) and keeps the plan current while the live stream is paused.
  setInterval(() => {
    void loadFloor();
    void loadBookings();
  }, 10_000);

  // Opening a URL with a table opens that table's dialog.
  const initial = await loadFloor();
  await loadBookings();
  if (initial && openTableId) {
    void openTableDialog(openTableId);
  }
  void statusRegion;
}

void main();
