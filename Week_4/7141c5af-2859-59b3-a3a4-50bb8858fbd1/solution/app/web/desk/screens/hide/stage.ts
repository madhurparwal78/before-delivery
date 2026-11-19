import { PARTS, type PartName } from "../../../../server/domain/placement.ts";
import { EASE, MOVE_MS, reducedMotion, STEP_MS } from "../../lib/motion.ts";

export interface View {
  name: PartName;
  state: "tray" | "lifted" | "placed";
  x: number | null;
  y: number | null;
  rotation: number;
}

/** Who asked for the next change of a piece, which decides its motion. Anything unmarked came from another window and glides. */
export type Cause = "step" | "turn" | "glide" | "follow" | "still";

interface Point {
  left: number;
  top: number;
}

function turned(rotation: number): boolean {
  return rotation === 90 || rotation === 270;
}

/** Where the element's own unrotated box sits so that its rotated box keeps the published top-left. */
export function boxOrigin(view: View, perCm: number): Point {
  const { width, height } = PARTS[view.name];
  const boxWidth = turned(view.rotation) ? height : width;
  const boxHeight = turned(view.rotation) ? width : height;
  return {
    left: ((view.x as number) + (boxWidth - width) / 2) * perCm,
    top: ((view.y as number) + (boxHeight - height) / 2) * perCm,
  };
}

/** The hide's frame clips what runs past it: the box's overhang on each side, turned into the element's own sides. */
export function frameClip(view: View, perCm: number, hideWidth: number, hideHeight: number): string {
  if (view.x === null || view.y === null) return "none";
  const { width, height } = PARTS[view.name];
  const boxWidth = turned(view.rotation) ? height : width;
  const boxHeight = turned(view.rotation) ? width : height;
  const left = Math.max(0, -view.x);
  const top = Math.max(0, -view.y);
  const right = Math.max(0, view.x + boxWidth - hideWidth);
  const bottom = Math.max(0, view.y + boxHeight - hideHeight);
  if (left + top + right + bottom === 0) return "none";
  const sides: Record<number, number[]> = { 0: [top, right, bottom, left], 90: [right, bottom, left, top], 180: [bottom, left, top, right], 270: [left, top, right, bottom] };
  return `inset(${(sides[view.rotation] as number[]).map((cm) => `${cm * perCm}px`).join(" ")})`;
}

/** Moves a piece as the same element, from wherever it stands now, so a further press carries on with no jump. */
export function moveTo(element: HTMLElement, to: Point, degrees: number, duration: number): void {
  const styles = getComputedStyle(element);
  const fromTranslate = styles.translate === "none" ? "0px 0px" : styles.translate;
  const fromRotate = styles.rotate === "none" ? "0deg" : styles.rotate;
  for (const animation of element.getAnimations()) animation.cancel();
  const translate = `${to.left}px ${to.top}px`;
  const rotate = `${degrees}deg`;
  element.style.translate = translate;
  element.style.rotate = rotate;
  element.toggleAttribute("data-moving", false);
  if (duration === 0 || reducedMotion()) return;
  const [fromLeft = 0, fromTop = 0] = fromTranslate.split(" ").map(parseFloat);
  element.style.setProperty("--way-x", `${to.left - fromLeft}px`);
  element.style.setProperty("--way-y", `${to.top - fromTop}px`);
  const glide = element.animate(
    [
      { translate: fromTranslate, rotate: fromRotate },
      { translate, rotate },
    ],
    { duration, easing: EASE },
  );
  element.toggleAttribute("data-moving", true);
  glide.onfinish = () => element.toggleAttribute("data-moving", false);
}

/** The lift itself: the piece rises off the leather. */
export function liftMotion(element: HTMLElement): void {
  if (reducedMotion()) return;
  element.querySelector(".piece-face")?.animate([{ scale: "0.94" }, { scale: "1" }], { duration: STEP_MS, easing: EASE });
}

export function durationOf(cause: Cause | undefined): number {
  if (cause === "step") return STEP_MS;
  if (cause === "follow" || cause === "still") return 0;
  return MOVE_MS;
}
