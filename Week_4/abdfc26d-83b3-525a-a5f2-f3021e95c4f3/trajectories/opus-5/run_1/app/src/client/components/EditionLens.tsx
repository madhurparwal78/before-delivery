import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditionEntry, EditionStatus } from '../../shared/api.js';
import { useReducedMotion } from '../lib/hooks.js';
import { seedFromHash } from '../lib/editionSeed.js';
import { LiveCanvas } from './LiveCanvas.js';
import type { ShaderUniform } from '../lib/shaderCanvas.js';

const LENS_DESKTOP = 240;
const LENS_PHONE = 176;
const SETTLE_MS = 500;

export interface EditionLensProps {
  readonly slug: string;
  readonly fragmentSource: string;
  readonly uniforms: readonly ShaderUniform[];
  readonly editionCount: number;
  readonly editions: readonly EditionEntry[];
  readonly edition: number;
  readonly locked: boolean;
  onEditionChange(edition: number): void;
  onClaim(edition: number): void;
}

function statusOf(editions: readonly EditionEntry[], edition: number): EditionStatus {
  return editions.find((entry) => entry.number === edition)?.status ?? 'available';
}

function seedOf(editions: readonly EditionEntry[], slug: string, edition: number): number {
  const hash = editions.find((entry) => entry.number === edition)?.seed_hash;
  return hash ? seedFromHash(hash) : 0;
}

/**
 * The signature lens. It maps pointer, touch and keyboard input to an edition
 * number, renders that number's seed variation inside the circle, and asks for
 * a hold on Enter, a click or a tap.
 */
export const EditionLens = forwardRef<HTMLDivElement, EditionLensProps>(function EditionLens(
  {
    slug,
    fragmentSource,
    uniforms,
    editionCount,
    editions,
    edition,
    locked,
    onEditionChange,
    onClaim,
  },
  forwardedRef,
) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [eased, setEased] = useState<{ x: number; y: number } | null>(null);
  const [moved, setMoved] = useState(false);
  const [numeralKick, setNumeralKick] = useState(0);

  const lensSize =
    typeof window !== 'undefined' && window.innerWidth < 768 ? LENS_PHONE : LENS_DESKTOP;
  const status = statusOf(editions, edition);
  const seed = seedOf(editions, slug, edition);

  /** The left edge is 1, the right edge is M, evenly spaced and rounded. */
  const editionAt = useCallback(
    (clientX: number): number => {
      const stage = stageRef.current;
      if (!stage || editionCount < 1) return 1;
      const rect = stage.getBoundingClientRect();
      if (rect.width === 0) return 1;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.min(editionCount, Math.max(1, Math.round(1 + ratio * (editionCount - 1))));
    },
    [editionCount],
  );


  const previousEdition = useRef(edition);
  useEffect(() => {
    if (previousEdition.current === edition) return;
    previousEdition.current = edition;
    if (reducedMotion) return;
    setNumeralKick((value) => value + 1);
    const timer = window.setTimeout(() => setNumeralKick(0), SETTLE_MS / 3);
    return () => window.clearTimeout(timer);
  }, [edition, reducedMotion]);

  const trackPointer = (clientX: number, clientY: number): void => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setPointer({ x: clientX - rect.left, y: clientY - rect.top });
    if (!moved) setMoved(true);
    if (!locked) onEditionChange(editionAt(clientX));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = edition - 1;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = edition + 1;
        break;
      case 'PageDown':
        next = edition - 10;
        break;
      case 'PageUp':
        next = edition + 10;
        break;
      case 'Home':
        next = 1;
        break;
      case 'End':
        next = editionCount;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onClaim(edition);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!moved) setMoved(true);
    if (!locked) onEditionChange(Math.min(editionCount, Math.max(1, next)));
  };

  const ringClass = `edition-lens__ring edition-lens__ring--${status}`;

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const measure = (): void =>
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  /**
   * Where the lens wants to be: under the pointer while one is on the stage,
   * otherwise at the position that maps to N, so keyboard and touch users see
   * the lens too.
   */
  const target = useMemo(() => {
    if (pointer) return pointer;
    if (stageSize.width === 0) return null;
    return {
      x:
        editionCount > 1
          ? ((edition - 1) / (editionCount - 1)) * stageSize.width
          : stageSize.width / 2,
      y: stageSize.height / 2,
    };
  }, [pointer, stageSize, edition, editionCount]);

  // The lens follows its target with an eased lag that settles within about
  // half a second; under reduced motion it jumps straight there.
  useEffect(() => {
    if (!target) return;
    if (reducedMotion) {
      setEased(target);
      return;
    }
    let frame = 0;
    const step = (): void => {
      setEased((current) => {
        if (!current) return target;
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) return target;
        frame = requestAnimationFrame(step);
        return { x: current.x + dx * 0.22, y: current.y + dy * 0.22 };
      });
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reducedMotion]);

  const stagePosition = eased ?? target;
  const lensLeft = stagePosition ? stagePosition.x : null;
  const lensTop = stagePosition ? stagePosition.y : null;

  return (
    <div
      className="edition-lens"
      ref={(node) => {
        stageRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        trackPointer(event.clientX, event.clientY);
      }}
      onPointerLeave={() => {
        if (!locked) setPointer(null);
      }}
      onTouchMove={(event) => {
        const touch = event.touches[0];
        if (!touch) return;
        trackPointer(touch.clientX, touch.clientY);
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (!touch) return;
        trackPointer(touch.clientX, touch.clientY);
      }}
      onClick={(event) => {
        if (!locked) onEditionChange(editionAt(event.clientX));
        onClaim(locked ? edition : editionAt(event.clientX));
      }}
    >
      <LiveCanvas
        className="edition-lens__base"
        fragmentSource={fragmentSource}
        uniforms={uniforms}
        seed={0}
      />

      {lensLeft !== null && lensTop !== null && (
        <div
          className={ringClass}
          style={{
            width: `${lensSize}px`,
            height: `${lensSize}px`,
            transform: `translate(${lensLeft - lensSize / 2}px, ${lensTop - lensSize / 2}px)`,
          }}
          aria-hidden="true"
        >
          <div className="edition-lens__inner">
            <LiveCanvas
              className="edition-lens__variation"
              fragmentSource={fragmentSource}
              uniforms={uniforms}
              seed={seed}
            />
          </div>
        </div>
      )}

      <div className="edition-lens__readout">
        <span
          className={`edition-lens__numeral numeral${numeralKick ? ' edition-lens__numeral--kick' : ''}`}
          key={`numeral-${edition}`}
        >
          {edition}
        </span>
        <span className="edition-lens__caption tabular">
          {moved ? `of ${editionCount} · ${status}` : `of ${editionCount} · move to choose`}
        </span>
      </div>

      <div
        className="edition-lens__slider"
        ref={sliderRef}
        role="slider"
        tabIndex={0}
        aria-label="Edition"
        aria-valuemin={1}
        aria-valuemax={editionCount}
        aria-valuenow={edition}
        aria-valuetext={`Edition ${edition} of ${editionCount}, ${status}`}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          event.stopPropagation();
          onClaim(edition);
        }}
      >
        <span className="visually-hidden">
          Edition {edition} of {editionCount}, {status}
        </span>
      </div>
    </div>
  );
});
