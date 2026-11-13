import { useEffect, useRef, useState } from 'react';
import { animate, reducedMotion } from '../motion.js';

interface SeamProps {
  boss: string;
  health: number;
  max: number;
  defeated: boolean;
  defeatLine: string;
}

const SEAM_DROP_MS = 440;

function BossName({ boss, under }: { boss: string; under: boolean }): JSX.Element {
  const text = useRef<SVGTextElement | null>(null);

  // The glyphs are fitted to the panel again once the display face has loaded.
  useEffect(() => {
    let dropped = false;
    void document.fonts.ready.then(() => {
      const element = text.current;
      if (dropped || !element) return;
      element.removeAttribute('textLength');
      element.setAttribute('textLength', '100');
    });
    return () => {
      dropped = true;
    };
  }, [boss]);

  return (
    <svg
      className={under ? 'seam-name seam-name-under' : 'seam-name'}
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <text ref={text} x="0" y="19" textLength="100" lengthAdjust="spacingAndGlyphs">
        {boss.toUpperCase()}
      </text>
    </svg>
  );
}

/** Two flat fields split by a seam: blush below for health left, aubergine above for damage dealt. */
export function HealthSeam({ boss, health, max, defeated, defeatLine }: SeamProps): JSX.Element {
  const remaining = useRef<HTMLDivElement | null>(null);
  const share = useRef(max > 0 ? Math.max(0, Math.min(1, health / max)) : 0);
  const [revealed, setRevealed] = useState(defeated);

  useEffect(() => {
    const target = max > 0 ? Math.max(0, Math.min(1, health / max)) : 0;
    const element = remaining.current;
    if (!element) return;
    const from = share.current;
    share.current = target;
    if (from === target) {
      element.style.height = `${target * 100}%`;
      return;
    }
    return animate(SEAM_DROP_MS, (progress) => {
      element.style.height = `${(from + (target - from) * progress) * 100}%`;
    });
  }, [health, max]);

  useEffect(() => {
    if (!defeated) {
      setRevealed(false);
      return;
    }
    if (reducedMotion()) {
      setRevealed(true);
      return;
    }
    const timer = window.setTimeout(() => setRevealed(true), SEAM_DROP_MS + 20);
    return () => window.clearTimeout(timer);
  }, [defeated]);

  if (defeated && revealed) {
    return (
      <div className="seam-panel defeat-field" data-seam="panel">
        <div className="defeat-word" aria-hidden="true">
          DOWN
        </div>
        <p className="defeat-line">{defeatLine}</p>
      </div>
    );
  }

  return (
    <div className="seam-panel" data-seam="panel">
      <BossName boss={boss} under={false} />
      <div
        className="seam-remaining"
        data-seam="remaining"
        ref={remaining}
        style={{ height: `${(max > 0 ? Math.max(0, Math.min(1, health / max)) : 0) * 100}%` }}
      >
        <div className="seam-inner">
          <BossName boss={boss} under={true} />
        </div>
      </div>
    </div>
  );
}
