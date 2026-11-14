import { moveFocus } from "../focus.js";
import type { MountedPage, PageContext } from "../router.js";
import { renderTiles, renderWorkResults } from "../../shared/render.js";
import { galleryQuery, parseGalleryQuery, type GalleryState } from "../../shared/routes.js";
import { galleryCounts, matchProjects } from "../../shared/rules.js";

export const GALLERY_ADDRESS_KEY = "vellum-orbit:gallery";

function resultsLine(count: number): string {
  if (count === 0) return "No projects match these filters.";
  return count === 1 ? "1 project matches" : `${count} projects match`;
}

export function mountWork({ bootstrap, main, url }: PageContext): MountedPage {
  const { content, settings } = bootstrap;
  const pageSize = settings.workPageSize;
  let state: GalleryState = parseGalleryQuery(url.searchParams, content);
  const controls = main.querySelector<HTMLElement>(".work-controls");
  const results = main.querySelector<HTMLElement>(".work-results");
  const status = main.querySelector<HTMLElement>(".results-status");
  const select = main.querySelector<HTMLSelectElement>("#f-industry");
  if (controls === null || results === null || status === null || select === null) throw new Error("Gallery markup missing");

  const remember = (): void => {
    const address = galleryQuery(state);
    history.replaceState(null, "", address);
    sessionStorage.setItem(GALLERY_ADDRESS_KEY, address);
  };

  const firstFilterButton = (): HTMLElement | null => controls.querySelector<HTMLElement>("[data-service]");

  const syncControls = (): void => {
    const counts = galleryCounts(content, state);
    for (const button of controls.querySelectorAll<HTMLButtonElement>("[data-service]")) {
      const id = button.dataset.service ?? "";
      button.setAttribute("aria-pressed", String(state.services.includes(id)));
      const count = button.querySelector(".num");
      if (count !== null) count.textContent = `(${counts.services[id]})`;
    }
    for (const option of select.options) {
      const industry = content.industries.find((i) => i.id === option.value);
      option.textContent =
        industry === undefined ? `All industries (${counts.allIndustries})` : `${industry.name} (${counts.industries[industry.id]})`;
    }
    select.value = state.industry ?? "";
    const active = state.services.length > 0 || state.industry !== null;
    const clear = controls.querySelector(".clear-filters");
    if (active && clear === null) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button quiet clear-filters";
      button.textContent = "Clear filters";
      controls.querySelector(".filter-row")?.append(button);
    } else if (!active) clear?.remove();
  };

  const applyFilter = (next: Pick<GalleryState, "services" | "industry">): void => {
    state = { ...next, pages: 1 };
    syncControls();
    results.innerHTML = renderWorkResults(content, state, pageSize);
    status.textContent = resultsLine(matchProjects(content, state).length);
    remember();
  };

  const showMore = (): void => {
    const matches = matchProjects(content, state);
    const shown = state.pages * pageSize;
    state = { ...state, pages: state.pages + 1 };
    const list = results.querySelector(".tiles");
    list?.insertAdjacentHTML("beforeend", renderTiles(content, matches.slice(shown, shown + pageSize), shown));
    const more = results.querySelector(".work-more");
    const visible = Math.min(matches.length, state.pages * pageSize);
    if (more !== null) {
      more.innerHTML = `<p class="num showing">Showing ${visible} of ${matches.length}</p>${
        visible < matches.length ? `<button type="button" class="button show-more">Show more work</button>` : ""
      }`;
    }
    remember();
    moveFocus(list?.children[shown]?.querySelector<HTMLElement>("a") ?? null);
  };

  const clearAll = (): void => {
    applyFilter({ services: [], industry: null });
    moveFocus(firstFilterButton());
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  main.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (button === null) return;
      const service = button.dataset.service;
      if (service !== undefined) {
        const chosen = state.services.includes(service)
          ? state.services.filter((s) => s !== service)
          : [...state.services, service];
        applyFilter({
          services: content.services.map((s) => s.id).filter((id) => chosen.includes(id)),
          industry: state.industry,
        });
      } else if (button.classList.contains("clear-filters") || button.classList.contains("show-all-projects")) clearAll();
      else if (button.classList.contains("show-more")) showMore();
    },
    { signal },
  );
  select.addEventListener("change", () => applyFilter({ services: state.services, industry: select.value === "" ? null : select.value }), {
    signal,
  });
  remember();
  return { unmount: () => listeners.abort() };
}
