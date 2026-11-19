import { store } from '../store.js';
import { ScrubField, useStoreState } from './common.js';
import { findLayer } from '../document.js';
import {
  barsBeats,
  playheadReadout,
  propertyLabel,
  RANGES,
  roundBpm,
  TICKS_PER_BAR,
} from '../../shared/domain.js';

const WINDOW_TICKS = TICKS_PER_BAR * 16;

export function Timeline() {
  const state = useStoreState();
  const doc = state.doc;
  if (doc === null) return null;
  const layer = findLayer(doc, state.selection);
  const lanes = [...new Set(doc.keys.filter((key) => key.layer_id === layer?.id).map((key) => key.property))];

  return (
    <section className="timeline" aria-label="Beat timeline">
      <div className="form-row">
        <span className="label">BPM</span>
        <div className="value-cell">
          <ScrubField
            label="BPM"
            value={doc.set.bpm}
            decimals={1}
            bpm
            min={RANGES.bpm.min}
            max={RANGES.bpm.max}
            onPreview={(next) => {
              store.transport.bpm = next;
              store.markDirty();
            }}
            onCommit={(next) =>
              store.commit({
                target: 'set',
                type: 'set.update',
                payload: { bpm: roundBpm(next) },
                baseVersion: doc.set.settings_version,
              })
            }
          />
        </div>
      </div>
      <div className="form-row">
        <span className="label">Playhead</span>
        <span role="timer" aria-label="Playhead position">
          {playheadReadout(Math.round(state.tick), doc.set.bpm)}
        </span>
      </div>

      {lanes.length === 0 ? (
        <p className="status-line">No keys on this layer yet</p>
      ) : (
        lanes.map((property) => (
          <div className="lane" key={property}>
            <span className="label">{propertyLabel(property)}</span>
            <div className="lane-track">
              <span
                className="playhead"
                style={{ left: `${(state.tick / WINDOW_TICKS) * 100}%` }}
                aria-hidden="true"
              />
              {doc.keys
                .filter((key) => key.layer_id === layer?.id && key.property === property)
                .map((key) => (
                  <button
                    key={`${key.property}-${key.tick}`}
                    type="button"
                    className="diamond"
                    style={{ left: `${(key.tick / WINDOW_TICKS) * 100}%` }}
                    aria-label={`Key ${propertyLabel(key.property)} at ${barsBeats(key.tick)}`}
                    onClick={() => store.seek(key.tick)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Delete') return;
                      event.preventDefault();
                      if (layer !== null) store.removeKey(layer.id, key.property, key.tick);
                    }}
                  />
                ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
