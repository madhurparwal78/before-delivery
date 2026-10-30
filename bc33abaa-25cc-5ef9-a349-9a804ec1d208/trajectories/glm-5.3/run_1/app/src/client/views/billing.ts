import { el, label, busy, openDialog } from "../dom";
import { api, errorText, money, localTime, localDate, type Me, type Subscription } from "../api";

export async function billingView(me: Me, shell: { page: HTMLElement; me: Me }): Promise<void> {
  const status = el("div", { className: "status", role: "status" });
  label(status, "Billing status");
  shell.page.append(el("h1", { text: "Billing" }), status);

  const data = (await api("/api/billing")) as { subscription: Subscription; card: { last4: string } | null };
  const sub = data.subscription;

  const planRegion = el("div", { className: "panel" });
  planRegion.setAttribute("role", "region");
  planRegion.setAttribute("aria-label", "Plan");
  planRegion.append(el("h3", { text: "Current plan" }), el("p", { className: "num", text: planLine(sub, shell.me.workspace.timeZone) }));
  if (sub.pendingChange) {
    planRegion.append(el("p", { className: "num", text: `Pending: ${sub.pendingChange.plan} ${sub.pendingChange.period} from ${sub.pendingChange.effectiveAt}` }));
  }
  shell.page.append(planRegion);

  const form = el("form", { "aria-label": "Change plan" });
  const planGroup = el("div", { role: "radiogroup", "aria-label": "Plan" });
  const teamRadio = el("input", { type: "radio", name: "plan", id: "bp-team", value: "team" }) as HTMLInputElement;
  const businessRadio = el("input", { type: "radio", name: "plan", id: "bp-business", value: "business" }) as HTMLInputElement;
  teamRadio.checked = true;
  planGroup.append(
    el("div", { className: "field" }, el("label", { for: teamRadio.id, text: "Team" }), teamRadio),
    el("div", { className: "field" }, el("label", { for: businessRadio.id, text: "Business" }), businessRadio),
  );
  const periodGroup = el("div", { role: "radiogroup", "aria-label": "Billing period" });
  const monthlyRadio = el("input", { type: "radio", name: "period", id: "bp-monthly", value: "monthly" }) as HTMLInputElement;
  const annualRadio = el("input", { type: "radio", name: "period", id: "bp-annual", value: "annual" }) as HTMLInputElement;
  monthlyRadio.checked = true;
  periodGroup.append(
    el("div", { className: "field" }, el("label", { for: monthlyRadio.id, text: "Monthly" }), monthlyRadio),
    el("div", { className: "field" }, el("label", { for: annualRadio.id, text: "Annual" }), annualRadio),
  );
  const extraSeats = el("input", { type: "number", id: "bp-seats", min: "0", max: "500", value: "0", className: "num" }) as HTMLInputElement;
  extraSeats.setAttribute("role", "spinbutton");
  label(extraSeats, "Extra seats");
  const cardNumber = el("input", { type: "text", id: "bp-card", placeholder: "4242424242424242", autocomplete: "off" }) as HTMLInputElement;
  label(cardNumber, "Card number");
  const cardExpiry = el("input", { type: "text", id: "bp-exp", placeholder: "MM/YY" }) as HTMLInputElement;
  label(cardExpiry, "Expiry (MM/YY)");
  const cardCvc = el("input", { type: "text", id: "bp-cvc", placeholder: "123", autocomplete: "off" }) as HTMLInputElement;
  label(cardCvc, "CVC");
  const checkoutBtn = el("button", { className: "btn primary", type: "submit", text: "Start paid plan" });
  const previewBtn = el("button", { className: "btn", type: "button", text: "Preview change" });
  const changeBtn = el("button", { className: "btn primary", type: "button", text: "Change plan" });
  const seatsBtn = el("button", { className: "btn", type: "button", text: "Update seats" });
  const cancelBtn = el("button", { className: "btn danger", type: "button", text: "Cancel subscription" });

  const previewRegion = el("div", { className: "panel", style: { marginTop: "12px" } });
  previewRegion.setAttribute("role", "region");
  previewRegion.setAttribute("aria-label", "Proration preview");
  previewRegion.append(el("h3", { text: "Proration preview" }), el("p", { text: "" }));

  const cardFields = el("div", {},
    el("div", { className: "field" }, el("label", { for: cardNumber.id, text: "Card number" }), cardNumber),
    el("div", { className: "field" }, el("label", { for: cardExpiry.id, text: "Expiry (MM/YY)" }), cardExpiry),
    el("div", { className: "field" }, el("label", { for: cardCvc.id, text: "CVC" }), cardCvc),
  );
  form.append(planGroup, periodGroup,
    el("div", { className: "field" }, el("label", { for: extraSeats.id, text: "Extra seats" }), extraSeats),
    cardFields,
    checkoutBtn, previewBtn, changeBtn, seatsBtn, cancelBtn);
  shell.page.append(form, previewRegion);
  const inCheckout = sub.state === "trial" || (sub.state === "suspended" && !sub.graceEndsAt);
  cardFields.style.display = inCheckout ? "" : "none";
  checkoutBtn.style.display = inCheckout ? "" : "none";
  previewBtn.style.display = inCheckout ? "none" : "";
  changeBtn.style.display = inCheckout ? "none" : "";
  seatsBtn.style.display = inCheckout ? "none" : "";
  cancelBtn.style.display = inCheckout || sub.state === "active" ? "" : "none";
  if (!inCheckout && sub.state !== "active") {
    previewBtn.style.display = "none";
    changeBtn.style.display = "none";
    seatsBtn.style.display = "none";
    cancelBtn.style.display = "none";
  }

  function cardBody(): { number: string; expMonth: number; expYear: number; cvc: string } | null {
    const number = cardNumber.value.replace(/\s/g, "");
    const expMatch = /^(\d{2})\/(\d{2})$/.exec(cardExpiry.value.trim());
    if (!expMatch) return null;
    return {
      number,
      expMonth: Number(expMatch[1]),
      expYear: 2000 + Number(expMatch[2]),
      cvc: cardCvc.value.trim(),
    };
  }

  function currentChoice(): { plan: string; period: string; extraSeats: number } {
    return {
      plan: businessRadio.checked ? "business" : "team",
      period: annualRadio.checked ? "annual" : "monthly",
      extraSeats: Number(extraSeats.value || 0),
    };
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = busy(checkoutBtn);
    b.start();
    setStatus(status, "Processing payment…");
    try {
      const choice = currentChoice();
      const card = cardBody();
      if (!card) throw { status: 422, body: { errors: { "card.expiry": "Use MM/YY." } } };
      await api("/api/billing/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey() },
        body: { ...choice, card },
      });
      window.location.reload();
    } catch (err) {
      renderBillingError(status, err);
    } finally {
      b.end();
    }
  });

  previewBtn.addEventListener("click", async () => {
    const choice = currentChoice();
    const previewText = previewRegion.querySelector("p")!;
    previewText.textContent = "Calculating…";
    try {
      const preview = (await api(`/api/billing/plan/preview?plan=${choice.plan}&period=${choice.period}`)) as { change: string; amountCents: number; effectiveAt: string };
      previewText.textContent = preview.change === "immediate"
        ? `Due today: ${money(preview.amountCents)}`
        : `No charge today. Your plan changes on ${localDate(new Date(preview.effectiveAt), shell.me.workspace.timeZone)}.`;
    } catch (err) {
      previewText.textContent = errorText(err);
    }
  });

  changeBtn.addEventListener("click", async () => {
    const b = busy(changeBtn);
    b.start();
    try {
      const choice = currentChoice();
      const result = (await api("/api/billing/plan", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey() },
        body: { plan: choice.plan, period: choice.period },
      })) as { change: string; amountCents?: number; effectiveAt?: string; subscription: Subscription };
      if (result.change === "immediate") {
        setStatus(status, `Plan changed to ${planName(result.subscription.plan)} ${periodName(result.subscription.period)}. Charged ${money(result.amountCents ?? 0)}.`);
      } else {
        setStatus(status, `Your plan changes to ${planName(result.subscription.plan)} ${periodName(result.subscription.period)} on ${localDate(new Date(result.effectiveAt!), shell.me.workspace.timeZone)}.`);
      }
    } catch (err) {
      renderBillingError(status, err);
    } finally {
      b.end();
    }
  });

  seatsBtn.addEventListener("click", async () => {
    const b = busy(seatsBtn);
    b.start();
    try {
      const choice = currentChoice();
      const result = (await api("/api/billing/seats", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey() },
        body: { extraSeats: choice.extraSeats },
      })) as { change: string; amountCents?: number; effectiveAt?: string; subscription: Subscription };
      if (result.change === "immediate") {
        setStatus(status, `Seats updated to ${result.subscription.seatsPurchased}. Charged ${money(result.amountCents ?? 0)}.`);
      } else {
        setStatus(status, `Seats drop to ${result.subscription.seatsPurchased} on ${localDate(new Date(result.effectiveAt!), shell.me.workspace.timeZone)}.`);
      }
    } catch (err) {
      renderBillingError(status, err);
    } finally {
      b.end();
    }
  });

  cancelBtn.addEventListener("click", () => {
    const content = el("div", {}, el("p", { text: "Cancel the subscription? The workspace becomes read-only and cancellation is final." }));
    content.setAttribute("role", "alertdialog");
    content.setAttribute("aria-label", "Cancel subscription");
    const confirm = el("button", { className: "btn danger", text: "Cancel subscription" });
    const keep = el("button", { className: "btn", text: "Keep subscription" });
    content.append(el("div", { className: "dialog-actions" }, keep, confirm));
    const dialog = openDialog(content, { name: "Cancel subscription", onOpen: () => keep.focus() });
    keep.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", async () => {
      const b = busy(confirm);
      b.start();
      try {
        await api("/api/billing/cancel", { method: "POST", headers: { "Idempotency-Key": idemKey() } });
        setStatus(status, "Subscription cancelled. The workspace is now read-only.");
        dialog.close();
      } catch (err) {
        renderBillingError(status, err);
      } finally {
        b.end();
      }
    });
  });

  // Invoices table
  const invoicesTable = el("table", { className: "data compact-cards" });
  invoicesTable.setAttribute("aria-label", "Invoices");
  invoicesTable.append(el("thead", {}, el("tr", {}, el("th", { text: "Invoice" }), el("th", { text: "Date" }), el("th", { text: "Amount" }), el("th", { text: "Balance" }), el("th", { text: "Status" }), el("th", { text: "" }))));
  const invoicesBody = el("tbody");
  invoicesTable.append(invoicesBody);
  shell.page.append(el("h2", { text: "Invoices" }), invoicesTable);

  async function refreshInvoices(): Promise<void> {
    try {
      const data = (await api("/api/billing/invoices")) as {
        invoices: { id: string; number: string; date: string; amountCents: number; balanceCents: number; status: string; pdfAvailable: boolean }[];
        payments: { id: string; invoiceId: string; amountCents: number; refundedCents: number }[];
      };
      invoicesBody.textContent = "";
      for (const invoice of data.invoices) {
        const row = el("tr", {},
          el("td", { className: "num", text: invoice.number }),
          el("td", { className: "num", text: localTime(new Date(invoice.date), shell.me.workspace.timeZone) }),
          el("td", { className: "num", text: money(invoice.amountCents) }),
          el("td", { className: "num", text: money(invoice.balanceCents) }),
          el("td", { text: invoice.status }),
        );
        const actions = el("td");
        if (invoice.status === "unpaid" && invoice.balanceCents > 0) {
          const pay = el("button", { className: "btn primary", text: `Pay invoice ${invoice.number}` });
          actions.append(pay);
          pay.addEventListener("click", () => {
            const cardN = el("input", { type: "text", placeholder: "4242424242424242" }) as HTMLInputElement;
            label(cardN, "Card number");
            const cardE = el("input", { type: "text", placeholder: "MM/YY" }) as HTMLInputElement;
            label(cardE, "Expiry (MM/YY)");
            const cardC = el("input", { type: "text", placeholder: "123" }) as HTMLInputElement;
            label(cardC, "CVC");
            const payBtn = el("button", { className: "btn primary", type: "submit", text: "Pay invoice" });
            const payForm = el("form", {},
              el("div", { className: "field" }, el("label", { text: "Card number" }), cardN),
              el("div", { className: "field" }, el("label", { text: "Expiry (MM/YY)" }), cardE),
              el("div", { className: "field" }, el("label", { text: "CVC" }), cardC),
              payBtn,
            );
            const dialog = openDialog(payForm, { name: `Pay invoice ${invoice.number}` });
            payForm.addEventListener("submit", async (e) => {
              e.preventDefault();
              const b = busy(payBtn);
              b.start();
              setStatus(status, "Processing payment…");
              try {
                const expMatch = /^(\d{2})\/(\d{2})$/.exec(cardE.value.trim());
                if (!expMatch) throw { status: 422, body: { errors: { "card.expiry": "Use MM/YY." } } };
                await api(`/api/billing/invoices/${invoice.id}/pay`, {
                  method: "POST",
                  headers: { "Idempotency-Key": idemKey() },
                  body: { card: { number: cardN.value.replace(/\s/g, ""), expMonth: Number(expMatch[1]), expYear: 2000 + Number(expMatch[2]), cvc: cardC.value.trim() } },
                });
                setStatus(status, `Payment recorded for invoice ${invoice.number}. A receipt is on its way.`);
                dialog.close();
                window.location.reload();
              } catch (err) {
                renderBillingError(status, err);
              } finally {
                b.end();
              }
            });
          });
        }
        if (invoice.pdfAvailable) {
          const dl = el("a", { href: `/api/billing/invoices/${invoice.id}/pdf`, className: "btn", text: `Download invoice ${invoice.number}` });
          actions.append(dl);
        }
        const payment = data.payments.find((p) => p.invoiceId === invoice.id);
        if (payment && invoice.status === "paid") {
          const refund = el("button", { className: "btn", text: `Refund invoice ${invoice.number}` });
          actions.append(refund);
          refund.addEventListener("click", async () => {
            const b = busy(refund);
            b.start();
            try {
              await api(`/api/billing/payments/${payment.id}/refund`, {
                method: "POST",
                headers: { "Idempotency-Key": idemKey() },
                body: {},
              });
              const refunded = (await api("/api/billing/invoices")) as { payments: { id: string; refundedCents: number }[] };
              const fresh = refunded.payments.find((p) => p.id === payment.id);
              setStatus(status, `Refunded ${money(fresh?.refundedCents ?? payment.amountCents)} for invoice ${invoice.number}.`);
              await refreshInvoices();
            } catch (err) {
              renderBillingError(status, err);
            } finally {
              b.end();
            }
          });
        }
        row.append(actions);
        invoicesBody.append(row);
      }
    } catch (err) {
      renderBillingError(status, err);
    }
  }
  await refreshInvoices();
}

export async function settingsView(me: Me, shell: { page: HTMLElement; me: Me }): Promise<void> {
  const ws = (await api("/api/workspace")) as { name: string; timeZone: string; reviewLinksEnabled: boolean };
  shell.page.append(el("h1", { text: "Settings" }));
  const form = el("form", { "aria-label": "Workspace settings" });
  const tz = el("select", { id: "st-tz" }) as HTMLSelectElement;
  for (const zone of (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone")) {
    const opt = el("option", { value: zone, text: zone }) as HTMLOptionElement;
    if (zone === ws.timeZone) opt.selected = true;
    tz.append(opt);
  }
  tz.setAttribute("aria-label", "Workspace time zone");
  const reviewSwitch = el("input", { type: "checkbox", id: "st-review" }) as HTMLInputElement;
  reviewSwitch.checked = ws.reviewLinksEnabled;
  reviewSwitch.setAttribute("role", "switch");
  label(reviewSwitch, "Allow review links");
  const save = el("button", { className: "btn primary", type: "submit", text: "Save settings" });
  form.append(
    el("div", { className: "field" }, el("label", { for: tz.id, text: "Workspace time zone" }), tz),
    el("div", { className: "field" }, el("label", { for: reviewSwitch.id, text: "Allow review links" }), reviewSwitch),
    save,
  );
  shell.page.append(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = busy(save);
    b.start();
    try {
      await api("/api/workspace", { method: "PATCH", body: { timeZone: tz.value, reviewLinksEnabled: reviewSwitch.checked } });
      window.location.reload();
    } finally {
      b.end();
    }
  });
}

function planLine(sub: Subscription, timeZone: string): string {
  if (sub.state === "trial") return `Trial · ends ${sub.trialEndsAt ? localTime(new Date(sub.trialEndsAt), timeZone) : ""}`;
  if (sub.state === "active") return `Active: ${planName(sub.plan)} ${periodName(sub.period)} · ${sub.seatsPurchased} seats`;
  if (sub.state === "past_due") return `Past due: grace period ends ${sub.graceEndsAt ? localTime(new Date(sub.graceEndsAt), timeZone) : ""}`;
  if (sub.state === "suspended") return "Suspended";
  return "Cancelled";
}

export function planName(plan: string): string {
  return plan === "business" ? "Business" : "Team";
}

export function periodName(period: string): string {
  return period === "annual" ? "annual" : "monthly";
}

function setStatus(status: HTMLElement, text: string): void {
  status.textContent = text;
  status.classList.remove("error");
}

function renderBillingError(status: HTMLElement, err: unknown): void {
  const e = err as { status?: number; body?: Record<string, unknown> };
  if (e?.body?.error === "card_declined") {
    status.textContent = "Your card was declined. Nothing was charged.";
  } else if (e?.body?.error === "seats_in_use") {
    status.textContent = `You have ${e.body.seatsUsed} people and invitations, more than the ${e.body.seatsAfter} seats this choice includes.`;
  } else if (e?.body?.error === "invoice_already_paid") {
    status.textContent = "This invoice is already paid.";
  } else if (e?.body?.error === "service_unavailable" && e.body.service === "billing") {
    status.textContent = "Billing is unavailable right now. Nothing was charged. Editing and publishing keep working.";
  } else if (e?.status === 422 && typeof e.body?.errors === "object" && e.body.errors !== null) {
    status.textContent = Object.values(e.body.errors as Record<string, string>)[0]!;
  } else {
    status.textContent = errorText(err);
  }
  status.classList.add("error");
}

let idemCounter = 0;
function idemKey(): string {
  idemCounter += 1;
  return `ui-${Date.now()}-${idemCounter}-${Math.random().toString(36).slice(2, 10)}`;
}
