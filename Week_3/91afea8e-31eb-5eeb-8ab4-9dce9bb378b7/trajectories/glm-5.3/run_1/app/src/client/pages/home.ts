import { el, clear } from "../ui.ts";
import { get } from "../api.ts";
import { amount, dateLabel } from "../format.ts";
import { state, navigate, PINCODE_KEY } from "../app.ts";
import { scrubTiffin, particleWordmark, dealsRail, parallaxLayers, cylinderLabel, scatterHeading, tiffinSvg, noiseField } from "../fx.ts";

interface Hit {
  listing_id: string; product_id: string; title: string; brand: string; category: string;
  seller_id: string; seller_name: string; price_paise: number; rating: number;
  image_url: string; in_stock: boolean; delivers: boolean; promise_date: string | null;
}

export async function renderHome(): Promise<HTMLElement> {
  const main = el("main", { class: "page-home-main" });

  const hero = el("section", { class: "hero", "aria-label": "everything. one cart." });
  const heroInner = el("div", { class: "hero-inner" });
  const headlineWrap = el("div", {});
  const headline = el("h1", { text: "everything. one cart." });
  const wordmarkCanvas = el("canvas", { class: "wordmark-canvas", "aria-label": "Chauraha" });
  headlineWrap.append(headline, wordmarkCanvas);

  const tiffin = el("div", { class: "tiffin-art", "aria-hidden": "true" });
  tiffin.innerHTML = tiffinSvg(0);
  heroInner.append(headlineWrap, tiffin);

  const band = el("div", { class: "hero-band" });
  const marquee = el("div", { class: "marquee", "aria-label": "Delivery promises" });
  const track = el("span", { class: "track" });
  track.textContent = "one cart, one parcel per seller. cash on delivery up to ₹50,000.00. returns picked up from your door. every refund explained to the paisa.";
  marquee.append(track);
  const pincodeForm = el("form", { class: "pincode-form", "aria-label": "Delivery pincode" });
  const pincodeInput = el("input", {
    type: "text", "aria-label": "Your pincode", inputmode: "numeric", maxlength: "6",
    placeholder: "6-digit pincode", value: state.pincode,
  });
  const checkBtn = el("button", { class: "btn btn-yellow", type: "submit", text: "Check" });
  pincodeForm.append(pincodeInput, checkBtn);
  const bandPromise = el("p", { class: "hero-promise", role: "status" });
  pincodeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void (async () => {
      const pin = pincodeInput.value.trim();
      if (!/^\d{6}$/.test(pin) || pin.startsWith("0")) {
        bandPromise.textContent = "Enter a 6-digit pincode.";
        return;
      }
      try {
        const info = await get<{ serviceable: boolean; city: string | null; cod_available: boolean }>(`/api/pincodes/${pin}`);
        state.pincode = pin;
        window.localStorage.setItem(PINCODE_KEY, pin);
        bandPromise.textContent = info.serviceable
          ? `we deliver to ${info.city ?? pin}${info.cod_available ? " with cash on delivery" : ""}.`
          : `We don't deliver to ${pin} yet.`;
        await loadDeals();
      } catch (err) {
        bandPromise.textContent = err instanceof Error ? err.message : "";
      }
    })();
  });
  band.append(marquee, pincodeForm, bandPromise);
  hero.append(heroInner, band);

  const dealsSection = el("section", { class: "panel-deep", "aria-label": "Today's Deals" });
  const dealsHead = el("h2", { text: "today's deals" });
  const todayLabel = el("span", { class: "today-label", "aria-hidden": "true" });
  const rail = el("div", { class: "deals-rail" });
  dealsSection.append(dealsHead, todayLabel, rail);

  const categoriesSection = el("section", { "aria-label": "Categories" });
  const catHead = el("h2", { text: "browse the bazaar" });
  const banners = el("div", { class: "category-banners" });
  const palette = ["#2437e0", "#ff4f9a", "#ffd23f", "#0b0b3a", "#1a2bb8"];
  const cats: Array<{ slug: string; name: string }> = [
    { slug: "kitchen", name: "kitchen" },
    { slug: "fashion", name: "fashion" },
    { slug: "electronics", name: "electronics" },
    { slug: "beverages", name: "beverages" },
  ];
  cats.forEach((c, i) => {
    const layers: HTMLElement[] = [];
    const banner = el("a", { class: "category-banner", href: `/search?category=${c.slug}` });
    banner.style.background = palette[i % palette.length];
    banner.style.position = "relative";
    banner.style.overflow = "hidden";
    const back = el("div", { class: "layer-back", "aria-hidden": "true" });
    back.textContent = c.name;
    back.style.cssText = "position:absolute;inset:0;font-family:var(--font-head);font-weight:900;font-size:8rem;opacity:0.12;";
    const mid = el("div", { class: "layer-mid", "aria-hidden": "true" });
    mid.textContent = "◆ ◆ ◆";
    mid.style.cssText = "position:absolute;inset:0;font-size:2.4rem;opacity:0.14;text-align:right;padding:20px;";
    const front = el("h2", { class: "layer-front", text: c.name });
    front.style.position = "relative";
    banner.append(back, mid, front);
    layers.push(back, mid, front);
    banners.append(banner);
    parallaxLayers(banner, layers);
    scatterHeading(front);
  });
  categoriesSection.append(catHead, banners);

  main.append(hero, dealsSection, categoriesSection);

  async function loadDeals(): Promise<void> {
    try {
      const res = await get<{ hits: Hit[] }>("/api/search?sort=newest&limit=8");
      clearRail();
      for (const hit of res.hits) {
        const card = el("a", { class: "deal-card", href: `/p/${hit.product_id}` });
        const title = el("h3", { text: hit.title });
        const price = el("span", { class: "deal-price", text: amount(hit.price_paise) });
        const seller = el("span", { text: `from ${hit.seller_name}` });
        card.append(title, price, seller);
        rail.append(card);
      }
      dealsRail(rail);
    } catch {
      clearRail();
      const empty = el("p", { text: "the deals counter is being set. come back in a minute." });
      rail.append(empty);
    }
  }

  function clearRail(): void {
    while (rail.firstChild) rail.removeChild(rail.firstChild);
  }

  void loadDeals();
  scrubTiffin(tiffin);
  const wordmarkCanvasEl = main.querySelector<HTMLCanvasElement>(".wordmark-canvas");
  if (wordmarkCanvasEl) particleWordmark(wordmarkCanvasEl, "chauraha");
  cylinderLabel(todayLabel);

  const noiseCanvas = el("canvas", { class: "noise-canvas", "aria-hidden": "true" });
  noiseField(noiseCanvas, Math.random() * 10);
  void dateLabel;
  void clear;
  return main;
}
