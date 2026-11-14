import { moveFocus } from "../focus.js";
import type { MountedPage, PageContext } from "../router.js";
import { toggleDisclosure } from "./services.js";
import { parsePriceQuery, priceQuery } from "../../shared/routes.js";
import { matchPrices, priceCounts, type PriceFilter } from "../../shared/rules.js";

export function mountPricing({ bootstrap, main, url }: PageContext): MountedPage {
  const { content } = bootstrap;
  let filter: PriceFilter = parsePriceQuery(url.searchParams, content);
  const status = main.querySelector<HTMLElement>(".price-status");
  const empty = main.querySelector<HTMLElement>(".price-empty");
  if (status === null || empty === null) throw new Error("Price list markup missing");

  const radios = (name: string): HTMLInputElement[] => [...main.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];

  const apply = (): void => {
    const counts = priceCounts(content, filter);
    for (const radio of radios("category")) {
      const count = radio.value === "" ? counts.allCategories : counts.categories[radio.value];
      const label = radio.closest("label")?.querySelector(".num");
      if (label) label.textContent = `(${count})`;
      radio.checked = radio.value === (filter.category ?? "");
    }
    for (const radio of radios("type")) {
      const count = radio.value === "fixed" || radio.value === "custom" ? counts.types[radio.value] : counts.allTypes;
      const label = radio.closest("label")?.querySelector(".num");
      if (label) label.textContent = `(${count})`;
      radio.checked = radio.value === (filter.type ?? "");
    }
    const matching = new Set(matchPrices(content, filter).map((i) => i.id));
    for (const item of main.querySelectorAll<HTMLElement>(".price-item")) item.hidden = !matching.has(item.dataset.item ?? "");
    empty.hidden = matching.size > 0;
    status.textContent =
      matching.size === 0 ? "No items match these filters." : `Showing ${matching.size} of ${content.prices.length} items`;
    history.replaceState(null, "", priceQuery(filter));
  };

  const listeners = new AbortController();
  main.addEventListener(
    "change",
    (event) => {
      const radio = event.target;
      if (!(radio instanceof HTMLInputElement) || radio.type !== "radio") return;
      if (radio.name === "category") filter = { ...filter, category: radio.value === "" ? null : radio.value };
      else filter = { ...filter, type: radio.value === "fixed" || radio.value === "custom" ? radio.value : null };
      apply();
    },
    { signal: listeners.signal },
  );
  main.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>("button");
      if (button === null) return;
      if (button.classList.contains("show-all-items")) {
        filter = { category: null, type: null };
        apply();
        moveFocus(radios("category")[0]);
      } else if (button.classList.contains("disclosure")) toggleDisclosure(button);
    },
    { signal: listeners.signal },
  );
  return { unmount: () => listeners.abort() };
}
