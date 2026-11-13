import { state, t, fmt, moneyEl, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api, idempotencyKey } from "../api.js";
import { status, toast, openDialog, closeDialog } from "../ui.js";
import { onEvent } from "../events.js";
import { serverNow } from "../i18n.js";
import { openDatePicker } from "../widgets/search.js";
import { onCleanup } from "../router.js";
import type { Page } from "../router.js";

type LedgerEntry = { id: number; pair: number; kind: string; account: string; debit_minor: number; credit_minor: number; at: string };
type BookingRoom = {
  n: number; room_type: string; plan: string; breakfast: boolean; adults: number; ages: number[];
  state: string; paid_minor: number; refunded_minor: number;
  nights: { date: string; lines: { key: string; minor: number }[]; total_minor: number }[];
};
type Booking = {
  code: string; version: number; state: string;
  property: { code: string; name: string; zone: string };
  in: string; out: string; given_name: string; surname: string; card_last4: string;
  quote_currency: string;
  rooms: BookingRoom[];
  total_minor: number; paid_minor: number; refunded_minor: number;
  cancellation: {
    tiers: { refund_pct: number; deadline_utc: string; deadline_local: string }[];
    status: { kind: string; refund_pct: number; until_utc: string | null };
  };
  no_show_open: boolean;
  ledger: LedgerEntry[];
  balance_minor: number;
};

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
    main.replaceChildren();
    const code = params.get("seg0") ?? path.split("/")[2];
    const load = async (): Promise<Booking | null> => {
      const res = await api<Booking>(`/api/bookings/${code}`);
      return res.ok ? res.data : null;
    };
    let booking = await load();
    if (!booking) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const word = document.createElement("p");
      word.className = "huge";
      word.textContent = t("empty.results.word", { fmt: fmt() });
      empty.appendChild(word);
      main.appendChild(empty);
      return;
    }

    const render = (): void => {
      if (!booking) return;
      main.replaceChildren();
      const h1 = document.createElement("h1");
      h1.textContent = `${ui("booking.heading")} ${booking.code}`;
      main.appendChild(h1);

      const guest = document.createElement("p");
      guest.textContent = `${booking.given_name} ${booking.surname}`;
      const propertyLine = document.createElement("p");
      propertyLine.textContent = `${booking.property.name} (${booking.property.zone})`;
      const dates = document.createElement("p");
      dates.textContent = `${booking.in} → ${booking.out}`;
      main.append(guest, propertyLine, dates);

      // rooms with their states
      const roomsUl = document.createElement("ul");
      for (const room of booking.rooms) {
        const li = document.createElement("li");
        li.textContent = `${room.room_type} · ${room.plan} · ${room.state}`;
        roomsUl.appendChild(li);
      }
      main.appendChild(roomsUl);

      // Night Strip in EUR from the booking's price snapshot
      const stripHost = document.createElement("section");
      main.appendChild(stripHost);
      const active = booking.rooms.filter((r) => r.state !== "cancelled");
      const perNight = new Map<string, { lines: { key: string; minor: number }[] }>();
      for (const room of active) {
        for (const night of room.nights) {
          const entry = perNight.get(night.date) ?? { lines: [] };
          entry.lines.push(...night.lines);
          perNight.set(night.date, entry);
        }
      }
      const stripQuote = {
        currency: "EUR",
        nights: [...perNight.keys()].sort().map((date) => ({
          date,
          converted_minor: (perNight.get(date)?.lines ?? []).find((l) => l.key === "night_total")?.minor ?? 0,
          state: "base"
        })),
        rooms: [{ nights: [...perNight.keys()].sort().map((date) => ({ date, lines: perNight.get(date)?.lines ?? [] })) }]
      };

      // cancellation region
      const cancelSection = document.createElement("section");
      cancelSection.className = "sage-field";
      cancelSection.setAttribute("role", "region");
      cancelSection.setAttribute("aria-label", ui("booking.cancellation"));
      const cancelH2 = document.createElement("h2");
      cancelH2.textContent = ui("booking.cancellation");
      cancelSection.appendChild(cancelH2);
      for (const tier of booking.cancellation.tiers) {
        const dl = document.createElement("p");
        dl.dataset.deadlineUtc = tier.deadline_utc;
        const zone = booking.property.zone;
        const localMoment = fmt().moment(new Date(tier.deadline_utc), zone);
        const browserMoment = fmt().moment(new Date(tier.deadline_utc), Intl.DateTimeFormat().resolvedOptions().timeZone);
        dl.textContent = `${tier.refund_pct === 100 ? ui("filters.free") : `${tier.refund_pct}% refund`} — ${localMoment} ${zone} (${browserMoment} your time)`;
        cancelSection.appendChild(dl);
      }
      const refundStatus = document.createElement("p");
      refundStatus.setAttribute("role", "status");
      refundStatus.dataset.status = "refund-status";
      cancelSection.appendChild(refundStatus);
      main.appendChild(cancelSection);

      const refreshStatus = (): void => {
        if (!booking) return;
        const s = booking.cancellation.status;
        const f = fmt();
        if (s.kind === "free") refundStatus.textContent = t("refund.free", { property_moment: s.until_utc ? f.moment(new Date(s.until_utc), booking.property.zone) : "", fmt: f });
        else if (s.kind === "partial") refundStatus.textContent = t("refund.partial", { p: s.refund_pct, property_moment: s.until_utc ? f.moment(new Date(s.until_utc), booking.property.zone) : "", fmt: f });
        else refundStatus.textContent = t("refund.none", { fmt: f });
      };
      refreshStatus();

      // cancel and change buttons
      const actions = document.createElement("div");
      actions.className = "dialog-actions";
      const activeRooms = booking.rooms.filter((r) => r.state === "confirmed" || r.state === "changed");
      for (const room of activeRooms) {
        const btn = document.createElement("button");
        btn.dataset.focusKey = "cancel-room-" + room.n;
        btn.textContent = `${ui("booking.cancel_room")} ${room.n}`;
        btn.addEventListener("click", () => cancelDialog([room.n]));
        actions.appendChild(btn);
      }
      if (activeRooms.length > 1) {
        const all = document.createElement("button");
        all.dataset.focusKey = "cancel-booking";
        all.textContent = ui("booking.cancel_booking");
        all.addEventListener("click", () => cancelDialog(activeRooms.map((r) => r.n)));
        actions.appendChild(all);
      }
      if (activeRooms.length > 0) {
        const change = document.createElement("button");
        change.dataset.focusKey = "change-dates";
        change.textContent = ui("booking.change_dates");
        change.addEventListener("click", () => changeDialog(change));
        actions.appendChild(change);
      }
      if (booking.no_show_open && state.user?.role === "manager") {
        const noShow = document.createElement("button");
        noShow.textContent = ui("booking.mark_no_show");
        noShow.addEventListener("click", async () => {
          const res = await api(`/api/bookings/${booking!.code}/no-show`, { method: "POST", headers: { "If-Match": `"${booking!.version}"` } });
          if (res.ok) { booking = res.data as Booking; render(); }
        });
        actions.appendChild(noShow);
      }
      main.appendChild(actions);

      // ledger table
      const ledgerH2 = document.createElement("h2");
      ledgerH2.textContent = ui("booking.ledger");
      const table = document.createElement("table");
      table.className = "data statement-table";
      table.setAttribute("aria-label", ui("booking.ledger"));
      table.dataset.balanceMinor = String(booking.balance_minor);
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const key of ["ledger.kind", "ledger.account", "ledger.debit", "ledger.credit", "ledger.time"]) {
        const th = document.createElement("th");
        th.textContent = ui(key);
        if (key.includes("debit") || key.includes("credit")) th.className = "num";
        headRow.appendChild(th);
      }
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const entry of booking.ledger) {
        const tr = document.createElement("tr");
        tr.dataset.kind = entry.kind;
        tr.dataset.account = entry.account;
        tr.dataset.pair = String(entry.pair);
        for (const [key, value] of [["kind", "ledger." + entry.kind], ["account", entry.account === "guest" ? "ledger.guest" : "ledger.property"]] as const) {
          const td = document.createElement("td");
          td.textContent = ui(value);
          tr.appendChild(td);
        }
        const debitTd = document.createElement("td");
        debitTd.className = "num";
        debitTd.dataset.minor = String(entry.debit_minor);
        debitTd.dataset.currency = "EUR";
        debitTd.textContent = entry.debit_minor === 0 ? "" : moneyText(entry.debit_minor, "EUR");
        const creditTd = document.createElement("td");
        creditTd.className = "num";
        creditTd.dataset.minor = String(entry.credit_minor);
        creditTd.dataset.currency = "EUR";
        creditTd.textContent = entry.credit_minor === 0 ? "" : moneyText(entry.credit_minor, "EUR");
        const atTd = document.createElement("td");
        atTd.textContent = entry.at;
        tr.append(debitTd, creditTd, atTd);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      main.append(ledgerH2, table);

      // the booking's total in the quote currency, as an approximate figure
      const approx = document.createElement("p");
      approx.dataset.minor = String(booking.total_minor);
      approx.dataset.currency = booking.quote_currency;
      approx.dataset.approx = "true";
      approx.textContent = `≈ ${moneyText(booking.total_minor, booking.quote_currency as "EUR")}`;
      main.appendChild(approx);

      const invoiceLink = document.createElement("a");
      invoiceLink.href = `/bookings/${booking.code}/invoice`;
      invoiceLink.textContent = ui("booking.invoice");
      main.appendChild(invoiceLink);

      async function cancelDialog(roomNums: number[]): Promise<void> {
        if (!booking) return;
        const preview = await api<{ refund_minor: number; refund_pct: number }>(`/api/bookings/${booking.code}/cancellations/preview?rooms=${roomNums.join(",")}`);
        if (!preview.ok) return;
        openDialog((body) => {
          const title = document.createElement("h2");
          title.textContent = roomNums.length === 1 ? ui("booking.cancel_room_title") : ui("booking.cancel_booking_title");
          const refund = document.createElement("p");
          refund.textContent = t("refund.amount", { amount: preview.data.refund_minor, currency: "EUR", fmt: fmt() });
          const confirm = document.createElement("button");
          confirm.className = "primary";
          confirm.textContent = ui("booking.confirm_cancel");
          confirm.addEventListener("click", async () => {
            confirm.setAttribute("aria-busy", "true");
            const res = await api(`/api/bookings/${booking!.code}/cancellations`, {
              method: "POST",
              headers: { "If-Match": `"${booking!.version}"` },
              body: JSON.stringify({ rooms: roomNums })
            });
            confirm.removeAttribute("aria-busy");
            if (res.ok) {
              const body2 = res.data as { refund_minor: number; booking: Booking };
              booking = body2.booking;
              toast(t("toast.cancelled", { amount: body2.refund_minor, currency: "EUR", fmt: fmt() }));
              closeDialog(body.closest("dialog") as HTMLDialogElement);
              render();
            }
          });
          const keep = document.createElement("button");
          keep.textContent = ui("booking.keep_booking");
          keep.addEventListener("click", () => closeDialog(body.closest("dialog") as HTMLDialogElement));
          body.append(title, refund, confirm, keep);
        }, { label: ui("booking.cancel_room_title") });
      }

      async function changeDialog(opener: HTMLElement): Promise<void> {
        if (!booking) return;
        openDialog((body) => {
          body.dataset.role = "change";
          const title = document.createElement("h2");
          title.textContent = ui("booking.change_title");
          const summary = document.createElement("div");
          const problemsHost = document.createElement("div");
          const fieldsHost = document.createElement("div");
          const actionsHost = document.createElement("div");
          body.append(title, summary, problemsHost, fieldsHost, actionsHost);
          const pickerHost = document.createElement("div");
          body.appendChild(pickerHost);
          const pickBtn = document.createElement("button");
          pickBtn.textContent = ui("search.dates");
          pickerHost.appendChild(pickBtn);
          let newIn: string | null = null;
          let newOut: string | null = null;
          pickBtn.addEventListener("click", () => {
            openDatePicker({
              opener: pickBtn,
              property: booking!.property.code,
              zone: booking!.property.zone,
              cur: "EUR",
              arrival: booking!.in,
              departure: booking!.out,
              onPicked: async (a, b) => {
                if (!a || !b) return;
                newIn = a;
                newOut = b;
                const res = await api<{ new_total_minor: number; paid_minor: number; pay_minor?: number; refund_minor?: number }>(`/api/bookings/${booking!.code}/changes/preview`, {
                  method: "POST",
                  body: JSON.stringify({ in: a, out: b })
                });
                if (!res.ok) {
                  if (res.data.error === "nonrefundable") { showChangeProblem(t("change.nonrefundable", { fmt: fmt() })); return; }
                  if (res.data.error === "invalid_state") { showChangeProblem(t("change.not_now", { fmt: fmt() })); return; }
                  if (res.data.error === "restricted") { showChangeProblem(String((res.data.reason as { code: string }).code)); return; }
                  return;
                }
                const f = fmt();
                summary.replaceChildren();
                const newTotal = document.createElement("p");
                newTotal.textContent = t("change.new_total", { amount: res.data.new_total_minor, currency: "EUR", fmt: f });
                const paid = document.createElement("p");
                paid.textContent = t("change.paid", { amount: res.data.paid_minor, currency: "EUR", fmt: f });
                summary.append(newTotal, paid);
                fieldsHost.replaceChildren();
                actionsHost.replaceChildren();
                const confirmBtn = document.createElement("button");
                confirmBtn.className = "primary";
                if (res.data.pay_minor !== undefined) {
                  const payLine = document.createElement("p");
                  payLine.textContent = t("change.pay", { amount: res.data.pay_minor, currency: "EUR", fmt: f });
                  summary.appendChild(payLine);
                  confirmBtn.textContent = ui("checkout.pay");
                  mkCardFields(fieldsHost);
                } else {
                  const refundLine = document.createElement("p");
                  refundLine.textContent = t("refund.amount", { amount: res.data.refund_minor ?? 0, currency: "EUR", fmt: f });
                  summary.appendChild(refundLine);
                  confirmBtn.textContent = ui("booking.confirm_change");
                }
                confirmBtn.addEventListener("click", async () => {
                  const payload: Record<string, unknown> = { in: newIn, out: newOut };
                  if (res.data.pay_minor !== undefined) {
                    const cardIn = fieldsHost.querySelector<HTMLInputElement>("[data-field='card_number']");
                    const expIn = fieldsHost.querySelector<HTMLInputElement>("[data-field='expiry']");
                    const secIn = fieldsHost.querySelector<HTMLInputElement>("[data-field='security_code']");
                    payload.card_number = cardIn?.value ?? "";
                    payload.expiry = expIn?.value ?? "";
                    payload.security_code = secIn?.value ?? "";
                  }
                  confirmBtn.setAttribute("aria-busy", "true");
                  const res2 = await api<Booking>(`/api/bookings/${booking!.code}/changes`, {
                    method: "POST",
                    headers: { "If-Match": `"${booking!.version}"`, "Idempotency-Key": idempotencyKey() },
                    body: JSON.stringify(payload)
                  });
                  confirmBtn.removeAttribute("aria-busy");
                  if (res2.ok) {
                    booking = res2.data;
                    toast(t("toast.changed", { fmt: fmt() }));
                    closeDialog(body.closest("dialog") as HTMLDialogElement);
                    render();
                  } else if (res2.data.error === "card") {
                    showChangeProblem(String(res2.data.outcome));
                  }
                });
                actionsHost.appendChild(confirmBtn);
              }
            });
          });
          function showChangeProblem(message: string): void {
            problemsHost.replaceChildren();
            const region = document.createElement("div");
            region.className = "problems";
            region.setAttribute("role", "region");
            region.setAttribute("aria-label", ui("problems.title"));
            const h3 = document.createElement("h3");
            h3.textContent = t("problems.heading", { count_noun: "problem", n: 1, fmt: fmt() });
            const a = document.createElement("a");
            a.href = "#";
            a.textContent = `${ui("search.dates")}: ${message}`;
            a.addEventListener("click", (e) => {
              e.preventDefault();
              const day = body.querySelector<HTMLElement>("[data-role='picker'] .day button");
              day?.focus();
            });
            region.append(h3, a);
            problemsHost.appendChild(region);
          }
          function mkCardFields(host: HTMLElement): void {
            const mk = (label: string, key: string) => {
              const lab = document.createElement("label");
              const input = document.createElement("input");
              input.type = "text";
              input.dataset.field = key;
              lab.append(document.createTextNode(label), input);
              host.appendChild(lab);
            };
            mk(ui("checkout.card"), "card_number");
            mk(ui("checkout.expiry"), "expiry");
            mk(ui("checkout.code"), "security_code");
          }
        }, { opener, label: ui("booking.change_title") });
      }
    };
    render();

    // re-read the refund status on every clock event
    const off = onEvent(async (name) => {
      if (name !== "clock") return;
      const fresh = await load();
      if (fresh) {
        booking = fresh;
        render();
      }
    }, "clock");
    onCleanup(() => { off(); });
  }
};

export default page;
