import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { copy } from '../../shared/copy.js';
import type { Narration, Plate } from '../../shared/types.js';

const PLATE_HOLD_MS = 7000;

export function Plates({ plates }: { plates: Plate[] }): JSX.Element {
  const { reducedMotion } = useStore();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (reducedMotion || !playing || held || plates.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % plates.length), PLATE_HOLD_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion, playing, held, plates.length]);

  if (plates.length === 0) return <p className="secondary">{copy.mediaUnavailable}</p>;

  return (
    <section
      aria-label="Plates"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="plate-viewer">
        {plates.map((plate, position) => (
          <img
            key={plate.media_url}
            src={plate.media_url}
            alt={plate.caption}
            className={position === index ? 'is-current' : ''}
          />
        ))}
      </div>
      <p className="secondary">{plates[index]?.caption}</p>
      <div className="inline-actions">
        {reducedMotion ? (
          <>
            <button
              type="button"
              onClick={() => setIndex((current) => (current - 1 + plates.length) % plates.length)}
            >
              Previous plate
            </button>
            <button type="button" onClick={() => setIndex((current) => (current + 1) % plates.length)}>
              Next plate
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setPlaying((current) => !current)}>
            {playing ? 'Pause plates' : 'Play plates'}
          </button>
        )}
      </div>
    </section>
  );
}

export function NarrationPlayer({ narration }: { narration: Narration | null }): JSX.Element {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  if (!narration) return <p className="secondary">{copy.mediaUnavailable}</p>;

  return (
    <div>
      <audio ref={audio} src={narration.media_url} onEnded={() => setPlaying(false)} preload="none" />
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            const element = audio.current;
            if (!element) return;
            if (playing) {
              element.pause();
              setPlaying(false);
              return;
            }
            void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
          }}
        >
          {playing ? 'Pause narration' : 'Play narration'}
        </button>
        <button type="button" aria-expanded={transcriptOpen} onClick={() => setTranscriptOpen((open) => !open)}>
          Transcript
        </button>
      </div>
      {transcriptOpen ? <p className="secondary">{narration.transcript}</p> : null}
    </div>
  );
}

export function ThresholdBand({ title, href }: { title: string; href: string }): JSX.Element {
  const { reducedMotion } = useStore();
  const band = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      setProgress(1);
      return undefined;
    }
    const onScroll = (): void => {
      const element = band.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const travelled = window.innerHeight - box.bottom;
      const span = box.height || 1;
      setProgress(Math.min(1, Math.max(0, travelled / span + 1)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reducedMotion]);

  const letters = [...title];

  return (
    <div className="threshold" ref={band}>
      <span className="catalogue">Threshold</span>
      <p className="threshold-letters" aria-hidden="true">
        {letters.map((letter, index) => {
          const settled = progress * letters.length >= index + 1;
          const drift = settled ? 0 : ((index % 5) - 2) * 18;
          return (
            <span key={index} style={{ transform: `translate(${drift}px, ${settled ? 0 : drift / 2}px)`, opacity: settled ? 1 : 0.35 }}>
              {letter === ' ' ? '\u00a0' : letter}
            </span>
          );
        })}
      </p>
      <a href={href}>{`Next: ${title}`}</a>
    </div>
  );
}
