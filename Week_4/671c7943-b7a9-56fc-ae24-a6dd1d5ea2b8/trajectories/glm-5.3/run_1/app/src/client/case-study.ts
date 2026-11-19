import { prefersReducedMotion, announce } from "./util.js";
import { replaceMainWith } from "./spa.js";

function initCaseStudy(): void {
  const article = document.querySelector<HTMLElement>(".case-study");
  if (!article) return;

  const title = document.querySelector<HTMLElement>(".case-title");
  const header = document.querySelector<HTMLElement>(".case-header");

  const settleFocus = () => {
    if (!title) return;
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
  };

  if (prefersReducedMotion()) {
    settleFocus();
  } else {
    const parts = ["eyebrow", "title", "standfirst"];
    parts.forEach((part, index) => {
      const element = header?.querySelector<HTMLElement>(`[data-title-line="${part}"]`);
      if (!element) return;
      window.setTimeout(() => element.classList.add("title-line-rise"), 560 + index * 60);
    });
    window.setTimeout(settleFocus, 560);
  }

  initShowcase();
  initArrowNav();
  initOnThisPage();
}

function initShowcase(): void {
  const region = document.querySelector<HTMLElement>("[data-screen]");
  if (!region) return;
  const track = region.querySelector<HTMLElement>(".showcase-track");
  const prevButton = region.querySelector<HTMLButtonElement>("[data-showcase-prev]");
  const nextButton = region.querySelector<HTMLButtonElement>("[data-showcase-next]");
  const counter = region.querySelector<HTMLElement>("[data-showcase-counter]");
  if (!track || !prevButton || !nextButton || !counter) return;
  const screens = Array.from(track.querySelectorAll<HTMLElement>(".showcase-screen"));
  const total = screens.length;
  let current = 1;

  const move = (target: number) => {
    const clamped = Math.max(1, Math.min(total, target));
    if (clamped === current) return;
    current = clamped;
    region.dataset.screen = String(current);
    counter.textContent = `${current} / ${total}`;
    prevButton.disabled = current === 1;
    nextButton.disabled = current === total;
    const screen = screens[current - 1];
    const caption = screen?.querySelector("figcaption")?.textContent ?? "";
    announce(`Screen ${current} of ${total}: ${caption}.`);
    track.scrollTo({ left: (current - 1) * track.clientWidth, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  prevButton.addEventListener("click", () => move(current - 1));
  nextButton.addEventListener("click", () => move(current + 1));

  let startX: number | null = null;
  let startScroll = 0;
  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    startX = event.clientX;
    startScroll = track.scrollLeft;
    track.setPointerCapture(event.pointerId);
  });
  track.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const delta = event.clientX - startX;
    startX = null;
    if (Math.abs(delta) >= 60) {
      move(delta < 0 ? current + 1 : current - 1);
    } else {
      track.scrollTo({ left: startScroll, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  });
  track.addEventListener("pointercancel", () => {
    startX = null;
    track.scrollTo({ left: startScroll, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  });
}

function initArrowNav(): void {
  const prev = document.querySelector<HTMLAnchorElement>("[data-prev-project]");
  const next = document.querySelector<HTMLAnchorElement>("[data-next-project]");
  if (!prev && !next) return;
  const go = (link: HTMLAnchorElement, direction: "prev" | "next") => {
    const hero = document.querySelector<HTMLElement>("[data-hero]");
    if (hero && !prefersReducedMotion()) {
      hero.classList.add(direction === "next" ? "hero-slide-out-next" : "hero-slide-out-prev");
    }
    void replaceMainWith(link.href).then(() => {
      const newHero = document.querySelector<HTMLElement>("[data-hero]");
      if (newHero && !prefersReducedMotion()) {
        newHero.classList.add(direction === "next" ? "hero-slide-in-next" : "hero-slide-in-prev");
      }
      initCaseStudy();
    });
  };
  if (!document.body.dataset.arrowNav) {
    document.body.dataset.arrowNav = "1";
    document.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (active.closest('[role="radiogroup"], [role="tablist"]')) return;
      }
      const prevLink = document.querySelector<HTMLAnchorElement>("[data-prev-project]");
      const nextLink = document.querySelector<HTMLAnchorElement>("[data-next-project]");
      if (event.key === "ArrowLeft" && prevLink) {
        event.preventDefault();
        prevLink.click();
      } else if (event.key === "ArrowRight" && nextLink) {
        event.preventDefault();
        nextLink.click();
      }
    });
  }
  [prev, next].forEach((link, i) => {
    if (!link) return;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      go(link, i === 0 ? "prev" : "next");
    });
  });
}

function initOnThisPage(): void {
  const sectionIds = ["overview", "objectives", "visual-system", "showcase", "process", "results"];
  let ticking = false;
  const update = () => {
    const probe = window.innerHeight * 0.4;
    let current: string | null = null;
    for (const id of sectionIds) {
      const section = document.getElementById(id);
      if (!section) continue;
      const rect = section.getBoundingClientRect();
      if (rect.top <= probe && rect.bottom > probe) {
        current = id;
      }
    }
    document.querySelectorAll<HTMLAnchorElement>(".on-this-page-link").forEach((link) => {
      if (current && link.dataset.sectionLink === current) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  update();

  document.querySelectorAll<HTMLAnchorElement>(".on-this-page-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const id = link.dataset.sectionLink ?? "";
      const section = document.getElementById(id);
      const heading = section?.querySelector<HTMLElement>("h2");
      if (!section || !heading) return;
      const top = section.getBoundingClientRect().top + window.scrollY - 64 - 16;
      if (prefersReducedMotion()) {
        window.scrollTo(0, Math.max(0, top));
      } else {
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        window.setTimeout(() => {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }, 600);
        return;
      }
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    });
  });
}

export { initCaseStudy };
