import { useEffect, useMemo, useRef, useState } from 'react';
import { DISCIPLINE_COLOURS, PAPER } from '../lattice/scene.js';
import type { Entry } from '../lib/types.js';
import { SectionHead } from './Display.js';
import type { JSX } from 'react';

interface GalleryProps {
  entries: Entry[];
  reducedMotion: boolean;
}

/** A frame drawn from the entry id, used when an entry carries no uploaded image. */
function ProceduralArtwork(props: { entry: Entry }): JSX.Element {
  const seed = useMemo(() => {
    let value = 0;
    for (const character of props.entry.id) {
      value = (value * 31 + character.codePointAt(0)!) % 100_000;
    }
    return value;
  }, [props.entry.id]);

  const colour = DISCIPLINE_COLOURS[props.entry.discipline] ?? PAPER;
  const bars = Array.from({ length: 9 }, (_, index) => {
    const pseudo = ((seed >> index) * 1103515245 + index * 12345) % 1000;
    return {
      x: 6 + index * 10.5,
      height: 18 + (pseudo % 70),
      width: 4 + (pseudo % 6),
      rotate: ((pseudo % 23) - 11) / 2,
    };
  });

  return (
    <svg viewBox="0 0 100 100" role="presentation" className="artwork">
      <rect x="0" y="0" width="100" height="100" fill="#0e0e10" />
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={bar.x}
          y={95 - bar.height}
          width={bar.width}
          height={bar.height}
          fill={colour}
          opacity={0.45 + ((seed + index) % 6) / 10}
          transform={`rotate(${bar.rotate} ${bar.x + bar.width / 2} ${95 - bar.height / 2})`}
        />
      ))}
      <circle cx={20 + (seed % 60)} cy={20 + (seed % 40)} r={6 + (seed % 9)} fill={PAPER} opacity="0.8" />
    </svg>
  );
}

const MASKS = [
  'polygon(0 6%, 92% 0, 100% 86%, 8% 100%)',
  'polygon(6% 0, 100% 8%, 94% 100%, 0 90%)',
  'polygon(0 0, 100% 4%, 88% 100%, 4% 92%)',
];

/** Pinned while vertical scroll pans the frames sideways, and a wrapping grid with reduced motion. */
export function Gallery(props: GalleryProps): JSX.Element {
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
      const distance = Math.max(1, bounds.height - window.innerHeight);
      setProgress(Math.max(0, Math.min(1, -bounds.top / distance)));
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

  const frames = props.entries.map((entry, index) => {
    const image = entry.images.find((candidate) => candidate.display_url !== null);
    const open = props.reducedMotion ? 1 : Math.min(1, Math.max(0, progress * 3 - index * 0.2));
    return (
      <figure
        key={entry.id}
        className="frame"
        style={{
          clipPath: MASKS[index % MASKS.length],
          opacity: props.reducedMotion ? 1 : 0.35 + open * 0.65,
        }}
      >
        {image === undefined ? (
          <ProceduralArtwork entry={entry} />
        ) : (
          <img src={image.display_url ?? ''} alt={entry.title} className="artwork" />
        )}
        <figcaption>{`${entry.title} — ${entry.artist_name}`}</figcaption>
      </figure>
    );
  });

  if (props.reducedMotion) {
    return (
      <section className="gallery wrapping ground-vermilion" aria-label="Gallery">
        <SectionHead>Gallery</SectionHead>
        <div className="frames grid">{frames}</div>
      </section>
    );
  }

  const pan = progress * Math.max(0, props.entries.length - 1.4) * 34;

  return (
    <section
      className="gallery ground-vermilion"
      aria-label="Gallery"
      ref={sectionRef}
      data-gallery-progress={progress.toFixed(2)}
    >
      <div className="gallery-pin">
        <SectionHead>Gallery</SectionHead>
        <div className="frames band" style={{ transform: `translateX(-${pan.toFixed(2)}vw)` }}>
          {frames}
        </div>
      </div>
    </section>
  );
}
