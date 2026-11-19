// The public site: slim bar, phone bar shadow, section rises, marks, questions, rail, search.
import { $, $$, announce, call, reducedMotion, safely } from "./core.js";
import { closeDialog, topDialog } from "./dialogs.js";

const SLIM_FROM = 200;
const SHADOW_FROM = 25;
const BACK_TOP_FROM = 600;

const initScrollParts = (): void => {
  const slim = $("[data-slim]");
  const bar = $("[data-phone-bar]");
  const back = $("[data-back-top]");
  const apply = (): void => {
    const y = scrollY;
    slim?.classList.toggle("is-showing", y >= SLIM_FROM);
    bar?.classList.toggle("has-shadow", y >= SHADOW_FROM);
    if (back) back.hidden = y < BACK_TOP_FROM;
  };
  addEventListener("scroll", apply, { passive: true });
  apply();
  addEventListener("load", apply);
};

const initRises = (): void => {
  const sections = $$(".rise");
  if (!sections.length) return;
  if (reducedMotion()) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.remove("rise-wait");
      observer.unobserve(entry.target);
    }
  });
  for (const section of sections) {
    if (section.getBoundingClientRect().bottom <= 0) continue;
    section.classList.add("rise-wait");
    void section.getBoundingClientRect();
    observer.observe(section);
  }
};

const initMarks = (): void => {
  const root = $("[data-marks]");
  const track = $("[data-marks-track]");
  if (!root || !track) return;
  let index = 0;
  const visible = (): number => Number(getComputedStyle(root).getPropertyValue("--marks-visible")) || 5;
  const last = (): number => Math.max(track.children.length - visible(), 0);
  const draw = (): void => {
    track.style.transform = `translateX(${-index * (100 / track.children.length)}%)`;
    for (const button of $$("[data-marks-step]", root)) {
      const atEnd = Number(button.dataset.marksStep) < 0 ? index === 0 : index === last();
      if (atEnd) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    }
  };
  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-marks-step]");
    if (!button || button.hasAttribute("aria-disabled")) return;
    index = Math.min(Math.max(index + Number(button.dataset.marksStep), 0), last());
    draw();
  });
  addEventListener("resize", () => { index = Math.min(index, last()); draw(); });
  draw();
};

const openQuestion = (button: HTMLElement, open: boolean): void => {
  const panel = document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
  button.setAttribute("aria-expanded", String(open));
  if (open) {
    panel.hidden = false;
    panel.inert = false;
    void panel.offsetHeight;
    panel.classList.add("is-open");
  } else {
    panel.inert = true;
    panel.classList.remove("is-open");
    void panel.offsetHeight;
    const moving = panel.getAnimations();
    const done = (): void => { if (button.getAttribute("aria-expanded") === "false") panel.hidden = true; };
    if (moving.length) void Promise.allSettled(moving.map((a) => a.finished)).then(done);
    else done();
  }
};
const initQuestions = (): void => {
  for (const panel of $$("[data-question-panel]")) panel.hidden = true;
  document.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("[data-question]");
    if (button) openQuestion(button, button.getAttribute("aria-expanded") !== "true");
  });
  const fromHash = (): void => {
    const holder = location.hash ? document.getElementById(location.hash.slice(1)) : null;
    const button = holder?.classList.contains("question") ? $<HTMLElement>("[data-question]", holder) : null;
    if (!button) return;
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
    panel.classList.add("no-motion");
    openQuestion(button, true);
    void panel.offsetHeight;
    panel.classList.remove("no-motion");
    holder?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  addEventListener("hashchange", fromHash);
  fromHash();
  addEventListener("load", fromHash);
};

const initRail = (): void => {
  const rail = $("[data-rail]");
  if (!rail) return;
  const links = $$<HTMLAnchorElement>("a", rail);
  const sections = $$("[data-section]");
  let held = false;
  const mark = (id: string): void => {
    for (const link of links) {
      if (link.getAttribute("href") === `#${id}`) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  const follow = (): void => {
    if (held) return;
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    let current = sections[0];
    for (const section of sections) if (section.getBoundingClientRect().top <= 120) current = section;
    if (atEnd) current = sections[sections.length - 1];
    if (current) mark(current.id);
  };
  let jumpEnds = 0;
  addEventListener("scroll", () => {
    if (held && performance.now() < jumpEnds) return;
    held = false;
    follow();
  }, { passive: true });
  rail.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!link) return;
    event.preventDefault();
    const id = (link.getAttribute("href") as string).slice(1);
    held = true;
    jumpEnds = performance.now() + 120;
    mark(id);
    document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" });
    history.replaceState(null, "", `#${id}`);
  });
  follow();
};

const initSearch = (): void => {
  const form = $<HTMLFormElement>("[data-search]");
  const list = $("[data-results]");
  if (!form || !list) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = (form.elements.namedItem("q") as HTMLInputElement).value;
    void safely(() => call("GET", `/api/public/search?q=${encodeURIComponent(q)}`)).then((reply) => {
      if (!reply.ok) {
        list.hidden = true;
        announce(reply.json?.error?.message ?? "Nothing found for that search.");
        return;
      }
      const results = reply.json.results as { title: string; path: string; excerpt: string }[];
      list.replaceChildren(...results.map((r) => {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = r.path;
        link.textContent = r.title;
        const excerpt = document.createElement("p");
        excerpt.textContent = r.excerpt;
        item.append(link, excerpt);
        return item;
      }));
      list.hidden = results.length === 0;
      announce(results.length ? `${results.length} results found.` : "Nothing found for that search.");
    });
  });
  list.addEventListener("click", (event) => {
    const top = topDialog();
    if ((event.target as HTMLElement).closest("a") && top) closeDialog(top, false);
  });
};

export const initPublic = (): void => {
  initScrollParts();
  initRises();
  initMarks();
  initQuestions();
  initRail();
  initSearch();
};
