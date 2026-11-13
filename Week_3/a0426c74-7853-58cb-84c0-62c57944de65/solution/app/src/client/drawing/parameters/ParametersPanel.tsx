import { useState } from 'react';
import type { FormEvent } from 'react';
import { NO_PARAMETERS } from '../../../shared/copy.ts';
import { constraintLabel, fmt3 } from '../../../shared/geometry/index.ts';
import { Button } from '../../ui/index.ts';
import { useDrawingSlice, useDrawingStore } from '../../store/index.ts';
import { CommitInput } from '../controls/CommitField.tsx';
import { useFocusTarget } from '../focusTargets.tsx';
import '../../styles/drawing/parameters.css';

function NewParameter({ onAdd }: { onAdd: (name: string, expression: string) => void }) {
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onAdd(name.trim(), expression.trim());
    setName('');
    setExpression('');
  }
  return (
    <form className="field-row" onSubmit={submit}>
      <input className="field" type="text" aria-label="Parameter name" autoComplete="off" placeholder="d1" value={name} onChange={(event) => setName(event.target.value)} />
      <input className="field" type="text" aria-label="Parameter expression" autoComplete="off" placeholder="10 + d2" value={expression} onChange={(event) => setExpression(event.target.value)} />
      <Button type="submit">Add parameter</Button>
    </form>
  );
}

/** `region "Parameters"`: `grid "Parameter list"` with name, expression and current value, and the constraints. */
export function ParametersPanel() {
  const store = useDrawingStore();
  const parameters = useDrawingSlice((snapshot) => snapshot.parameters);
  const constraints = useDrawingSlice((snapshot) => snapshot.state.constraints);
  const canEdit = useDrawingSlice((snapshot) => snapshot.canEdit);
  const focusRef = useFocusTarget('parameter-list');
  const setParameter = (name: string, expression: string): void => store.edit('PARAM', [{ type: 'parameter_set', name, expression }]);

  return (
    <>
      <div className="param-list" role="grid" aria-label="Parameter list" tabIndex={-1} ref={focusRef}>
        <div className="param-row param-row--head muted" role="row">
          <div role="columnheader">Name</div>
          <div role="columnheader">Expression</div>
          <div role="columnheader">Value</div>
        </div>
        {parameters.map((parameter) => (
          <div key={parameter.name} className="param-row" role="row">
            <div className="strong" role="gridcell">{parameter.name}</div>
            <div role="gridcell">
              {canEdit ? (
                <CommitInput aria-label={`Expression of ${parameter.name}`} value={parameter.expression} onCommit={(expression) => setParameter(parameter.name, expression)} />
              ) : parameter.expression}
            </div>
            <div role="gridcell">{parameter.value === null ? '' : fmt3(parameter.value)}</div>
            {canEdit ? (
              <div role="gridcell">
                <Button aria-label={`Delete ${parameter.name}`} onClick={() => store.edit('PARAM', [{ type: 'parameter_delete', name: parameter.name }])}>Delete</Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {parameters.length === 0 ? <p className="empty">{NO_PARAMETERS}</p> : null}
      {canEdit ? <NewParameter onAdd={setParameter} /> : null}
      {constraints.length > 0 ? (
        <ul className="list" role="list" aria-label="Constraints">
          {constraints.map((constraint) => (
            <li key={constraint.id} className="line">
              <span>{constraintLabel(constraint)}</span>
              {canEdit ? (
                <Button aria-label={`Delete constraint ${constraintLabel(constraint)}`} onClick={() => store.edit('PARAM', [{ type: 'constraint_delete', id: constraint.id }])}>Delete</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
