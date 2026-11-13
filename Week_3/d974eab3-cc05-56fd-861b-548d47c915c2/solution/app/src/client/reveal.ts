import { reducedMotion } from "./motion.js";

/** Chapter headings rise into place the first time they enter the viewport. */
export function headingReveal(signal: AbortSignal): (heading: HTMLElement) => void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.setAttribute("data-reveal", "done");
      observer.unobserve(entry.target);
    }
  });
  signal.addEventListener("abort", () => observer.disconnect());
  return (heading) => {
    if (reducedMotion()) return;
    heading.setAttribute("data-reveal", "pending");
    observer.observe(heading);
  };
}
