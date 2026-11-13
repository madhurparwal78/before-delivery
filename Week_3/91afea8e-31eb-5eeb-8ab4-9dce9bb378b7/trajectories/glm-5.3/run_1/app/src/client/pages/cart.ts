import { el, clear, announce, busy, openDialog, Countdown, clockSkew } from "../ui.ts";
import { get, post, patch, put, del, ApiFailure } from "../api.ts";
import { amount, dateLabel } from "../format.ts";
import { state, navigate, signinLink, refreshCartCount, guestCart } from "../app.ts";
import { Reel, setCodBar, slideStrips } from "../reel.ts";

interface Quote {
  lines: Array<{
    line_id: string; listing_id: string; product_id: string; title: string; seller_id: string;
    quantity: number; unit_price_paise: number; deal: { price_paise: number; ends_at: string } | null;
    selected: boolean; gift_wrap: boolean; gift_message: string;
    line_subtotal_paise: number; coupon_share_paise: number; line_total_paise: number;
    gst_rate: number; taxable_value_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
    in_stock: boolean;
  }>;
  saved_for_later: Array<{ line_id: string; listing_id: string; title: string; unit_price_paise: number; in_stock: boolean }>;
  parcels: Array<{ seller_id: string; seller_name: string; line_ids: string[]; speed: string; one_day_available: boolean; serviceable: boolean; promise_date: string | null; delivery_fee_paise: number; cod_fee_paise: number }>;
  destination: { address_id: string | null; pincode: string; city: string | null; state: string | null };
  coupon: { code: string; discount_paise: number } | null;
  payment: { method: string | null; use_balance: boolean; emi_tenure_months: number | null };
  subtotal_paise: number; discount_paise: number; gift_wrap_paise: number; delivery_paise: number;
  cod_fee_paise: number; emi_discount_paise: number; payable_paise: number;
  balance_applied_paise: number; due_paise: number;
  cod: { eligible: boolean; reason: string | null; message: string | null; cap_paise: number; cash_paise: number };
  server_time: string;
}

export async function renderCart(): Promise<HTMLElement> {
  const main = el("main", { class: "cart-page" });

  if (!state.account || state.account.role !== "shopper") {
    void navigate(signinLink());
    const waiting = el("div", { class: "panel-deep" });
    waiting.append(el("p", { text: "taking you to sign in so your cart can come with you." }));
    main.append(waiting);
    return main;
  }

  let quote = await get<Quote>("/api/cart");
  const layout = el("div", { class: "cart-layout" });
  const left = el("div", { class: "cart-parcels" });
  const right = el("div", { class: "cart-summary" });
  layout.append(left, right);

  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Cart updates" });

  let reel: Reel | null = null;

  async function repaint(next: Quote, announceTotal = true): Promise<void> {
    quote = next;
    clear(left);
    clear(right);

    if (quote.lines.length === 0 && quote.saved_for_later.length === 0) {
      const empty = el("div", { class: "panel-pink" });
      empty.append(el("p", { text: "your cart is empty. the bazaar isn't." }));
      left.append(empty);
    }

    for (const parcel of quote.parcels) {
      const panel = el("section", { class: "parcel-panel", "aria-label": `${parcel.seller_name} parcel` });
      const h2 = el("h2", { text: `${parcel.seller_name} parcel` });
      const strip = el("div", { class: "parcel-strip", "aria-hidden": "true" });
      const inner = el("span", { class: "strip-inner", text: `arrives by ${dateLabel(parcel.promise_date ?? "")} · delivery ${amount(parcel.delivery_fee_paise)}` });
      strip.append(inner);
      panel.append(h2, strip);
      if (!parcel.serviceable) {
        panel.append(el("p", { class: "field-error", text: `${parcel.seller_name} doesn't deliver to ${quote.destination.pincode}.` }));
      }

      const speedGroup = el("fieldset", {});
      speedGroup.append(el("legend", { text: `Delivery speed for ${parcel.seller_name}` }));
      const radioStandard = el("input", { type: "radio", name: `speed-${parcel.seller_id}`, value: "standard" });
      radioStandard.checked = parcel.speed !== "one_day";
      const radioOneDay = el("input", { type: "radio", name: `speed-${parcel.seller_id}`, value: "one_day" });
      radioOneDay.checked = parcel.speed === "one_day";
      radioOneDay.disabled = !parcel.one_day_available;
      const changeSpeed = (speed: string) => {
        void (async () => {
          try {
            const nextQuote = await put<Quote>("/api/cart/delivery-speed", { seller_id: parcel.seller_id, speed });
            await repaint(nextQuote);
            announceCart(nextQuote);
          } catch (err) {
            if (err instanceof ApiFailure) announce(err.message);
          }
        })();
      };
      radioStandard.addEventListener("change", () => changeSpeed("standard"));
      radioOneDay.addEventListener("change", () => changeSpeed("one_day"));
      const stdLabel = el("label", { style: "display:flex;align-items:center;gap:10px" });
      stdLabel.append(radioStandard, el("span", { text: "Standard" }));
      const oneLabel = el("label", { style: "display:flex;align-items:center;gap:10px" });
      oneLabel.append(radioOneDay, el("span", { text: "One day" }));
      speedGroup.append(stdLabel, oneLabel);
      panel.append(speedGroup);
      left.append(panel);
    }

    for (const line of quote.lines) {
      const parcel = quote.parcels.find((p) => p.line_ids.includes(line.line_id));
      const panel = parcel
        ? (Array.from(left.children).find((n) => (n as HTMLElement).getAttribute("aria-label") === `${parcel.seller_name} parcel`) as HTMLElement | undefined)
        : undefined;
      if (!panel) continue;
      panel.append(lineNode(line));
    }

    // saved for later
    if (quote.saved_for_later.length > 0) {
      const saved = el("section", { class: "parcel-panel", "aria-label": "Saved for later" });
      saved.append(el("h2", { text: "saved for later" }));
      for (const item of quote.saved_for_later) {
        const row = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0" });
        row.append(el("span", { text: `${item.title} · ${amount(item.unit_price_paise)}${item.in_stock ? "" : " · sold out"}` }));
        const moveBtn = el("button", { class: "btn btn-primary", text: `Move ${item.title} to cart` });
        moveBtn.addEventListener("click", () => {
          void busy(moveBtn, async () => {
            const nextQuote = await post<Quote>(`/api/cart/saved/${item.line_id}/move-to-cart`, {});
            await repaint(nextQuote);
            announceCart(nextQuote);
          });
        });
        row.append(moveBtn);
        saved.append(row);
      }
      left.append(saved);
    }

    // summary
    const summaryHeading = el("h2", { text: "the bill" });
    const row = (label: string, value: number) => {
      const r = el("div", { class: "summary-row" });
      r.append(el("span", { text: label }), el("span", { text: amount(value) }));
      return r;
    };
    right.append(summaryHeading);
    right.append(row("subtotal", quote.subtotal_paise));
    right.append(row("coupon savings", -quote.discount_paise));
    right.append(row("gift wrap", quote.gift_wrap_paise));
    right.append(row("delivery", quote.delivery_paise));
    if (quote.cod_fee_paise > 0) right.append(row("cash on delivery fee", quote.cod_fee_paise));
    if (quote.emi_discount_paise > 0) right.append(row("no-cost EMI discount", -quote.emi_discount_paise));
    right.append(row("GST included", quote.lines.reduce((a, l) => a + l.cgst_paise + l.sgst_paise + l.igst_paise, 0)));

    const totalGroup = el("div", { class: "payable-total", role: "group", "aria-label": "Payable total" });
    const reelHost = el("span", {});
    const label = el("span", { text: "payable" });
    totalGroup.append(label, reelHost);
    reel = new Reel(reelHost);
    reel.setSkew(clockSkew(quote.server_time));
    reel.roll(amount(quote.payable_paise));
    const totalForAria = el("span", { class: "status", text: amount(quote.payable_paise) });
    totalGroup.append(totalForAria);
    right.append(totalGroup);

    if (quote.balance_applied_paise > 0) {
      right.append(row("Chauraha balance applied", -quote.balance_applied_paise));
      right.append(row("due now", quote.due_paise));
    }

    // COD bar
    const codBar = el("div", { class: "cod-bar", role: "progressbar", "aria-label": "Cash on delivery limit", "aria-valuemin": "0", "aria-valuemax": String(quote.cod.cap_paise), "aria-valuenow": String(quote.cod.cash_paise) });
    codBar.append(el("div", { class: "fill" }), el("span", { class: "bar-label", text: "cash on delivery limit" }));
    setCodBar(codBar, quote.cod.cash_paise, quote.cod.cap_paise, quote.cod.eligible);
    right.append(codBar);

    // coupon
    const couponForm = el("form", { class: "coupon-form", style: "display:flex;gap:10px;margin-top:14px" });
    const couponInput = el("input", { type: "text", placeholder: "Coupon code", "aria-label": "Coupon code" });
    if (quote.coupon) couponInput.value = quote.coupon.code;
    const applyBtn = el("button", { class: "btn btn-yellow", type: "submit", text: quote.coupon ? "Remove coupon" : "Apply coupon" });
    couponForm.append(couponInput, applyBtn);
    couponForm.addEventListener("submit", (e) => {
      e.preventDefault();
      void busy(applyBtn, async () => {
        try {
          const nextQuote = quote.coupon
            ? await del<Quote>("/api/cart/coupon")
            : await post<Quote>("/api/cart/coupon", { code: couponInput.value.trim() });
          await repaint(nextQuote);
          announceCart(nextQuote);
        } catch (err) {
          if (err instanceof ApiFailure) {
            const field = couponInput.parentElement?.querySelector(".field-error") ?? el("p", { class: "field-error" });
            (field as HTMLElement).textContent = err.fields.code ?? err.message;
            couponInput.after(field as HTMLElement);
          }
        }
      });
    });
    right.append(couponForm);

    // share cart
    const shareBtn = el("button", { class: "btn btn-ghost", text: "Share cart" });
    shareBtn.addEventListener("click", () => openShareDialog("cart", shareBtn));
    right.append(shareBtn);

    if (announceTotal) announceCart(quote);
  }

  function lineNode(line: Quote["lines"][number]): HTMLElement {
    const node = el("article", { class: "cart-line", "data-line-id": line.line_id });
    const top = el("div", { style: "display:flex;justify-content:space-between;gap:12px;align-items:flex-start" });
    const selectLabel = el("label", { style: "display:flex;gap:10px;align-items:flex-start" });
    const selectCheck = el("input", { type: "checkbox", "aria-label": `Select ${line.title}` });
    selectCheck.checked = line.selected;
    selectCheck.addEventListener("change", () => {
      void patch<Quote>(`/api/cart/lines/${line.line_id}`, { selected: selectCheck.checked })
        .then(async (q: Quote) => { await repaint(q); announceCart(q); });
    });
    const info = el("div", {});
    const titleLink = el("a", { href: `/p/${line.product_id}`, text: line.title });
    info.append(titleLink);
    if (line.deal) {
      const dealText = el("p", { text: `deal ${amount(line.deal.price_paise)}` });
      const timerEl = el("span", { role: "timer", "aria-label": "Deal ends in", class: "chip chip-pending" });
      dealText.append(timerEl);
      new Countdown(timerEl, new Date(line.deal.ends_at).getTime(), 0);
      info.append(dealText);
    }
    if (!line.in_stock) {
      info.append(el("p", { class: "field-error", text: "Sold out. Remove it or save it for later." }));
    }
    const price = el("p", { class: "price", style: "font-family:var(--font-head);font-weight:900;font-size:1.5rem", text: amount(line.unit_price_paise) });
    info.append(price);
    const tax = el("p", { class: "tax-split", style: "font-weight:700" });
    tax.append(document.createTextNode(`taxable ${amount(line.taxable_value_paise)}`));
    if (line.cgst_paise > 0) tax.append(document.createTextNode(` · CGST ${amount(line.cgst_paise)} · SGST ${amount(line.sgst_paise)}`));
    if (line.igst_paise > 0) tax.append(document.createTextNode(` · IGST ${amount(line.igst_paise)}`));
    info.append(tax);
    selectLabel.append(selectCheck, info);
    top.append(selectLabel);
    node.append(top);

    const qtyLabel = el("label", { class: "field", style: "display:flex;align-items:center;gap:10px" });
    qtyLabel.append(el("span", { class: "label-text", text: `Quantity for ${line.title}` }));
    const qty = el("input", { type: "number", min: "1", max: "10", value: String(line.quantity), "aria-label": `Quantity for ${line.title}` });
    qty.addEventListener("change", () => {
      void patch<Quote>(`/api/cart/lines/${line.line_id}`, { quantity: Number(qty.value) })
        .then(async (q: Quote) => { await repaint(q); announceCart(q); })
        .catch((err: ApiFailure) => {
          announce(err.fields.quantity ?? err.message);
        });
    });
    qtyLabel.append(qty);
    node.append(qtyLabel);

    const giftCheck = el("input", { type: "checkbox", "aria-label": `Gift wrap ${line.title}` });
    giftCheck.checked = line.gift_wrap;
    giftCheck.addEventListener("change", () => {
      void patch<Quote>(`/api/cart/lines/${line.line_id}`, { gift_wrap: giftCheck.checked })
        .then(async (q: Quote) => { await repaint(q); announceCart(q); });
    });
    const giftLabel = el("label", { style: "display:flex;align-items:center;gap:10px" });
    giftLabel.append(giftCheck, el("span", { text: `Gift wrap ${line.title} (+₹30.00)` }));
    node.append(giftLabel);

    if (line.gift_wrap) {
      const msgLabel = el("label", { class: "field" });
      const msgInput = el("textarea", { rows: "2", maxlength: "240", placeholder: "a note for the lucky one" });
      msgInput.value = line.gift_message;
      const counter = el("span", { class: "counter", text: `${[...line.gift_message].length}/240` });
      const updateCounter = () => { counter.textContent = `${[...msgInput.value].length}/240`; };
      msgInput.addEventListener("input", updateCounter);
      msgInput.addEventListener("blur", () => {
        void patch<Quote>(`/api/cart/lines/${line.line_id}`, { gift_message: msgInput.value })
          .then(async (q: Quote) => { await repaint(q, false); });
      });
      const labelWrap = el("span", { class: "label-text" });
      labelWrap.append(document.createTextNode(`Gift message for ${line.title} `), counter);
      msgLabel.append(labelWrap, msgInput);
      node.append(msgLabel);
    }

    const actions = el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" });
    const saveBtn = el("button", { class: "btn btn-ghost", text: `Save ${line.title} for later` });
    saveBtn.addEventListener("click", () => {
      void busy(saveBtn, async () => {
        const nextQuote = await post<Quote>(`/api/cart/lines/${line.line_id}/save-for-later`, {});
        await repaint(nextQuote);
        const nextQty = document.querySelector<HTMLInputElement>(`[data-line-id] input[type=number]`);
        nextQty?.focus();
      });
    });
    const wishBtn = el("button", { class: "btn btn-ghost", text: `Move ${line.title} to wishlist` });
    wishBtn.addEventListener("click", () => {
      void busy(wishBtn, async () => {
        const nextQuote = await post<Quote>(`/api/cart/lines/${line.line_id}/move-to-wishlist`, {});
        await refreshCartCount();
        await repaint(nextQuote);
      });
    });
    const removeBtn = el("button", { class: "btn btn-ghost", text: `Remove ${line.title}` });
    removeBtn.addEventListener("click", () => {
      void busy(removeBtn, async () => {
        const nextQuote = await del<Quote>(`/api/cart/lines/${line.line_id}`);
        await refreshCartCount();
        await repaint(nextQuote);
      });
    });
    actions.append(saveBtn, wishBtn, removeBtn);
    node.append(actions);
    return node;
  }

  function announceCart(q: Quote): void {
    const parcels = q.parcels.length;
    const region = main.querySelector<HTMLElement>("[role=status][aria-label='Cart updates']");
    if (region) {
      announce(parcels === 1 ? `Total ${amount(q.payable_paise)}, 1 parcel.` : `Total ${amount(q.payable_paise)}, ${parcels} parcels.`, region);
    }
  }

  function openShareDialog(kind: "wishlist" | "cart", opener: HTMLElement): void {
    const nameField = el("label", { class: "field" });
    nameField.append(el("span", { class: "label-text", text: "Name to show" }));
    const nameInput = el("input", { type: "text", maxlength: "40", value: state.account?.first_name ?? "" });
    nameField.append(nameInput);
    const linkField = el("label", { class: "field" });
    linkField.append(el("span", { class: "label-text", text: "Share link" }));
    const linkInput = el("input", { type: "text", readonly: "readonly" });
    linkField.append(linkInput);
    const createBtn = el("button", { class: "btn btn-primary", text: "Create link" });
    const copyBtn = el("button", { class: "btn btn-yellow", text: "Copy link", hidden: "true" });
    const regenBtn = el("button", { class: "btn btn-ghost", text: "Make a new link" });
    const offBtn = el("button", { class: "btn btn-ghost", text: "Turn off link" });
    const dlg = el("dialog", { "aria-label": kind === "cart" ? "Share cart" : "Share wishlist" });
    dlg.append(el("h2", { text: kind === "cart" ? "Share cart" : "Share wishlist" }), nameField, linkField, createBtn, copyBtn, regenBtn, offBtn);
    const load = async () => {
      try {
        const link = await post<{ token: string; url: string; display_name: string }>(`/api/${kind}/share`, { display_name: nameInput.value || "a shopper" });
        linkInput.value = link.url;
        createBtn.hidden = true;
        copyBtn.hidden = false;
      } catch { /* first create fails silently until a name is typed */ }
    };
    createBtn.addEventListener("click", () => void busy(createBtn, load));
    copyBtn.addEventListener("click", () => { void navigator.clipboard?.writeText(`${window.location.origin}${linkInput.value}`); });
    regenBtn.addEventListener("click", () => {
      void busy(regenBtn, async () => {
        const link = await post<{ url: string }>(`/api/${kind}/share/regenerate`, { display_name: nameInput.value || "a shopper" });
        linkInput.value = link.url;
      });
    });
    offBtn.addEventListener("click", () => {
      void busy(offBtn, async () => {
        await del(`/api/${kind}/share`);
        linkInput.value = "";
        copyBtn.hidden = true;
        createBtn.hidden = false;
      });
    });
    openDialog(dlg, opener);
    void load();
  }

  // guest merge announcement region
  const mergeRegion = el("section", { class: "panel-deep", "aria-label": "Cart merge", hidden: "true" });
  const mergeResults = window.sessionStorage.getItem("chauraha_merge");
  if (mergeResults) {
    try {
      const results = JSON.parse(mergeResults) as Array<{ title: string; outcome: string; quantity: number }>;
      mergeRegion.hidden = false;
      mergeRegion.append(el("h2", { text: "cart merge" }));
      for (const r of results) {
        const text = r.outcome === "added" ? `${r.title}: added.`
          : r.outcome === "combined" ? `${r.title}: combined, now ${r.quantity}.`
          : r.outcome === "capped" ? `${r.title}: capped at 10.`
          : r.outcome === "saved_for_later" ? `${r.title}: cart full, saved for later.`
          : `${r.title}: no longer available.`;
        mergeRegion.append(el("p", { text }));
      }
      window.sessionStorage.removeItem("chauraha_merge");
    } catch { /* nothing to show */ }
  }
  main.append(mergeRegion);

  // destination pincode control
  const destForm = el("form", { style: "display:flex;gap:10px;max-width:340px" });
  const destInput = el("input", { type: "text", "aria-label": "Pincode", value: quote.destination.pincode, inputmode: "numeric", maxlength: "6" });
  const destBtn = el("button", { class: "btn btn-yellow", type: "submit", text: "Deliver here" });
  destForm.append(destInput, destBtn);
  destForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(destBtn, async () => {
      const nextQuote = await put<Quote>("/api/cart/destination", { pincode: destInput.value.trim() });
      await repaint(nextQuote);
    });
  });

  main.append(statusRegion, destForm, layout);

  await repaint(quote, false);
  slideStrips(left, () => "");
  void guestCart;
  return main;
}
