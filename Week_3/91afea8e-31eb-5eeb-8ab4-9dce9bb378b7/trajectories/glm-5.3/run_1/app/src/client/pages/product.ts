import { el, busy, announce, openDialog } from "../ui.ts";
import { get, post } from "../api.ts";
import { amount, dateLabel } from "../format.ts";
import { state, navigate, signinLink, refreshCartCount, guestCart, setGuestCart } from "../app.ts";
import { imageRipple } from "../fx.ts";
import { fallingChip } from "../reel.ts";

interface Offer {
  listing_id: string; seller_id: string; seller_name: string; seller_rating: number;
  price_paise: number; delivery_fee_paise: number; landed_paise: number;
  promise_date: string | null; cod_available: boolean; in_stock: boolean; featured: boolean;
}

interface Product {
  id: string; title: string; brand: string; category: string; gst_rate: number;
  rating: number; description: string; specs: Record<string, string | number>;
  offers_count: number; featured_offer: Offer | null;
}

interface EmiPlan {
  tenure_months: number; no_cost: boolean; upfront_discount_paise: number;
  principal_paise: number; instalment_paise: number; total_interest_paise: number; total_payable_paise: number;
}

export async function renderProduct(productId: string, query: URLSearchParams): Promise<HTMLElement> {
  const pin = query.get("pin") ?? state.pincode;
  const product = await get<Product>(`/api/products/${productId}?pin=${encodeURIComponent(pin)}`);

  const main = el("main", { class: "layout-2col product-page" });
  const viewerCol = el("div", { class: "viewer-col" });
  const detailsCol = el("div", { class: "details-col" });

  const h1 = el("h1", { text: product.title });
  detailsCol.append(h1);

  // 3D viewer: a procedural model that orbits on drag, with a still render without WebGL
  const viewer = el("div", { class: "viewer-3d", role: "img", "aria-label": `${product.title}, 3D view`, tabindex: "0" });
  viewer.style.cssText = "border-radius:var(--radius);background:var(--ultramarine-deep);aspect-ratio:1;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;";
  let angle = 0;
  const drawModel = () => {
    viewer.innerHTML = modelSvg(product.category, angle);
  };
  drawModel();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let dragging = false;
  let lastX = 0;
  viewer.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; viewer.setPointerCapture(e.pointerId); });
  viewer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    angle += (e.clientX - lastX) * 0.6;
    lastX = e.clientX;
    drawModel();
  });
  viewer.addEventListener("pointerup", () => { dragging = false; });
  if (!reducedMotion) {
    window.setInterval(() => {
      if (!dragging) {
        angle = (angle + 0.5) % 360;
        drawModel();
      }
    }, 90);
  }
  viewerCol.append(viewer);

  const featured = product.featured_offer;
  if (featured) {
    const offerPanel = el("div", { class: "panel-deep" });
    const featuredLabel = featured.featured ? "featured offer" : "best offer";
    offerPanel.append(el("p", { class: "chip chip-paid", text: featuredLabel }));
    offerPanel.append(el("p", { class: "price", style: "font-family:var(--font-head);font-weight:900;font-size:2.4rem", text: amount(featured.price_paise) }));
    offerPanel.append(el("p", { text: `sold by ${featured.seller_name} · arrives by ${dateLabel(featured.promise_date ?? "")}` }));
    detailsCol.append(offerPanel);
  }

  const meta = el("p", { text: `${product.brand} · ${product.category} · rated ${product.rating.toFixed(1)}` });
  const description = el("p", { text: product.description });
  detailsCol.append(meta, description);

  // pincode promise, updates in place
  const pinLabel = el("label", { class: "field", style: "max-width:320px" });
  pinLabel.append(el("span", { class: "label-text", text: "Pincode" }));
  const pinInput = el("input", { type: "text", value: pin, inputmode: "numeric", maxlength: "6" });
  const pinBtn = el("button", { class: "btn btn-yellow", text: "Check pincode", type: "button" });
  const promise = el("p", { role: "status", class: "hero-promise" });
  const updatePromise = (p: string) => {
    state.pincode = p;
    window.localStorage.setItem("chauraha_pincode", p);
    promise.textContent = `arrives by ${dateLabel(p)}`;
  };
  if (featured?.promise_date) updatePromise(featured.promise_date);
  pinBtn.addEventListener("click", () => {
    void busy(pinBtn, async () => {
      const value = pinInput.value.trim();
      if (!/^\d{6}$/.test(value) || value.startsWith("0")) {
        promise.textContent = "Enter a 6-digit pincode.";
        return;
      }
      try {
        const fresh = await get<Product>(`/api/products/${productId}?pin=${value}`);
        const offer = fresh.featured_offer;
        if (!offer) {
          promise.textContent = `We don't deliver to ${value} yet.`;
        } else {
          promise.textContent = `arrives by ${dateLabel(offer.promise_date ?? "")}${offer.cod_available ? " · cash on delivery available" : ""}`;
        }
        window.history.replaceState({}, "", `/p/${productId}?pin=${value}`);
      } catch (err) {
        promise.textContent = err instanceof Error ? err.message : "";
      }
    });
  });
  pinLabel.append(pinInput, pinBtn, promise);
  detailsCol.append(pinLabel);

  // actions
  const actions = el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" });
  const addToCartBtn = el("button", { class: "btn btn-primary", text: "Add to cart" });
  const buyNowBtn = el("button", { class: "btn btn-yellow", text: "Buy now" });
  const wishlistBtn = el("button", { class: "btn btn-ghost", text: "Add to wishlist" });
  actions.append(addToCartBtn, buyNowBtn, wishlistBtn);
  detailsCol.append(actions);

  const addLine = async (listingId: string, quantity = 1): Promise<void> => {
    if (!state.account || state.account.role !== "shopper") {
      const guest = guestCart();
      const existing = guest.find((l) => l.listing_id === listingId);
      if (existing) existing.quantity = Math.min(10, existing.quantity + quantity);
      else if (guest.length < 10) guest.push({ listing_id: listingId, quantity });
      setGuestCart(guest);
      await refreshCartCount();
      fallingChip(product.title);
      announce(`${product.title} added to your cart.`);
      void navigate(signinLink());
      return;
    }
    await post("/api/cart/lines", { listing_id: listingId, quantity });
    await refreshCartCount();
    fallingChip(product.title);
    announce(`${product.title} added to your cart.`);
  };

  addToCartBtn.addEventListener("click", () => {
    void busy(addToCartBtn, async () => {
      await addLine(featured?.listing_id ?? "");
    });
  });
  buyNowBtn.addEventListener("click", () => {
    void busy(buyNowBtn, async () => {
      await addLine(featured?.listing_id ?? "");
      void navigate("/cart");
    });
  });
  wishlistBtn.addEventListener("click", () => {
    void busy(wishlistBtn, async () => {
      if (!state.account || state.account.role !== "shopper") {
        void navigate(signinLink());
        return;
      }
      await post("/api/wishlist", { product_id: product.id, listing_id: featured?.listing_id ?? null });
      wishlistBtn.textContent = "Add to wishlist";
      wishlistBtn.setAttribute("aria-pressed", "true");
      announce(`${product.title} saved to your wishlist.`);
    });
  });

  const offersLink = el("a", { class: "btn btn-ghost", href: `/p/${productId}/offers?pin=${pin}`, text: `See all ${product.offers_count} offers` });
  detailsCol.append(offersLink);

  // EMI table
  if (featured && featured.price_paise >= 300000) {
    try {
      const emi = await get<{ amount_paise: number; plans: EmiPlan[] }>(`/api/emi-plans?listing_id=${featured.listing_id}`);
      const tableWrap = el("div", { class: "table-wrap" });
      const table = el("table", { "aria-label": "EMI plans" });
      const thead = el("thead", {});
      const headRow = el("tr", {});
      for (const h of ["Tenure", "Instalment", "Total interest", "Total payable", "No cost"]) headRow.append(el("th", { text: h }));
      thead.append(headRow);
      const tbody = el("tbody", {});
      for (const plan of emi.plans) {
        const row = el("tr", {});
        row.append(
          el("td", { text: `${plan.tenure_months} months` }),
          el("td", { text: amount(plan.instalment_paise) }),
          el("td", { text: amount(plan.total_interest_paise) }),
          el("td", { text: amount(plan.total_payable_paise) }),
          el("td", { text: plan.no_cost ? "yes" : "-" }),
        );
        tbody.append(row);
      }
      table.append(thead, tbody);
      tableWrap.append(table);
      detailsCol.append(el("h3", { text: "emi plans" }), tableWrap);
    } catch { /* EMI not offered below ₹3,000.00 */ }
  }

  const specPanel = el("div", { class: "panel-deep" });
  specPanel.append(el("h3", { text: "specs" }));
  for (const [k, v] of Object.entries(product.specs)) {
    specPanel.append(el("p", { text: `${k.replace(/_/g, " ")}: ${String(v)}` }));
  }
  detailsCol.append(specPanel);

  const rippleImg = el("div", { class: "ripple-img", style: "border-radius:var(--radius);aspect-ratio:1;background:var(--card-art);--card-art:url('/img/listings/${}')".replace("${}", `${featured?.listing_id ?? productId}.svg`) });
  imageRipple(rippleImg);
  viewerCol.append(rippleImg);

  main.append(viewerCol, detailsCol);
  void openDialog;
  return main;
}

/** Procedural 3D-ish product model that turns with the angle. */
function modelSvg(category: string, angle: number): string {
  const a = (angle * Math.PI) / 180;
  const w = Math.abs(Math.cos(a)) * 70 + 30;
  const shades: Record<string, [string, string]> = {
    kitchen: ["#ffd23f", "#ff4f9a"],
    fashion: ["#ff4f9a", "#c3ccff"],
    electronics: ["#12c48b", "#ffd23f"],
    beverages: ["#ffd23f", "#12c48b"],
  };
  const [c1, c2] = shades[category] ?? ["#ffd23f", "#ff4f9a"];
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:70%">
    <ellipse cx="100" cy="180" rx="${w + 20}" ry="12" fill="rgba(11,11,58,0.5)"/>
    <rect x="${100 - w / 2}" y="60" width="${w}" height="100" rx="18" fill="${c1}" stroke="#0b0b3a" stroke-width="5"/>
    <rect x="${100 - w / 2 - 10}" y="40" width="${w + 20}" height="26" rx="13" fill="${c2}" stroke="#0b0b3a" stroke-width="5"/>
    <circle cx="100" cy="34" r="9" fill="#ffffff" stroke="#0b0b3a" stroke-width="4"/>
  </svg>`;
}

export async function renderOffers(productId: string, query: URLSearchParams): Promise<HTMLElement> {
  const pin = query.get("pin") ?? state.pincode;
  const res = await get<{ offers: Offer[]; total: number }>(`/api/products/${productId}/offers?pin=${encodeURIComponent(pin)}`);
  const product = await get<Product>(`/api/products/${productId}`);
  const main = el("main", {});
  main.append(el("h1", { text: `${product.title} offers` }));
  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { "aria-label": "Seller offers" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  for (const h of ["Seller", "Price", "Delivery", "Landed price", "Arrives by", "Cash on delivery"]) headRow.append(el("th", { text: h }));
  thead.append(headRow);
  const tbody = el("tbody", {});
  for (const offer of res.offers) {
    const row = el("tr", {});
    if (offer.featured) row.append(el("td", { text: `${offer.seller_name} (featured offer)` }));
    else row.append(el("td", { text: offer.seller_name }));
    row.append(
      el("td", { text: amount(offer.price_paise) }),
      el("td", { text: amount(offer.delivery_fee_paise) }),
      el("td", { text: amount(offer.landed_paise) }),
      el("td", { text: offer.promise_date ? `arrives by ${dateLabel(offer.promise_date)}` : "-" }),
      el("td", { text: offer.cod_available ? "yes" : "no" }),
    );
    const choose = el("button", { class: "btn btn-primary", text: `Choose ${offer.seller_name}` });
    choose.addEventListener("click", () => {
      void busy(choose, async () => {
        if (!state.account || state.account.role !== "shopper") {
          void navigate(signinLink());
          return;
        }
        await post("/api/cart/lines", { listing_id: offer.listing_id, quantity: 1 });
        await refreshCartCount();
        void navigate("/cart");
      });
    });
    row.append(el("td", {}, choose));
    tbody.append(row);
  }
  table.append(thead, tbody);
  wrap.append(table);
  main.append(wrap);
  return main;
}
