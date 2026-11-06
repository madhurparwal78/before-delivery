import { SENSOR_KIND_WORD } from "../format";
import type { Sensor } from "../types";

interface SensorsProps {
  sensors: Sensor[];
  selected: string[];
  contributing: string[] | null;
  onToggle: (sensorId: string) => void;
}

export function Sensors({ sensors, selected, contributing, onToggle }: SensorsProps) {
  const lastSelected = selected.length === 1 ? selected[0] : null;
  return (
    <section role="group" aria-label="Sensors" className="pane sensors-pane">
      <h2 className="pane-title">Sensors</h2>
      <ul className="sensor-list">
        {sensors.map((s) => (
          <li key={s.id}>
            <label className={`sensor-check ${contributing?.includes(s.id) ? "is-contributing" : ""}`}>
              <input
                type="checkbox"
                aria-label={s.id}
                checked={selected.includes(s.id)}
                disabled={s.id === lastSelected}
                onChange={() => onToggle(s.id)}
              />
              <span className={`sensor-swatch sensor-swatch-${s.kind}`} aria-hidden="true" />
              <span className="sensor-id num">{s.id}</span>
              <span className="sensor-kind">{SENSOR_KIND_WORD[s.kind]}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
