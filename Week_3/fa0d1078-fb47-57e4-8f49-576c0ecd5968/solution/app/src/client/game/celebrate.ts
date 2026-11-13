import { reducedMotion } from "../motion";

const CELL_MS = 300;
const STAGGER_MS = 40;
const SEQUENCE_MS = 940;

/**
 * The solved sequence: every cell grows about 8 percent and returns, staggered by (row + column - 2) x 40 ms;
 * the thread closes into a loop and the plinth lifts. Resolves when the last cell's animation has finished.
 */
export async function celebrate(): Promise<void> {
  const board = document.getElementById("board");
  if (!board || reducedMotion()) return;
  board.setAttribute("data-celebrating", "true");
  const cells = [...board.querySelectorAll<HTMLElement>("[data-cell]")];
  const animations = cells.map((cell) => {
    const delay = (Number(cell.dataset.cell?.[1]) + Number(cell.dataset.cell?.[3]) - 2) * STAGGER_MS;
    return cell.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], {
      duration: CELL_MS,
      delay,
      easing: "ease-in-out",
      fill: "backwards",
    });
  });
  document.querySelector(".plinth")?.animate([{ transform: "translateY(0)" }, { transform: "translateY(-6px)" }], {
    duration: SEQUENCE_MS,
    easing: "ease-out",
  });
  document.querySelector(".hem-loop")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SEQUENCE_MS, easing: "linear" });
  await Promise.all(animations.map((animation) => animation.finished)).catch(() => undefined);
  board.removeAttribute("data-celebrating");
}
