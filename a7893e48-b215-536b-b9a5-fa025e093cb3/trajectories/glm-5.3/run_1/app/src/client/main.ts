import {
  api, HttpError, DayData, Hold, Booking, SiteInfo, SessionUser, StatusInfo,
  money, hours, keyId, todayStr,
} from "./api.js";
import { Dial } from "./dial.js";

let user: SessionUser | null = null;
let sites: SiteInfo[] = [];
let status: StatusInfo | null = null;
let liveHold: Hold | null = null;
let dial: Dial | null = null;
let boardState = { siteId: "", date: todayStr(), stationIndex: 0, renterId: "" };
let renters: { id: string; name: string; business: string; email: string; home_site_id: string }[] = [];
let overrunKey = "";

const el = (sel: string): HTMLElement => document.querySelector(sel) ?? document.body;
function h(tag: string, attrs: Record<string, string | boolean | null> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === true) node.setAttribute(k, "");
    else if (v !== false && v !== null) node.setAttribute(k, String(v));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------- shell ---------------------------------- */

function icon(name: string): string {
  return `<img src="/icons/${name}.svg" alt="" width="18" height="18" aria-hidden="true">`;
}

async function pollStatus(): Promise<void> {
  try {
    status = await api<StatusInfo>("GET", "/api/status");
  } catch { /* leave as-is */ }
  renderBanner();
}

function renderBanner(): void {
  const banner = el('[role="status"][aria-label="Service status"]');
  banner.innerHTML = "";
  if (!status) return;
  const lines: string[] = [];
  if (status.billing === "delayed") lines.push("Card payments are delayed: billing is unreachable. Pack bookings still work.");
  if (status.mail === "delayed") lines.push("Emails are delayed and will send automatically when mail is back.");
  if (lines.length === 0) {
    banner.removeAttribute("role");
    banner.setAttribute("data-empty", "true");
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-label", "Service status");
    return;
  }
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-label", "Service status");
  for (const line of lines) banner.appendChild(h("div", {}, line));
  // delayed suffixes on affected buttons
  document.querySelectorAll<HTMLElement>("[data-delayable]").forEach(btn => {
    const base = btn.getAttribute("data-label") ?? "";
    const delayed = (status!.billing === "delayed");
    btn.textContent = delayed ? `${base} (delayed)` : base;
  });
}

function shell(content: HTMLElement): void {
  document.body.innerHTML = "";
  if (!user) { renderSignin(); return; }
  const top = h("header", { class: "topbar" });
  top.innerHTML = `<div class="brand"><img src="/icons/flame.svg" alt="" width="22" height="22">Hearthshift</div>`;
  const nav = h("nav", { class: "main", "aria-label": "Main" });
  const links: [string, string][] = user.role === "renter"
    ? [["Board", "/board"], ["Tickets", "/tickets"], ["Pack", "/pack"], ["Documents", "/documents"]]
    : user.role === "front_desk"
      ? [["Board", "/board"], ["Counter", "/counter"]]
      : [["Board", "/board"], ["Counter", "/counter"], ["Manage", "/manage"]];
  for (const [label, href] of links) {
    const a = h("a", { href }, label + " ");
    if (location.pathname === href) a.setAttribute("aria-current", "page");
    nav.appendChild(a);
  }
  top.appendChild(nav);
  top.appendChild(h("span", { class: "user" }, user.name));
  const signOut = h("button", { class: "btn", id: "sign-out" }, "Sign out");
  signOut.addEventListener("click", async () => {
    await api("DELETE", "/api/session");
    user = null;
    navigate("/");
  });
  top.appendChild(signOut);
  document.body.appendChild(top);
  const banner = h("div", { role: "status", "aria-label": "Service status", class: "status-banner" });
  document.body.appendChild(banner);
  const main = h("main", {});
  main.appendChild(content);
  document.body.appendChild(main);
  renderBanner();
}

/* ------------------------------ navigation -------------------------------- */

function navigate(path: string): void {
  history.pushState(null, "", path);
  route();
}

window.addEventListener("popstate", route);

async function route(): Promise<void> {
  const path = location.pathname;
  if (path === "/" || path === "/index.html") {
    if (user) { navigate(user.role === "renter" ? "/board" : user.role === "front_desk" ? "/counter" : "/manage"); return; }
    renderSignin();
    return;
  }
  if (!user) {
    try {
      const me = await api<{ user: SessionUser }>("GET", "/api/me");
      user = me.user;
      sites = (await api<{ sites: SiteInfo[] }>("GET", "/api/sites")).sites;
    } catch {
      renderSignin();
      return;
    }
  }
  if (path === "/board") await renderBoard();
  else if (path === "/tickets") await renderTickets();
  else if (path === "/pack") await renderPack();
  else if (path === "/documents") await renderDocuments();
  else if (path === "/counter") await renderCounter();
  else if (path === "/manage") await renderManage();
  else renderNotFound();
}

function renderNotFound(): void {
  document.body.innerHTML = "";
  document.body.appendChild(h("main", {}, "Not found."));
}

/* -------------------------------- sign in --------------------------------- */

function renderSignin(): void {
  document.body.innerHTML = "";
  const main = h("main", { class: "signin-card" });
  const box = h("div", { class: "signin-box card" });
  box.appendChild(h("h1", {}, "Hearthshift"));
  const email = h("input", { type: "email", id: "email", autocomplete: "email" }) as HTMLInputElement;
  const emailLabel = h("label", { for: "email" }, "Email");
  const pw = h("input", { type: "password", id: "password", autocomplete: "current-password" }) as HTMLInputElement;
  const pwLabel = h("label", { for: "password" }, "Password");
  const signIn = h("button", { class: "btn primary", style: "width:100%" }, "Sign in");
  const feedback = h("div", { role: "status", "aria-label": "Sign-in status", class: "feedback" });
  const f1 = h("div", { class: "field" });
  f1.appendChild(emailLabel); f1.appendChild(email);
  const f2 = h("div", { class: "field" });
  f2.appendChild(pwLabel); f2.appendChild(pw);
  box.appendChild(f1); box.appendChild(f2);
  box.appendChild(signIn);
  box.appendChild(feedback);
  main.appendChild(box);
  document.body.appendChild(main);

  const doSignIn = async () => {
    feedback.textContent = "Signing in…";
    try {
      const res = await api<{ user: SessionUser }>("POST", "/api/session", { email: email.value, password: pw.value });
      user = res.user;
      sites = (await api<{ sites: SiteInfo[] }>("GET", "/api/sites")).sites;
      pollStatus();
      navigate(user.role === "renter" ? "/board" : user.role === "front_desk" ? "/counter" : "/manage");
    } catch (e) {
      feedback.textContent = e instanceof HttpError && e.status === 401 ? "Email or password is wrong." : "Email or password is wrong.";
    }
  };
  signIn.addEventListener("click", doSignIn);
  [email, pw].forEach(inp => inp.addEventListener("keydown", (e) => { if (e.key === "Enter") void doSignIn(); }));
}

/* --------------------------------- board ---------------------------------- */

async function renderBoard(): Promise<void> {
  const staff = user!.role !== "renter";
  if (!boardState.siteId) {
    boardState.siteId = sites[0]?.id ?? "";
    if (user!.role === "front_desk") boardState.siteId = user!.site_ids[0] ?? sites[0]?.id ?? "";
  }
  const content = h("div", { class: "board-page" });
  const controls = h("div", { class: "board-controls" });
  const siteSel = h("select", { "aria-label": "Site" }) as HTMLSelectElement;
  for (const s of sites) {
    const o = h("option", { value: s.id }, s.name) as HTMLOptionElement;
    if (s.id === boardState.siteId) o.selected = true;
    siteSel.appendChild(o);
  }
  const prev = h("button", { class: "btn", "aria-label": "Previous day", title: "Previous day" });
  prev.innerHTML = icon("chevron-left");
  const dayBox = h("input", { type: "text", "aria-label": "Day", value: boardState.date }) as HTMLInputElement;
  const next = h("button", { class: "btn", "aria-label": "Next day", title: "Next day" });
  next.innerHTML = icon("chevron-right");
  controls.appendChild(h("label", {}, "Site"));
  controls.appendChild(siteSel);
  controls.appendChild(prev);
  controls.appendChild(dayBox);
  controls.appendChild(next);

  let renterSel: HTMLSelectElement | null = null;
  if (staff) {
    renterSel = h("select", { "aria-label": "Renter" }) as HTMLSelectElement;
    renterSel.appendChild(h("option", { value: "" }, "Pick a renter…"));
    const all = await api<{ renters: typeof renters }>("GET", "/api/renters");
    renters = all.renters;
    for (const r of renters) {
      const o = h("option", { value: r.id }, r.business) as HTMLOptionElement;
      if (r.id === boardState.renterId) o.selected = true;
      renterSel.appendChild(o);
    }
    controls.appendChild(h("label", {}, "Renter"));
    controls.appendChild(renterSel);
  }

  const layout = h("div", { class: "board-layout" });
  const stationCol = h("div", { class: "station-list" });
  const dialArea = h("div");
  layout.appendChild(stationCol);
  layout.appendChild(dialArea);
  content.appendChild(controls);
  content.appendChild(layout);

  const dialStatus = h("div", { role: "status", "aria-label": "Dial status", class: "feedback" });
  content.appendChild(dialStatus);
  const legend = h("ul", { class: "legend", "aria-label": "Dial legend" });
  for (const [name, cls] of [["Free", "free"], ["Held", "held"], ["Booked", "booked"], ["Yours", "yours"]] as const) {
    legend.appendChild(h("li", {}, "")).appendChild(h("span", { class: `swatch ${cls}`, "aria-hidden": "true" }));
    legend.lastChild!.appendChild(h("span", {}, name));
  }
  content.appendChild(legend);

  const checkoutBtn = h("button", { class: "btn primary", style: "display:none" }, "Checkout");
  content.appendChild(checkoutBtn);
  const rail = h("div", { class: "rail", role: "list", "aria-label": "Booking tickets" });
  content.appendChild(rail);

  shell(content);
  siteSel.addEventListener("change", () => { boardState.siteId = siteSel.value; boardState.stationIndex = 0; void loadBoard(); });
  prev.addEventListener("click", () => shiftDay(-1));
  next.addEventListener("click", () => shiftDay(1));
  dayBox.addEventListener("change", () => { boardState.date = dayBox.value; void loadBoard(); });
  renterSel?.addEventListener("change", () => { boardState.renterId = renterSel!.value; void loadBoard(); });
  checkoutBtn.addEventListener("click", () => openCheckout());

  function shiftDay(n: number): void {
    const d = new Date(Date.parse(boardState.date + "T00:00:00Z") + n * 86400000);
    boardState.date = d.toISOString().slice(0, 10);
    dayBox.value = boardState.date;
    void loadBoard();
  }

  const setStatus = (msg: string) => { dialStatus.textContent = msg; };

  dial = new Dial({
    onPlaceHold: (stationId, startTick, endTick) => { void placeHold(stationId, startTick, endTick); },
    onStatus: setStatus,
    onFocusStation: (stationId) => {
      const idx = (dayData?.stations ?? []).findIndex(s => s.id === stationId);
      if (idx >= 0) { boardState.stationIndex = idx; markStationButtons(); }
    },
  });
  dialArea.appendChild(dial.el);
  const summaryEl = h("div", { class: "summary", role: "region", "aria-label": "Selection summary" });
  dialArea.style.position = "relative";
  dialArea.appendChild(summaryEl);
  const callout = h("div", { class: "callout", style: "display:none" });
  dialArea.appendChild(callout);

  let dayData: DayData | null = null;

  function markStationButtons(): void {
    stationCol.querySelectorAll("button").forEach((b, i) => {
      b.setAttribute("aria-pressed", String(i === boardState.stationIndex));
    });
  }

  async function placeHold(stationId: string, startTick: number, endTick: number): Promise<void> {
    if (!dayData) return;
    const staffUser = user!.role !== "renter";
    if (staffUser && !boardState.renterId) {
      setStatus("Pick a renter before claiming time.");
      dial!.clearSelection();
      return;
    }
    const perTick = dayData.hours * 60 / dayData.ticks.length / 4;
    const startMin = startTick * perTick;
    const endMin = endTick * perTick;
    const fmt = (m: number) => {
      const total = Math.round(m) % (dayData!.hours * 60);
      const hh = Math.floor(total / 60);
      return `${String(hh).padStart(2, "0")}:${String(Math.round(total) % 60).padStart(2, "0")}`;
    };
    setStatus("Placing hold…");
    try {
      const res = await api<{ hold: Hold }>("POST", "/api/holds", {
        station_id: stationId,
        date: boardState.date,
        start: fmt(startMin),
        end: fmt(endMin),
        ...(staffUser ? { renter_id: boardState.renterId } : {}),
      });
      liveHold = res.hold;
      dial!.clearSelection();
      setStatus(`Held until ${res.hold.expires_at.slice(11, 16)}. Finish checkout to keep it.`);
      await loadBoard();
      openCheckout();
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.body.error === "slot_taken") {
          const b = e.body.blocker!;
          dial!.retract(() => {
            setStatus(`Another renter just took this time. ${b.label}`);
          });
        } else if (e.body.error === "validation") {
          const first = Object.values(e.body.fields ?? {})[0] ?? "That time can't be held.";
          dial!.retract(() => { setStatus(`That time can't be held: ${first}`); });
        } else {
          setStatus(e.body.message);
        }
      }
    }
  }

  async function loadBoard(): Promise<void> {
    try {
      dayData = await api<DayData>("GET", `/api/sites/${boardState.siteId}/day?date=${boardState.date}`);
    } catch { return; }
    dial!.setData(dayData, boardState.stationIndex);
    // station buttons
    stationCol.innerHTML = "";
    dayData.stations.forEach((st, i) => {
      const btn = h("button", { class: "station-btn" }) as HTMLButtonElement;
      const nameSpan = h("span", {}, st.name);
      const rateSpan = h("span", { class: "num" }, money(st.rate_cents) + "/h");
      btn.appendChild(nameSpan);
      btn.appendChild(rateSpan);
      btn.setAttribute("aria-pressed", String(i === boardState.stationIndex));
      btn.addEventListener("click", () => {
        boardState.stationIndex = i;
        markStationButtons();
        const slider = dial!.el.querySelector(`[data-ring="${i}"]`) as HTMLElement | null;
        slider?.focus();
      });
      stationCol.appendChild(btn);
    });
    updateSummary();
    await loadTickets();
    await refreshLiveHold();
  }

  function updateSummary(): void {
    const sel = dial!.selectionSummary();
    if (!sel || !dayData) {
      summaryEl.innerHTML = `<div class="small">Select time on a ring.</div>`;
      return;
    }
    const packAvail = dayData.pack_minutes_available ?? 0;
    const cardOverflow = sel.cardMinutes > 0;
    summaryEl.innerHTML = `
      <div class="hours">${hours(sel.minutes)} h</div>
      <div class="price">${money(sel.cardCents)}</div>
      <div class="small">Pack ${hours(sel.packMinutes)} h · <span class="${cardOverflow ? "card-overflow" : ""}">Card ${hours(sel.cardMinutes)} h</span></div>
      <div class="small">Pack balance ${hours(packAvail)} h</div>`;
  }

  async function refreshLiveHold(): Promise<void> {
    // find own live hold from the day segments (hold_id present)
    let holdId: string | null = null;
    if (dayData) {
      for (const st of dayData.stations) {
        for (const seg of st.segments) {
          if ((seg.state === "yours_held" || seg.state === "held") && seg.hold_id && (user!.role === "renter" ? seg.state === "yours_held" : true)) {
            holdId = seg.hold_id;
          }
        }
      }
    }
    if (holdId) {
      try { liveHold = (await api<{ hold: Hold }>("GET", `/api/holds/${holdId}`)).hold; } catch { liveHold = null; }
    }
    if (liveHold && liveHold.status === "held") {
      checkoutBtn.style.display = "";
      startCountdown();
    } else {
      liveHold = null;
      checkoutBtn.style.display = "none";
      dial!.clearCountdown();
    }
  }

  let countdownTimer: number | undefined;
  function startCountdown(): void {
    if (countdownTimer) window.clearInterval(countdownTimer);
    const timerEl = ensureTimerRegion();
    const tick = () => {
      if (!liveHold) return;
      const left = Date.parse(liveHold.expires_at) - Date.now();
      if (left <= 0) {
        timerEl.textContent = "Your hold ran out and the time was released.";
        setStatus("Your hold ran out and the time was released.");
        dial!.clearCountdown();
        window.clearInterval(countdownTimer);
        void loadBoard();
        return;
      }
      const mm = Math.floor(left / 60000);
      const ss = Math.floor((left % 60000) / 1000);
      timerEl.textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      const total = Date.parse(liveHold.expires_at) - Date.parse(liveHold.created_at);
      dial!.setCountdown(Math.max(0, left / total));
    };
    tick();
    countdownTimer = window.setInterval(tick, 1000);
  }
  function ensureTimerRegion(): HTMLElement {
    let t = document.querySelector('[role="timer]"]') as HTMLElement | null;
    if (!t) {
      t = h("div", { role: "timer", "aria-label": "Hold time left", class: "hold-countdown" });
      const boardEl = document.querySelector(".board-page") as HTMLElement | null;
      boardEl?.insertBefore(t, document.querySelector(".rail"));
    }
    return t as HTMLElement;
  }

  async function loadTickets(): Promise<void> {
    rail.innerHTML = "";
    let bookings: Booking[] = [];
    try {
      const res = await api<{ bookings: Booking[] }>("GET", `/api/bookings?site_id=${boardState.siteId}&date=${boardState.date}`);
      bookings = res.bookings;
    } catch { return; }
    for (const b of bookings) {
      const t = ticketEl(b);
      t.addEventListener("click", () => openBookingDetails(b.id));
      rail.appendChild(t);
    }
  }

  void loadBoard();
  // live refresh
  const refresh = window.setInterval(() => { void loadBoard(); }, 10000);
  void refresh;
  const statusRefresh = window.setInterval(() => void pollStatus(), 10000);
  void statusRefresh;
}

function paymentLabel(b: Booking): string {
  if (b.status === "cancelled_refunded") return "Refunded";
  if (b.status === "cancelled_forfeit") return "Forfeited";
  if (b.status === "unpaid_cancelled") return "Unpaid";
  if (b.card_minutes === 0) return "Pack";
  if (b.paid) return "Paid";
  if (b.balance_due_by) return `Balance due by ${b.balance_due_by.slice(0, 10)} ${b.balance_due_by.slice(11, 16)}`;
  return "Balance due";
}

function statusStamp(b: Booking): string {
  switch (b.status) {
    case "confirmed": return b.paid || b.card_minutes === 0 ? "Confirmed" : "Confirmed";
    case "checked_in": return "Checked in";
    case "overrun_billed": return "Overrun billed";
    case "checked_out": return "Checked out";
    case "settled": return "Settled";
    case "cancelled_refunded": return "Cancelled — refunded";
    case "cancelled_forfeit": return "Cancelled — forfeited";
    case "unpaid_cancelled": return "Cancelled — unpaid";
    default: return "Held";
  }
}

function ticketEl(b: Booking): HTMLElement {
  const t = h("button", { class: `ticket${b.status.startsWith("cancelled") ? " cancelled" : ""}`, role: "listitem" });
  t.innerHTML = `
    <h3>${b.station_name}</h3>
    <div class="row"><span>Date</span><span class="num">${b.local_start.slice(0, 10)}</span></div>
    <div class="row"><span>Time</span><span class="num">${b.local_start.slice(11)}–${b.local_end.slice(11)}</span></div>
    <div class="row"><span>Hours</span><span class="num">${hours(b.minutes)} h</span></div>
    <div class="row"><span>Amount</span><span class="num">${money(b.card_cents)}</span></div>
    <div class="row"><span>Payment</span><span>${paymentLabel(b)}</span></div>
    <span class="stamp">${statusStamp(b)}</span>`;
  return t;
}

/* ------------------------------- dialogs ---------------------------------- */

function openOverlay(dialog: HTMLElement, opener: HTMLElement | null, onClose: () => void): () => void {
  const overlay = h("div", { class: "overlay" });
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const first = dialog.querySelector<HTMLElement>("input, button, select, textarea, [tabindex]");
  first?.focus();
  const keyHandler = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") { close(); }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", keyHandler);
    opener?.focus();
    onClose();
  };
  document.addEventListener("keydown", keyHandler);
  overlay.addEventListener("pointerdown", (ev) => { if (ev.target === overlay) close(); });
  return close;
}

function openCheckout(): void {
  if (!liveHold) return;
  const site = sites.find(s => s.id === liveHold!.site_id)!;
  const dialog = h("div", { role: "dialog", "aria-label": "Checkout", class: "dialog" }) as HTMLElement;
  const occs = liveHold.occurrences;
  const q = liveHold.quote;
  const noticeHours = 24; // replaced by the hold's site policy below
  void noticeHours;
  dialog.innerHTML = `
    <header><h2>Checkout</h2></header>
    ${occs.map(o => `<p class="num">${o.date} ${o.start}–${o.end} · ${hours(o.minutes)} h</p>`).join("")}
    <dl class="dl">
      <dt>Hours</dt><dd class="num">${hours(occs.reduce((s, o) => s + o.minutes, 0))} h</dd>
      <dt>Pack hours</dt><dd class="num">${hours(q.pack_minutes)} h</dd>
      <dt>Card</dt><dd class="num">${money(q.card_cents)}</dd>
      <dt>Deposit</dt><dd class="num">${money(q.deposit_cents)}</dd>
    </dl>
    <p class="small">Held until <span class="num">${liveHold.expires_at.slice(11, 16)}</span>. Finish checkout to keep it.</p>
    <div class="checkbox-row">
      <input type="checkbox" id="use-pack" ${q.pack_minutes_available !== null && q.pack_minutes_available > 0 ? "checked" : ""}>
      <label for="use-pack">Use pack hours (${hours(q.pack_minutes_available ?? 0)} h available)</label>
    </div>
    <fieldset><legend>Card payment</legend>
      <div class="radio-row"><input type="radio" name="cardpay" id="pay-now" value="now"><label for="pay-now">Pay now</label></div>
      <div class="radio-row"><input type="radio" name="cardpay" id="pay-later" value="later" checked><label for="pay-later">Pay later</label></div>
    </fieldset>
    <p class="terms">${freeTermsNotice()}</p>
    <div class="row-actions">
      <button class="btn primary" id="confirm-booking">Confirm booking</button>
      <button class="btn" id="let-hold-go">Let hold go</button>
    </div>
    <div role="status" aria-label="Checkout status" class="feedback"></div>`;
  const statusEl = dialog.querySelector('[role="status"]') as HTMLElement;
  const payNow = dialog.querySelector<HTMLInputElement>("#pay-now")!;
  const payLater = dialog.querySelector<HTMLInputElement>("#pay-later")!;
  const usePack = dialog.querySelector<HTMLInputElement>("#use-pack")!;
  const confirmBtn = dialog.querySelector<HTMLButtonElement>("#confirm-booking")!;
  const letGo = dialog.querySelector<HTMLButtonElement>("#let-hold-go")!;
  if (status?.billing === "delayed") {
    payNow.parentElement!.querySelector("label")!.textContent = "Pay now (delayed)";
  }
  if (q.card_cents === 0) { payNow.disabled = true; payLater.disabled = true; }

  const key = keyId();
  confirmBtn.addEventListener("click", async () => {
    statusEl.textContent = "Confirming…";
    try {
      await api<{ bookings: Booking[] }>("POST", `/api/holds/${liveHold!.id}/confirm`, {
        use_pack: usePack.checked,
        pay_now: payNow.checked,
      }, key);
      statusEl.textContent = "Booking confirmed. Confirmation email queued.";
      liveHold = null;
      setTimeout(() => { closeOverlay(); void navigate("/board"); void reloadBoardData(); }, 250);
    } catch (e) {
      if (e instanceof HttpError) {
        switch (e.body.error) {
          case "hold_expired":
            statusEl.textContent = "Your hold ran out before payment. Nothing was charged.";
            liveHold = null;
            break;
          case "certificate_required":
            statusEl.textContent = `Upload a liability certificate that covers ${(e.body.dates ?? []).join(", ")} before confirming.`;
            break;
          case "pay_now_required":
            statusEl.textContent = "This booking starts too soon to pay later. Choose Pay now.";
            break;
          case "pack_insufficient":
            statusEl.textContent = "Your pack no longer covers these hours. Untick Use pack hours or buy a pack.";
            break;
          case "billing_unavailable":
            statusEl.textContent = "Card payments are delayed while billing is unreachable. Nothing was charged.";
            break;
          case "invalid_transition":
            statusEl.textContent = "This hold was already confirmed.";
            break;
          default:
            statusEl.textContent = e.body.message;
        }
      }
    }
  });
  letGo.addEventListener("click", async () => {
    statusEl.textContent = "Releasing…";
    try {
      await api("DELETE", `/api/holds/${liveHold!.id}`);
      statusEl.textContent = "Hold released.";
      liveHold = null;
      setTimeout(() => { closeOverlay(); void reloadBoardData(); }, 250);
    } catch { statusEl.textContent = "That hold is no longer live."; }
  });
  const closeOverlay = openOverlay(dialog, null, () => void reloadBoardData());
  void site; void noticeHours; void payLater;
}

function freeTermsNotice(): string {
  return "Free cancellation until the notice hours before start. Later cancellations keep the time charge and the deposit.";
}

async function reloadBoardData(): Promise<void> {
  if (location.pathname === "/board") await route();
}

async function openBookingDetails(id: string): Promise<void> {
  let booking: Booking;
  let invoice: { lines: { description: string; minutes: number | null; amount_cents: number }[]; total_cents: number; terms: string; balance_due_cents: number };
  try {
    booking = (await api<{ booking: Booking }>("GET", `/api/bookings/${id}`)).booking;
    invoice = await api(`GET`, `/api/bookings/${id}/invoice`);
  } catch { return; }
  const dialog = h("div", { role: "dialog", "aria-label": "Booking details", class: "dialog" });
  dialog.innerHTML = `
    <header><h2>Booking details</h2></header>
    <dl class="dl">
      <dt>Station</dt><dd>${booking.station_name}</dd>
      <dt>Local start</dt><dd class="num">${booking.local_start}</dd>
      <dt>Local end</dt><dd class="num">${booking.local_end}</dd>
      <dt>Hours</dt><dd class="num">${hours(booking.minutes)} h</dd>
      <dt>Status</dt><dd>${statusStamp(booking)}</dd>
      <dt>Payment</dt><dd>${paymentLabel(booking)}</dd>
      <dt>Terms</dt><dd>${booking.terms}</dd>
    </dl>
    <h3>Invoice</h3>
    <table><tbody>
      ${invoice.lines.map(l => `<tr><td>${l.description}</td><td class="num">${money(l.amount_cents)}</td></tr>`).join("")}
      <tr><td>Total</td><td class="num">${money(invoice.total_cents)}</td></tr>
    </tbody></table>
    <div class="row-actions">
      ${booking.status === "confirmed" && booking.balance_due_cents > 0 ? `<button class="btn primary" id="pay-balance" data-delayable data-label="Pay balance">Pay balance</button>` : ""}
      ${booking.status === "confirmed" ? `<button class="btn danger" id="cancel-booking">Cancel booking</button>` : ""}
    </div>
    ${user!.role === "manager" && booking.status === "confirmed" ? `
      <div class="field"><label for="override-reason">Override reason</label><input type="text" id="override-reason"></div>
      <button class="btn" id="override-cancel">Cancel with full refund</button>` : ""}
    <div role="status" aria-label="Booking status" class="feedback"></div>`;
  const statusEl = dialog.querySelector('[role="status"]') as HTMLElement;
  const payBtn = dialog.querySelector<HTMLButtonElement>("#pay-balance");
  payBtn?.addEventListener("click", async () => {
    statusEl.textContent = "Paying…";
    try {
      await api("POST", `/api/bookings/${id}/pay`, {}, keyId());
      statusEl.textContent = `Balance paid: ${money(booking.balance_due_cents)}.`;
      setTimeout(() => { overlayRemove(); void reloadBoardData(); }, 300);
    } catch (e) {
      statusEl.textContent = e instanceof HttpError && e.body.error === "billing_unavailable"
        ? "Card payments are delayed while billing is unreachable. Nothing was charged."
        : "Could not pay right now.";
    }
  });
  const cancelBtn = dialog.querySelector<HTMLButtonElement>("#cancel-booking");
  cancelBtn?.addEventListener("click", () => { overlayRemove(); openCancelDialog(booking); });
  const overrideBtn = dialog.querySelector<HTMLButtonElement>("#override-cancel");
  overrideBtn?.addEventListener("click", async () => {
    const reason = (dialog.querySelector("#override-reason") as HTMLInputElement).value;
    statusEl.textContent = "Cancelling…";
    try {
      await api("POST", `/api/bookings/${id}/override`, { action: "cancel_refunded", reason });
      statusEl.textContent = "Cancelled with full refund. Reason recorded.";
      setTimeout(() => { overlayRemove(); void reloadBoardData(); }, 400);
    } catch (e) {
      if (e instanceof HttpError && e.body.error === "validation") {
        statusEl.textContent = e.body.fields?.reason ?? "Give a reason of at least 5 characters.";
      } else if (e instanceof HttpError && e.body.error === "billing_unavailable") {
        statusEl.textContent = "Refunds are delayed while billing is unreachable. Your booking is unchanged.";
      } else {
        statusEl.textContent = "Could not cancel right now.";
      }
    }
  });
  const overlay = h("div", { class: "overlay" });
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const overlayRemove = () => overlay.remove();
  const opener = document.activeElement as HTMLElement;
  openOverlayKeys(dialog, overlay, opener);
}

function openOverlayKeys(dialog: HTMLElement, overlay: HTMLElement, opener: HTMLElement | null): void {
  const first = dialog.querySelector<HTMLElement>("input, button, select, textarea, [tabindex]");
  first?.focus();
  const handler = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", handler);
      opener?.focus();
    }
  };
  document.addEventListener("keydown", handler);
  overlay.addEventListener("pointerdown", (ev) => {
    if (ev.target === overlay) { overlay.remove(); document.removeEventListener("keydown", handler); opener?.focus(); }
  });
}

function openCancelDialog(booking: Booking): void {
  const notice = booking.policy.notice_hours;
  const startAt = Date.parse(booking.start_at);
  const full = startAt - notice * 3600000 >= Date.now();
  const dialog = h("div", { role: "alertdialog", "aria-label": "Cancel booking", class: "dialog" });
  dialog.innerHTML = `
    <header><h2>Cancel booking</h2></header>
    <p>${full ? "You'll get a full refund." : `You're inside the ${notice}-hour notice. Nothing will be refunded.`}</p>
    <p class="terms">${booking.terms}</p>
    <div class="row-actions">
      <button class="btn danger" id="yes-cancel">Yes, cancel</button>
      <button class="btn" id="keep-booking">Keep booking</button>
    </div>
    <div role="status" aria-label="Cancel status" class="feedback"></div>`;
  const overlay = h("div", { class: "overlay" });
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  const statusEl = dialog.querySelector('[role="status"]') as HTMLElement;
  const closer = () => { overlay.remove(); document.removeEventListener("keydown", esc); };
  const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") closer(); };
  document.addEventListener("keydown", esc);
  dialog.querySelector("#yes-cancel")!.addEventListener("click", async () => {
    statusEl.textContent = "Cancelling…";
    try {
      const res = await api<{ refund: { tier: string; card_refund_cents: number; deposit_refund_cents: number; pack_minutes_returned: number } }>(
        "POST", `/api/bookings/${booking.id}/cancel`, {}, keyId(),
      );
      const r = res.refund;
      statusEl.textContent = r.tier === "full"
        ? `Cancelled. Refunded ${money(r.card_refund_cents)} to card, ${hours(r.pack_minutes_returned)} h to your pack and the ${money(r.deposit_refund_cents)} deposit.`
        : `Cancelled under your booking's ${notice}-hour terms. Nothing was refunded.`;
      setTimeout(() => { closer(); void reloadBoardData(); }, 600);
    } catch (e) {
      statusEl.textContent = e instanceof HttpError && e.body.error === "billing_unavailable"
        ? "Refunds are delayed while billing is unreachable. Your booking is unchanged."
        : "Could not cancel right now.";
    }
  });
  dialog.querySelector("#keep-booking")!.addEventListener("click", closer);
  const first = dialog.querySelector<HTMLElement>("button");
  first?.focus();
}

/* -------------------------------- tickets --------------------------------- */

async function renderTickets(): Promise<void> {
  const content = h("div", {});
  content.appendChild(h("h1", {}, "Tickets"));
  const rail = h("div", { class: "rail", role: "list", "aria-label": "Booking tickets", style: "display:block" });
  content.appendChild(rail);
  shell(content);
  const res = await api<{ bookings: Booking[] }>("GET", "/api/bookings");
  rail.innerHTML = "";
  for (const b of res.bookings) {
    const t = ticketEl(b);
    t.addEventListener("click", () => openBookingDetails(b.id));
    rail.appendChild(t);
  }
}

/* ---------------------------------- pack ---------------------------------- */

async function renderPack(): Promise<void> {
  const content = h("div", {});
  content.appendChild(h("h1", {}, "Hour pack"));
  const region = h("section", { role: "region", "aria-label": "Hour pack", class: "card" });
  content.appendChild(region);
  const buyBtn = h("button", { class: "btn primary", "data-delayable": true, "data-label": "Buy 20-hour pack" }, "Buy 20-hour pack · $560.00");
  content.appendChild(buyBtn);
  const statusEl = h("div", { role: "status", "aria-label": "Pack status", class: "feedback" });
  content.appendChild(statusEl);
  const table = h("table", { "aria-label": "Pack ledger", class: "card" });
  table.innerHTML = `<thead><tr><th>When</th><th>Movement</th><th>Account</th><th>Hours</th><th>Booking</th></tr></thead><tbody></tbody>`;
  content.appendChild(table);
  shell(content);
  await loadPack();

  async function loadPack(): Promise<void> {
    const res = await api<{ available_minutes: number; reserved_minutes: number; used_minutes: number; entries: { id: string; account: string; minutes: number; reason: string; booking_id: string | null; created_at: string }[] }>("GET", "/api/me/pack");
    region.innerHTML = `
      <p class="hours num" style="font-size:1.6rem">${hours(res.available_minutes)} h available</p>
      <p>${hours(res.reserved_minutes)} h reserved</p>
      <p>${hours(res.used_minutes)} h used</p>`;
    const tbody = table.querySelector("tbody")!;
    tbody.innerHTML = "";
    for (const e of res.entries) {
      tbody.appendChild(h("tr", {}, "")).innerHTML = `
        <td class="num">${e.created_at.slice(0, 16).replace("T", " ")}</td>
        <td>${e.reason}</td>
        <td>${e.account}</td>
        <td class="num">${e.minutes > 0 ? "+" : ""}${e.minutes}</td>
        <td class="num">${e.booking_id ?? "—"}</td>`;
    }
  }

  buyBtn.addEventListener("click", async () => {
    statusEl.textContent = "Buying pack…";
    try {
      const res = await api<{ available_minutes: number }>("POST", "/api/packs", { product: "20h" }, keyId());
      statusEl.textContent = `20 hours added. ${hours(res.available_minutes)} h available.`;
      await loadPack();
    } catch (e) {
      statusEl.textContent = e instanceof HttpError && e.body.error === "billing_unavailable"
        ? "Card payments are delayed while billing is unreachable. Nothing was charged."
        : "Could not buy a pack right now.";
    }
  });
}

/* -------------------------------- documents ------------------------------- */

async function renderDocuments(): Promise<void> {
  const content = h("div", {});
  content.appendChild(h("h1", {}, "Documents"));
  const form = h("form", { class: "card" });
  const kindSel = h("select", { id: "doc-kind", "aria-label": "Document type" }) as HTMLSelectElement;
  kindSel.innerHTML = `<option value="liability">Liability certificate</option><option value="food_handler">Food handler card</option>`;
  const validFrom = h("input", { type: "text", "aria-label": "Valid from", value: "2026-01-01" }) as HTMLInputElement;
  validFrom.id = "doc-from";
  const expiresOn = h("input", { type: "text", "aria-label": "Expires on", value: "2027-01-01" }) as HTMLInputElement;
  expiresOn.id = "doc-to";
  const file = h("input", { type: "file", id: "doc-file", accept: ".pdf,.png,.jpg,.jpeg", "aria-label": "Document file (PDF, PNG or JPEG)" }) as HTMLInputElement;
  const upload = h("button", { class: "btn primary", type: "submit" }, "Upload document");
  const formRows = [
    ["Document type", kindSel],
    ["Valid from", validFrom],
    ["Expires on", expiresOn],
    ["Document file (PDF, PNG or JPEG)", file],
  ] as [string, HTMLElement][];
  for (const [label, input] of formRows) {
    const row = h("div", { class: "field" });
    const lab = h("label", {}, label);
    lab.setAttribute("for", input.id);
    row.appendChild(lab);
    row.appendChild(input);
    form.appendChild(row);
  }
  form.appendChild(upload);
  const statusEl = h("div", { role: "status", "aria-label": "Documents status", class: "feedback" });
  content.appendChild(form);
  content.appendChild(statusEl);
  const table = h("table", { "aria-label": "My documents", class: "card" });
  table.innerHTML = `<thead><tr><th>Type</th><th>Valid from</th><th>Expires on</th><th>Status</th><th>File</th></tr></thead><tbody></tbody>`;
  content.appendChild(table);
  shell(content);
  await loadDocs();

  async function loadDocs(): Promise<void> {
    const res = await api<{ documents: { id: string; kind: string; valid_from: string; expires_on: string }[] }>("GET", "/api/documents");
    const tbody = table.querySelector("tbody")!;
    tbody.innerHTML = "";
    const today = todayStr();
    for (const d of res.documents) {
      let statusTxt: string;
      if (d.valid_from > today) statusTxt = "Not yet valid";
      else if (d.expires_on < today) statusTxt = "Expired";
      else {
        const days = Math.round((Date.parse(d.expires_on + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
        statusTxt = days <= 14 ? `Expires in ${days} days` : "Current";
      }
      const tr = h("tr");
      tr.innerHTML = `
        <td>${d.kind === "liability" ? "Liability certificate" : "Food handler card"}</td>
        <td class="num">${d.valid_from}</td>
        <td class="num">${d.expires_on}</td>
        <td>${statusTxt}</td>
        <td><a href="/api/documents/${d.id}/file">Open</a></td>`;
      tbody.appendChild(tr);
    }
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    statusEl.textContent = "Uploading…";
    const fd = new FormData();
    fd.append("kind", kindSel.value);
    fd.append("valid_from", validFrom.value);
    fd.append("expires_on", expiresOn.value);
    if (file.files?.[0]) fd.append("file", file.files[0]);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd, credentials: "same-origin" });
      if (res.status === 201) {
        statusEl.textContent = "Document saved.";
        await loadDocs();
      } else {
        const body = (await res.json()) as { error: string; fields?: Record<string, string> };
        if (body.error === "unsupported_file_type") statusEl.textContent = "Files must be PDF, PNG or JPEG.";
        else if (body.error === "file_too_large") statusEl.textContent = "Files must be 5,000,000 bytes or smaller.";
        else statusEl.textContent = Object.values(body.fields ?? {})[0] ?? "Could not save the document.";
      }
    } catch {
      statusEl.textContent = "Could not save the document.";
    }
  });
}

/* --------------------------------- counter -------------------------------- */

async function renderCounter(): Promise<void> {
  const content = h("div", {});
  content.appendChild(h("h1", {}, "Counter"));
  const siteSel = h("select", { "aria-label": "Site" }) as HTMLSelectElement;
  for (const s of sites) siteSel.appendChild(h("option", { value: s.id }, s.name) as HTMLOptionElement);
  const siteId = user!.role === "front_desk" ? user!.site_ids[0] : sites[0]?.id;
  siteSel.value = siteId ?? "";
  content.appendChild(siteSel);
  const statusEl = h("div", { role: "status", "aria-label": "Counter status", class: "feedback" });
  content.appendChild(statusEl);
  const tableWrap = h("div", { class: "card" });
  const table = h("table", { "aria-label": "Today's bookings", class: "counter-table" });
  table.innerHTML = `<thead><tr><th>Renter</th><th>Station</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody>`;
  tableWrap.appendChild(table);
  content.appendChild(tableWrap);
  shell(content);

  async function load(): Promise<void> {
    const res = await api<{ bookings: Booking[] }>("GET", `/api/bookings?site_id=${siteSel.value}&date=${todayStr()}`);
    const tbody = table.querySelector("tbody")!;
    tbody.innerHTML = "";
    for (const b of res.bookings) {
      const tr = h("tr");
      tr.innerHTML = `<td>${b.renter_business}</td><td>${b.station_name}</td><td class="num">${b.local_start.slice(11)}–${b.local_end.slice(11)}</td><td>${statusStamp(b)}</td>`;
      const actions = h("td");
      const wrap = h("div", { class: "row-actions" });
      const addButton = (label: string, fn: () => void, delayed = false) => {
        const btn = h("button", { class: "btn" }, label);
        if (delayed) { btn.setAttribute("data-delayable", "true"); btn.setAttribute("data-label", label); }
        btn.addEventListener("click", fn);
        wrap.appendChild(btn);
        return btn;
      };
      if (b.status === "confirmed") {
        addButton("Check in", () => void act("check-in", b, `Checked in: ${b.renter_business}.`));
      }
      if (b.status === "checked_in") {
        addButton("Charge overrun", () => openOverrun(b));
      }
      if (b.status === "checked_in" || b.status === "overrun_billed") {
        addButton("Check out", () => void act("check-out", b, `Checked out: ${b.renter_business}.`));
      }
      if (b.status === "checked_out") {
        addButton("Add cleaning fee", () => void act("cleaning-fee", b, `Cleaning fee charged: ${money(sites.find(s => s.id === b.site_id)?.cleaning_fee_cents ?? 0)}.`, true, keyId()), true);
        addButton("Settle", () => void act("settle", b, `Settled. Deposit refunded: ${money(b.deposit_cents)}.`, true), true);
      }
      actions.appendChild(wrap);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
  }

  async function act(path: string, b: Booking, success: string, delayed = false, key?: string): Promise<void> {
    statusEl.textContent = "Saving…";
    try {
      await api("POST", `/api/bookings/${b.id}/${path}`, {}, key);
      statusEl.textContent = success;
      await load();
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.body.error === "outside_check_in_window") statusEl.textContent = "Check-in opens 30 minutes before start.";
        else if (e.body.error === "billing_unavailable") statusEl.textContent = delayedBessage(path);
        else statusEl.textContent = e.body.message;
      }
    }
    void delayed;
  }

  function delayedBessage(path: string): string {
    switch (path) {
      case "overrun": return "Overrun can't be charged while billing is unreachable. Nothing was charged.";
      case "cleaning-fee": return "Cleaning fee can't be charged while billing is unreachable. Nothing was charged.";
      case "settle": return "Settlement is delayed while billing is unreachable. The booking is unchanged.";
      default: return "Card payments are delayed while billing is unreachable. Nothing was charged.";
    }
  }

  function openOverrun(b: Booking): void {
    const dialog = h("div", { role: "dialog", "aria-label": "Charge overrun", class: "dialog" });
    const site = sites.find(s => s.id === b.site_id)!;
    const station = site.stations.find(s => s.id === b.station_id)!;
    dialog.innerHTML = `
      <header><h2>Charge overrun</h2></header>
      <div class="field"><label for="overrun-minutes">Overrun minutes</label>
        <input type="number" id="overrun-minutes" min="1" max="240" value="40"></div>
      <p>Amount: <span class="num" id="overrun-amount">${money(Math.round(40 * station.rate_cents / 60))}</span></p>
      <button class="btn primary" id="charge-btn">Charge</button>
      <div role="status" aria-label="Counter status" class="feedback"></div>`;
    const minutes = dialog.querySelector<HTMLInputElement>("#overrun-minutes")!;
    const amountEl = dialog.querySelector<HTMLElement>("#overrun-amount")!;
    minutes.addEventListener("input", () => {
      const m = Math.round(Number(minutes.value) * station.rate_cents / 60);
      amountEl.textContent = money(m);
    });
    overrunKey = keyId(); // reused until the dialog closes
    dialog.querySelector("#charge-btn")!.addEventListener("click", async () => {
      const dialogStatus = dialog.querySelector('[role="status"]') as HTMLElement;
      dialogStatus.textContent = "Charging…";
      try {
        await api("POST", `/api/bookings/${b.id}/overrun`, { minutes: Number(minutes.value) }, overrunKey);
        dialogStatus.textContent = `Overrun of ${minutes.value} min charged: ${amountEl.textContent}.`;
        setTimeout(() => { overlay.remove(); statusEl.textContent = `Overrun of ${minutes.value} min charged: ${amountEl.textContent}.`; void load(); }, 350);
      } catch (e) {
        dialogStatus.textContent = e instanceof HttpError && e.body.error === "billing_unavailable"
          ? "Overrun can't be charged while billing is unreachable. Nothing was charged."
          : "Could not charge right now.";
      }
    });
    const overlay = h("div", { class: "overlay" });
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    openOverlayKeys(dialog, overlay, document.activeElement as HTMLElement);
    minutes.focus();
  }

  siteSel.addEventListener("change", () => void load());
  void load();
}

/* ---------------------------------- manage -------------------------------- */

async function renderManage(): Promise<void> {
  const content = h("div", {});
  content.appendChild(h("h1", {}, "Manage"));
  const grid = h("div", { class: "manage-grid" });
  content.appendChild(grid);

  // site totals
  const totalsCard = h("section", { class: "card", role: "region", "aria-label": "Site totals" });
  totalsCard.appendChild(h("h2", {}, "Site totals"));
  grid.appendChild(totalsCard);

  // renter search
  const searchCard = h("section", { class: "card" });
  searchCard.appendChild(h("h2", {}, "Renter search"));
  const search = h("input", { type: "search", "aria-label": "Search renters", placeholder: "Search renters" }) as HTMLInputElement;
  const results = h("ul", { "aria-label": "Renter results", class: "legend", style: "display:block" });
  searchCard.appendChild(search);
  searchCard.appendChild(results);
  grid.appendChild(searchCard);

  // utilisation
  const utilCard = h("section", { class: "card" });
  utilCard.appendChild(h("h2", {}, "Station utilisation"));
  const utilSite = h("select", { "aria-label": "Report site" }) as HTMLSelectElement;
  for (const s of sites) utilSite.appendChild(h("option", { value: s.id }, s.name) as HTMLOptionElement);
  const utilDay = h("input", { type: "text", "aria-label": "Report day", value: todayStr() }) as HTMLInputElement;
  const utilTable = h("table", { "aria-label": "Station utilisation" });
  utilTable.innerHTML = `<thead><tr><th>Station</th><th>Booked hours</th><th>Day hours</th><th>Utilisation</th></tr></thead><tbody></tbody>`;
  const csv = h("a", { href: "#", "aria-label": "Download CSV" }, "Download CSV");
  utilCard.appendChild(h("div", { class: "form-row" }, ""));
  (utilCard.querySelector(".form-row") as HTMLElement).append(utilSite, utilDay);
  utilCard.appendChild(utilTable);
  utilCard.appendChild(csv);
  grid.appendChild(utilCard);

  // policy
  const policyCard = h("section", { class: "card" });
  policyCard.appendChild(h("h2", {}, "Cancellation policy"));
  const policySite = h("select", { "aria-label": "Policy site" }) as HTMLSelectElement;
  for (const s of sites) policySite.appendChild(h("option", { value: s.id }, s.name) as HTMLOptionElement);
  const notice = h("input", { type: "number", min: "1", max: "168", value: "24", "aria-label": "Notice hours" }) as HTMLInputElement;
  const effective = h("input", { type: "text", value: todayStr(), "aria-label": "Effective from" }) as HTMLInputElement;
  const schedule = h("button", { class: "btn primary" }, "Schedule policy");
  const policyTable = h("table", { "aria-label": "Policy versions" });
  policyTable.innerHTML = `<thead><tr><th>Notice</th><th>Effective from</th><th>Scheduled by</th></tr></thead><tbody></tbody>`;
  const formRow = h("div", { class: "form-row" });
  formRow.append(policySite, notice, effective, schedule);
  policyCard.appendChild(formRow);
  policyCard.appendChild(policyTable);
  grid.appendChild(policyCard);

  // binder
  const binderCard = h("section", { class: "card" });
  binderCard.appendChild(h("h2", {}, "Binder links"));
  const binderSite = h("select", { "aria-label": "Binder site" }) as HTMLSelectElement;
  for (const s of sites) binderSite.appendChild(h("option", { value: s.id }, s.name) as HTMLOptionElement);
  const binderFrom = h("input", { type: "text", value: todayStr(), "aria-label": "Binder from" }) as HTMLInputElement;
  const binderTo = h("input", { type: "text", value: todayStr(), "aria-label": "Binder to" }) as HTMLInputElement;
  const binderCreate = h("button", { class: "btn primary" }, "Create binder link");
  const binderTable = h("table", { "aria-label": "Binder links" });
  binderTable.innerHTML = `<thead><tr><th>Link</th><th>Range</th><th>Expiry</th><th>State</th><th></th></tr></thead><tbody></tbody>`;
  const binderRow = h("div", { class: "form-row" });
  binderRow.append(binderSite, binderFrom, binderTo, binderCreate);
  binderCard.appendChild(binderRow);
  binderCard.appendChild(binderTable);
  grid.appendChild(binderCard);

  const statusEl = h("div", { role: "status", "aria-label": "Manager status", class: "feedback" });
  content.appendChild(statusEl);
  shell(content);

  async function loadTotals(): Promise<void> {
    const res = await api<{ sites: { site_id: string; name: string; local_date: string; bookings_today: number; booked_minutes_today: number; unpaid_balance_cents: number; expiring_documents: number }[]; totals: { bookings_today: number; booked_minutes_today: number; unpaid_balance_cents: number; expiring_documents: number } }>("GET", "/api/dashboard");
    totalsCard.innerHTML = "<h2>Site totals</h2>";
    for (const s of res.sites) {
      const dl = h("dl", { class: "totals" });
      dl.innerHTML = `
        <dt>${s.name} — bookings today</dt><dd class="num">${s.bookings_today}</dd>
        <dt>${s.name} — booked hours today</dt><dd class="num">${hours(s.booked_minutes_today)} h</dd>
        <dt>${s.name} — unpaid balances</dt><dd class="num">${money(s.unpaid_balance_cents)}</dd>
        <dt>${s.name} — documents expiring in 14 days</dt><dd class="num">${s.expiring_documents}</dd>`;
      totalsCard.appendChild(dl);
    }
    const dl = h("dl", { class: "totals" });
    dl.innerHTML = `
      <dt><strong>Total — bookings today</strong></dt><dd class="num">${res.totals.bookings_today}</dd>
      <dt><strong>Total — booked hours today</strong></dt><dd class="num">${hours(res.totals.booked_minutes_today)} h</dd>
      <dt><strong>Total — unpaid balances</strong></dt><dd class="num">${money(res.totals.unpaid_balance_cents)}</dd>
      <dt><strong>Total — documents expiring in 14 days</strong></dt><dd class="num">${res.totals.expiring_documents}</dd>`;
    totalsCard.appendChild(dl);
  }

  async function loadUtil(): Promise<void> {
    const res = await api<{ day_minutes: number; stations: { name: string; booked_minutes: number; utilisation_percent: number }[] }>(
      "GET", `/api/sites/${utilSite.value}/utilisation?date=${utilDay.value}`);
    const tbody = utilTable.querySelector("tbody")!;
    tbody.innerHTML = "";
    for (const st of res.stations) {
      tbody.appendChild(h("tr")).innerHTML = `
        <td>${st.name}</td>
        <td class="num">${hours(st.booked_minutes)} h</td>
        <td class="num">${hours(res.day_minutes)} h</td>
        <td class="num">${st.utilisation_percent.toFixed(1)}%</td>`;
    }
    csv.setAttribute("href", `/api/sites/${utilSite.value}/utilisation.csv?date=${utilDay.value}`);
  }

  async function loadPolicies(): Promise<void> {
    const res = await api<{ versions: { notice_hours: number; effective_from: string; created_by_name: string }[] }>(
      "GET", `/api/sites/${policySite.value}/policies`);
    const tbody = policyTable.querySelector("tbody")!;
    tbody.innerHTML = "";
    for (const v of res.versions) {
      tbody.appendChild(h("tr")).innerHTML = `
        <td class="num">${v.notice_hours} h</td>
        <td class="num">${v.effective_from}</td>
        <td>${v.created_by_name}</td>`;
    }
  }

  async function loadBinders(): Promise<void> {
    const res = await api<{ links: { id: string; url: string; from: string; to: string; expires_at: string; revoked: boolean }[] }>(
      "GET", `/api/sites/${binderSite.value}/binder-links`);
    const tbody = binderTable.querySelector("tbody")!;
    tbody.innerHTML = "";
    for (const l of res.links) {
      const tr = h("tr");
      tr.innerHTML = `
        <td><a href="${l.url}">${l.url}</a></td>
        <td class="num">${l.from} to ${l.to}</td>
        <td class="num">${l.expires_at.slice(0, 10)}</td>
        <td>${l.revoked ? "Revoked" : "Active"}</td>`;
      const td = h("td");
      const regen = h("button", { class: "btn" }, "Regenerate");
      const revoke = h("button", { class: "btn" }, "Revoke");
      regen.addEventListener("click", async () => {
        statusEl.textContent = "Saving…";
        try {
          await api("POST", `/api/binder-links/${l.id}/regenerate`, {});
          statusEl.textContent = "New link ready. The old link no longer works.";
          await loadBinders();
        } catch { statusEl.textContent = "Could not regenerate."; }
      });
      revoke.addEventListener("click", async () => {
        statusEl.textContent = "Saving…";
        try {
          await api("DELETE", `/api/binder-links/${l.id}`);
          statusEl.textContent = "Link revoked.";
          await loadBinders();
        } catch { statusEl.textContent = "Could not revoke."; }
      });
      td.append(regen, revoke);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  let searchTimer: number | undefined;
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      const res = await api<{ renters: { id: string; name: string; business: string; email: string; home_site_id: string }[] }>(
        "GET", `/api/renters?q=${encodeURIComponent(search.value)}`);
      results.innerHTML = "";
      for (const r of res.renters) {
        const li = h("li", {}, `${r.business} — ${r.name} · ${r.email}`);
        results.appendChild(li);
      }
    }, 250);
  });

  schedule.addEventListener("click", async () => {
    statusEl.textContent = "Scheduling…";
    try {
      await api("POST", `/api/sites/${policySite.value}/policies`, {
        notice_hours: Number(notice.value),
        effective_from: effective.value,
      });
      statusEl.textContent = `${notice.value}-hour policy scheduled from ${effective.value}.`;
      await loadPolicies();
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.body.error === "policy_date_taken") statusEl.textContent = "A policy already starts on that date.";
        else statusEl.textContent = Object.values(e.body.fields ?? {})[0] ?? "Could not schedule.";
      }
    }
  });

  binderCreate.addEventListener("click", async () => {
    statusEl.textContent = "Saving…";
    try {
      await api("POST", `/api/sites/${binderSite.value}/binder-links`, { from: binderFrom.value, to: binderTo.value });
      statusEl.textContent = "Binder link ready.";
      await loadBinders();
    } catch (e) {
      statusEl.textContent = e instanceof HttpError
        ? Object.values(e.body.fields ?? {})[0] ?? "Could not create."
        : "Could not create.";
    }
  });

  [utilSite, utilDay].forEach(elx => elx.addEventListener("change", () => void loadUtil()));
  policySite.addEventListener("change", () => void loadPolicies());
  binderSite.addEventListener("change", () => void loadBinders());

  await Promise.all([loadTotals(), loadUtil(), loadPolicies(), loadBinders()]);
}

/* ---------------------------------- boot ---------------------------------- */

async function boot(): Promise<void> {
  window.setInterval(() => void pollStatus(), 10000);
  void pollStatus();
  try {
    const me = await api<{ user: SessionUser }>("GET", "/api/me");
    user = me.user;
    sites = (await api<{ sites: SiteInfo[] }>("GET", "/api/sites")).sites;
  } catch { user = null; }
  route();
}
void boot();
