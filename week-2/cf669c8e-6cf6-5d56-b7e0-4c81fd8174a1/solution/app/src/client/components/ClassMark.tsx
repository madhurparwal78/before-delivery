import type { ReactNode } from 'react';
import type { RoadClass } from '../../shared/types.js';

/** The road class with its plate mark: blue for 25 km/h, yellow for 45 km/h. */
export function ClassMark({ roadClass, label }: { roadClass: RoadClass; label?: string }): ReactNode {
  return (
    <span className="class-mark" data-class={roadClass}>
      <span className="plate-swatch" aria-hidden="true" />
      <span>{label ?? `${roadClass} km/h`}</span>
    </span>
  );
}
