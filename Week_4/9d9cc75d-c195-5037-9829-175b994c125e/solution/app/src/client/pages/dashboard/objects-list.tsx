import { useId } from 'react';
import { Button } from '../../ui/button.tsx';

export interface ObjectRef {
  sheet: string;
  name: string;
}

interface Props {
  objects: readonly ObjectRef[];
  hidden: ReadonlySet<string>;
  onToggle: (object: ObjectRef) => void;
}

/** `list "Dashboard objects"`: one Hide or Show button per object. The button keeps focus when it changes its name. */
export function ObjectsList({ objects, hidden, onToggle }: Props) {
  const headingId = useId();
  return (
    <section className="board-card">
      <h2 id={headingId} className="board-card-title">
        Dashboard objects
      </h2>
      <ul className="board-objects" aria-labelledby={headingId}>
        {objects.map((object) => (
          <li key={object.sheet}>
            <Button compact onClick={() => onToggle(object)}>
              {hidden.has(object.sheet) ? 'Show' : 'Hide'} {object.name}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
