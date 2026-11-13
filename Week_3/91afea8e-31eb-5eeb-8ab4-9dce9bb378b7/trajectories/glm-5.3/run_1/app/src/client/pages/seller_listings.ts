import { el, busy } from "../ui.ts";
import { get, post, patch, del, ApiFailure } from "../api.ts";
import { amount } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

interface Listing {
  listing_id: string; product_id: string; title: string; category: string;
  price_paise: number; cost_price_paise: number; stock: number; status: string;
  photo_count: number; cod_allowed: boolean; no_cost_emi: boolean;
}

export async function renderSellerListings(): Promise<HTMLElement> {
  const main = el("main", {});
  guardSeller();
  main.append(el("h1", { text: "my listings" }));
  const newLink = el("a", { class: "btn btn-primary", href: "/seller/listings/new", text: "New listing" });
  main.append(newLink);

  const searchLabel = el("label", { class: "field", style: "max-width:360px" });
  searchLabel.append(el("span", { class: "label-text", text: "Search my listings" }));
  const searchInput = el("input", { type: "search" });
  searchLabel.append(searchInput);
  main.append(searchLabel);

  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Save status" });
  const wrap = el("div", { class: "table-wrap" });
  const table = el("table", { "aria-label": "Listings" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  for (const h of ["Title", "Category", "Price", "Stock", "Status", "Photos", ""]) headRow.append(el("th", { text: h }));
  thead.append(headRow);
  const tbody = el("tbody", {});

  const load = async (q: string) => {
    tbody.textContent = "";
    const res = await get<{ listings: Listing[]; facets: { category: Record<string, number> }; next_cursor: string | null }>(`/api/seller/listings?limit=24${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    for (const listing of res.listings) {
      const row = el("tr", {});
      row.append(
        el("td", { text: listing.title }),
        el("td", { text: listing.category }),
        el("td", { text: amount(listing.price_paise) }),
        el("td", { text: String(listing.stock) }),
        el("td", { text: listing.status }),
        el("td", { text: String(listing.photo_count) }),
      );
      const edit = el("a", { class: "btn btn-ghost", href: `/seller/listings/${listing.listing_id}`, text: "Edit" });
      row.append(el("td", {}, edit));
      tbody.append(row);
    }
  };
  let timer = 0;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(searchInput.value.trim()), 300);
  });
  await load("");
  table.append(thead, tbody);
  wrap.append(table);
  main.append(statusRegion, wrap);
  return main;
}

function guardSeller(): void {
  if (!state.account || state.account.role !== "seller") void navigate(signinLink());
}

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const RETURN_NOTE_MAX = 500;

export async function renderSellerListingForm(): Promise<HTMLElement> {
  return listingForm(null);
}

export async function renderSellerListingEdit(listingId: string): Promise<HTMLElement> {
  return listingForm(listingId);
}

async function listingForm(listingId: string | null): Promise<HTMLElement> {
  const main = el("main", {});
  guardSeller();
  main.append(el("h1", { text: listingId ? "edit listing" : "new listing" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Save status" });
  const error = el("p", { class: "field-error", role: "alert" });

  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  const mkText = (label: string, key: string, max: number, initial = "") => {
    const wrap = el("label", { class: "field" });
    wrap.append(el("span", { class: "label-text", text: label }));
    const input = el("input", { type: "text", maxlength: String(max), value: initial });
    const counter = el("span", { class: "counter", text: `${[...initial].length}/${max}` });
    input.addEventListener("input", () => { counter.textContent = `${[...input.value].length}/${max}`; });
    wrap.append(input, counter);
    inputs[key] = input;
    return wrap;
  };
  const mkArea = (label: string, key: string, max: number) => {
    const wrap = el("label", { class: "field" });
    wrap.append(el("span", { class: "label-text", text: label }));
    const area = el("textarea", { rows: "4", maxlength: String(max) });
    const counter = el("span", { class: "counter", text: `0/${max}` });
    area.addEventListener("input", () => { counter.textContent = `${[...area.value].length}/${max}`; });
    wrap.append(area, counter);
    inputs[key] = area;
    return wrap;
  };

  const form = el("form", {});
  form.append(
    mkText("Title", "title", TITLE_MAX),
    mkArea("Description", "description", DESCRIPTION_MAX),
    mkArea("Return note", "return_note", RETURN_NOTE_MAX),
  );

  const priceLabel = el("label", { class: "field", style: "display:inline-block;width:30%" });
  priceLabel.append(el("span", { class: "label-text", text: "Price (₹)" }));
  const priceInput = el("input", { type: "number", min: "0", step: "1", value: "0" });
  priceLabel.append(priceInput);
  const costLabel = el("label", { class: "field", style: "display:inline-block;width:30%" });
  costLabel.append(el("span", { class: "label-text", text: "Cost price (₹)" }));
  const costInput = el("input", { type: "number", min: "0", step: "1", value: "0" });
  costLabel.append(costInput);
  const stockLabel = el("label", { class: "field", style: "display:inline-block;width:30%" });
  stockLabel.append(el("span", { class: "label-text", text: "Stock" }));
  const stockInput = el("input", { type: "number", min: "0", max: "9999", step: "1", value: "0" });
  stockLabel.append(stockInput);
  form.append(priceLabel, costLabel, stockLabel);

  const codCheck = el("input", { type: "checkbox" });
  const codLabel = el("label", { style: "display:flex;gap:10px;align-items:center" });
  codLabel.append(codCheck, el("span", { text: "Cash on delivery" }));
  const emiCheck = el("input", { type: "checkbox" });
  const emiLabel = el("label", { style: "display:flex;gap:10px;align-items:center" });
  emiLabel.append(emiCheck, el("span", { text: "No-cost EMI" }));
  form.append(codLabel, emiLabel);

  const photosLabel = el("label", { class: "field" });
  photosLabel.append(el("span", { class: "label-text", text: "Listing photos" }));
  const photosInput = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: "true" });
  photosLabel.append(photosInput);
  form.append(photosLabel);

  const saveBtn = el("button", { class: "btn btn-primary", type: "submit", text: "Save listing" });
  form.append(saveBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void busy(saveBtn, async () => {
      error.textContent = "";
      const body = {
        title: (inputs.title as HTMLInputElement).value,
        description: (inputs.description as HTMLTextAreaElement).value,
        return_note: (inputs.return_note as HTMLTextAreaElement).value,
        price_paise: Math.round(Number(priceInput.value) * 100),
        cost_price_paise: Math.round(Number(costInput.value) * 100),
        stock: Number(stockInput.value),
        cod_allowed: codCheck.checked,
        no_cost_emi: emiCheck.checked,
      };
      try {
        if (listingId) {
          await patch(`/api/seller/listings/${listingId}`, body);
        } else {
          await post("/api/seller/listings", { ...body, brand: "house brand", category: "kitchen" });
        }
        status.textContent = "Listing saved.";
        if (!listingId) void navigate("/seller/listings", true);
      } catch (err) {
        if (err instanceof ApiFailure) {
          status.textContent = `Not saved: ${err.message}`;
          const fieldMsg = Object.values(err.fields)[0];
          if (fieldMsg) error.textContent = fieldMsg;
        }
      }
    });
  });

  // photo uploads
  photosInput.addEventListener("change", () => {
    const files = Array.from(photosInput.files ?? []);
    for (const file of files) {
      void (async () => {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(listingId ? `/api/seller/listings/${listingId}/photos` : "/api/seller/gst-certificate", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
        });
        const body = await res.json();
        if (!res.ok) {
          status.textContent = `Not saved: ${body.message}`;
        } else {
          status.textContent = "Listing saved.";
        }
      })();
    }
  });

  main.append(form, error, status);
  return main;
}
