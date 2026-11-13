import { useEffect, useRef, useState } from 'react';
import { springRegime, type SpringSeed } from '../../../shared/exhibits.js';
import { springAnnouncement } from '../../../shared/copy.js';
import { useStore } from '../../lib/store.js';

const SHARDS = 7;
const REST_SECONDS = 4;

export function SpringExhibit({ seed, onUse }: { seed: SpringSeed; onUse: () => void }): JSX.Element {
  const { reducedMotion } = useStore();
  const [stiffness, setStiffness] = useState(seed.stiffness.initial);
  const [damping, setDamping] = useState(seed.damping.initial);
  const [offsets, setOffsets] = useState<number[]>(() => new Array(SHARDS).fill(0));
  const animation = useRef<number | null>(null);

  const regime = springRegime(stiffness, damping);

  useEffect(
    () => () => {
      if (animation.current !== null) window.cancelAnimationFrame(animation.current);
    },
    [],
  );

  function pluck(): void {
    onUse();
    if (animation.current !== null) window.cancelAnimationFrame(animation.current);
    if (reducedMotion) {
      setOffsets(new Array(SHARDS).fill(0));
      return;
    }
    const started = performance.now();
    const omega = Math.sqrt(stiffness);
    const zeta = damping / (2 * omega);
    const damped = zeta < 1 ? omega * Math.sqrt(1 - zeta * zeta) : 0;
    const step = (): void => {
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed >= REST_SECONDS) {
        setOffsets(new Array(SHARDS).fill(0));
        animation.current = null;
        return;
      }
      const envelope = Math.exp(-zeta * omega * elapsed) * (1 - elapsed / REST_SECONDS);
      setOffsets(
        Array.from({ length: SHARDS }, (_unused, index) => {
          const lag = index * 0.3;
          const swing = damped > 0 ? Math.cos(damped * elapsed - lag) : 1;
          return 46 * envelope * swing;
        }),
      );
      animation.current = window.requestAnimationFrame(step);
    };
    animation.current = window.requestAnimationFrame(step);
  }

  return (
    <div className="exhibit">
      <span className="catalogue">HRR-IV-01</span>
      <h3>The spring sculpture</h3>
      <p>
        A chain of shards hangs on one spring. Set its stiffness and damping, then pluck it and watch the energy
        leave.
      </p>
      <div className="spring-stage" aria-hidden="true">
        {offsets.map((offset, index) => (
          <span
            key={index}
            style={{ left: `${8 + index * 13}%`, transform: `translateY(${offset}px)` }}
          />
        ))}
      </div>
      <div className="field">
        <label htmlFor="spring-stiffness">Stiffness</label>
        <input
          id="spring-stiffness"
          type="range"
          aria-label="Stiffness"
          min={seed.stiffness.min}
          max={seed.stiffness.max}
          step={seed.stiffness.step}
          value={stiffness}
          onChange={(event) => {
            setStiffness(Number(event.target.value));
            onUse();
          }}
        />
        <span className="readout">{stiffness}</span>
      </div>
      <div className="field">
        <label htmlFor="spring-damping">Damping</label>
        <input
          id="spring-damping"
          type="range"
          aria-label="Damping"
          min={seed.damping.min}
          max={seed.damping.max}
          step={seed.damping.step}
          value={damping}
          onChange={(event) => {
            setDamping(Number(event.target.value));
            onUse();
          }}
        />
        <span className="readout">{damping}</span>
      </div>
      <div className="inline-actions">
        <button type="button" onClick={pluck}>
          Pluck
        </button>
      </div>
      <p role="status" aria-label="Sculpture state" className="readout">
        {springAnnouncement(regime)}
      </p>
    </div>
  );
}
