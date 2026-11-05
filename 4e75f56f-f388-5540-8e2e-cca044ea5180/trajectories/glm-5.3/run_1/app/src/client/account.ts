import { el, clear, openDialog, announce, mountStatus } from "./ui.js";
import { api, ApiFailure, money, mmss, hhmmss, newKey } from "./api.js";
import { state, refreshMe, emit, type Reservation } from "./state.js";
import { openSignInDialog } from "./authDialog.js";

/**
 * The account screen: my seats, groups, waitlist entry and offers, with every
 * action the signed-in person may take.
 */
export function buildAccount(root: HTMLElement): void {
  let searchDebounce = 0;

  async function load(): Promise<void> {
    await refreshMe();
    render();
  }

  function stateLabel(r: Reservation): string {
    if (r.state === "deposit_paid" && !state.me?.deposits_open) return "Balance overdue";
    switch (r.state) {
      case "held":
        return "Held";
      case "deposit_paid":
        return "Deposit paid";
      case "paid_in_full":
        return "Paid in full";
      case "checked_in_day1":
        return "Checked in for day 1";
      case "checked_in_day2":
        return "Checked in for day 2";
      case "certificate_issued":
        return "Certificate issued";
      case "cancelled":
        return "Cancelled";
      case "refunded":
        return "Refunded";
      default:
        return r.state;
    }
  }

  function render(): void {
    clear(root);
    const me = state.me;
    const wrap = el("div", { class: "staff-page" });
    if (!me) {
      const heading = el("h1", { class: "chapter-title" }, "My seats");
      wrap.append(
        heading,
        el("p", { class: "lede" }, "Sign in to see your seats, documents and offers."),
        el("div", { class: "auth-entry" })
      );
      const signIn = el("button", { class: "btn btn-live" }, "Sign in");
      signIn.addEventListener("click", () => openSignInDialog(signIn, load));
      wrap.append(signIn);
      root.append(wrap);
      return;
    }

    wrap.append(el("h1", { class: "chapter-title", id: "my-seats-heading", tabindex: "-1" }, "My seats"));
    const updates = mountStatus(wrap, "Account updates");

    if (me.account.role === "practitioner" || me.account.role === "clinic") {
      if (me.waitlist) {
        wrap.append(el("p", { class: "hint" }, `You are number ${me.waitlist.position} on the ${me.waitlist.tier === "atelier" ? "Atelier" : "Bench"} waitlist.`));
      }
      for (const offer of me.offers) {
        wrap.append(renderOffer(offer));
      }
      const seats = el("div", { class: "desk-cards" });
      const seatsHeading = el("h2", {}, "Reservations");
      wrap.append(seatsHeading);
      const any = me.reservations.length > 0;
      if (!any) {
        wrap.append(el("p", { class: "hint" }, "No seats yet. Reserve a bench from the lab chapter."));
        const go = el("a", { class: "btn btn-live", href: "/" }, "Reserve a bench");
        wrap.append(go);
      }
      for (const r of me.reservations) {
        wrap.append(renderSeat(r));
      }
    } else if (me.account.role === "registrar" || me.account.role === "director") {
      wrap.append(el("p", { class: "hint" }, `You are signed in as the ${me.account.role}. The desk is at /desk and the content desk at /desk/content.`));
    } else if (me.account.role === "frontdesk") {
      wrap.append(el("p", { class: "hint" }, "You are signed in as front desk. The check-in screen is at /checkin."));
    }

    const signOut = el("button", { class: "btn btn-quiet" }, "Sign out");
    signOut.addEventListener("click", async () => {
      await api("/api/auth/signout", { method: "POST" });
      await refreshMe();
      emit();
      render();
    });
    wrap.append(signOut);
    root.append(wrap);
  }

  function announceAccount(message: string): void {
    announce("Account updates", message);
  }

  function renderOffer(offer: { id: string; bench: string; tier: string; state: string; seconds_remaining: number }): HTMLElement {
    const region = el("section", { class: "hold-panel", role: "region", "aria-label": "Waitlist offer" });
    const left = el("span", { class: "mono num", role: "timer" }, hhmmss(offer.seconds_remaining));
    const tick = () => {
      const me = state.me;
      const fresh = me?.offers.find((o) => o.id === offer.id);
      if (!fresh) return;
      left.textContent = hhmmss(fresh.seconds_remaining);
      window.setTimeout(tick, 1000);
    };
    window.setTimeout(tick, 1000);
    region.append(
      el("h3", {}, `Bench ${offer.bench} is waiting for you`),
      el("p", { class: "hint" }, el("span", {}, `${left.textContent} left to accept`.replace("hh:mm:ss", left.textContent))),
      left
    );
    const accept = el("button", { class: "btn btn-live" }, "Accept bench");
    const decline = el("button", { class: "btn btn-quiet" }, "Decline");
    accept.addEventListener("click", async () => {
      try {
        await api(`/api/offers/${offer.id}/accept`, { method: "POST" });
        await load();
        announceAccount(`Bench ${offer.bench} is held for you.`);
      } catch (e) {
        if (e instanceof ApiFailure && e.body.error === "offer_lapsed") {
          announceAccount("This offer has passed to the next person on the waitlist.");
          await load();
        }
      }
    });
    decline.addEventListener("click", async () => {
      await api(`/api/offers/${offer.id}/decline`, { method: "POST" });
      await load();
      announceAccount("This offer has passed to the next person on the waitlist.");
    });
    region.append(accept, decline);
    return region;
  }

  function renderSeat(r: Reservation): HTMLElement {
    const region = el("section", {
      class: "hold-panel card",
      role: "region",
      "aria-label": `Bench ${r.bench}`,
    });
    region.append(
      el("h3", { class: "num" }, `Bench ${r.bench}`),
      el("p", { class: "hint" }, `${stateLabel(r)} · ${r.tier === "atelier" ? "Atelier" : "Bench"} tier${r.attendee && !r.attendee.accepted ? " · awaiting acceptance" : ""}`)
    );
    const actions = el("div", { class: "hold-actions" });

    const isBuyer = state.me?.reservations.some((x) => x.id === r.id && x.buyer.kind === state.me?.account.role) ?? false;
    const amAttendee = r.attendee?.accepted && r.attendee.email?.toLowerCase() === state.me?.account.email.toLowerCase();
    const buyerRole = r.buyer.kind;

    if (r.state === "deposit_paid" && (r.payment_pending === null || r.payment_pending === undefined)) {
      const balance = r.balance_cents;
      const payBalance = el("button", { class: "btn btn-live" }, `Pay balance $${money(balance)}`);
      payBalance.addEventListener("click", () => paySeat(r, "balance", payBalance));
      actions.append(payBalance);
    }
    if (r.tier === "bench" && (r.state === "deposit_paid" || r.state === "paid_in_full")) {
      const upgrade = el("button", { class: "btn btn-gold" }, "Upgrade to Atelier");
      upgrade.addEventListener("click", () => openUpgrade(r, upgrade));
      actions.append(upgrade);
    }
    if (r.state === "deposit_paid" || r.state === "paid_in_full") {
      if (buyerRole !== "clinic" || isBuyer) {
        const cancel = el("button", { class: "btn btn-quiet" }, "Cancel seat");
        cancel.addEventListener("click", async () => {
          try {
            const res = await api<{ reservation: Reservation }>(`/api/reservations/${r.id}/cancel`, { method: "POST" });
            await load();
            announceAccount(`Bench ${r.bench} is cancelled. Refund due: $${money(res.reservation.refund_due_cents ?? 0)}. The registrar will send it.`);
          } catch (e) {
            if (e instanceof ApiFailure && e.body.error === "no_refund_window") {
              await load();
              announceAccount("Refunds closed on 19 March 2027. You can assign this seat to a colleague instead.");
            }
          }
        });
        actions.append(cancel);
      }
      if (r.attendee === null || !r.attendee.accepted || isBuyer) {
        if (buyerRole === "clinic" || r.attendee?.email?.toLowerCase() !== state.me?.account.email.toLowerCase()) {
          const assign = el("button", { class: "btn" }, "Assign to a colleague");
          assign.addEventListener("click", () => openAssign(r, assign));
          actions.append(assign);
        }
      }
    }
    if (r.attendee && !r.attendee.accepted && r.attendee.email?.toLowerCase() === state.me?.account.email.toLowerCase()) {
      const accept = el("button", { class: "btn btn-live" }, "Accept seat");
      accept.addEventListener("click", async () => {
        await api(`/api/reservations/${r.id}/accept`, { method: "POST" });
        await load();
        announceAccount(`Bench ${r.bench} is now your seat.`);
      });
      actions.append(accept);
    }
    if (amAttendee) {
      if (r.licence_status !== "matched") {
        const uploadLicence = el("button", { class: "btn" }, "Upload licence");
        uploadLicence.addEventListener("click", () => openLicenceUpload(r, uploadLicence));
        actions.append(uploadLicence);
      }
      const uploadPassport = el("button", { class: "btn" }, "Upload passport scan");
      uploadPassport.addEventListener("click", () => openPassportUpload(r, uploadPassport));
      actions.append(uploadPassport);
    }
    if (r.documents.includes("visa-letter") && (amAttendee || isBuyer)) {
      const visa = el("button", { class: "btn" }, "Download visa letter");
      visa.addEventListener("click", () => downloadDoc(r.id, "visa-letter", visa));
      actions.append(visa);
    }
    if (r.documents.includes("certificate") && amAttendee) {
      const cert = el("button", { class: "btn btn-live" }, "Download certificate");
      cert.addEventListener("click", () => downloadDoc(r.id, "certificate", cert));
      actions.append(cert);
    }
    for (const kind of r.documents) {
      if (kind.endsWith("-receipt")) {
        const receipt = el("button", { class: "btn btn-quiet" }, `Download ${kind.replace("-receipt", "")} receipt`);
        receipt.addEventListener("click", () => downloadDoc(r.id, kind, receipt));
        actions.append(receipt);
      }
    }

    region.append(actions);
    return region;
  }

  async function downloadDoc(reservationId: string, kind: string, opener: HTMLElement): Promise<void> {
    try {
      const path = kind === "group-invoice"
        ? `/api/groups/${reservationId}/documents/invoice`
        : `/api/reservations/${reservationId}/documents/${kind}`;
      const res = await api<{ url: string }>(path);
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      if (e instanceof ApiFailure) {
        if (e.body.error === "storage_unavailable") {
          announceAccount("Documents are unavailable right now. Try again shortly.");
        }
      }
    }
  }

  async function paySeat(r: Reservation, kind: "balance" | "full", opener: HTMLElement): Promise<void> {
    const submit = async () => {
      try {
        const res = await api<{ reservation: Reservation }>(`/api/reservations/${r.id}/${kind}`, {
          method: "POST",
          body: JSON.stringify({ billing_name: state.me?.account.name ?? "" }),
          idempotencyKey: newKey(),
        });
        await load();
        if (res.reservation.state === "paid_in_full") {
          announceAccount(`Bench ${r.bench} is paid in full.`);
        } else {
          announceAccount(`Payment for Bench ${r.bench} is being confirmed. We will update this page and email your receipt.`);
        }
      } catch (e) {
        if (e instanceof ApiFailure) {
          if (e.body.error === "billing_unavailable") {
            announceAccount("Billing is offline right now. Your hold keeps running and no money has moved.");
          } else {
            announceAccount(e.body.message);
          }
        }
      }
    };
    openDialog({
      label: "Checkout",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        const name = el("input", { type: "text", value: state.me?.account.name ?? "" }) as HTMLInputElement;
        const amount = kind === "balance" ? r.balance_cents : r.price_cents;
        const submitBtn = el("button", { class: "btn btn-live", type: "submit" }, `Pay ${kind === "balance" ? "balance" : "in full"} $${money(amount)}`);
        const close = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(el("h2", {}, "Checkout"), el("label", { class: "form-field" }, el("span", {}, "Name for the receipt"), name), submitBtn, close);
        close.addEventListener("click", () => dialog.close());
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          submitBtn.disabled = true;
          submitBtn.textContent = "Processing payment";
          await submit();
          dialog.close();
        });
        return form;
      },
    });
  }

  function openUpgrade(r: Reservation, opener: HTMLElement): void {
    openDialog({
      label: "Upgrade to Atelier",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        form.append(el("h2", {}, "Upgrade to Atelier"));
        const benches = (state.benches?.benches ?? []).filter((b) => b.row === "A" || b.row === "B");
        const list = el("div", { class: "bench-grid", style: "grid-template-columns:repeat(3,1fr)" });
        let chosen: string | null = null;
        const radios: HTMLInputElement[] = [];
        for (const b of benches) {
          const input = el("input", { type: "radio", name: "upgrade-bench", value: b.label }) as HTMLInputElement;
          if (b.state !== "open") input.disabled = true;
          radios.push(input);
          list.append(el("label", { class: "radiolabel" }, input, b.label));
        }
        form.append(el("p", { class: "hint" }, "Choose an open Atelier bench in row A or B."), list);
        const name = el("input", { type: "text", value: state.me?.account.name ?? "" }) as HTMLInputElement;
        form.append(el("label", { class: "form-field" }, el("span", {}, "Name for the receipt"), name));
        const submit = el("button", { class: "btn btn-live", type: "submit" }, "Pay upgrade $2,450.00");
        const close = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(submit, close);
        close.addEventListener("click", () => dialog.close());
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          chosen = radios.find((x) => x.checked)?.value ?? null;
          if (!chosen) return;
          submit.disabled = true;
          submit.textContent = "Processing payment";
          try {
            const res = await api<{ reservation: Reservation }>(`/api/reservations/${r.id}/upgrade`, {
              method: "POST",
              body: JSON.stringify({ bench: chosen, billing_name: name.value }),
              idempotencyKey: newKey(),
            });
            await load();
            announceAccount(`Bench ${res.reservation.bench} is now your Atelier bench.`);
            dialog.close();
          } catch (e) {
            submit.disabled = false;
            submit.textContent = "Pay upgrade";
            if (e instanceof ApiFailure) announceAccount(e.body.message);
          }
        });
        return form;
      },
    });
  }

  function openAssign(r: Reservation, opener: HTMLElement): void {
    openDialog({
      label: "Assign to a colleague",
      opener,
      build: (dialog) => {
        const form = el("form", {});
        const name = el("input", { type: "text", value: r.attendee?.name ?? "" }) as HTMLInputElement;
        const email = el("input", { type: "email", value: r.attendee?.email ?? "" }) as HTMLInputElement;
        const errorNote = el("p", { class: "field-error", hidden: "true" });
        const submit = el("button", { class: "btn btn-live", type: "submit" }, "Assign seat");
        const close = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(
          el("h2", {}, "Assign to a colleague"),
          el("label", { class: "form-field" }, el("span", {}, "Name"), name),
          el("label", { class: "form-field" }, el("span", {}, "Email"), email),
          errorNote,
          submit,
          close
        );
        close.addEventListener("click", () => dialog.close());
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            await api(`/api/reservations/${r.id}/assignee`, {
              method: "PUT",
              body: JSON.stringify({ name: name.value, email: email.value }),
            });
            await load();
            announceAccount(`Bench ${r.bench} is assigned to ${name.value}. We emailed them.`);
            dialog.close();
          } catch (e) {
            if (e instanceof ApiFailure) {
              errorNote.hidden = false;
              errorNote.textContent = e.body.message;
            }
          }
        });
        return form;
      },
    });
  }

  function openLicenceUpload(r: Reservation, opener: HTMLElement): void {
    openUpload(r, "licence", opener);
  }

  function openPassportUpload(r: Reservation, opener: HTMLElement): void {
    openUpload(r, "passport", opener);
  }

  function openUpload(r: Reservation, kind: "licence" | "passport", opener: HTMLElement): void {
    openDialog({
      label: kind === "licence" ? "Upload licence" : "Upload passport scan",
      opener,
      build: (dialog) => {
        const form = el("form", { enctype: "multipart/form-data" });
        form.append(el("h2", {}, kind === "licence" ? "Upload licence" : "Upload passport scan"));
        const inputs: Record<string, HTMLInputElement> = {};
        const addText = (label: string, name: string, value = "") => {
          const input = el("input", { type: "text", name, value }) as HTMLInputElement;
          inputs[name] = input;
          form.append(el("label", { class: "form-field" }, el("span", {}, label), input));
        };
        if (kind === "licence") {
          addText("Licence number", "licence_number");
          addText("Issuing state", "licence_state");
        } else {
          addText("Full name as in passport", "full_name");
          addText("Nationality", "nationality");
          addText("Passport number", "passport_number");
        }
        const file = el("input", { type: "file", name: "file", accept: ".pdf,.jpg,.jpeg,.png" }) as HTMLInputElement;
        form.append(el("label", { class: "form-field" }, el("span", {}, "File (PDF, JPEG or PNG, 10 MB or smaller)"), file));
        const errorNote = el("p", { class: "field-error", hidden: "true" });
        const submit = el("button", { class: "btn btn-live", type: "submit" }, kind === "licence" ? "Upload licence" : "Upload passport scan");
        const close = el("button", { class: "btn btn-quiet", type: "button" }, "Close");
        form.append(errorNote, submit, close);
        close.addEventListener("click", () => dialog.close());
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const body = new FormData();
          for (const [name, input] of Object.entries(inputs)) body.append(name, input.value);
          if (file.files?.[0]) body.append("file", file.files[0]);
          try {
            await api(`/api/reservations/${r.id}/${kind}`, { method: "POST", body });
            await load();
            announceAccount(kind === "licence" ? "Licence received. The registrar will check it." : "Passport scan received. The registrar will prepare your letter.");
            dialog.close();
          } catch (e) {
            if (e instanceof ApiFailure) {
              if (e.body.error === "unsupported_file_type") {
                errorNote.hidden = false;
                errorNote.textContent = "Upload a PDF, JPEG or PNG file.";
              } else if (e.body.error === "file_too_large" || e.body.error === "payload_too_large") {
                errorNote.hidden = false;
                errorNote.textContent = "Files must be 10,000,000 bytes or smaller.";
              } else if (e.body.error === "storage_unavailable") {
                errorNote.hidden = false;
                errorNote.textContent = "Uploads are unavailable right now. Nothing was saved; try again shortly.";
              } else {
                errorNote.hidden = false;
                errorNote.textContent = e.body.message;
              }
            }
          }
        });
        return form;
      },
    });
  }

  void searchDebounce;
  void mmss;
  load();
}
