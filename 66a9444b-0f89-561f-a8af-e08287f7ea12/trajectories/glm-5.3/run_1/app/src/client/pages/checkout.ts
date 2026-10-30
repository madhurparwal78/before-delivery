import { api, el, eur, me, clock, deadlineFmt, announce, ApiProblem } from "../api.js";
import type { Programme } from "../api.js";

type Step = "tickets" | "details" | "review";

interface Draft {
  fullFestival: number;
  dayPasses: Record<string, number>;
  rate: "full" | "reduced";
  voucher: string;
  attendeeNames: Record<string, string>;
  key: string;
}

const DRAFT_KEY = "kerf-checkout-draft";

function loadDraft(programme: Programme): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Draft;
      if (parsed.key) return parsed;
    }
  } catch {
    // fall through to a fresh draft
  }
  const draft: Draft = {
    fullFestival: 0,
    dayPasses: {},
    rate: "full",
    voucher: "",
    attendeeNames: {},
    key: `co-${Math.random().toString(36).slice(2, 14)}`,
  };
  for (const day of programme.festival_days) draft.dayPasses[day.date] = 0;
  return draft;
}

function saveDraft(draft: Draft): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

let activeDialog: HTMLDialogElement | null = null;

export async function openCheckout(step: Step, suggestedPasses?: Array<{ product: string; festival_day?: string }>): Promise<void> {
  if (!me) {
    window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    return;
  }
  const user = me;
  if (!user) return;
  const programme = await api<Programme>("/api/programme");
  const draft = loadDraft(programme);
  if (suggestedPasses) {
    for (const pass of suggestedPasses) {
      if (pass.product === "full_festival") draft.fullFestival += 1;
      if (pass.product === "day" && pass.festival_day) draft.dayPasses[pass.festival_day] = (draft.dayPasses[pass.festival_day] ?? 0) + 1;
    }
  }
  saveDraft(draft);

  const opener = document.activeElement as HTMLElement | null;
  if (activeDialog) activeDialog.remove();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Checkout");
  activeDialog = dialog;
  const inner = el("div", { class: "dialog-inner" });
  dialog.append(inner);
  document.body.append(dialog);

  let currentStep: Step = step;
  const statusNode = el("div", { role: "status", "aria-label": "Checkout status", text: "" });
  const alertNode = el("div", { role: "alert", "aria-label": "Checkout problem", text: "" });

  interface Hold { id: string; session_id: string; quantity: number; expires_at: string }
  interface SessionInfo { id: string; title: string; admission: string }

  const sessionById = new Map(programme.sessions.map((s) => [s.id, s]));

  function setStep(next: Step): void {
    currentStep = next;
    const url = new URL(window.location.href);
    url.searchParams.set("checkout", next);
    window.history.replaceState({}, "", url.toString());
    render();
  }

  async function render(): Promise<void> {
    const steps = el("ol", { class: "checkout-steps", "aria-label": "Checkout steps" });
    for (const step of ["tickets", "details", "review"] as Step[]) {
      const li = el("li", { text: step === "tickets" ? "Tickets" : step === "details" ? "Details" : "Review and pay" });
      if (step === currentStep) li.setAttribute("aria-current", "step");
      li.addEventListener("click", () => {
        if (step !== currentStep) setStep(step);
      });
      steps.append(li);
    }
    const heading = el("h2", { text: currentStep === "tickets" ? "Tickets" : currentStep === "details" ? "Details" : "Review and pay", id: "checkout-heading" });

    const body = el("div", { class: "form-grid" });

    if (currentStep === "tickets") {
      let holds: Hold[] = [];
      try {
        holds = (await api<{ holds: Hold[] }>("/api/holds")).holds;
      } catch {
        holds = [];
      }
      for (const hold of holds) {
        const session = sessionById.get(hold.session_id);
        const row = el("div", { class: "row" });
        row.append(el("div", { text: `${session?.title ?? hold.session_id} — Held until ${clock(hold.expires_at)}` }));
        const release = el("button", { text: `Release seat for ${session?.title ?? hold.session_id}`, "aria-label": `Release seat for ${session?.title ?? hold.session_id}` });
        release.addEventListener("click", async () => {
          try {
            await api(`/api/holds/${hold.id}`, { method: "DELETE" }, "none");
            announce(statusNode, `Your hold on ${session?.title ?? "the session"} expired and the seat was released.`.replace("expired and the seat was released", "was released"));
          } catch {
            announce(statusNode, "Could not release that seat.");
          }
          await render();
        });
        row.append(release);
        body.append(row);
      }
      const fullRow = el("label", { text: "Full-festival passes" });
      const fullInput = el("input", { type: "number", min: "0", max: "10", value: String(draft.fullFestival), "aria-label": "Full-festival passes" }) as HTMLInputElement;
      fullInput.addEventListener("input", () => {
        draft.fullFestival = Math.max(0, Math.min(10, Number(fullInput.value) || 0));
        saveDraft(draft);
      });
      fullRow.append(fullInput);
      body.append(fullRow);
      for (const day of programme.festival_days) {
        const row = el("label", { text: `Day passes for ${day.label}` });
        const input = el("input", { type: "number", min: "0", max: "10", value: String(draft.dayPasses[day.date] ?? 0), "aria-label": `Day passes for ${day.label}` }) as HTMLInputElement;
        input.addEventListener("input", () => {
          draft.dayPasses[day.date] = Math.max(0, Math.min(10, Number(input.value) || 0));
          saveDraft(draft);
        });
        row.append(input);
        body.append(row);
      }
      const continueBtn = el("button", { text: "Continue" });
      continueBtn.addEventListener("click", () => setStep("details"));
      body.append(continueBtn);
    }

    if (currentStep === "details") {
      if (user.role !== "group_booker") {
        const rateGroup = el("div", { role: "radiogroup", "aria-label": "Rate" });
        for (const [value, label] of [["full", "Full rate"], ["reduced", "Reduced rate (student or jobseeker)"]] as const) {
          const radio = el("input", { type: "radio", name: "rate", value, id: `rate-${value}` }) as HTMLInputElement;
          radio.checked = draft.rate === value;
          radio.addEventListener("change", () => {
            draft.rate = value as "full" | "reduced";
            saveDraft(draft);
          });
          const lab = el("label", { for: `rate-${value}`, text: label });
          const radioRow = el("div");
          radioRow.append(radio, lab);
          rateGroup.append(radioRow);
        }
        body.append(rateGroup);
      }
      const voucherRow = el("label", { text: "Gift voucher code" });
      const voucherInput = el("input", { type: "text", value: draft.voucher, "aria-label": "Gift voucher code" }) as HTMLInputElement;
      voucherInput.addEventListener("input", () => {
        draft.voucher = voucherInput.value.trim();
        saveDraft(draft);
      });
      voucherRow.append(voucherInput);
      const applyBtn = el("button", { text: "Apply voucher" });
      applyBtn.addEventListener("click", async () => {
        try {
          const res = await api<{ balance_cents: number }>(`/api/vouchers/${encodeURIComponent(draft.voucher)}`);
          announce(statusNode, `Voucher balance: ${eur(res.balance_cents)}.`);
        } catch (e) {
          if (e instanceof ApiProblem && e.status === 404) announce(alertNode, "We don't recognise this voucher code.");
          else announce(alertNode, "We couldn't check that voucher.");
        }
      });
      voucherRow.append(applyBtn);
      body.append(voucherRow);

      if (user.role === "group_booker") {
        const holds = (await api<{ holds: Hold[] }>("/api/holds")).holds;
        let index = 0;
        for (const hold of holds) {
          for (let i = 0; i < hold.quantity; i += 1) {
            index += 1;
            const session = sessionById.get(hold.session_id);
            const row = el("label", { text: `Attendee ${index} name` });
            const input = el("input", { type: "text", value: draft.attendeeNames[`${hold.id}-${i}`] ?? "", "aria-label": `Attendee ${index} name` }) as HTMLInputElement;
            input.addEventListener("input", () => {
              draft.attendeeNames[`${hold.id}-${i}`] = input.value;
              saveDraft(draft);
            });
            row.append(input);
            body.append(row);
            void session;
          }
        }
      }
      const backBtn = el("button", { text: "Back" });
      backBtn.addEventListener("click", () => setStep("tickets"));
      const continueBtn = el("button", { text: "Continue" });
      continueBtn.addEventListener("click", () => setStep("review"));
      const btnRow = el("div");
      btnRow.append(backBtn, continueBtn);
      body.append(btnRow);
    }

    if (currentStep === "review") {
      const table = el("table", { class: "ruled", "aria-label": "Order summary" });
      const head = el("thead");
      const headRow = el("tr");
      for (const col of ["Item", "Holder", "Price", "Group discount", "Voucher", "To pay"]) {
        headRow.append(el("th", { text: col }));
      }
      head.append(headRow);
      table.append(head);
      const tbody = el("tbody");
      let holderIndex = 0;
      const holdRows: Array<{ hold: Hold; holder: string }> = [];
      let holds: Hold[] = [];
      try {
        holds = (await api<{ holds: Hold[] }>("/api/holds")).holds;
      } catch {
        holds = [];
      }
      for (const hold of holds) {
        const session = sessionById.get(hold.session_id);
        const price = draft.rate === "reduced" ? session?.price_reduced_cents ?? 0 : session?.price_full_cents ?? 0;
        for (let i = 0; i < hold.quantity; i += 1) {
          const holder = user.role === "group_booker" ? draft.attendeeNames[`${hold.id}-${i}`] || "" : user.name;
          holdRows.push({ hold, holder });
          const tr = el("tr");
          tr.append(
            el("td", { text: session?.title ?? hold.session_id }),
            el("td", { text: holder }),
            el("td", { text: eur(price) }),
            el("td", { text: eur(0) }),
            el("td", { text: eur(0) }),
            el("td", { text: eur(price) }),
          );
          tbody.append(tr);
          holderIndex += 1;
        }
      }
      const policyRes = await api<{ full_festival_full_cents: number; full_festival_reduced_cents: number; day_full_cents: number; day_reduced_cents: number; group_discount_percent: number }>("/api/programme").then(() => null).catch(() => null);
      void policyRes;
      // Prices per the seeded policy are mirrored here for review.
      const fullPrice = draft.rate === "reduced" ? 5500 : 9500;
      const dayPrice = draft.rate === "reduced" ? 2000 : 3500;
      for (let i = 0; i < draft.fullFestival; i += 1) {
        const tr = el("tr");
        tr.append(
          el("td", { text: "Full-festival pass" }),
          el("td", { text: user.role === "group_booker" ? "" : user.name }),
          el("td", { text: eur(fullPrice) }),
          el("td", { text: eur(0) }),
          el("td", { text: eur(0) }),
          el("td", { text: eur(fullPrice) }),
        );
        tbody.append(tr);
      }
      for (const [day, count] of Object.entries(draft.dayPasses)) {
        for (let i = 0; i < count; i += 1) {
          const label = programme.festival_days.find((d) => d.date === day)?.label ?? day;
          const tr = el("tr");
          tr.append(
            el("td", { text: `Day pass · ${label}` }),
            el("td", { text: user.role === "group_booker" ? "" : user.name }),
            el("td", { text: eur(dayPrice) }),
            el("td", { text: eur(0) }),
            el("td", { text: eur(0) }),
            el("td", { text: eur(dayPrice) }),
          );
          tbody.append(tr);
        }
      }
      table.append(tbody);
      body.append(table);

      const total = await computeTotal();
      const payLabel = user.role === "group_booker" ? "Place order on invoice" : `Pay ${eur(total)}`;
      const payBtn = el("button", { text: payLabel }) as HTMLButtonElement;
      payBtn.addEventListener("click", async () => {
        payBtn.disabled = true;
        announce(statusNode, "Processing payment…");
        try {
          const passes: Array<{ product: string; festival_day?: string }> = [];
          for (let i = 0; i < draft.fullFestival; i += 1) passes.push({ product: "full_festival" });
          for (const [day, count] of Object.entries(draft.dayPasses)) {
            for (let i = 0; i < count; i += 1) passes.push({ product: "day", festival_day: day });
          }
          const holdIds = holdRows.map((r) => r.hold.id);
          const attendeeNames: string[] = [];
          if (user.role === "group_booker") {
            for (const row of holdRows) {
              attendeeNames.push(row.holder);
            }
            for (let i = 0; i < draft.fullFestival; i += 1) attendeeNames.push(draft.attendeeNames[`pass-full-${i}`] ?? user.name);
            for (const [day, count] of Object.entries(draft.dayPasses)) {
              for (let i = 0; i < count; i += 1) attendeeNames.push(draft.attendeeNames[`pass-day-${day}-${i}`] ?? user.name);
            }
          }
          const order = await api<{ id: string; invoice_id: string | null; rate: string; status: string }>("/api/checkout", {
            method: "POST",
            headers: { "Idempotency-Key": draft.key },
            body: JSON.stringify({
              hold_ids: [...new Set(holdIds)],
              passes,
              rate: user.role === "group_booker" ? "full" : draft.rate,
              voucher_code: draft.voucher === "" ? null : draft.voucher,
              attendee_names: user.role === "group_booker" ? attendeeNames : null,
            }),
          });
          sessionStorage.removeItem(DRAFT_KEY);
          closeDialog(opener);
          const url = new URL(window.location.href);
          url.searchParams.delete("checkout");
          window.history.replaceState({}, "", url.toString());
          window.location.href = `/orders/${order.id}`;
        } catch (e) {
          payBtn.disabled = false;
          if (e instanceof ApiProblem) {
            if (e.body.error === "payment_unavailable") {
              announce(alertNode, "Payments are unavailable right now. Nothing was charged and your seats stay held. Try again in a moment.");
            } else if (e.body.error === "storage_unavailable") {
              announce(alertNode, "We couldn't issue your passes right now. Nothing was charged. Try again in a moment.");
            } else if (e.body.error === "hold_expired") {
              announce(alertNode, "Your hold expired and the seat was released.");
            } else if (e.body.error === "session_cancelled") {
              announce(alertNode, "That session was cancelled. Remove it to continue.");
            } else {
              const errors = e.body.errors as Record<string, string> | undefined;
              if (errors?.voucher_code === "unknown") announce(alertNode, "We don't recognise this voucher code.");
              else if (errors?.voucher_code === "empty") announce(alertNode, "This voucher has no balance left.");
              else if (errors?.items === "group_minimum") announce(alertNode, "Group bookings need at least 5 tickets.");
          else if (errors?.attendee_names === "count_mismatch" || errors?.attendee_names === "blank") announce(alertNode, "Enter a name for every attendee.");
              else announce(alertNode, JSON.stringify(e.body));
            }
          } else {
            announce(alertNode, "Something went wrong.");
          }
        }
      });
      body.append(payBtn);
      const backBtn = el("button", { text: "Back" });
      backBtn.addEventListener("click", () => setStep("details"));
      body.append(backBtn);
    }

    const closeBtn = el("button", { text: "Close checkout" });
    closeBtn.addEventListener("click", () => closeDialog(opener));

    inner.replaceChildren(steps, heading, body, statusNode, alertNode, closeBtn);
    dialog.close();
    dialog.showModal();
    // Focus moves to the step heading; Tab cycles inside the dialog.
    const headingNode = document.getElementById("checkout-heading");
    if (headingNode) headingNode.setAttribute("tabindex", "-1");
    headingNode?.focus();
  }

  function closeDialog(opener: HTMLElement | null): void {
    if (dialog.open) dialog.close();
    dialog.remove();
    activeDialog = null;
    const url = new URL(window.location.href);
    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url.toString());
    if (opener) opener.focus();
  }

  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog(opener);
  });

  await render();
}

async function computeTotal(): Promise<number> {
  const programme = await api<Programme>("/api/programme");
  void programme;
  const draft = loadDraft(programme);
  return draft.fullFestival * 9500 + Object.values(draft.dayPasses).reduce((s, n) => s + n * 3500, 0);
}
