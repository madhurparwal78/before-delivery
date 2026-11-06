import { city, screen } from "../../content";
import { type Disposables, query, queryAll } from "../Disposables";
import { clamp01, type Stage, storyClock, windowProgress } from "../stage";
import { cityCaption, litCopy, litCount } from "./cityMath";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const PIN_FROM_WIDTH = 1024;
const SETTLED_AT = 0.6;

/** Deterministic per-letter variety for the settling line (the same scatter on every visit). */
const scatter = (index: number, salt: number) => {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Writes a value to the DOM only when it changes. */
function writer<T>(apply: (value: T) => void) {
  let last: T | undefined;
  return (value: T) => {
    if (value === last) return;
    last = value;
    apply(value);
  };
}

/**
 * Everything on the page that follows the scroll position, recomputed each frame from layout: the story
 * clock, the hero fade, the city counter and caption, the brightness meter, the settling line, the
 * sideways ritual chapter and the footer dimming. Nothing here depends on time; scrolling back reverses it.
 */
export function initScrollDom(disposables: Disposables, reduced: boolean, scrollPageTo: (y: number) => void) {
  const root = document.documentElement;
  const clock = query(".sh-clock");
  const heroSection = query(".sh-hero");
  const heroInner = query(".sh-hero__inner");
  const citySection = query(".sh-city");
  const cityCount = query("[data-city-lit]");
  const cityLine = query("[data-city-caption]");
  const meter = query("[role='meter']");
  const meterValue = query("[data-brightness]");
  const settleSection = query(".sh-settle");
  const trackSection = query(".sh-track");
  const pin = query(".sh-track__pin", trackSection);
  const lights = query(".sh-lights");

  const setClock = writer<string>((text) => (clock.textContent = text));
  const setHeroFade = writer<string>((value) => heroInner.style.setProperty("--hero-fade", value));
  const setLit = writer<number>((count) => (cityCount.textContent = litCopy(count)));
  // Nothing in the lights-out effect depends on time: the caption changes exactly where scroll crosses its point.
  const setCaption = writer<number>((index) => (cityLine.textContent = city.captions[index]));
  const setLevel = writer<number>((value) => {
    meter.setAttribute("aria-valuenow", String(value));
    meter.style.setProperty("--level", String(value / 100));
    meterValue.textContent = `${value}%`;
  });
  const setLights = writer<string>((value) => lights.style.setProperty("--lights-dark", value));

  let letters: HTMLElement[] = [];
  const settleLetters = () => {
    letters = queryAll<HTMLElement>(".sh-char", settleSection);
  };
  const setSettle = writer<number>((p) => {
    letters.forEach((letter, index) => {
      const start = scatter(index, 1) * 0.3;
      const t = reduced ? 1 : easeOutCubic(clamp01((p - start) / (SETTLED_AT - start)));
      const rise = 1 - t;
      letter.style.transform =
        rise === 0
          ? ""
          : `translate3d(0, ${(-rise * (0.35 + scatter(index, 2) * 0.65)).toFixed(3)}em, 0) rotate(${(rise * (scatter(index, 3) - 0.5) * 36).toFixed(1)}deg)`;
      letter.style.opacity = rise === 0 ? "" : (0.3 + t * 0.7).toFixed(3);
    });
  });

  let pinned = false;
  let travel = 0;
  let placed = 0;
  const measureTrack = () => {
    pinned = !reduced && window.innerWidth >= PIN_FROM_WIDTH;
    root.classList.toggle("is-track-pinned", pinned);
    if (!pinned) {
      trackSection.style.removeProperty("--track-height");
      pin.scrollLeft = 0;
      return;
    }
    travel = Math.max(0, pin.scrollWidth - pin.clientWidth);
    trackSection.style.setProperty("--track-height", `${Math.round(travel * 1.15 + window.innerHeight)}px`);
  };
  measureTrack();
  disposables.listen(window, "resize", measureTrack);
  disposables.add(() => {
    trackSection.style.removeProperty("--track-height");
    root.classList.remove("is-track-pinned");
  });

  const pageYFor = (left: number) => {
    const top = trackSection.getBoundingClientRect().top + window.scrollY;
    return top + (travel ? left / travel : 0) * (trackSection.offsetHeight - window.innerHeight);
  };

  // The rail is the pin's own horizontal scroll position, driven by the page scroll. When the browser
  // scrolls the rail itself (scrollIntoView, find in page), the page follows so both stay in step.
  disposables.listen(pin, "scroll", () => {
    if (!pinned || travel === 0 || Math.abs(pin.scrollLeft - placed) < 2) return;
    placed = pin.scrollLeft;
    scrollPageTo(pageYFor(pin.scrollLeft));
  });

  // A card that receives keyboard focus is brought fully on screen.
  disposables.listen<FocusEvent>(pin, "focusin", (event) => {
    const card = (event.target as Element).closest<HTMLElement>("[data-ritual]");
    if (!pinned || !card) return;
    const box = card.getBoundingClientRect();
    if (box.left >= 0 && box.right <= window.innerWidth) return;
    const left = Math.min(travel, Math.max(0, pin.scrollLeft + box.left - (window.innerWidth - box.width) / 2));
    placed = left;
    pin.scrollLeft = left;
    scrollPageTo(pageYFor(left));
  });

  const update = (stage: Stage) => {
    const viewport = window.innerHeight;
    setClock(storyClock(stage.minutes));

    const hero = heroSection.getBoundingClientRect();
    setHeroFade(reduced ? "1" : (1 - clamp01(-hero.top / (hero.height * 0.42))).toFixed(3));

    const cityProgress = windowProgress(citySection.getBoundingClientRect(), viewport);
    setLit(litCount(cityProgress));
    setCaption(cityCaption(cityProgress));

    const dial = meter.getBoundingClientRect();
    const q = clamp01((viewport - dial.top) / (viewport + dial.height));
    setLevel(Math.round(screen.dialFrom - (screen.dialFrom - screen.dialTo) * q));

    setSettle(Math.round(windowProgress(settleSection.getBoundingClientRect(), viewport) * 1000) / 1000);

    if (pinned) {
      const left = Math.round(windowProgress(trackSection.getBoundingClientRect(), viewport) * travel);
      if (Math.abs(pin.scrollLeft - left) >= 1) {
        placed = left;
        pin.scrollLeft = left;
      }
    }

    setLights((windowProgress(lights.getBoundingClientRect(), viewport) * 0.85).toFixed(3));
  };

  return { update, settleLetters, measureTrack };
}
