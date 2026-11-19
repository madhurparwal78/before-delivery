import { prefersReducedMotion, announce, focusScroll, setQueryParam } from "./util.js";
import { initCaseStudy } from "./case-study.js";
import { initEnquiryForm } from "./enquiry.js";
import { writeCarry, readCarry } from "./carry.js";
import { recordHeroFly, applyHeroFly, replaceMainWith } from "./spa.js";

const HEADER_HEIGHT = 64;

function headingFor(id: string): HTMLElement | null {
  const section = document.getElementById(id);
  if (!section) return null;
  return (section.querySelector("h1, h2") ?? section) as HTMLElement;
}

function jumpToSection(id: string): void {
  const section = document.getElementById(id);
  const heading = headingFor(id);
  if (!section || !heading) return;
  const top = section.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - 16;
  const settle = () => {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  };
  if (prefersReducedMotion()) {
    window.scrollTo(0, Math.max(0, top));
    settle();
    return;
  }
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  window.setTimeout(settle, 600);
}

function initSkipLink(): void {
  document.querySelector<HTMLAnchorElement>(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      focusScroll(heading);
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  });
}

function initSectionLinks(): void {
  document.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("/#")) {
      if (window.location.pathname !== "/") return;
      event.preventDefault();
      const id = href.slice(2);
      jumpToSection(id);
      window.history.replaceState(null, "", `/#${id}`);
    } else if (href.startsWith("#") && href.length > 1) {
      const id = href.slice(1);
      if (!document.getElementById(id)) return;
      event.preventDefault();
      jumpToSection(id);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
    }
  });
}

function initHashLoad(): void {
  const id = window.location.hash.slice(1);
  if (!id) return;
  const section = document.getElementById(id);
  const heading = headingFor(id);
  if (!section || !heading) return;
  const top = section.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - 16;
  window.scrollTo(0, Math.max(0, top));
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

const SECTION_IDS = ["about", "services", "work", "philosophy", "contact"];

function updateCurrentSection(): void {
  if (window.location.pathname !== "/") return;
  const probe = window.innerHeight * 0.4;
  let current: string | null = null;
  for (const id of SECTION_IDS) {
    const section = document.getElementById(id);
    if (!section) continue;
    const rect = section.getBoundingClientRect();
    if (rect.top <= probe && rect.bottom > probe) current = id;
  }
  const intro = document.getElementById("intro");
  if (intro) {
    const rect = intro.getBoundingClientRect();
    if (rect.top <= probe && rect.bottom > probe) current = null;
  }
  document.querySelectorAll<HTMLElement>('[aria-current="true"]').forEach((element) => element.removeAttribute("aria-current"));
  if (!current) return;
  document
    .querySelectorAll<HTMLAnchorElement>(`.main-nav a[href="/#${current}"], .menu-panel a[href="/#${current}"]`)
    .forEach((link) => link.setAttribute("aria-current", "true"));
}

function initCurrentSection(): void {
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      updateCurrentSection();
      ticking = false;
    });
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  updateCurrentSection();
}

function initMenu(): void {
  const button = document.querySelector<HTMLButtonElement>(".menu-button");
  const dialog = document.querySelector<HTMLElement>(".menu-dialog");
  if (!button || !dialog) return;
  const panel = dialog.querySelector<HTMLElement>(".menu-panel");
  if (!panel) return;

  const openMenu = () => {
    dialog.hidden = false;
    dialog.removeAttribute("data-closing");
    button.setAttribute("aria-expanded", "true");
    panel.querySelector<HTMLAnchorElement>("nav a")?.focus();
  };

  const closeMenu = () => {
    dialog.hidden = true;
    dialog.removeAttribute("data-closing");
    button.setAttribute("aria-expanded", "false");
    button.focus();
  };

  const requestClose = () => {
    if (prefersReducedMotion()) {
      closeMenu();
      return;
    }
    dialog.setAttribute("data-closing", "true");
    window.setTimeout(closeMenu, 280);
  };

  button.addEventListener("click", () => {
    if (dialog.hidden) openMenu();
  });

  panel.querySelector<HTMLButtonElement>(".menu-close")?.addEventListener("click", requestClose);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) requestClose();
  });

  document.addEventListener("keydown", (event) => {
    if (dialog.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>(".menu-panel a[href], .menu-panel button")
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || active === null)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  });

  panel.querySelectorAll<HTMLAnchorElement>("nav a").forEach((link) => {
    link.addEventListener("click", () => {
      closeMenu();
      const href = link.getAttribute("href") ?? "";
      const id = href.startsWith("/#") ? href.slice(2) : href.slice(1);
      jumpToSection(id);
    });
  });
}

function initTabs(selector: string): void {
  const tablist = document.querySelector<HTMLElement>(selector);
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (tabs.length === 0) return;

  const select = (index: number, focus = true) => {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = tab.getAttribute("aria-controls");
      const element = panel ? document.getElementById(panel) : null;
      if (element) element.hidden = !selected;
    });
    if (focus) tabs[index]?.focus();
  };

  tablist.addEventListener("keydown", (event) => {
    const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const count = tabs.length;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (current + 1) % count;
    else if (event.key === "ArrowLeft") next = (current - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    select(next);
  });

  tablist.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (!tab) return;
    select(tabs.indexOf(tab), false);
  });
}

function initServices(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".service-button"));
  if (buttons.length === 0) return;
  const services = buttons.map((button) => button.closest<HTMLElement>(".service"));

  const animateHeight = (panel: HTMLElement, opening: boolean) => {
    const duration = 320;
    if (prefersReducedMotion()) {
      if (opening) {
        panel.hidden = false;
      } else {
        panel.hidden = true;
      }
      return;
    }
    if (opening) {
      panel.hidden = false;
      panel.style.overflow = "hidden";
      panel.style.height = "0px";
      const target = panel.scrollHeight;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        panel.style.height = `${target * (1 - Math.pow(1 - t, 3))}px`;
        if (t < 1) {
          window.requestAnimationFrame(step);
        } else {
          panel.style.height = "";
          panel.style.overflow = "";
        }
      };
      window.requestAnimationFrame(step);
    } else {
      const startHeight = panel.scrollHeight;
      panel.style.overflow = "hidden";
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        panel.style.height = `${startHeight * Math.pow(1 - t, 3)}px`;
        if (t < 1) {
          window.requestAnimationFrame(step);
        } else {
          panel.hidden = true;
          panel.style.height = "";
          panel.style.overflow = "";
        }
      };
      window.requestAnimationFrame(step);
    }
  };

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      const serviceId = services[index]?.dataset.service ?? "";
      if (isOpen) {
        button.setAttribute("aria-expanded", "false");
        const panel = services[index]?.querySelector<HTMLElement>(".service-panel");
        if (panel) animateHeight(panel, false);
        setQueryParam("service", null);
      } else {
        buttons.forEach((other, otherIndex) => {
          if (otherIndex !== index && other.getAttribute("aria-expanded") === "true") {
            other.setAttribute("aria-expanded", "false");
            const panel = services[otherIndex]?.querySelector<HTMLElement>(".service-panel");
            if (panel) animateHeight(panel, false);
          }
        });
        button.setAttribute("aria-expanded", "true");
        const panel = services[index]?.querySelector<HTMLElement>(".service-panel");
        if (panel) animateHeight(panel, true);
        setQueryParam("service", serviceId);
      }
    });

    button.addEventListener("keydown", (event) => {
      const count = buttons.length;
      let next: number | null = null;
      if (event.key === "ArrowDown") next = (index + 1) % count;
      else if (event.key === "ArrowUp") next = (index - 1 + count) % count;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = count - 1;
      if (next === null) return;
      event.preventDefault();
      buttons[next].focus();
    });
  });

  const openFocus = document.querySelector<HTMLElement>("[data-open-focus]");
  if (openFocus) {
    focusScroll(openFocus);
    openFocus.focus();
  }
}

function initWorkFilter(): void {
  const fieldset = document.querySelector<HTMLFieldSetElement>(".work-filter");
  const list = document.querySelector<HTMLUListElement>(".work-list");
  const empty = document.querySelector<HTMLElement>("[data-empty]");
  if (!fieldset || !list) return;
  const radios = Array.from(fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  if (radios.length === 0) return;

  const labelFor = (value: string): string | null => {
    if (value === "all") return null;
    const label = fieldset.querySelector<HTMLInputElement>(`input[value="${value}"]`)?.closest("label")?.textContent ?? "";
    return label.replace(/\(\d+\)/, "").trim();
  };

  const apply = (value: string, byUser: boolean) => {
    const name = labelFor(value);
    let visible = 0;
    Array.from(list.querySelectorAll<HTMLElement>(".work-item")).forEach((item) => {
      const match = value === "all" || item.dataset.category === value;
      item.hidden = !match;
      if (match) visible += 1;
    });
    list.hidden = visible === 0;
    if (empty) {
      empty.hidden = visible > 0;
      if (visible === 0 && name) empty.textContent = `No projects in ${name} yet.`;
    }
    if (!byUser) return;
    if (value === "all") {
      announce(`Showing ${visible} projects.`);
    } else if (visible === 0) {
      announce(`No projects in ${name} yet.`);
    } else if (visible === 1) {
      announce(`Showing 1 project in ${name}.`);
    } else {
      announce(`Showing ${visible} projects in ${name}.`);
    }
    setQueryParam("category", value === "all" ? null : value);
    const suffix = value === "all" ? "" : `?category=${value}`;
    Array.from(list.querySelectorAll<HTMLAnchorElement>("[data-work-link]")).forEach((link) => {
      const slug = link.closest<HTMLElement>(".work-item")?.dataset.project ?? "";
      link.setAttribute("href", `/work/${slug}${suffix}`);
    });
    if (!prefersReducedMotion() && visible > 0) {
      list.classList.remove("fade-in");
      void list.offsetWidth;
      list.classList.add("fade-in");
    }
  };

  radios.forEach((radio) => {
    radio.addEventListener("change", () => apply(radio.value, true));
  });

  fieldset.addEventListener("keydown", (event) => {
    const current = radios.findIndex((radio) => radio.checked);
    const count = radios.length;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + count) % count;
    if (next === null) return;
    event.preventDefault();
    radios[next].checked = true;
    apply(radios[next].value, true);
  });
}

function initReveals(): void {
  if (prefersReducedMotion()) {
    document.querySelectorAll<HTMLElement>(".reveal-heading").forEach((element) => {
      element.classList.remove("reveal-heading");
    });
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -15% 0px" }
  );
  document.querySelectorAll<HTMLElement>(".reveal-heading").forEach((heading) => observer.observe(heading));
}

function initCoverReveal(): void {
  if (prefersReducedMotion()) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const cover = entry.target as HTMLElement;
        const svg = cover.querySelector("svg");
        if (svg && !cover.querySelector(".cover-reveal")) {
          const wrap = document.createElement("span");
          wrap.className = "cover-reveal is-revealed";
          cover.insertBefore(wrap, svg);
          wrap.appendChild(svg);
        }
        observer.unobserve(cover);
      }
    },
    { rootMargin: "0px 0px -10% 0px" }
  );
  document.querySelectorAll<HTMLElement>(".work-cover").forEach((cover) => observer.observe(cover));
}

function initParallax(): void {
  const plate = document.querySelector<HTMLElement>("[data-parallax]");
  if (!plate || prefersReducedMotion()) return;
  const update = () => {
    const shift = Math.round(0.25 * Math.min(window.scrollY, 800));
    plate.style.transform = `translateY(${shift}px)`;
  };
  window.addEventListener("scroll", update, { passive: true });
}

function initCount(): void {
  const counters = Array.from(document.querySelectorAll<HTMLElement>("[data-count]"));
  const tablist = document.querySelector<HTMLElement>('[role="tablist"][aria-label="Statistics"]');
  if (counters.length === 0 || !tablist) return;

  const run = () => {
    if (prefersReducedMotion()) {
      counters.forEach((element) => {
        element.textContent = Number(element.dataset.value).toLocaleString("en-US");
      });
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const t = now - started;
      for (const element of counters) {
        const value = Number(element.dataset.value);
        if (t >= 1200) {
          element.textContent = value.toLocaleString("en-US");
        } else {
          const eased = 1 - Math.pow(1 - t / 1200, 3);
          element.textContent = Math.round(value * eased).toLocaleString("en-US");
        }
      }
      if (t < 1200) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          run();
          observer.disconnect();
        }
      }
    },
    { threshold: 0.1 }
  );
  observer.observe(tablist);
}

function initFocusClear(): void {
  document.addEventListener("focusin", (event) => {
    const element = event.target as HTMLElement;
    if (element.closest(".site-header") || element.closest(".menu-dialog") || element.closest(".skip-link")) return;
    const rect = element.getBoundingClientRect();
    if (rect.top < HEADER_HEIGHT + 8) {
      window.requestAnimationFrame(() => {
        const current = element.getBoundingClientRect();
        if (current.top < HEADER_HEIGHT + 8) {
          window.scrollTo(0, Math.max(0, current.top + window.scrollY - HEADER_HEIGHT - 8));
        }
      });
    }
  });
}

function initWorkLinks(): void {
  document.querySelectorAll<HTMLAnchorElement>("[data-work-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const item = link.closest<HTMLElement>(".work-item");
      const slug = item?.dataset.project ?? "";
      const items = Array.from(document.querySelectorAll<HTMLElement>(".work-item"));
      const index = items.findIndex((candidate) => candidate.dataset.project === slug);
      writeCarry({ fromSlug: slug, tileIndex: index });
      const cover = item?.querySelector<HTMLElement>("[data-cover]") ?? null;
      if (cover) recordHeroFly(cover.getBoundingClientRect());
      void replaceMainWith(link.href).then(() => {
        const hero = document.querySelector<HTMLElement>("[data-hero]");
        if (hero) applyHeroFly(hero);
        initCaseStudy();
      });
    });
  });
}

function initCategoryLinks(): void {
  document.querySelectorAll<HTMLAnchorElement>("[data-category-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const category = link.dataset.categoryLink ?? "";
      const radio = document.querySelector<HTMLInputElement>(`.work-filter input[value="${category}"]`);
      if (radio && !radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
      setQueryParam("category", category);
      jumpToSection("work");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#work`);
    });
  });
}

function initTypeLinks(): void {
  document.querySelectorAll<HTMLAnchorElement>("[data-type-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const type = link.dataset.typeLink ?? "";
      setQueryParam("type", type);
      const radio = document.querySelector<HTMLInputElement>(`.enquiry-form input[value="${type}"]`);
      if (radio) radio.checked = true;
      jumpToSection("contact");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#contact`);
      window.setTimeout(() => {
        document.querySelector<HTMLInputElement>("#name")?.focus();
      }, prefersReducedMotion() ? 0 : 620);
    });
  });
}

function initPopstate(): void {
  window.addEventListener("popstate", () => {
    if (window.location.pathname === "/") {
      void restoreHome();
      return;
    }
    if (window.location.pathname.startsWith("/work/")) {
      void replaceMainWith(window.location.href, false).then(() => {
        const newHero = document.querySelector<HTMLElement>("[data-hero]");
        if (newHero && !prefersReducedMotion()) {
          newHero.classList.add("hero-slide-in-next");
        }
        initCaseStudy();
      });
    }
  });
}

function restoreHome(): Promise<void> {
  return fetch(window.location.href)
    .then((response) => response.text())
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const newMain = doc.querySelector("main");
      const currentMain = document.querySelector("main");
      if (!newMain || !currentMain) {
        window.location.reload();
        return;
      }
      currentMain.replaceWith(newMain);
      document.title = doc.title;
      initTileRestore();
    });
}

function initTileRestore(): void {
  const carry = readCarry();
  if (!carry || window.location.pathname !== "/") return;
  const item = document.querySelector<HTMLElement>(`.work-item[data-project="${carry.fromSlug}"]`);
  const link = item?.querySelector<HTMLElement>("[data-work-link]");
  if (!item || !link) return;
  const rect = item.getBoundingClientRect();
  window.setTimeout(() => {
    item.scrollIntoView({ block: "start" });
    const top = rect.top + window.scrollY - HEADER_HEIGHT - 8;
    window.scrollTo(0, Math.max(0, top));
    link.focus({ preventScroll: true });
  }, prefersReducedMotion() ? 0 : 60);
}



function boot(): void {
  initSkipLink();
  initSectionLinks();
  initHashLoad();
  initCurrentSection();
  initMenu();
  initTabs(".stat-tabs");
  initTabs(".process-tabs");
  initServices();
  initWorkFilter();
  initReveals();
  initCoverReveal();
  initParallax();
  initCount();
  initFocusClear();
  initWorkLinks();
  initCategoryLinks();
  initTypeLinks();
  initPopstate();
  initTileRestore();
  initCaseStudy();
  initEnquiryForm();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
