import { el, clear, esc, announce, busy } from "../ui.ts";
import { get } from "../api.ts";
import { amount, dateLabel } from "../format.ts";
import { state, saveCompare, navigate } from "../app.ts";

export interface SearchParams {
  q: string; category: string; brand: string[]; seller: string[];
  price_min: string; price_max: string; rating: string;
  pin: string; deliverable: boolean; sort: string; cursor: string | null;
}

export function paramsFromQuery(query: URLSearchParams): SearchParams {
  return {
    q: query.get("q") ?? "",
    category: query.get("category") ?? "",
    brand: (query.get("brand") ?? "").split(",").filter(Boolean),
    seller: (query.get("seller") ?? "").split(",").filter(Boolean),
    price_min: query.get("price_min") ?? "",
    price_max: query.get("price_max") ?? "",
    rating: query.get("rating") ?? "",
    pin: query.get("pin") ?? "",
    deliverable: query.get("deliverable") === "1",
    sort: query.get("sort") ?? "",
    cursor: query.get("cursor") ?? null,
  };
}

/** The search address reproduces the results exactly. */
export function searchUrl(params: SearchParams): string {
  const q = new URLSearchParams();
  if (params.q) q.set("q", params.q);
  if (params.category) q.set("category", params.category);
  if (params.brand.length) q.set("brand", params.brand.join(","));
  if (params.seller.length) q.set("seller", params.seller.join(","));
  if (params.price_min) q.set("price_min", params.price_min);
  if (params.price_max) q.set("price_max", params.price_max);
  if (params.rating) q.set("rating", params.rating);
  if (params.pin) q.set("pin", params.pin);
  if (params.deliverable) q.set("deliverable", "1");
  if (params.sort) q.set("sort", params.sort);
  const qs = q.toString();
  return `/search${qs ? `?${qs}` : ""}`;
}

interface Hit {
  listing_id: string; product_id: string; title: string; brand: string; category: string;
  seller_id: string; seller_name: string; price_paise: number; rating: number;
  image_url: string; in_stock: boolean; delivers: boolean; promise_date: string | null;
}

interface SearchResponse {
  hits: Hit[];
  facets: { category: Record<string, number>; brand: Record<string, number>; seller: Record<string, number>; rating: Record<string, number> };
  total: number;
  next_cursor: string | null;
  degraded: boolean;
}

export async function renderSearch(query: URLSearchParams): Promise<HTMLElement> {
  const params = paramsFromQuery(query);
  if (!params.pin) params.pin = state.pincode;
  if (!params.sort) params.sort = params.q ? "relevance" : "newest";

  const main = el("main", {});
  const heading = el("h1", { text: params.q ? `results for ${params.q}` : "all products" });
  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Search results" });

  const layout = el("div", { class: "search-layout" });
  const resultsCol = el("div", {});
  const list = el("div", { class: "results-list", role: "list", "aria-label": "Products" });
  const degradedBanner = el("div", { class: "banner-degraded", role: "status", hidden: "true" });
  degradedBanner.textContent = "Search is running in basic mode. Typo matching and filters are off for now.";

  const sortBox = el("label", { class: "field", style: "display:inline-block;min-width:200px" });
  sortBox.append(el("span", { class: "label-text", text: "Sort by" }));
  const sortSelect = el("select", { "aria-label": "Sort by" });
  const sortOptions: Array<{ value: string; label: string }> = [
    { value: "relevance", label: "Relevance" },
    { value: "price_asc", label: "Price: low to high" },
    { value: "price_desc", label: "Price: high to low" },
    { value: "rating", label: "Rating" },
    { value: "newest", label: "Newest" },
  ];
  for (const opt of sortOptions) {
    const o = el("option", { value: opt.value, text: opt.label });
    if (opt.value === params.sort) o.selected = true;
    sortSelect.append(o);
  }
  sortSelect.addEventListener("change", () => {
    params.sort = sortSelect.value;
    void navigate(searchUrl(params), true);
    void runSearch();
  });
  sortBox.append(sortSelect);

  let hits: Hit[] = [];

  async function runSearch(append = false): Promise<void> {
    if (!append) clear(list);
    const query2 = new URLSearchParams();
    if (params.q) query2.set("q", params.q);
    if (params.category) query2.set("category", params.category);
    if (params.brand.length) query2.set("brand", params.brand.join(","));
    if (params.seller.length) query2.set("seller", params.seller.join(","));
    if (params.price_min) query2.set("price_min", params.price_min);
    if (params.price_max) query2.set("price_max", params.price_max);
    if (params.rating) query2.set("rating", params.rating);
    if (params.pin) query2.set("pin", params.pin);
    if (params.deliverable) query2.set("deliverable", "1");
    if (params.sort) query2.set("sort", params.sort);
    if (append && cursor) query2.set("cursor", cursor);
    try {
      const res = await get<SearchResponse>(`/api/search?${query2.toString()}`);
      degradedBanner.hidden = !res.degraded;
      hits = append ? [...hits, ...res.hits] : res.hits;
      cursor = res.next_cursor;
      const firstNew = res.hits.length > 0 && append ? list.children.length : 0;
      for (const hit of res.hits) {
        list.append(hitCard(hit));
      }
      loadMoreBtn.hidden = res.next_cursor === null;
      loadMoreBtn.textContent = "Load more";
      statusRegion.textContent = res.total === 1 ? "1 result" : `${res.total} results`;
      if (append && res.hits.length > 0) {
        const added = list.children[firstNew] as HTMLElement | undefined;
        const focusTarget = added?.querySelector<HTMLElement>("a") ?? added;
        focusTarget?.focus();
      }
      if (res.hits.length === 0 && !append) {
        const empty = el("div", { class: "panel-pink", role: "region" });
        empty.append(el("p", { text: "no match. loosen a filter." }));
        list.append(empty);
      }
    } catch {
      degradedBanner.hidden = false;
    }
  }

  let cursor: string | null = params.cursor;
  const loadMoreBtn = el("button", { class: "btn btn-yellow", text: "Load more", hidden: "true" });
  loadMoreBtn.addEventListener("click", () => {
    void busy(loadMoreBtn, async () => { await runSearch(true); });
  });

  resultsCol.append(sortBox, degradedBanner, list, loadMoreBtn);

  // filters rail (also the phone sheet's content)
  const filters = buildFilters(params, () => {
    void navigate(searchUrl(params), true);
    void runSearch();
  });

  // phone: Filters button opens a full-width sheet
  const filtersBtn = el("button", { class: "btn btn-yellow", text: "Filters" });
  filtersBtn.addEventListener("click", () => {
    const dlg = el("dialog", { "aria-label": "Filters", class: "filters-sheet" });
    dlg.style.maxWidth = "100vw";
    dlg.style.width = "100vw";
    dlg.style.borderRadius = "0";
    dlg.style.height = "100vh";
    dlg.append(filters.cloneNode(true));
    document.body.append(dlg);
    dlg.showModal();
    const close = el("button", { class: "btn btn-primary", text: "Show results" });
    close.addEventListener("click", () => { dlg.close(); dlg.remove(); });
    dlg.append(close);
  });

  layout.append(filters, resultsCol);
  main.append(heading, statusRegion, filtersBtn, layout);
  void runSearch();
  void esc;
  return main;
}

type Rerun = () => void;

function buildFilters(params: SearchParams, rerun: Rerun): HTMLElement {
  const form = el("form", { class: "filters-rail", role: "complementary", "aria-label": "Filters" });
  const legend = el("h2", { text: "filters" });
  form.append(legend);

  const groupCat = el("fieldset", {});
  groupCat.append(el("legend", { text: "category" }));
  const groupBrand = el("fieldset", {});
  groupBrand.append(el("legend", { text: "brand" }));
  const groupSeller = el("fieldset", {});
  groupSeller.append(el("legend", { text: "seller" }));

  const priceGroup = el("fieldset", {});
  priceGroup.append(el("legend", { text: "price" }));
  const minPrice = el("input", { type: "number", "aria-label": "Minimum price", min: "0", step: "1", placeholder: "min", value: params.price_min });
  const maxPrice = el("input", { type: "number", "aria-label": "Maximum price", min: "0", step: "1", placeholder: "max", value: params.price_max });
  priceGroup.append(minPrice, maxPrice);
  let priceTimer = 0;
  const queuePrice = () => {
    window.clearTimeout(priceTimer);
    priceTimer = window.setTimeout(() => {
      params.price_min = minPrice.value;
      params.price_max = maxPrice.value;
      rerun();
    }, 300);
  };
  minPrice.addEventListener("input", queuePrice);
  maxPrice.addEventListener("input", queuePrice);

  const ratingGroup = el("fieldset", {});
  ratingGroup.append(el("legend", { text: "rating" }));
  const ratingRadios: HTMLInputElement[] = [];
  for (const option of [{ value: "", label: "Any" }, { value: "4", label: "4 stars & up" }, { value: "3", label: "3 stars & up" }]) {
    const label = el("label", { style: "display:flex;align-items:center;gap:10px" });
    const radio = el("input", { type: "radio", name: "rating", value: option.value });
    radio.checked = params.rating === option.value;
    label.append(radio, el("span", { text: option.label }));
    radio.addEventListener("change", () => {
      params.rating = radio.value;
      rerun();
    });
    ratingRadios.push(radio);
    ratingGroup.append(label);
  }
  void ratingRadios;

  const deliversWrap = el("fieldset", {});
  deliversWrap.append(el("legend", { text: "delivery" }));
  const deliversLabel = el("label", { style: "display:flex;align-items:center;gap:10px" });
  const deliversCheck = el("input", { type: "checkbox" });
  deliversCheck.checked = params.deliverable;
  deliversLabel.append(deliversCheck, el("span", { text: `Only items that deliver to ${params.pin || "your pincode"}` }));
  deliversCheck.addEventListener("change", () => {
    params.deliverable = deliversCheck.checked;
    rerun();
  });
  deliversWrap.append(deliversLabel);

  const pinGroup = el("fieldset", {});
  pinGroup.append(el("legend", { text: "pincode" }));
  const pinInput = el("input", { type: "text", "aria-label": "Pincode", value: params.pin, inputmode: "numeric", maxlength: "6" });
  pinInput.addEventListener("change", () => {
    params.pin = pinInput.value.trim();
    state.pincode = params.pin;
    rerun();
  });
  pinGroup.append(pinInput);

  const clearBtn = el("button", { class: "btn btn-ghost", type: "button", text: "Clear filters" });
  clearBtn.addEventListener("click", () => {
    params.category = "";
    params.brand = [];
    params.seller = [];
    params.price_min = "";
    params.price_max = "";
    params.rating = "";
    params.deliverable = false;
    rerun();
  });

  form.append(groupCat, groupBrand, groupSeller, priceGroup, ratingGroup, pinGroup, deliversWrap, clearBtn);
  return form;
}

export function hitCard(hit: Hit): HTMLElement {
  const card = el("article", { class: "product-card", role: "listitem" });
  card.setAttribute("aria-label", hit.title);
  const link = el("a", { href: `/p/${hit.product_id}`, "aria-label": hit.title });
  const img = el("img", { src: hit.image_url, alt: hit.title, loading: "lazy" });
  const title = el("h3", { text: hit.title });
  const brand = el("p", { text: `${hit.brand} · ${hit.category}` });
  const price = el("p", { class: "price", text: amount(hit.price_paise) });
  const seller = el("p", { text: `sold by ${hit.seller_name}` });
  link.append(img, title, brand, price, seller);
  const meta = el("p", {});
  if (hit.in_stock) {
    if (hit.delivers) {
      meta.append(el("span", { class: "promise-chip", text: `arrives by ${dateLabel(hit.promise_date ?? "")}` }));
    } else {
      meta.append(el("span", { class: "no-delivery", text: `We don't deliver to ${state.pincode} yet.` }));
    }
  } else {
    meta.append(el("span", { class: "no-delivery", text: "sold out" }));
  }

  const compareLabel = el("label", { style: "display:flex;align-items:center;gap:10px;margin-top:10px" });
  const compareCheck = el("input", { type: "checkbox", "aria-label": `Compare ${hit.title}` });
  compareCheck.checked = state.compare.includes(hit.product_id);
  compareCheck.addEventListener("change", () => {
    if (compareCheck.checked) {
      if (state.compare.length >= 4) {
        compareCheck.checked = false;
        announce("Compare up to 4 products.");
        return;
      }
      if (!state.compare.includes(hit.product_id)) state.compare.push(hit.product_id);
    } else {
      state.compare = state.compare.filter((id) => id !== hit.product_id);
    }
    saveCompare();
    updateCompareLink();
  });
  compareLabel.append(compareCheck, el("span", { text: "compare" }));
  card.append(link, meta, compareLabel);
  return card;
}

function updateCompareLink(): void {
  const link = document.querySelector<HTMLAnchorElement>("a[aria-label^='Compare (']");
  if (link) {
    link.textContent = `Compare (${state.compare.length})`;
    link.setAttribute("href", `/compare?ids=${state.compare.join(",")}&diff=0`);
    link.style.display = state.compare.length >= 2 ? "" : "none";
  }
}
