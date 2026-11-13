import { useState, type FormEvent } from 'react';
import { Trash } from 'lucide-react';
import { bindingCount } from '../../shared/document';
import { presetApplied, variableDeleted } from '../../shared/messages';
import { VARIABLE_TYPES, type Variable, type VariableType, type VariableValue, type Vec2, type Vec3 } from '../../shared/types';
import { editGate, NumberField, Notice, Switch } from './controls';
import { useEditorSelector, useEditorStore } from './EditorProvider';

const LIMIT = 1_000_000;

const DEFAULTS: Record<VariableType, VariableValue> = {
  Number: 0,
  Boolean: false,
  Text: '',
  Colour: '#FFFFFF',
  'Vector 2': { x: 0, y: 0 },
  'Vector 3': { x: 0, y: 0, z: 0 },
};

function TextValue({ variable, disabled, gate, commit }: { variable: Variable; disabled: boolean; gate: ReturnType<typeof editGate>; commit: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = variable.value as string;
  const done = (): void => {
    if (draft !== null && draft !== stored) commit(draft);
    setDraft(null);
  };
  return (
    <input
      type="text"
      aria-label={`${variable.name} value`}
      value={draft ?? stored}
      disabled={disabled}
      {...gate}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => event.key === 'Enter' && done()}
      onBlur={done}
    />
  );
}

function VariableRow({ variable, onDelete }: { variable: Variable; onDelete: (name: string) => void }) {
  const { actions } = useEditorStore();
  const canEdit = useEditorSelector((e) => e.canEdit);
  const gate = editGate(canEdit);
  const { name, type, value } = variable;
  const invalid = (message: string): void => actions.setNotice('variables', message);
  const number = (label: string, current: number, commit: (n: number) => void) => (
    <NumberField key={label} label={label} value={current} min={-LIMIT} max={LIMIT} step={1} shiftStep={10} gate={gate} onCommit={commit} onInvalid={invalid} />
  );
  let control;
  if (type === 'Number') control = number(`${name} value`, value as number, (n) => actions.setVariable(name, n));
  else if (type === 'Boolean') control = <Switch label={`${name} value`} checked={value as boolean} onChange={(checked) => actions.setVariable(name, checked)} disabled={!canEdit} describedBy={gate['aria-describedby']} title={gate.title} />;
  else if (type === 'Text' || type === 'Colour') control = <TextValue variable={variable} disabled={!canEdit} gate={gate} commit={(text) => actions.setVariable(name, text)} />;
  else {
    const vec = value as Vec3 | Vec2;
    const axes = type === 'Vector 2' ? (['x', 'y'] as const) : (['x', 'y', 'z'] as const);
    control = (
      <div className="vector-fields">
        {axes.map((axis) => number(`${name} ${axis}`, (vec as unknown as Record<string, number>)[axis] ?? 0, (n) => actions.setVariable(name, { ...vec, [axis]: n })))}
      </div>
    );
  }
  return (
    <li className="variable-row">
      <div className="variable-head">
        <span className="variable-name">{name}</span>
        <span className="muted">{type}</span>
        <button type="button" className="row-button" aria-label={`Delete ${name}`} {...gate} onClick={() => onDelete(name)}>
          <Trash size={16} aria-hidden="true" />
        </button>
      </div>
      {control}
    </li>
  );
}

export function VariablesCard() {
  const store = useEditorStore();
  const { actions } = store;
  const doc = useEditorSelector((e) => e.document);
  const canEdit = useEditorSelector((e) => e.canEdit);
  const notice = useEditorSelector((e) => e.notices.variables);
  const gate = editGate(canEdit);
  const [tab, setTab] = useState<'variables' | 'presets'>('variables');
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('Number');
  const [presetName, setPresetName] = useState('');

  const addVariable = (event: FormEvent): void => {
    event.preventDefault();
    actions.apply([{ type: 'addVariable', variable: { name, type, value: DEFAULTS[type] } }], undefined, 'variables');
    if (store.getSnapshot().document.variables.some((v) => v.name === name)) setName('');
  };

  const deleteVariable = (target: string): void => {
    const count = bindingCount(doc, target);
    actions.apply([{ type: 'deleteVariable', name: target }], undefined, 'variables');
    if (!store.getSnapshot().document.variables.some((v) => v.name === target)) actions.announce(variableDeleted(target, count));
  };

  const savePreset = (event: FormEvent): void => {
    event.preventDefault();
    actions.apply([{ type: 'savePreset', name: presetName }], undefined, 'variables');
    if (store.getSnapshot().document.presets.some((p) => p.name === presetName)) setPresetName('');
  };

  const applyPreset = (target: string): void => {
    actions.apply([{ type: 'applyPreset', name: target }], undefined, 'variables');
    if (!store.getSnapshot().notices.variables) actions.announce(presetApplied(target));
  };

  return (
    <section className="panel vp-card">
      <div role="tablist" aria-label="Variables and presets" className="tabs">
        {(['variables', 'presets'] as const).map((id) => (
          <button key={id} type="button" role="tab" id={`vp-tab-${id}`} aria-selected={tab === id} aria-controls={`vp-panel-${id}`} className="tab" onClick={() => setTab(id)}>
            {id === 'variables' ? 'Variables' : 'Presets'}
          </button>
        ))}
      </div>
      <Notice message={notice} />
      {tab === 'variables' ? (
        <div role="tabpanel" id="vp-panel-variables" aria-labelledby="vp-tab-variables" className="vp-panel">
          <form className="add-variable" onSubmit={addVariable}>
            <input type="text" aria-label="New variable name" placeholder="name" value={name} disabled={!canEdit} {...gate} onChange={(event) => setName(event.target.value)} />
            <select aria-label="Variable type" value={type} disabled={!canEdit} {...gate} onChange={(event) => setType(event.target.value as VariableType)}>
              {VARIABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-compact" {...gate}>
              Add variable
            </button>
          </form>
          {doc.variables.length === 0 ? (
            <p className="muted">No variables yet.</p>
          ) : (
            <ul className="variable-list">
              {doc.variables.map((variable) => (
                <VariableRow key={variable.name} variable={variable} onDelete={deleteVariable} />
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div role="tabpanel" id="vp-panel-presets" aria-labelledby="vp-tab-presets" className="vp-panel">
          <form className="add-variable" onSubmit={savePreset}>
            <input type="text" aria-label="Preset name" placeholder="preset" value={presetName} disabled={!canEdit} {...gate} onChange={(event) => setPresetName(event.target.value)} />
            <button type="submit" className="btn btn-compact" {...gate}>
              Save preset
            </button>
          </form>
          {doc.presets.length === 0 ? (
            <p className="muted">No presets yet.</p>
          ) : (
            <ul className="variable-list">
              {doc.presets.map((preset) => (
                <li key={preset.name} className="variable-row preset-row">
                  <span className="variable-name">{preset.name}</span>
                  <button type="button" className="btn btn-compact" {...gate} onClick={() => applyPreset(preset.name)}>
                    Apply {preset.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
