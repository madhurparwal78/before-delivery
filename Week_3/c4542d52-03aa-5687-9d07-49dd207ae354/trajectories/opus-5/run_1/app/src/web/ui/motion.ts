export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts a figure from one value to another, ending exactly on the server's value. */
export function countTo(node: HTMLElement, from: number, to: number, render: (value: number) => string): void {
  if (prefersReducedMotion() || from === to) {
    node.textContent = render(to);
    return;
  }
  const duration = 320;
  const start = performance.now();
  const step = (stamp: number): void => {
    const progress = Math.min(1, (stamp - start) / duration);
    const eased = 1 - (1 - progress) * (1 - progress);
    node.textContent = render(progress === 1 ? to : Math.round(from + (to - from) * eased));
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

export function countMoney(node: HTMLElement, from: string, to: string, render: (value: string) => string): void {
  const fromCents = Math.round(Number(from) * 100);
  const toCents = Math.round(Number(to) * 100);
  countTo(node, fromCents, toCents, (value) => render((value / 100).toFixed(2)));
}

/** Scrolls a horizontal track so the given cell lies wholly inside its visible frame. */
export function scrollCellIntoTrack(track: HTMLElement, cell: HTMLElement): void {
  const trackBox = track.getBoundingClientRect();
  const cellBox = cell.getBoundingClientRect();
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  if (cellBox.left < trackBox.left) {
    track.scrollTo({ left: track.scrollLeft - (trackBox.left - cellBox.left), behavior });
  } else if (cellBox.right > trackBox.right) {
    track.scrollTo({ left: track.scrollLeft + (cellBox.right - trackBox.right), behavior });
  }
}
