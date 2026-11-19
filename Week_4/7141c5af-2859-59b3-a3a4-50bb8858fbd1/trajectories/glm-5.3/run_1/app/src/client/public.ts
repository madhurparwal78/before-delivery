import { api, announce, el, qs, qsa, motion, setTitle, focusHeading, ApiFail } from "./core.js";
import { dialogs } from "./dialogs.js";

/** Public site interactions: Work panel, header scroll, case rail, filter, enquiry form. */

export function installHeaderScroll(): void {
  const header = qs(".site-header");
  if (!header) return;
  const apply = () => {
    header.dataset.scrolled = String(window.scrollY > 24);
  };
  apply();
  window.addEventListener("scroll", apply, { passive: true });
}

export function installWorkPanel(): void {
  const button = qs("#work-panel-button");
  const panel = qs("#work-panel");
  if (!button || !panel) return;
  let open = false;
  let closingTimer = 0;
  const cases = [
    { slug: "bentwood-armchair", title: "Bentwood armchair" },
    { slug: "tubular-lounge", title: "Tubular lounge" },
    { slug: "swivel-desk-chair", title: "Swivel desk chair" },
    { slug: "folding-deck-chair", title: "Folding deck chair" },
    { slug: "cantilever-side-chair", title: "Cantilever side chair" },
    { slug: "slat-bench", title: "Slat bench" },
  ];
  panel.setAttribute("role", "navigation");
  panel.setAttribute("aria-label", "Work");
  panel.innerHTML = `
    <div class="work-tiles">${cases.map((c) => `<a class="work-tile" href="/work/${c.slug}" data-slug="${c.slug}">${c.title}</a>`).join("")}</div>
    <img id="work-preview" alt="Preview of ${cases[0]!.title}" src="/assets/preview-${cases[0]!.slug}.svg">`;

  const previews = async (slug: string, title: string): Promise<void> => {
    const img = panel.querySelector<HTMLImageElement>("#work-preview");
    if (!img) return;
    const res = await fetch(`/work/${slug}`, { headers: { Accept: "text/html" } });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const svg = doc.querySelector("[data-part=case-drawing]")?.innerHTML ?? "";
    const blob = new Blob([svg ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 200">${svg}</svg>` : ""], { type: "image/svg+xml" });
    img.src = blob.size ? URL.createObjectURL(blob) : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
    img.alt = `Preview of ${title}`;
    if (!motion.reduced) {
      motion.animate(img, { opacity: "0" }, { opacity: "1" }, 160);
    }
  };

  const openPanel = () => {
    if (open) return;
    open = true;
    window.clearTimeout(closingTimer);
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    if (!motion.reduced) {
      motion.animate(panel, { opacity: "0", transform: "translateY(-8px)" }, { opacity: "1", transform: "translateY(0)" }, 320);
    }
    void previews(cases[0]!.slug, cases[0]!.title);
  };

  const closePanel = () => {
    if (!open) return;
    open = false;
    button.setAttribute("aria-expanded", "false");
    const done = () => {
      panel.hidden = true;
    };
    if (motion.reduced) {
      done();
    } else {
      motion.animate(panel, { opacity: "1" }, { opacity: "0" }, 320, done);
    }
  };

  button.addEventListener("click", () => (open ? closePanel() : openPanel()));
  button.addEventListener("keydown", (e) => {
    if (e.key === "Tab" || e.key === "ArrowDown") {
      if (e.key === "ArrowDown") e.preventDefault();
      if (open) {
        const first = panel.querySelector<HTMLElement>(".work-tile");
        first?.focus();
      } else if (e.key === "ArrowDown") {
        openPanel();
      }
    }
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      button.focus();
    } else if (e.key === "Tab" && !e.shiftKey && document.activeElement === panel.querySelector(".work-tile:last-child")) {
      closePanel();
    }
  });
  qsa(".work-tile", panel).forEach((tile) => {
    tile.addEventListener("mouseenter", () => {
      const slug = tile.dataset.slug!;
      const title = tile.textContent ?? "";
      void previews(slug, title);
    });
    tile.addEventListener("focus", () => {
      const slug = tile.dataset.slug!;
      const title = tile.textContent ?? "";
      void previews(slug, title);
    });
  });
}

export function installKindFilter(): void {
  const group = qs("#kind-group");
  if (!group) return;
  const radios = qsa("input[type=radio]", group);
  radios.forEach((radio) => {
    radio.addEventListener("change", () => {
      const value = (radio as HTMLInputElement).value;
      const url = value === "all" ? "/work" : `/work?kind=${value === "frame-only" ? "frame-only" : value}`;
      history.pushState({}, "", url);
      void loadCases(value === "all" ? null : value);
    });
  });
}

async function loadCases(kind: string | null): Promise<void> {
  const grid = qs("#case-grid");
  if (!grid) return;
  const res = await fetch(kind ? `/work?kind=${kind}` : "/work", { headers: { Accept: "text/html" } });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const newTiles = doc.querySelectorAll("#case-grid .case-tile");
  // Items move as the same elements: diff by slug.
  const existing = [...grid.querySelectorAll<HTMLElement>(".case-tile")];
  const bySlug = new Map(existing.map((t) => [t.getAttribute("data-case"), t]));
  const incoming = [...newTiles];
  const incomingSlugs = new Set(incoming.map((t) => t.getAttribute("data-case")));
  for (const tile of existing) {
    if (!incomingSlugs.has(tile.getAttribute("data-case"))) {
      if (motion.reduced) tile.remove();
      else motion.animate(tile, { opacity: "1" }, { opacity: "0" }, 320, () => tile.remove());
    }
  }
  for (const tile of incoming) {
    const slug = tile.getAttribute("data-case");
    const same = bySlug.get(slug);
    if (same) {
      grid.append(same);
    } else {
      const node = el(tile.outerHTML);
      if (!motion.reduced) {
        node.style.opacity = "0";
        motion.animate(node, { opacity: "0" }, { opacity: "1" }, 320);
      }
      grid.append(node);
    }
  }
  installCaseNavigation();
}

export function installCaseNavigation(): void {
  qsa("a.case-tile").forEach((tile) => {
    tile.addEventListener("click", (e) => {
      const drawing = tile.querySelector<HTMLElement>("[data-part=case-drawing]");
      if (!drawing || motion.reduced) return; // reduced motion: no shared move at all
      e.preventDefault();
      const slug = tile.dataset.case!;
      void sharedMoveToCase(slug, tile, drawing);
    });
  });
}

async function sharedMoveToCase(slug: string, tile: HTMLElement, drawing: HTMLElement): Promise<void> {
  const res = await fetch(`/work/${slug}`, { headers: { Accept: "text/html" } });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Keep the tile's drawing element; it becomes the case hero.
  const rect = drawing.getBoundingClientRect();
  const main = qs("#main")!;
  main.querySelectorAll("*").forEach((n) => {
    if (n !== drawing) n.remove();
  });
  const newMain = doc.getElementById("main")!;
  main.innerHTML = newMain.innerHTML;
  const hero = qs(".case-hero", main) ?? null;
  if (hero) hero.remove();
  drawing.setAttribute("data-hero", "true");
  drawing.classList.add("case-hero", "case-drawing");
  drawing.style.position = "fixed";
  drawing.style.left = `${rect.left}px`;
  drawing.style.top = `${rect.top}px`;
  drawing.style.width = `${rect.width}px`;
  drawing.style.height = `${rect.height}px`;
  main.prepend(drawing);
  document.body.dataset.route = `/work/${slug}`;
  setTitle(`${doc.title}`);
  history.pushState({}, "", `/work/${slug}`);
  const target = qs("#main .case-body", main)!.getBoundingClientRect();
  if (!motion.reduced) {
    motion.animate(
      drawing,
      {},
      { left: `${window.innerWidth / 2 - 110}px`, top: "24px", width: "220px", height: "200px" },
      320,
      () => {
        drawing.style.position = "";
        drawing.style.left = "";
        drawing.style.top = "";
        drawing.style.width = "";
        drawing.style.height = "";
      }
    );
  }
  void target;
  focusHeading();
  installCaseRail();
  installWorkPanel();
  installHeaderScroll();
}

export function installCaseRail(): void {
  const rail = qs(".sections-rail");
  if (!rail) return;
  const links = qsa(".rail-link", rail);
  if (!links.length) return;
  const sections = links.map((link) => document.getElementById(link.getAttribute("href")!.slice(1))!);
  links.forEach((link, i) => {
    const heading = document.getElementById(`${sections[i]!.id}-heading`);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const hash = link.getAttribute("href")!;
      links.forEach((l) => l.removeAttribute("aria-current"));
      link.setAttribute("aria-current", "true");
      const top = (heading?.getBoundingClientRect().top ?? 0) + window.scrollY - 140;
      window.scrollTo({ top, behavior: "instant" as ScrollBehavior });
      heading?.focus();
      history.pushState({}, "", `${location.pathname}${hash}`);
    });
  });
  const apply = () => {
    const line = 96 + (qs(".site-header")?.offsetHeight ?? 0);
    let current = 0;
    const bottomish = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (bottomish) {
      current = sections.length - 1;
    } else {
      sections.forEach((s, i) => {
        const heading = document.getElementById(`${s.id}-heading`);
        if (heading && heading.getBoundingClientRect().top <= line) current = i;
      });
    }
    links.forEach((l, i) => {
      if (i === current) l.setAttribute("aria-current", "true");
      else l.removeAttribute("aria-current");
    });
  };
  apply();
  window.addEventListener("scroll", apply, { passive: true });
}

const busy = async (button: HTMLButtonElement, fn: () => Promise<void>): Promise<void> => {
  if (button.getAttribute("aria-disabled") === "true") return;
  const original = button.textContent ?? "";
  button.textContent = "Working…";
  button.setAttribute("aria-disabled", "true");
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiFail) announce(e.message);
  } finally {
    button.textContent = original;
    button.removeAttribute("aria-disabled");
  }
};

export function installEnquiryForm(): void {
  const form = document.querySelector<HTMLFormElement>(".enquiry-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
    await busy(btn, async () => {
      const data = {
        name: (form.elements.namedItem("name") as HTMLInputElement).value,
        email: (form.elements.namedItem("email") as HTMLInputElement).value,
        message: (form.elements.namedItem("message") as HTMLTextAreaElement).value,
      };
      await api("/api/enquiries", { method: "POST", json: data });
      announce("Thank you. Your enquiry is on its way.");
      form.reset();
    });
  });
}

export function installAuthForms(): void {
  const form = document.querySelector<HTMLFormElement>(".auth-form");
  if (!form) return;
  const endpoint = form.dataset.endpoint ?? "";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;
    await busy(btn, async () => {
      const data: Record<string, string> = {};
      for (const field of ["name", "email", "password"]) {
        const input = form.elements.namedItem(field) as HTMLInputElement | null;
        if (input) data[field] = input.value;
      }
      const res = await api<{ session: { landing: string } }>(endpoint, { method: "POST", json: data });
      window.location.href = res.session.landing;
    });
  });
}


void ApiFail;
