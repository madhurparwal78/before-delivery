import { useState } from 'react';

export interface TelemetryProps {
  fps: number;
  frameMs: number;
  step: number;
  stateHash: string;
}

function band(fps: number): string {
  if (fps >= 50) return 'fps good';
  if (fps >= 30) return 'fps fair';
  return 'fps poor';
}

export function Telemetry(props: TelemetryProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="telemetry" role="group" aria-label="Run telemetry">
      <button
        type="button"
        className="ghost"
        aria-label="More telemetry"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? '-' : '+'}
      </button>
      <div className={band(props.fps)}>fps {props.fps}</div>
      <div>ms {props.frameMs.toFixed(1)}</div>
      <div>step {props.step}</div>
      <div>hash {props.stateHash.slice(0, 12)}</div>
      {expanded ? <div style={{ overflowWrap: 'anywhere' }}>{props.stateHash}</div> : null}
    </div>
  );
}
