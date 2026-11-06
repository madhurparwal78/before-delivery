import { useImperativeHandle, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { length } from '../format.js';
import { useSceneSnapshot } from './hooks.js';
import type { SceneModel } from './model.js';

export interface ClearanceHandle { focusSlider(): void }
interface ClearanceProps {
  model: SceneModel;
  /** The server's verdict word, for example `Fits`; rendered as an element with exactly this text. */
  verdictWord?: string;
  /** Escape on the slider: the part has returned to the rail start; the page moves focus to the parts row. */
  onEscape?: () => void;
}

const px = (value: number | undefined): string => (value === undefined ? '' : value.toFixed(1));

export function ClearanceRegion({ model, verdictWord, onEscape, ref }: ClearanceProps & { ref?: Ref<ClearanceHandle> }): ReactNode {
  const snap = useSceneSnapshot(model);
  const slider = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focusSlider: () => slider.current?.focus() }), []);
  const rail = snap.rail;
  if (!rail) return null;
  const units = snap.units;
  const fraction = rail.railMm > 0 ? rail.travelMm / rail.railMm : 0;
  const gap = (index: number): string => rail.stations[index]?.gapMm ?? '';
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 1 : 5;
    switch (event.key) {
      case 'ArrowRight': model.stepTravel(step); break;
      case 'ArrowLeft': model.stepTravel(-step); break;
      case 'Home': model.travelToStart(); break;
      case 'End': model.travelToStop(); break;
      case 'Escape': model.travelToStart(); onEscape?.(); break;
      default: return;
    }
    event.preventDefault();
  };
  const name = snap.selectedPart === 'hub-motor' ? 'Hub motor' : 'Traction pack';
  return (
    <section
      className="clearance"
      aria-label="Clearance"
      data-part={rail.part}
      data-travel-mm={rail.travelMm.toFixed(1)}
      data-rail-mm={rail.railMm.toFixed(1)}
      data-gap-s1-mm={gap(0)}
      data-gap-s2-mm={gap(1)}
      data-gap-s3-mm={gap(2)}
      data-smallest-gap-mm={rail.smallestGapMm}
      data-contact={rail.contact ? 'true' : 'false'}
      data-fouling-feature={rail.foulingFeature}
      data-fouling-screen-x={rail.contact && rail.foulingPoint ? px(rail.foulingPoint.x) : ''}
      data-fouling-screen-y={rail.contact && rail.foulingPoint ? px(rail.foulingPoint.y) : ''}
      data-leading-edge-screen-x={px(rail.leadingEdge.x)}
      data-leading-edge-screen-y={px(rail.leadingEdge.y)}
    >
      <header className="clearance-head">
        <h3 className="clearance-title">Clearance</h3>
        <span className="clearance-part">{name}</span>
        {verdictWord ? <span className="verdict-word" data-verdict={verdictWord}>{verdictWord}</span> : null}
      </header>
      <div
        ref={slider}
        className="travel-slider"
        role="slider"
        tabIndex={0}
        aria-label="Insertion travel"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={rail.railMm}
        aria-valuenow={rail.travelMm}
        aria-valuetext={length(rail.travelMm, units)}
        onKeyDown={onKeyDown}
      >
        <div className="travel-track" aria-hidden="true">
          <div className="travel-fill" style={{ width: `${fraction * 100}%` }} />
          {rail.stations.map((s) => (
            <span key={s.id} className="travel-tick" data-reached={s.reached} style={{ left: `${(s.travelMm / rail.railMm) * 100}%` }} />
          ))}
          <span className="travel-stop" data-contact={rail.contact} style={{ left: `${(rail.stopMm / rail.railMm) * 100}%` }} />
        </div>
      </div>
      <dl className="readout">
        <div className="readout-row">
          <dt>Travel</dt>
          <dd className="num">{length(rail.travelMm, units)} of {length(rail.railMm, units)}</dd>
        </div>
        {rail.stations.map((s) => (
          <div key={s.id} className="readout-row" data-reached={s.reached}>
            <dt>{s.name}</dt>
            <dd className="num">
              <span className="readout-at">at {length(s.travelMm, units)}</span>
              <span className="readout-gap">{s.reached ? `gap ${length(s.gapMm, units)}` : 'not reached'}</span>
            </dd>
          </div>
        ))}
        <div className="readout-row">
          <dt>Smallest gap</dt>
          <dd className="num">{rail.smallestGapMm ? length(rail.smallestGapMm, units) : 'none yet'}</dd>
        </div>
        {rail.contact ? (
          <div className="readout-row readout-contact">
            <dt>Contact</dt>
            <dd>{rail.foulingFeature}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
