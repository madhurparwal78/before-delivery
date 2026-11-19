import { barsBeats, readout, roundBpm, snapTick, TICK_LIMIT, TICKS_PER_BAR, TICKS_PER_BEAT } from "../../shared/beat.ts";
import { propertyLabel } from "../../shared/layers.ts";
import type { EditorStore } from "../store/editor.ts";
import { useFrames } from "./hooks.ts";
import { ScrubField } from "./ScrubField.tsx";

const BEAT_PX = 14;
const WIDTH = (TICK_LIMIT / TICKS_PER_BEAT) * BEAT_PX;

function Readout({ store }: { store: EditorStore }) {
  useFrames(store);
  return (
    <div role="timer" aria-label="Playhead position" className="readout">
      {readout(store.transport.tick(), store.doc.set.bpm)}
    </div>
  );
}

function Playhead({ store }: { store: EditorStore }) {
  useFrames(store);
  return <div className="playhead" aria-hidden="true" style={{ left: (store.transport.tick() / TICKS_PER_BEAT) * BEAT_PX }} />;
}

export function TimelinePane({ store }: { store: EditorStore }) {
  const layer = store.selected;
  const keys = layer ? store.doc.keys.filter((key) => key.layer_id === layer.id) : [];
  const properties = [...new Set(keys.map((key) => key.property))];
  const bars = Array.from({ length: TICK_LIMIT / TICKS_PER_BAR }, (_value, index) => index);
  const seek = (tick: number): void => store.transport.seek(tick);
  return (
    <section aria-label="Beat timeline" role="region" className="timeline">
      <div className="timeline-bar">
        <label className="timeline-bpm">
          <span>BPM</span>
          <ScrubField
            label="BPM"
            value={store.doc.set.bpm}
            min={40}
            max={240}
            decimals={1}
            fixedStep={0.1}
            normalize={roundBpm}
            disabled={!store.canEdit}
            error={store.fieldErrors.get("set:bpm")}
            onCommit={(bpm) => store.commit({ type: "set.update", target: "set", payload: { bpm } })}
          />
        </label>
        <Readout store={store} />
      </div>
      <div className="lanes">
        <div className="lane-labels">
          <div className="lane-ruler-label" />
          {properties.map((property) => (
            <div key={property} className="lane-label">{propertyLabel(property)}</div>
          ))}
        </div>
        <div className="lane-scroll" tabIndex={0} role="region" aria-label="Timeline lanes">
          <div className="lane-area" style={{ width: WIDTH }}>
            <div
              className="lane-ruler"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                seek(snapTick(((event.clientX - box.left) / BEAT_PX) * TICKS_PER_BEAT));
              }}
            >
              {bars.map((bar) => (
                <span key={bar} className="ruler-mark" style={{ left: bar * 4 * BEAT_PX }}>{bar + 1}</span>
              ))}
            </div>
            {properties.map((property) => (
              <div key={property} className="lane">
                {keys.filter((key) => key.property === property).map((key) => {
                  const label = `Key ${propertyLabel(property)} at ${barsBeats(key.tick)}`;
                  return (
                    <button
                      key={key.tick}
                      type="button"
                      className="diamond"
                      aria-label={label}
                      style={{ left: (key.tick / TICKS_PER_BEAT) * BEAT_PX }}
                      onClick={() => seek(key.tick)}
                      onKeyDown={(event) => {
                        if (event.key === "Delete" && store.canEdit) {
                          event.preventDefault();
                          store.commit({ type: "key.remove", target: key.layer_id, payload: { property, tick: key.tick } });
                        }
                      }}
                    />
                  );
                })}
              </div>
            ))}
            <Playhead store={store} />
          </div>
        </div>
      </div>
      {!layer ? <p className="muted pad">Select a layer to see its keys.</p> : keys.length === 0 ? <p className="muted pad">No keys on {layer.name} yet.</p> : null}
    </section>
  );
}
