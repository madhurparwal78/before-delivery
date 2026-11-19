import { useEffect, useRef } from "react";

const NOT_FOUND_COPY = "We couldn't find that page.";

export function NotFound() {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <main className="blunt-field">
      <h1 ref={heading} tabIndex={-1}>{NOT_FOUND_COPY}</h1>
    </main>
  );
}
