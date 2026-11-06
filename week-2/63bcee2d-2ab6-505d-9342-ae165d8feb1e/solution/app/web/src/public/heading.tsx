import { useEffect, useLayoutEffect, useRef } from "react";
import { reducedMotion } from "./shell";

// The page's level-1 heading. It takes focus after a page change, sets the page title, and when `reveal`
// is set its lines rise out of a mask one after another the first time it enters the viewport
// (in place at once under reduced motion).

let headingFocusPending = false;

/** A page change: the next page heading to mount takes focus. */
export function markHeadingFocus(): void {
  headingFocusPending = true;
}

/** Focuses a heading when a page change is waiting for one. */
function takeHeadingFocus(heading: HTMLElement | null): void {
  if (heading && headingFocusPending) {
    headingFocusPending = false;
    heading.focus();
  }
}

export function PageHeading({ lines, title, reveal = false, className = "" }: { lines: string[]; title: string; reveal?: boolean; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useLayoutEffect(() => {
    const heading = ref.current;
    takeHeadingFocus(heading);
    if (!heading || !reveal || reducedMotion()) return;
    const start = (): void => heading.classList.add("is-revealing");
    const box = heading.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) {
      start();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        start();
        observer.disconnect();
      }
    });
    observer.observe(heading);
    return () => observer.disconnect();
  }, [reveal, lines.join("\n")]);

  return (
    <h1 ref={ref} tabIndex={-1} className={`page-heading ${reveal ? "reveal" : ""} ${className}`}>
      {lines.map((line, index) => (
        <span key={index} className="line">
          <span className="line-inner" style={{ animationDelay: `${index * 160}ms` }}>{line}</span>
          {index < lines.length - 1 ? " " : ""}
        </span>
      ))}
    </h1>
  );
}

/** Splits a case study title into reveal lines at its comma, keeping the comma on the first line. */
export const titleLines = (title: string): string[] => {
  const at = title.indexOf(", ");
  return at < 0 ? [title] : [title.slice(0, at + 1), title.slice(at + 2)];
};
