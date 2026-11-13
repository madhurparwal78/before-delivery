import { state, t, fmt, moneyEl } from "../i18n.js";
import { ui } from "../boot.js";
import { api, idempotencyKey } from "../api.js";
import { status, toast, openDialog, closeDialog } from "../ui.js";
import { onEvent, holdSecondsLeft } from "../events.js";
import { onCleanup } from "../router.js";
import type { Page } from "../router.js";

type Quote = {
  id: string; property: string; in: string; out: string; nights_count: number; currency: string;
  tier: string;
  rooms: { room_type: string; plan: string; breakfast: boolean; adults: number; ages: number[]; nights: { date: string; lines: { key: string; minor: number }[]; total_minor: number }[] }[];
  nights: { date: string; total_minor: number; converted_minor: number; state: string }[];
  total_minor: number; converted_total_minor: number; expires_at: string; hold_id: string | null;
};

type Hold = { id: string; quote_id: string; expires_at: string };

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
    main.replaceChildren();
    const quoteId = params.get("seg0") ?? path.split("/")[2];
    const quoteRes = await api<Quote>(`/api/quotes/${quoteId}`);
    if (!quoteRes.ok) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const word = document.createElement("p");
      word.className = "huge";
      word.textContent = t("empty.results.word", { fmt: fmt() });
      empty.appendChild(word);
      main.appendChild(empty);
      return;
    }
    let quote = quoteRes.data;
    const propertyRes = await api<{ code: string; name: string; zone: string }>(`/api/properties/${quote.property}`);
    const property = propertyRes.ok ? propertyRes.data : { code: quote.property, name: "", zone: "UTC" };

    const wrap = document.createElement("div");
    wrap.className = "checkout-page";
    main.appendChild(wrap);

    // Night Strip at the top
    const stripHost = document.createElement("section");
    wrap.appendChild(stripHost);
    const strip = await import("../nightstrip.js");
    strip.renderNightStrip(stripHost, quote, property.zone);

    // rooms summary
    const summary = document.createElement("section");
    const roomsUl = document.createElement("ul");
    for (const room of quote.rooms) {
      const li = document.createElement("li");
      li.textContent = `${room.room_type} · ${room.plan} · ${room.adults} adults`;
      roomsUl.appendChild(li);
    }
    summary.appendChild(roomsUl);
    wrap.appendChild(summary);

    // hold band
    let hold: Hold | null = null;
    const holdBand = document.createElement("div");
    holdBand.className = "holdband";
    holdBand.hidden = true;
    const holdText = document.createElement("span");
    const timerEl = document.createElement("span");
    timerEl.setAttribute("role", "timer");
    timerEl.setAttribute("aria-label", ui("checkout.time_left"));
    holdBand.append(holdText, timerEl);
    wrap.appendChild(holdBand);

    const announcements = document.createElement("div");
    announcements.className = "status-line";
    announcements.setAttribute("role", "status");
    announcements.dataset.status = "hold-announcements";
    wrap.appendChild(announcements);

    // Reserve
    const reserveBtn = document.createElement("button");
    reserveBtn.className = "reserve-btn";
    reserveBtn.dataset.focusKey = "reserve";
    reserveBtn.textContent = ui("property.reserve");
    wrap.appendChild(reserveBtn);

    // guest and card fields
    const form = document.createElement("form");
    form.className = "checkout-form";
    const mkText = (label: string, key: string, type = "text") => {
      const lab = document.createElement("label");
      const input = document.createElement("input");
      input.type = type;
      input.dataset.field = key;
      input.dataset.focusKey = key;
      lab.append(document.createTextNode(label), input);
      form.appendChild(lab);
      return input;
    };
    const given = mkText(ui("checkout.given"), "given_name");
    const surname = mkText(ui("checkout.surname"), "surname");
    const card = mkText(ui("checkout.card"), "card_number");
    const row2 = document.createElement("div");
    row2.className = "row2";
    const expiryLab = document.createElement("label");
    const expiry = document.createElement("input");
    expiry.type = "text";
    expiry.dataset.field = "expiry";
    expiry.dataset.focusKey = "expiry";
    expiryLab.append(document.createTextNode(ui("checkout.expiry")), expiry);
    const codeLab = document.createElement("label");
    const sec = document.createElement("input");
    sec.type = "text";
    sec.dataset.field = "security_code";
    sec.dataset.focusKey = "security_code";
    codeLab.append(document.createTextNode(ui("checkout.code")), sec);
    row2.append(expiryLab, codeLab);
    form.appendChild(row2);
    [given, surname, card, expiry, sec].forEach((el) => { el.disabled = true; });
    wrap.appendChild(form);

    const problemsHost = document.createElement("div");
    wrap.appendChild(problemsHost);

    const payBtn = document.createElement("button");
    payBtn.className = "pay-btn";
    payBtn.dataset.focusKey = "pay";
    payBtn.textContent = ui("checkout.pay");
    payBtn.disabled = true;
    wrap.appendChild(payBtn);

    // sticky reserve column on wider screens
    const reserveCol = document.createElement("aside");
    reserveCol.className = "price-reserve";
    reserveCol.setAttribute("role", "region");
    reserveCol.setAttribute("aria-label", ui("property.price_reserve"));
    const totalEl = document.createElement("div");
    totalEl.className = "total";
    totalEl.append(moneyEl(quote.converted_total_minor, quote.currency as "EUR"));
    reserveCol.append(totalEl);
    main.appendChild(reserveCol);

    let countdownTimer: number | null = null;
    let lastAnnouncedMinute: number | null = null;

    function startCountdown(): void {
      if (countdownTimer) clearInterval(countdownTimer);
      const tick = () => {
        if (!hold) return;
        const left = holdSecondsLeft(hold.expires_at);
        const mm = String(Math.floor(left / 60)).padStart(2, "0");
        const ss = String(left % 60).padStart(2, "0");
        timerEl.textContent = `${mm}:${ss}`;
        for (const mark of [5, 2, 1]) {
          if (left <= mark * 60 && (lastAnnouncedMinute === null || lastAnnouncedMinute > mark)) {
            lastAnnouncedMinute = mark;
            status("hold-announcements", t("hold.minutes", { count_noun: "minute", n: mark, fmt: fmt() }));
          }
        }
      };
      tick();
      countdownTimer = window.setInterval(tick, 1000);
    }

    reserveBtn.addEventListener("click", async () => {
      reserveBtn.setAttribute("aria-busy", "true");
      reserveBtn.disabled = true;
      const res = await api<Hold>("/api/holds", { method: "POST", body: JSON.stringify({ quote_id: quote.id }) });
      reserveBtn.removeAttribute("aria-busy");
      reserveBtn.disabled = false;
      if (!res.ok) {
        if (res.data.error === "sold_out") { justTakenDialog(); return; }
        if (res.data.error === "restricted") {
          const reason = res.data.reason as { code: string };
          status("room-advice", reason.code);
        }
        return;
      }
      hold = res.data;
      holdBand.hidden = false;
      [given, surname, card, expiry, sec].forEach((el) => { el.disabled = false; });
      payBtn.disabled = false;
      reserveBtn.disabled = true;
      startCountdown();
    });

    payBtn.addEventListener("click", async () => {
      if (!hold) return;
      payBtn.disabled = true;
      payBtn.setAttribute("aria-busy", "true");
      const body: Record<string, unknown> = {
        hold_id: hold.id,
        quote_id: quote.id,
        given_name: given.value,
        surname: surname.value,
        card_number: card.value,
        expiry: expiry.value,
        security_code: sec.value
      };
      if (pendingStepUp) body.step_up_code = stepUpInput?.value ?? "";
      const res = await api<Record<string, unknown>>("/api/bookings", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify(body)
      });
      payBtn.removeAttribute("aria-busy");
      if (res.ok) {
        const booking = res.data as { code: string };
        location.href = `/bookings/${booking.code}`;
        return;
      }
      payBtn.disabled = false;
      const data = res.data;
      if (data.error === "card" && data.outcome === "step_up") {
        pendingStepUp = true;
        stepUpDialog();
        return;
      }
      if (data.error === "validation") showProblems(data.fields as Record<string, string>, "validation");
      else if (data.error === "card") showProblems({ card_number: String(data.outcome) }, "card");
      else if (data.error === "hold_expired") holdEndedDialog();
      else if (data.error === "price_changed") priceChangedDialog(Number(data.old_total_minor), Number(data.new_total_minor));
      else if (data.error === "sold_out") justTakenDialog();
      else if (data.error === "restricted") showProblems({ dates: String((data.reason as { code: string }).code) }, "restricted");
    });

    let pendingStepUp = false;
    let stepUpInput: HTMLInputElement | null = null;

    function stepUpDialog(): void {
      const dlg = openDialog((body) => {
        const title = document.createElement("h2");
        title.textContent = ui("checkout.confirm_title");
        const lab = document.createElement("label");
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.focusKey = "stepup-code";
        lab.append(document.createTextNode(ui("checkout.confirm_code")), input);
        const msg = document.createElement("p");
        const submit = document.createElement("button");
        submit.className = "primary";
        submit.textContent = ui("checkout.confirm");
        submit.addEventListener("click", async () => {
          if (!/^\d{3}$/.test(input.value)) {
            msg.textContent = t("field.code", { fmt: fmt() });
            return;
          }
          if (!hold) return;
          submit.setAttribute("aria-busy", "true");
          const res = await api<Record<string, unknown>>("/api/bookings", {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey() },
            body: JSON.stringify({
              hold_id: hold.id, quote_id: quote.id,
              given_name: given.value, surname: surname.value,
              card_number: card.value, expiry: expiry.value, security_code: sec.value,
              step_up_code: input.value
            })
          });
          submit.removeAttribute("aria-busy");
          if (res.ok) {
            const booking = res.data as { code: string };
            location.href = `/bookings/${booking.code}`;
            return;
          }
          if (res.data.error === "card" && res.data.outcome === "wrong_code") {
            msg.textContent = t("card.wrong_code", { fmt: fmt() });
            return;
          }
          closeDialog(dlg);
          payBtn.disabled = false;
        });
        body.append(title, lab, msg, submit);
        stepUpInput = input;
      }, { opener: payBtn, label: ui("checkout.confirm_title") });
    }

    function holdEndedDialog(): void {
      const dlg = openDialog((body) => {
        const title = document.createElement("h2");
        title.textContent = ui("dlg.hold_ended");
        const p = document.createElement("p");
        p.textContent = t("hold.ended", { fmt: fmt() });
        const again = document.createElement("button");
        again.textContent = ui("dlg.search_again");
        again.addEventListener("click", () => { location.href = `/search${location.search}`; });
        body.append(title, p, again);
      }, { opener: payBtn, label: ui("dlg.hold_ended"), pinned: true });
    }

    function priceChangedDialog(oldTotal: number, newTotal: number): void {
      openDialog((body) => {
        const title = document.createElement("h2");
        title.textContent = ui("dlg.price_changed");
        const p = document.createElement("p");
        p.textContent = oldTotal === newTotal
          ? t("price.refreshed", { new: newTotal, currency: quote.currency as "EUR", fmt: fmt() })
          : t("price.changed", { old: oldTotal, new: newTotal, currency: quote.currency as "EUR", fmt: fmt() });
        const accept = document.createElement("button");
        accept.className = "primary";
        accept.textContent = ui("dlg.accept_price");
        accept.addEventListener("click", async () => {
          const res = await api<Quote>("/api/quotes", {
            method: "POST",
            body: JSON.stringify({ property: quote.property, in: quote.in, out: quote.out, currency: quote.currency, hold_id: hold?.id })
          });
          if (res.ok) {
            quote = res.data;
            totalEl.replaceChildren(moneyEl(quote.converted_total_minor, quote.currency as "EUR"));
            closeDialog(document.querySelector("dialog[open]") as HTMLDialogElement);
            payBtn.focus();
          }
        });
        const keep = document.createElement("button");
        keep.textContent = ui("dlg.keep_searching");
        keep.addEventListener("click", async () => {
          if (hold) await api(`/api/holds/${hold.id}`, { method: "DELETE" });
          location.href = `/search${location.search}`;
        });
        body.append(title, p, accept, keep);
      }, { opener: payBtn, label: ui("dlg.price_changed"), pinned: true });
    }

    function justTakenDialog(): void {
      openDialog((body) => {
        const title = document.createElement("h2");
        title.textContent = ui("dlg.just_taken");
        const p = document.createElement("p");
        p.textContent = t("just.taken", { fmt: fmt() });
        const again = document.createElement("button");
        again.textContent = ui("dlg.search_again");
        again.addEventListener("click", () => { location.href = `/search${location.search}`; });
        body.append(title, p, again);
      }, { opener: payBtn, label: ui("dlg.just_taken"), pinned: true });
    }

    function showProblems(fields: Record<string, string>, kind: "validation" | "card" | "restricted"): void {
      problemsHost.replaceChildren();
      const region = document.createElement("div");
      region.className = "problems";
      region.setAttribute("role", "region");
      region.setAttribute("aria-label", ui("problems.title"));
      const h3 = document.createElement("h3");
      const entries = Object.entries(fields);
      h3.textContent = `${t("problems.heading", { count_noun: "problem", n: entries.length, fmt: fmt() })}`;
      const ul = document.createElement("ul");
      for (const [field, code] of entries) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#";
        const label = fieldLabel(field);
        a.textContent = `${label}: ${messageFor(field, code, kind)}`;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const target = form.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
          if (target) target.focus();
          else {
            // a refusal with no field of its own focuses the first night button
            const firstNight = stripHost.querySelector<HTMLButtonElement>("[data-role='nightstrip'] button");
            firstNight?.focus();
          }
        });
        li.appendChild(a);
        ul.appendChild(li);
      }
      region.append(h3, ul);
      problemsHost.appendChild(region);
      region.setAttribute("tabindex", "-1");
      region.focus();
    }

    function fieldLabel(field: string): string {
      const map: Record<string, string> = {
        given_name: ui("checkout.given"),
        surname: ui("checkout.surname"),
        card_number: ui("checkout.card"),
        expiry: ui("checkout.expiry"),
        security_code: ui("checkout.code"),
        dates: ui("search.dates")
      };
      return map[field] ?? field;
    }

    function messageFor(field: string, code: string, kind: "validation" | "card" | "restricted"): string {
      const f = fmt();
      if (kind === "card") {
        const map: Record<string, Parameters<typeof t>[0]> = { declined: "card.declined", expired: "card.expired", unknown: "card.unknown" };
        return t(map[code] ?? "card.unknown", { fmt: f });
      }
      if (kind === "restricted") return code;
      const map: Record<string, Parameters<typeof t>[0]> = {
        required: "field.given",
        "field.card": "field.card",
        "field.expiry": "field.expiry",
        "field.code": "field.code"
      };
      if (field === "given_name" && code === "required") return t("field.given", { fmt: f });
      if (field === "surname" && code === "required") return t("field.surname", { fmt: f });
      if (field === "card_number") return t("field.card", { fmt: f });
      if (field === "expiry") return t("field.expiry", { fmt: f });
      if (field === "security_code") return t("field.code", { fmt: f });
      return code;
    }

    // live events
    const offHold = onEvent((name, data) => {
      if (name === "hold.expired" && data.hold_id === hold?.id) {
        hold = null;
        holdEndedDialog();
      }
      if (name === "quote.changed" && data.quote_id === quote.id) {
        priceChangedDialog(Number(data.old_total_minor), Number(data.new_total_minor));
      }
    });
    onCleanup(() => {
      offHold();
      if (countdownTimer) clearInterval(countdownTimer);
    });
  }
};

export default page;
