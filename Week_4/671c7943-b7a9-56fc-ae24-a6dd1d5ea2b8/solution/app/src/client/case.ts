import { showcaseAnnouncement } from "../shared/copy.js";
import { all, announce, must } from "./dom.js";
import { jumpTo } from "./jump.js";
import { onScroll } from "./scroll.js";

const SWIPE_PX = 60;

function initShowcase(section: HTMLElement): void {
  const track = must<HTMLElement>(section, "[data-track]");
  const counter = must<HTMLElement>(section, "[data-count-label]");
  const [previous, next] = all<HTMLButtonElement>(section, "[data-step]") as [HTMLButtonElement, HTMLButtonElement];
  const captions = all<HTMLElement>(section, "figcaption").map((caption) => caption.textContent ?? "");
  const total = captions.length;
  let screen = 1;
  const show = (target: number): void => {
    if (target < 1 || target > total || target === screen) return;
    screen = target;
    track.style.transform = `translateX(${-(screen - 1) * 100}%)`;
    section.dataset["screen"] = String(screen);
    counter.textContent = `${screen} / ${total}`;
    const focused = document.activeElement;
    previous.disabled = screen === 1;
    next.disabled = screen === total;
    if (focused === previous && previous.disabled) next.focus();
    if (focused === next && next.disabled) previous.focus();
    announce(showcaseAnnouncement(screen, total, captions[screen - 1] ?? ""));
  };
  previous.addEventListener("click", () => show(screen - 1));
  next.addEventListener("click", () => show(screen + 1));
  let startX = 0;
  let startY = 0;
  section.addEventListener("touchstart", (event) => {
    startX = event.touches[0]?.clientX ?? 0;
    startY = event.touches[0]?.clientY ?? 0;
  }, { passive: true });
  section.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(touch.clientY - startY)) show(screen + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

/** Marks the On this page link of the last section whose heading has passed the point 40% down the viewport. */
function initContents(main: HTMLElement): void {
  const links = all<HTMLAnchorElement>(main, ".toc a");
  const headings = links.map((link) => must<HTMLElement>(main, link.hash));
  const heads = headings.map((section) => must<HTMLElement>(section, "h2"));
  for (const [index, link] of links.entries()) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const heading = heads[index];
      if (heading) jumpTo(heading, false);
    });
  }
  onScroll(() => {
    if (!main.isConnected) return;
    const point = innerHeight * 0.4;
    let current = -1;
    heads.forEach((heading, index) => {
      if (heading.getBoundingClientRect().top <= point) current = index;
    });
    links.forEach((link, index) => {
      if (index === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  });
}

export function initCase(main: HTMLElement): void {
  initShowcase(must<HTMLElement>(main, ".showcase"));
  initContents(main);
}
