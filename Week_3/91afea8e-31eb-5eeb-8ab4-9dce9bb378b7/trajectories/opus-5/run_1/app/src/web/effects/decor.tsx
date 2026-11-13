/** Home and page decoration: particles, scroll scrubbing, parallax, cursor, morphs and bursts. */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFinePointer, useReducedMotion } from '../state.tsx';

/** The wordmark drawn from particles that scatter near the pointer and re-form. */
export function ParticleWordmark({ text }: { text: string }): ReactNode {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const context = element.getContext('2d');
    if (context === null) return;
    const width = 520;
    const height = 150;
    element.width = width;
    element.height = height;

    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const sampleContext = sample.getContext('2d');
    if (sampleContext === null) return;
    sampleContext.fillStyle = '#fff';
    let fontSize = 120;
    do {
      sampleContext.font = `900 ${fontSize}px "Darker Grotesque", sans-serif`;
      fontSize -= 4;
    } while (sampleContext.measureText(text).width > width - 16 && fontSize > 24);
    sampleContext.fillText(text, 8, height - 24);
    const pixels = sampleContext.getImageData(0, 0, width, height).data;

    type Particle = { x: number; y: number; homeX: number; homeY: number; vx: number; vy: number };
    const particles: Particle[] = [];
    for (let y = 0; y < height && particles.length < 6000; y += 3) {
      for (let x = 0; x < width && particles.length < 6000; x += 3) {
        if (pixels[(y * width + x) * 4 + 3] > 128) {
          particles.push({ x, y, homeX: x, homeY: y, vx: 0, vy: 0 });
        }
      }
    }

    if (reduced) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#ffd400';
      context.font = sampleContext.font;
      context.fillText(text, 8, height - 24);
      return;
    }

    let pointer: [number, number] = [-999, -999];
    const onMove = (event: PointerEvent): void => {
      const box = element.getBoundingClientRect();
      pointer = [
        ((event.clientX - box.left) / Math.max(box.width, 1)) * width,
        ((event.clientY - box.top) / Math.max(box.height, 1)) * height,
      ];
    };
    const onLeave = (): void => {
      pointer = [-999, -999];
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);

    let frame = 0;
    const draw = (): void => {
      frame = requestAnimationFrame(draw);
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#ffd400';
      for (const particle of particles) {
        const dx = particle.x - pointer[0];
        const dy = particle.y - pointer[1];
        const distance = Math.hypot(dx, dy);
        if (distance < 40) {
          particle.vx += (dx / (distance || 1)) * 1.4;
          particle.vy += (dy / (distance || 1)) * 1.4;
        }
        particle.vx += (particle.homeX - particle.x) * 0.05;
        particle.vy += (particle.homeY - particle.y) * 0.05;
        particle.vx *= 0.86;
        particle.vy *= 0.86;
        particle.x += particle.vx;
        particle.y += particle.vy;
        context.fillRect(particle.x, particle.y, 2, 2);
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced, text]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Chauraha"
      data-effect="wordmark"
      style={{ width: 'min(520px, 90vw)', height: 'auto' }}
    />
  );
}

/** How far the page has scrolled through the first 900 px, from 0 to 1. */
export function useScrollProgress(span = 900): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = (): void => {
      setProgress(Math.min(1, Math.max(0, window.scrollY / span)));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [span]);
  return progress;
}

/** The tiffin stack whose tiers open and close with the scroll, drawn as vector art. */
export function ScrollTiffin(): ReactNode {
  const reduced = useReducedMotion();
  const progress = useScrollProgress();
  const open = reduced ? 0 : progress;
  const tiers = [0, 1, 2];
  return (
    <svg
      className="tiffin"
      viewBox="0 0 200 260"
      role="img"
      aria-label="Steel tiffin stack"
      data-effect="tiffin"
    >
      <defs>
        <clipPath id="arch">
          <path d="M20 250 L20 90 A80 80 0 0 1 180 90 L180 250 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#arch)">
        <rect x="0" y="0" width="200" height="260" fill="#ffd400" />
        {tiers.map((tier) => (
          <rect
            key={tier}
            x={46 + tier * 4}
            y={170 - tier * 46 - open * (tier * 26)}
            width={108 - tier * 8}
            height={42}
            rx="6"
            fill={tier % 2 === 0 ? '#1b2ee8' : '#ff2d94'}
            stroke="#08080c"
            strokeWidth="3"
          />
        ))}
        <rect x="70" y={56 - open * 70} width="60" height="14" rx="7" fill="#08080c" />
      </g>
    </svg>
  );
}

/** Today's Deals: pinned while vertical scroll travels sideways across the panels. */
export function PinnedDealsRail({ children }: { children: ReactNode }): ReactNode {
  const reduced = useReducedMotion() || !useFinePointer();
  const holder = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLUListElement | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const onScroll = (): void => {
      const section = holder.current;
      const rail = track.current;
      if (section === null || rail === null) return;
      const box = section.getBoundingClientRect();
      const travel = Math.max(0, rail.scrollWidth - window.innerWidth + 32);
      const through = Math.min(1, Math.max(0, -box.top / Math.max(box.height - window.innerHeight, 1)));
      setOffset(through * travel);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  if (reduced) {
    return (
      <div ref={holder} data-effect="deals-rail-still">
        <ul className="plain deals-rail" ref={track}>
          {children}
        </ul>
      </div>
    );
  }

  return (
    <div ref={holder} style={{ height: '180vh' }} data-effect="deals-rail">
      <div style={{ position: 'sticky', top: 0, overflow: 'hidden', paddingTop: 24 }}>
        <ul
          className="plain deals-rail"
          ref={track}
          style={{
            transform: `translateX(${-offset}px)`,
            transition: 'transform 0.2s linear',
            overflow: 'visible',
          }}
        >
          {children}
        </ul>
      </div>
    </div>
  );
}

/** Category banners in three layers that move at a fifth, a half and full scroll speed. */
export function ParallaxBanner({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): ReactNode {
  const reduced = useReducedMotion();
  const holder = useRef<HTMLDivElement | null>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const onScroll = (): void => {
      const element = holder.current;
      if (element === null) return;
      const box = element.getBoundingClientRect();
      setShift((window.innerHeight - box.top) * 0.1);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  const layer = (depth: number): React.CSSProperties =>
    reduced ? {} : { transform: `translateY(${-shift * depth}px)` };

  return (
    <div ref={holder} className="panel panel-black" data-effect="parallax" style={{ overflow: 'hidden' }}>
      <div style={layer(0.2)} aria-hidden="true">
        <div style={{ height: 8, background: 'var(--pink)', borderRadius: 999 }} />
      </div>
      <div style={layer(0.5)}>
        <KineticHeading text={title} />
      </div>
      <div style={layer(1)}>{children}</div>
    </div>
  );
}

/** A heading whose letters scatter on hover and regroup. */
export function KineticHeading({ text }: { text: string }): ReactNode {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState(false);
  return (
    <h3
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      data-effect="kinetic-heading"
    >
      {[...text].map((character, index) => (
        <span
          key={`${index}-${character}`}
          style={
            reduced || !hover
              ? undefined
              : {
                  display: 'inline-block',
                  transform: `translateY(${((index % 3) - 1) * 10}px) rotate(${((index % 5) - 2) * 4}deg)`,
                  transition: 'transform 0.3s ease-out',
                }
          }
        >
          {character === ' ' ? '\u00a0' : character}
        </span>
      ))}
    </h3>
  );
}

/** `today only` wrapped around a slowly turning cylinder. */
export function CylinderLabel({ text }: { text: string }): ReactNode {
  const reduced = useReducedMotion();
  return (
    <span
      className="chip"
      data-effect="cylinder"
      style={
        reduced
          ? undefined
          : {
              display: 'inline-block',
              animation: 'cylinder 10s linear infinite',
              transformStyle: 'preserve-3d',
            }
      }
    >
      {text}
    </span>
  );
}

/** The slow wave field behind the sign-in and checkout panels, seeded on each load. */
export function NoiseBackdrop(): ReactNode {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const context = element.getContext('2d');
    if (context === null) return;
    const seed = Math.random() * 1000;
    let frame = 0;
    const draw = (time: number): void => {
      const width = (element.width = window.innerWidth);
      const height = (element.height = window.innerHeight);
      context.fillStyle = '#1522b4';
      context.fillRect(0, 0, width, height);
      context.strokeStyle = 'rgba(255, 212, 0, 0.18)';
      context.lineWidth = 2;
      const phase = reduced ? 0 : time / 2600;
      for (let line = 0; line < 14; line += 1) {
        context.beginPath();
        for (let x = 0; x <= width; x += 12) {
          const y =
            (height / 14) * line +
            Math.sin(x / 150 + phase + seed + line) * 18 +
            Math.cos(x / 90 - phase) * 8;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    draw(0);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  return <canvas ref={canvas} className="noise-backdrop" aria-hidden="true" data-effect="noise" />;
}

/** The magnetic cursor, only on fine pointers with motion allowed. */
export function MagneticCursor(): ReactNode {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const dot = useRef<HTMLDivElement | null>(null);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!fine || reduced) {
      document.body.classList.remove('no-cursor');
      return;
    }
    document.body.classList.add('no-cursor');
    const onMove = (event: PointerEvent): void => {
      const element = dot.current;
      if (element === null) return;
      element.style.transform = `translate(${event.clientX - 9}px, ${event.clientY - 9}px)`;
      const target = event.target as HTMLElement | null;
      const over = target?.closest('[data-effect="viewer"]');
      const card = target?.closest('article');
      setLabel(over !== null && over !== undefined ? 'drag' : card !== null && card !== undefined ? '' : '');
      element.style.width = card !== null && card !== undefined ? '34px' : '18px';
      element.style.height = card !== null && card !== undefined ? '34px' : '18px';
      const typing =
        target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      element.style.opacity = typing ? '0' : '1';
      document.body.classList.toggle('no-cursor', !typing);
    };
    const onKey = (): void => {
      document.body.classList.remove('no-cursor');
      if (dot.current !== null) dot.current.style.opacity = '0';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-cursor');
    };
  }, [fine, reduced]);

  if (!fine || reduced) return null;
  return (
    <div className="cursor-dot" ref={dot} aria-hidden="true" data-effect="cursor">
      {label}
    </div>
  );
}

/** Chips that drop into the cart drawer and settle under gravity. */
export function FallingChips({ trigger }: { trigger: number }): ReactNode {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chips = useRef<{ x: number; y: number; vy: number; colour: string }[]>([]);

  useEffect(() => {
    if (trigger === 0) return;
    const colours = ['#ffd400', '#ff2d94', '#00c389'];
    chips.current.push({
      x: 20 + Math.random() * 100,
      y: reduced ? 150 : -20,
      vy: 0,
      colour: colours[chips.current.length % colours.length],
    });
    if (chips.current.length > 6) chips.current.shift();
  }, [trigger, reduced]);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const context = element.getContext('2d');
    if (context === null) return;
    element.width = 160;
    element.height = 180;
    let frame = 0;
    const draw = (): void => {
      frame = requestAnimationFrame(draw);
      context.clearRect(0, 0, 160, 180);
      let floor = 170;
      for (const chip of chips.current) {
        if (!reduced) {
          chip.vy += 0.6;
          chip.y = Math.min(chip.y + chip.vy, floor - 16);
          if (chip.y >= floor - 16) chip.vy = 0;
        } else {
          chip.y = floor - 16;
        }
        floor -= 18;
        context.fillStyle = chip.colour;
        context.fillRect(chip.x, chip.y, 44, 16);
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  return <canvas ref={canvas} className="chips-layer" aria-hidden="true" data-effect="chips" />;
}

/** One confetti burst when the placed heading first appears. */
export function PlacedBurst(): ReactNode {
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    const element = canvas.current;
    if (element === null) return;
    const context = element.getContext('2d');
    if (context === null) return;
    const width = (element.width = window.innerWidth);
    const height = (element.height = window.innerHeight);
    const colours = ['#ffd400', '#ff2d94', '#00c389', '#ffffff'];
    const pieces = Array.from({ length: 120 }, (_, index) => ({
      x: width / 2,
      y: height / 3,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 1) * 11,
      colour: colours[index % colours.length],
    }));
    let frame = 0;
    let ticks = 0;
    const draw = (): void => {
      ticks += 1;
      context.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.vy += 0.3;
        piece.x += piece.vx;
        piece.y += piece.vy;
        context.fillStyle = piece.colour;
        context.fillRect(piece.x, piece.y, 8, 12);
      }
      if (ticks < 110) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  if (reduced) return null;
  return <canvas ref={canvas} className="burst" aria-hidden="true" data-effect="burst" />;
}

/** The cart icon that morphs to a check mark, and the wishlist heart that fills. */
export function MorphIcon({
  kind,
  active,
}: {
  kind: 'cart' | 'heart';
  active: boolean;
}): ReactNode {
  const reduced = useReducedMotion();
  const path =
    kind === 'cart'
      ? active
        ? 'M4 13 L9 18 L20 6'
        : 'M3 5 h3 l2 9 h9 l2 -6 H7'
      : active
        ? 'M12 20 C4 14 4 7 8 6 C10 5.4 12 7 12 9 C12 7 14 5.4 16 6 C20 7 20 14 12 20 Z'
        : 'M12 19 C5 13.6 5.6 8 8.4 7.2 C10 6.8 12 8.4 12 10 C12 8.4 14 6.8 15.6 7.2 C18.4 8 19 13.6 12 19 Z';
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      data-effect={`morph-${kind}`}
      style={reduced ? undefined : { transition: 'all 0.6s ease-out' }}
    >
      <path
        d={path}
        fill={kind === 'heart' && active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
