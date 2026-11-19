/**
 * Discipline filtering, card reveal, the quick-look dialog and the gallery
 * return. The pressed list lives in the `category` parameter in canonical
 * order; every change replaces the current history entry.
 */
import {
  ANNOUNCEMENTS,
  DISCIPLINES,
  PROJECTS,
  filterResultsText,
  formatCategory,
  frameKey,
  parseCategory,
  projectShows,
} from "../shared/domain.js";
import { announce, prefersReducedMotion, qs, qsa, viewportUnder768 } from "./core.js";

type QuickLookState = {
  open: boolean;
  slug: string;
  frame: number;
  opener: HTMLButtonElement | null;
};

let quickLook: QuickLookState = { open: false, slug: "", frame: 1, opener: null };

export function initGallery(): void {
  if (!document.body.classList.contains("page-home")) return;
  const pressed = new Set<string>(parseCategory(new URL(window.location.href).searchParams.get("category")));
  applyFilter(pressed, { announceChange: false, replaceHistory: false, canonicalise: true });
  initFilterButtons();
  initCards();
  initQuickLook();
  initEnquireLinks();
  initGalleryReturn();
  window.addEventListener("popstate", () => {
    const list = parseCategory(new URL(window.location.href).searchParams.get("category"));
    applyFilter(new Set(list), { announceChange: false, replaceHistory: false, canonicalise: false });
  });
}

/**
 * The gallery return: arriving on the home page from a case study restores the
 * filters and focuses that project's card link, clear of the header, with no
 * announcement. It takes precedence over the hash and history rules.
 */
function initGalleryReturn(): void {
  const returningTo = sessionStorage.getItem("quillfern-return");
  if (!returningTo) return;
  sessionStorage.removeItem("quillfern-return");
  const card = qs<HTMLElement>(`[data-project='${returningTo}']`);
  if (!card || card.hidden) return;
  const link = qs<HTMLAnchorElement>("[data-card-link]", card);
  if (!link) return;
  link.setAttribute("tabindex", "-1");
  const place = (): void => {
    link.focus({ preventScroll: true });
    const top = card.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: "auto" });
  };
  place();
  // the browser can drop a focus set during load, so settle it once more
  window.setTimeout(place, 50);
}

function initFilterButtons(): void {
  const all = qs<HTMLButtonElement>("[data-filter-all]");
  all?.addEventListener("click", () => {
    applyFilter(new Set(), { announceChange: true, replaceHistory: true, canonicalise: false });
  });
  for (const button of qsa<HTMLButtonElement>("[data-filter-value]")) {
    button.addEventListener("click", () => {
      const value = button.dataset.filterValue ?? "";
      const url = new URL(window.location.href);
      const current = new Set(parseCategory(url.searchParams.get("category")));
      if (current.has(value)) current.delete(value);
      else current.add(value);
      applyFilter(current, { announceChange: true, replaceHistory: true, canonicalise: false });
    });
  }
}

type FilterOptions = {
  announceChange: boolean;
  replaceHistory: boolean;
  canonicalise: boolean;
};

/** Offset grid: at 1024 px and wider the middle column of shown cards sits 64 px lower. */
function applyGalleryOffsets(): void {
  if (window.innerWidth < 1024) return;
  let position = 0;
  for (const card of qsa<HTMLElement>("[data-project]")) {
    if (card.hidden) continue;
    position += 1;
    if (position % 3 === 2) card.dataset.offset = "middle";
  }
}

function applyFilter(pressed: Set<string>, options: FilterOptions): void {
  const list = DISCIPLINES.filter((d) => pressed.has(d.value)).map((d) => d.value);
  for (const button of qsa<HTMLButtonElement>("[data-filter-value]")) {
    const value = button.dataset.filterValue ?? "";
    button.setAttribute("aria-pressed", list.includes(value) ? "true" : "false");
  }
  const all = qs<HTMLButtonElement>("[data-filter-all]");
  all?.setAttribute("aria-pressed", list.length === 0 ? "true" : "false");

  let shown = 0;
  for (const card of qsa<HTMLElement>("[data-project]")) {
    const categories = (card.dataset.categories ?? "").split(" ");
    const visible = projectShows(categories, list);
    card.hidden = !visible;
    card.removeAttribute("data-offset");
    if (visible) {
      shown += 1;
      if (!prefersReducedMotion()) {
        card.dataset.faded = "false";
        requestAnimationFrame(() => {
          card.dataset.faded = "true";
        });
        window.setTimeout(() => card.removeAttribute("data-faded"), 300);
      }
    }
  }
  applyGalleryOffsets();

  const results = qs<HTMLElement>("[data-results]");
  const text = filterResultsText(shown);
  if (results) results.textContent = text;
  if (options.announceChange) announce(ANNOUNCEMENTS.filter(shown));

  const url = new URL(window.location.href);
  const canonical = list.length > 0 ? formatCategory(list) : null;
  if (canonical) url.searchParams.set("category", canonical);
  else url.searchParams.delete("category");
  if (options.canonicalise || options.replaceHistory) {
    window.history.replaceState({}, "", url);
  }

  const query = canonical ? `?category=${canonical}` : "";
  for (const card of qsa<HTMLElement>("[data-project]")) {
    const slug = card.dataset.project ?? "";
    const link = qs<HTMLAnchorElement>("[data-card-link]", card);
    if (link) link.setAttribute("href", `/work/${slug}${query}`);
    const open = qs<HTMLAnchorElement>("[data-quick-look-open]");
    if (open && quickLook.slug === slug) open.setAttribute("href", `/work/${slug}${query}`);
  }
}

function initCards(): void {
  for (const card of qsa<HTMLElement>("[data-project]")) {
    card.addEventListener("pointerenter", () => {
      if (viewportUnder768()) return;
      card.dataset.revealed = "true";
    });
    card.addEventListener("pointerleave", () => {
      if (viewportUnder768()) return;
      card.dataset.revealed = "false";
    });
    card.addEventListener("focusin", () => {
      card.dataset.revealed = "true";
    });
    card.addEventListener("focusout", () => {
      if (card.contains(document.activeElement)) return;
      card.dataset.revealed = "false";
    });
  }
  const sync = (): void => {
    if (viewportUnder768()) {
      for (const card of qsa<HTMLElement>("[data-project]")) card.dataset.revealed = "true";
    }
  };
  sync();
  window.addEventListener("resize", () => {
    sync();
    for (const card of qsa<HTMLElement>("[data-project]")) card.removeAttribute("data-offset");
    applyGalleryOffsets();
  });
}

function initQuickLook(): void {
  const dialog = qs<HTMLElement>("[data-quick-look]");
  const backdrop = qs<HTMLElement>("[data-preview-backdrop]");
  if (!dialog || !backdrop) return;
  const frameSlot = qs<HTMLElement>("[data-quick-look-frame-slot]", dialog);
  const status = qs<HTMLElement>("[data-quick-look-status]", dialog);
  const title = qs<HTMLElement>("[data-quick-look-title]", dialog);
  const prev = qs<HTMLButtonElement>("[data-frame-prev]", dialog);
  const next = qs<HTMLButtonElement>("[data-frame-next]", dialog);
  const close = qs<HTMLButtonElement>("[data-quick-look-close]", dialog);
  const openLink = qs<HTMLAnchorElement>("[data-quick-look-open]", dialog);
  if (!frameSlot || !status || !title || !prev || !next || !close || !openLink) return;

  const project = (slug: string) => PROJECTS.find((candidate) => candidate.slug === slug);

  const renderFrame = (): void => {
    const current = project(quickLook.slug);
    if (!current || !frameSlot) return;
    frameSlot.dataset.frame = String(quickLook.frame);
    const key = frameKey(quickLook.slug, quickLook.frame);
    frameSlot.dataset.mediaSlot = key;
    frameSlot.dataset.mediaName = `${current.title}, frame ${quickLook.frame} of 6`;
    frameSlot.dataset.mediaKind = "frame";
    let img = frameSlot.querySelector<HTMLImageElement>("img");
    if (!img) {
      img = document.createElement("img");
      img.setAttribute("data-media-img", "");
      frameSlot.appendChild(img);
    }
    img.alt = `${current.title}, frame ${quickLook.frame} of 6`;
    if (!prefersReducedMotion()) {
      img.dataset.crossfade = "true";
      window.setTimeout(() => img?.removeAttribute("data-crossfade"), 220);
    }
    img.dataset.state = "loading";
    // the media module wires the slot's error rules before the request starts
    document.dispatchEvent(new CustomEvent("quicklook-frame"));
    img.src = `/media/${key}`;
    status.textContent = `Frame ${quickLook.frame} of 6`;
    prev.disabled = quickLook.frame === 1;
    next.disabled = quickLook.frame === 6;
    if (document.activeElement === prev && prev.disabled) next.focus({ preventScroll: true });
    if (document.activeElement === next && next.disabled) prev.focus({ preventScroll: true });
  };

  const openDialog = (slug: string, opener: HTMLButtonElement): void => {
    quickLook = { open: true, slug, frame: 1, opener };
    const current = project(slug);
    if (!current) return;
    title.textContent = `${current.title} preview`;
    const url = new URL(window.location.href);
    const category = url.searchParams.get("category");
    openLink.setAttribute(
      "href",
      category ? `/work/${slug}?category=${category}` : `/work/${slug}`
    );
    dialog.hidden = false;
    backdrop.hidden = false;
    renderFrame();
    next.focus({ preventScroll: true });
  };

  const closeDialog = (): void => {
    if (!quickLook.open) return;
    quickLook.open = false;
    dialog.hidden = true;
    backdrop.hidden = true;
    const opener = quickLook.opener;
    quickLook = { open: false, slug: "", frame: 1, opener: null };
    if (frameSlot) {
      const img = frameSlot.querySelector("img");
      img?.removeAttribute("src");
      frameSlot.querySelector(".fallback-plate")?.remove();
    }
    if (opener) opener.focus({ preventScroll: true });
  };

  for (const button of qsa<HTMLButtonElement>("[data-preview-open]")) {
    button.addEventListener("click", () => {
      openDialog(button.dataset.slug ?? "", button);
    });
  }

  prev.addEventListener("click", () => {
    if (quickLook.frame > 1) {
      quickLook.frame -= 1;
      renderFrame();
    }
  });
  next.addEventListener("click", () => {
    if (quickLook.frame < 6) {
      quickLook.frame += 1;
      renderFrame();
    }
  });
  close.addEventListener("click", closeDialog);
  backdrop.addEventListener("click", closeDialog);

  window.addEventListener("keydown", (event) => {
    if (!quickLook.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (quickLook.frame < 6) {
        quickLook.frame += 1;
        renderFrame();
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (quickLook.frame > 1) {
        quickLook.frame -= 1;
        renderFrame();
      }
      return;
    }
    if (event.key === "Tab") {
      const focusables = qsa<HTMLElement>("a[href], button:not([disabled])", dialog);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

/** Enquire links jump to the form, prefill the project type and keep every typed value. */
function initEnquireLinks(): void {
  const select = qs<HTMLSelectElement>("#enquiry-project-type");
  const nameField = qs<HTMLInputElement>("#enquiry-name");
  if (!select || !nameField) return;
  for (const link of qsa<HTMLAnchorElement>("[data-enquire-link]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const value = link.dataset.serviceValue ?? "";
      const url = new URL(window.location.href);
      url.searchParams.delete("category");
      if (value) url.searchParams.set("service", value);
      else url.searchParams.delete("service");
      url.hash = "contact";
      window.history.pushState({}, "", url);
      select.value = value;
      const heading = document.getElementById("contact");
      if (heading) {
        const top = heading.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({
          top,
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }
      nameField.focus({ preventScroll: true });
      const serviceName = select.options[select.selectedIndex]?.textContent ?? "";
      announce(ANNOUNCEMENTS.enquire(serviceName));
    });
  }

  const params = new URL(window.location.href).searchParams;
  const service = params.get("service");
  if (service && select.querySelector(`option[value="${service}"]`)) {
    select.value = service;
    // a focus set during load can be dropped by the browser, so settle it
    const settle = (): void => nameField.focus({ preventScroll: true });
    settle();
    window.setTimeout(settle, 50);
    window.setTimeout(settle, 150);
  } else if (service) {
    const url = new URL(window.location.href);
    url.searchParams.delete("service");
    window.history.replaceState({}, "", url);
  }
}
