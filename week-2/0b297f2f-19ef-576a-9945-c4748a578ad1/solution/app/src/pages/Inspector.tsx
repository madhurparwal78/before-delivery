import { useRef, useState } from "react";
import { formatLength, type Unit } from "../../shared/units";
import { request } from "../api";
import { FIELD_MESSAGES, say } from "../copy";
import { luxHours, luxText, statusText } from "../format";
import { isFailure, useStore } from "../store";
import { Button } from "../ui/Button";
import { LuxStatus } from "./Ledger";
import type { Placement, Wall } from "../types";

interface InspectorProps {
  selected: Placement | null;
  unit: Unit;
  canRemove: boolean;
  removing: boolean;
  onRemove: (p: Placement) => void;
  onDetails: (p: Placement, opener: HTMLElement) => void;
  children?: React.ReactNode;
}

export function Inspector({ selected, unit, canRemove, removing, onRemove, onDetails, children }: InspectorProps) {
  return (
    <section aria-label="Inspector" className="inspector">
      <div className="inspector-work">
        {selected ? (
          <>
            <h3 className="inspector-title">{selected.objectTitle}</h3>
            <dl className="facts">
              <div>
                <dt>Object number</dt>
                <dd>{selected.objectNumber}</dd>
              </div>
              <div>
                <dt>Wall</dt>
                <dd>{selected.wallName}</dd>
              </div>
              <div>
                <dt>Offset</dt>
                <dd>{formatLength(selected.offsetMm, unit)}</dd>
              </div>
              <div>
                <dt>Centre height</dt>
                <dd>
                  {formatLength(selected.centreHeightMm, unit)}
                  {selected.heightOverride ? " (exception)" : ""}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>
                  {formatLength(selected.widthMm, unit)} × {formatLength(selected.heightMm, unit)}
                </dd>
              </div>
              <div>
                <dt>Planned lux</dt>
                <dd>{luxText(selected.plannedLux)}</dd>
              </div>
              <div>
                <dt>Lux-hours</dt>
                <dd>
                  {luxHours(selected.plannedLuxHours)} of {luxHours(selected.luxHourBudget)}
                </dd>
              </div>
              <div>
                <dt>Lux status</dt>
                <dd>
                  <LuxStatus placement={selected} />
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{statusText(selected.status, selected.claimedBy?.name ?? null)}</dd>
              </div>
            </dl>
            <div className="inspector-actions">
              <Button onClick={(e) => onDetails(selected, e.currentTarget)}>Details</Button>
              {canRemove && (
                <Button busy={removing} onClick={() => onRemove(selected)}>
                  Remove from wall
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="inspector-empty">Select a work in the scene or the ledger to see where it hangs.</p>
        )}
      </div>
      <Walls />
      {children}
    </section>
  );
}

/** One lux level per wall; saves made before an earlier one answers are sent in order and only the last is shown. */
function Walls() {
  const store = useStore();
  const walls = store.exhibition?.gallery.walls ?? [];
  const curator = store.staff?.role === "curator";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, number>>({});
  const queue = useRef(new Map<string, Promise<void>>());
  const latest = useRef(new Map<string, number>());

  const save = (wall: Wall) => {
    const text = (drafts[wall.id] ?? String(wall.plannedLux)).trim();
    const value = Number(text);
    const token = (latest.current.get(wall.id) ?? 0) + 1;
    latest.current.set(wall.id, token);
    if (!/^\d+$/.test(text) || value < 1 || value > 1000) {
      setErrors((e) => ({ ...e, [wall.id]: FIELD_MESSAGES.luxLevel }));
      store.announce(FIELD_MESSAGES.luxLevel);
      return;
    }
    setBusy((b) => ({ ...b, [wall.id]: (b[wall.id] ?? 0) + 1 }));
    const previous = queue.current.get(wall.id) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        const data = await request<{ wall: Wall; placements: Placement[] }>("PATCH", `/api/walls/${wall.id}`, { plannedLux: value });
        if (latest.current.get(wall.id) !== token) return;
        store.setWall(wall.id, data.wall.plannedLux);
        data.placements.forEach(store.putPlacement);
        setDrafts((d) => ({ ...d, [wall.id]: String(data.wall.plannedLux) }));
        setErrors((e) => ({ ...e, [wall.id]: "" }));
        store.announce(say.wallLux(wall.name, data.wall.plannedLux));
      } catch (error) {
        if (latest.current.get(wall.id) !== token) return;
        const message = isFailure(error) ? (error.fields.plannedLux ?? error.message) : FIELD_MESSAGES.luxLevel;
        setErrors((e) => ({ ...e, [wall.id]: message }));
        store.announce(message);
      } finally {
        setBusy((b) => ({ ...b, [wall.id]: (b[wall.id] ?? 1) - 1 }));
      }
    });
    queue.current.set(wall.id, run);
  };

  return (
    <section aria-label="Walls" className="walls">
      <h3>Walls</h3>
      <ul className="wall-list">
        {walls.map((w) => (
          <li key={w.id} className="wall-row">
            {curator ? (
              <>
                <label htmlFor={`lux-${w.id}`} className="wall-name">
                  {w.name}
                </label>
                <div className="wall-edit">
                  <input
                    id={`lux-${w.id}`}
                    type="text"
                    inputMode="numeric"
                    aria-label={`Lux on ${w.name}`}
                    aria-invalid={errors[w.id] ? true : undefined}
                    aria-describedby={errors[w.id] ? `lux-${w.id}-error` : undefined}
                    value={drafts[w.id] ?? String(w.plannedLux)}
                    onChange={(e) => setDrafts((d) => ({ ...d, [w.id]: e.target.value }))}
                  />
                  <span className="unit-label" aria-hidden="true">
                    lux
                  </span>
                  <Button aria-label={`Save lux for ${w.name}`} busy={(busy[w.id] ?? 0) > 0} onClick={() => save(w)}>
                    Save
                  </Button>
                </div>
                {errors[w.id] && (
                  <p className="field-error" id={`lux-${w.id}-error`}>
                    {errors[w.id]}
                  </p>
                )}
              </>
            ) : (
              <p className="wall-read">
                <span className="wall-name">{w.name}</span> <span className="num">{luxText(w.plannedLux)}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
