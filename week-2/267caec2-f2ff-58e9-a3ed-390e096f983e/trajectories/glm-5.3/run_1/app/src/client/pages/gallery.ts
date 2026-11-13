import { get } from "../api.js";
import { h, marker, deskError, deskErrorFrom } from "../ui.js";
import { setBand } from "../band.js";

interface GalleryItem {
  entryNumber: number;
  title: string;
  studioName: string;
  programName: string;
  year: number;
  category: string;
  award: "winner" | "finalist" | "honourable_mention";
  score: string;
  images: string[];
}

export async function renderGallery(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Gallery", countdownIso: null });
  main.textContent = "";
  main.append(h("h1", { class: "page-title", text: "Gallery" }));

  const years = new Set<string>(["All"]);
  const categories = new Set<string>(["All"]);
  const items = await loadItems();
  for (const item of items) {
    years.add(String(item.year));
    categories.add(item.category);
  }

  const yearSelect = h("select", { id: "gallery-year" }) as HTMLSelectElement;
  const categorySelect = h("select", { id: "gallery-category" }) as HTMLSelectElement;
  const awardSelect = h("select", { id: "gallery-award" }) as HTMLSelectElement;
  yearSelect.append(h("option", { value: "All", text: "All" }));
  for (const year of [...years].filter((y) => y !== "All").sort((a, b) => Number(b) - Number(a))) {
    yearSelect.append(h("option", { value: year, text: year }));
  }
  categorySelect.append(h("option", { value: "All", text: "All" }));
  for (const category of [...categories].filter((c) => c !== "All").sort()) {
    categorySelect.append(h("option", { value: category, text: category }));
  }
  for (const award of ["All", "Winner", "Finalist", "Honourable mention"]) {
    awardSelect.append(h("option", { value: award, text: award }));
  }
  const awardValues: Record<string, string> = { Winner: "winner", Finalist: "finalist", "Honourable mention": "honourable_mention" };

  const list = h("ul", { class: "gallery-grid", "aria-label": "Winners" });
  main.append(
    h("div", { class: "filters" },
      h("div", { class: "field" }, h("label", { for: "gallery-year", text: "Year" }), yearSelect),
      h("div", { class: "field" }, h("label", { for: "gallery-category", text: "Category" }), categorySelect),
      h("div", { class: "field" }, h("label", { for: "gallery-award", text: "Award level" }), awardSelect),
    ),
    list,
  );

  const refresh = async () => {
    const params = new URLSearchParams();
    if (yearSelect.value !== "All") {
      params.set("year", yearSelect.value);
    }
    if (categorySelect.value !== "All") {
      params.set("category", categorySelect.value);
    }
    if (awardSelect.value !== "All") {
      params.set("award", awardValues[awardSelect.value]);
    }
    const items = await loadItems(params.toString());
    list.textContent = "";
    if (items.length === 0) {
      list.append(h("li", { text: "No winners match those filters yet." }));
      return;
    }
    for (const item of items) {
      const image = item.images[0] ? h("img", { src: item.images[0], alt: `${item.title} by ${item.studioName}` }) : h("span", { text: "" });
      const awardMarker = marker(item.award === "winner" ? "winner" : item.award === "finalist" ? "finalist" : "mention", item.award === "winner" ? "Winner" : item.award === "finalist" ? "Finalist" : "Honourable mention");
      const score = h("span", { class: "mono", text: item.score });
      list.append(h("li", {},
        h("article", { class: "gallery-card" },
          image,
          h("h3", { text: item.title }),
          h("p", { class: "card-meta", text: `${item.studioName} — ${item.year} · ${item.category}` }),
          h("p", { class: "card-meta" }, awardMarker, " ", score),
        ),
      ));
    }
  };
  for (const select of [yearSelect, categorySelect, awardSelect]) {
    select.addEventListener("change", () => {
      void refresh().catch((error) => deskError(deskErrorFrom(error)));
    });
  }
  await refresh();
}

async function loadItems(query = ""): Promise<GalleryItem[]> {
  const result = await get<{ items: GalleryItem[] }>(`/api/public/gallery${query ? `?${query}` : ""}`);
  return result.items;
}
