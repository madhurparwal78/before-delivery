/**
 * The published Menu disclosure: the only script on a published page. It is serialised with
 * `toString()` into each snapshot, so it must stay self-contained (no imports, no outer names).
 * Motion is driven from animation frames and exposed as `data-motion` and `data-progress`;
 * toggling mid-motion reverses from the current progress; reduced motion jumps to the end state.
 */
export function menuDisclosure(): void {
  const DURATION = 200;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  document.querySelectorAll<HTMLButtonElement>("button.pl-menu").forEach((button) => {
    const list = document.getElementById(button.getAttribute("aria-controls") ?? "");
    if (!list) return;
    let progress = 0;
    let target = 0;
    let last = 0;
    let frame = 0;
    const paint = () => {
      const moving = progress !== target;
      const state = moving ? (target === 1 ? "opening" : "closing") : target === 1 ? "open" : "closed";
      list.setAttribute("data-motion", state);
      list.setAttribute("data-progress", progress.toFixed(2));
      const eased = 1 - Math.pow(1 - progress, 3);
      list.style.opacity = String(eased);
      list.style.transform = progress < 1 ? `translateY(${(-8 * (1 - eased)).toFixed(2)}px)` : "";
    };
    const step = (now: number) => {
      const delta = (now - last) / DURATION;
      last = now;
      progress = target === 1 ? Math.min(1, progress + delta) : Math.max(0, progress - delta);
      paint();
      frame = progress === target ? 0 : requestAnimationFrame(step);
    };
    const toggle = (open: boolean) => {
      target = open ? 1 : 0;
      button.setAttribute("aria-expanded", String(open));
      if (reduce.matches) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        progress = target;
      } else if (!frame && progress !== target) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
      paint();
    };
    button.addEventListener("click", () => toggle(target === 0));
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || target === 0) return;
      toggle(false);
      button.focus();
    };
    list.addEventListener("keydown", close);
    button.addEventListener("keydown", close);
  });
}
