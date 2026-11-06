export const FEEDBACK_MS = 180;
export const STATE_MS = 360;
export const ENTRANCE_MS = 720;

const query = window.matchMedia('(prefers-reduced-motion: reduce)');

export function reducedMotion(): boolean {
  return query.matches;
}


/** Rolls only the digits that changed, over 180 ms. */
export function setRollingFigure(host: HTMLElement, text: string): void {
  const characters = [...text];
  while (host.childElementCount > characters.length) {
    host.removeChild(host.lastElementChild as Element);
  }
  while (host.childElementCount < characters.length) {
    const cell = document.createElement('span');
    cell.className = 'figure-cell';
    host.appendChild(cell);
  }
  const cells = [...host.children] as HTMLElement[];
  for (const [index, character] of characters.entries()) {
    const cell = cells[index];
    if (cell.textContent === character) continue;
    cell.textContent = character;
    if (reducedMotion()) continue;
    cell.classList.remove('is-rolling');
    void cell.offsetWidth;
    cell.classList.add('is-rolling');
    window.setTimeout(() => cell.classList.remove('is-rolling'), FEEDBACK_MS);
  }
}

/** Eases an SVG path to a new shape over 720 ms, as an element animation. */
export function easePath(path: SVGPathElement, nextShape: string): void {
  const previous = path.getAttribute('d');
  path.setAttribute('d', nextShape);
  if (reducedMotion() || previous === null || previous === nextShape) return;
  path.animate(
    [{ d: `path("${previous}")` }, { d: `path("${nextShape}")` }],
    { duration: ENTRANCE_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
}

export function raiseHeading(heading: HTMLElement): void {
  if (reducedMotion()) return;
  heading.classList.add('is-entering');
  window.setTimeout(() => heading.classList.remove('is-entering'), ENTRANCE_MS);
}
