import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

const STATEMENTS = ['Four days.', 'Five venues.', 'One lattice.'] as const;

interface PinnedStoryProps {
  reducedMotion: boolean;
}

/** Pinned for three viewport heights; each third swaps the statement, tied to scroll. */
export function PinnedStory(props: PinnedStoryProps): JSX.Element {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (props.reducedMotion) return;
    const section = sectionRef.current;
    if (section === null) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const bounds = section.getBoundingClientRect();
      const travelled = -bounds.top;
      const distance = Math.max(1, bounds.height - window.innerHeight);
      setProgress(Math.max(0, Math.min(1, travelled / distance)));
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measure();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [props.reducedMotion]);

  if (props.reducedMotion) {
    return (
      <section className="story stacked ground-ultramarine" aria-label="About the festival">
        {STATEMENTS.map((statement) => (
          <p className="display" key={statement}>
            {statement}
          </p>
        ))}
      </section>
    );
  }

  const slot = Math.min(STATEMENTS.length - 1, Math.floor(progress * STATEMENTS.length));
  const within = progress * STATEMENTS.length - slot;

  return (
    <section
      className="story ground-ultramarine"
      aria-label="About the festival"
      ref={sectionRef}
      data-story-progress={progress.toFixed(2)}
    >
      <div className="story-pin">
        {STATEMENTS.map((statement, index) => {
          const active = index === slot;
          const entering = Math.min(1, within * 2.5);
          return (
            <p
              className="display"
              key={statement}
              style={{
                opacity: active ? entering : 0,
                transform: `translateY(${active ? (1 - entering) * 2.5 : 3}rem)`,
              }}
              aria-hidden={active ? undefined : true}
            >
              {statement}
            </p>
          );
        })}
      </div>
    </section>
  );
}
