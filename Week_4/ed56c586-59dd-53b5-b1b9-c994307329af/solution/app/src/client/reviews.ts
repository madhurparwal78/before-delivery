import { REVIEWS } from "../shared/catalog.js";
import { reviewAnnouncement, reviewPosition } from "../shared/announcements.js";
import { announce } from "./announce.js";
import { all, must } from "./dom.js";

/** The review carousel: one slide shows at a time and the reviews do not wrap. Buttons, arrow keys, Home and End, and a
 * mostly horizontal drag of at least 40 px move it; every change is announced once. */

const SWIPE_MIN_PX = 40;

export function initReviews(): void {
  const carousel = must<HTMLElement>(document, "[data-carousel]");
  const track = must<HTMLElement>(carousel, "[data-review-track]");
  const strip = must<HTMLElement>(carousel, "[data-review-strip]");
  const slides = all<HTMLElement>(strip, "[data-review-slide]");
  const previous = must<HTMLButtonElement>(carousel, "[data-review-previous]");
  const next = must<HTMLButtonElement>(carousel, "[data-review-next]");
  const position = must<HTMLElement>(carousel, "[data-review-position]");
  let index = 0;

  const show = (to: number): void => {
    const bounded = Math.max(0, Math.min(slides.length - 1, to));
    if (bounded === index) return;
    const hadPrevious = document.activeElement === previous;
    const hadNext = document.activeElement === next;
    index = bounded;
    strip.style.transform = `translateX(${-index * 100}%)`;
    slides.forEach((slide, at) => {
      slide.inert = at !== index;
      if (at === index) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", "true");
    });
    position.textContent = reviewPosition(index + 1);
    previous.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    if (hadPrevious && previous.disabled) next.focus();
    if (hadNext && next.disabled) previous.focus();
    announce(reviewAnnouncement(index + 1, REVIEWS[index]));
  };

  previous.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  carousel.addEventListener("keydown", (event) => {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: slides.length - 1 };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    show(to);
  });

  let start: { readonly x: number; readonly y: number } | undefined;
  track.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    track.setPointerCapture(event.pointerId);
  });
  track.addEventListener("pointerup", (event) => {
    if (start === undefined) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = undefined;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
  });
  track.addEventListener("pointercancel", () => {
    start = undefined;
  });
}
