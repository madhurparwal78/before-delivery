/** A heading that reveals one line at a time the first time it is seen. */

import { useEffect, useRef, useState } from 'react';
import { DURATION_SHORT } from '../lib/motion.js';

export function LineReveal({
  lines,
  className,
}: {
  lines: readonly string[];
  className?: string;
}): JSX.Element {
  const host = useRef<HTMLSpanElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = host.current;
    if (!node || revealed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [revealed]);

  return (
    <span
      className={`line-reveal ${className ?? ''}`.trim()}
      data-revealed={revealed ? 'true' : 'false'}
      ref={host}
    >
      {lines.map((line, index) => (
        <span className="line-mask" key={line}>
          <span
            className="line-body"
            style={{ transitionDelay: `${index * DURATION_SHORT}ms` }}
          >
            {line}
          </span>
        </span>
      ))}
    </span>
  );
}
