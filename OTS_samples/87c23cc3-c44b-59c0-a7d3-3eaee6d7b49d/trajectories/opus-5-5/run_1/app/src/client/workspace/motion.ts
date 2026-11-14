import { prefersReducedMotion } from "../ui.js";

export const ENTER_MS = 300;
export const ROW_STAGGER_MS = 40;
export const DRAW_MS = 400;
export const FLASH_MS = 600;
export const GLIDE_MS = 350;
export const TYPE_MS = 35;

const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** An entity fades and grows into place while its rows fill in one after another. */
export function playEnter(entity: SVGGElement): void {
  if (prefersReducedMotion()) return;
  const body = entity.querySelector<SVGGElement>(".entity-body");
  if (!body) return;
  entity.setAttribute("data-motion", "enter");
  const animation = body.animate(
    [
      { opacity: 0, transform: "scale(0.96)" },
      { opacity: 1, transform: "scale(1)" },
    ],
    { duration: ENTER_MS, easing: EASE_OUT },
  );
  entity.querySelectorAll<SVGGElement>("[data-column]").forEach((row, index) => {
    row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: index * ROW_STAGGER_MS, easing: EASE_OUT, fill: "backwards" });
  });
  const done = () => entity.removeAttribute("data-motion");
  animation.onfinish = done;
  animation.oncancel = done;
}

/** Endpoint rows flash a light accent tint; under reduced motion they hold a static highlight. */
export function playFlash(rows: SVGGElement[]): void {
  for (const row of rows) {
    row.setAttribute("data-flash", "true");
    const tint = row.querySelector<SVGRectElement>(".row-flash");
    if (prefersReducedMotion() || !tint) {
      window.setTimeout(() => row.removeAttribute("data-flash"), FLASH_MS);
      continue;
    }
    const animation = tint.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLASH_MS, easing: "ease-out" });
    const done = () => row.removeAttribute("data-flash");
    animation.onfinish = done;
    animation.oncancel = done;
  }
}

/** A connector draws itself from its start to its target, then its endpoint rows flash. */
export function playDraw(link: SVGGElement, rows: SVGGElement[]): void {
  const path = link.querySelector<SVGPathElement>(".link-line");
  if (prefersReducedMotion() || !path) {
    playFlash(rows);
    return;
  }
  const length = Math.max(1, path.getTotalLength());
  link.setAttribute("data-motion", "draw");
  const animation = path.animate(
    [
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: `${length}` },
      { strokeDasharray: `${length} ${length}`, strokeDashoffset: "0" },
    ],
    { duration: DRAW_MS, easing: EASE_OUT },
  );
  animation.onfinish = () => {
    link.removeAttribute("data-motion");
    playFlash(rows);
  };
  animation.oncancel = () => link.removeAttribute("data-motion");
}

/** Marks a gliding entity and gives it a slight lift for the length of the glide. */
export function playLift(entity: SVGGElement): void {
  const body = entity.querySelector<SVGGElement>(".entity-body");
  entity.setAttribute("data-motion", "move");
  const animation = body?.animate([{ transform: "scale(1)" }, { transform: "scale(1.015)" }, { transform: "scale(1)" }], {
    duration: GLIDE_MS,
    easing: EASE_OUT,
  });
  const done = () => entity.removeAttribute("data-motion");
  if (animation) {
    animation.onfinish = done;
    animation.oncancel = done;
  } else window.setTimeout(done, GLIDE_MS);
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
