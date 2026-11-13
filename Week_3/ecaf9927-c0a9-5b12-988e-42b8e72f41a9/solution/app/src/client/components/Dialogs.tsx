import { useRef, useState, type FormEvent } from 'react';
import type { Plane } from '../../shared/api';
import { formatDensity } from '../../shared/units';
import { newKey } from '../api';
import { Overlay, useOverlayClose } from '../lib/overlay';
import { useWorkbench } from '../workbench';
import { Field, Segmented } from './Field';

function Actions({ submit, busy, busyLabel }: { submit: string; busy?: boolean; busyLabel?: string }) {
  const close = useOverlayClose();
  return (
    <div className="button-row">
      <button type="submit" className="primary" disabled={busy}>
        {busy ? busyLabel : submit}
      </button>
      <button type="button" onClick={close}>
        Cancel
      </button>
    </div>
  );
}

function MaterialSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { materials } = useWorkbench();
  return (
    <div className="field">
      <label htmlFor="new-material">Material</label>
      <select id="new-material" value={value} onChange={(event) => onChange(event.target.value)}>
        {materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {formatDensity(m.density_g_cm3)}
          </option>
        ))}
      </select>
    </div>
  );
}

function NewPart() {
  const wb = useWorkbench();
  const close = useOverlayClose();
  const [name, setName] = useState('');
  const [material, setMaterial] = useState(wb.materials[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await wb.createPart(name, material);
    if (outcome.ok) close();
    else setErrors(outcome.fields ?? {});
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="panel-title">New part</h2>
      <Field label="Name" data-autofocus="" value={name} onChange={(e) => setName(e.target.value)} error={errors['name']} />
      <MaterialSelect value={material} onChange={setMaterial} />
      {errors['material_id'] && <p className="field-error">{errors['material_id']}</p>}
      <Actions submit="Create part" />
    </form>
  );
}

function NewAssembly() {
  const wb = useWorkbench();
  const close = useOverlayClose();
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await wb.createAssembly(name);
    if (outcome.ok) close();
    else setErrors(outcome.fields ?? {});
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="panel-title">New assembly</h2>
      <Field label="Name" data-autofocus="" value={name} onChange={(e) => setName(e.target.value)} error={errors['name']} />
      <Actions submit="Create assembly" />
    </form>
  );
}

function NewPurchased() {
  const wb = useWorkbench();
  const close = useOverlayClose();
  const [name, setName] = useState('');
  const [mass, setMass] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await wb.createPurchased(name, mass);
    if (outcome.ok) close();
    else setErrors(outcome.fields ?? {});
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="panel-title">New purchased part</h2>
      <Field label="Name" data-autofocus="" value={name} onChange={(e) => setName(e.target.value)} error={errors['name']} />
      <Field label="Declared mass (g)" numeric inputMode="decimal" autoComplete="off" value={mass} onChange={(e) => setMass(e.target.value)} error={errors['declared_mass_g']} />
      <Actions submit="Create purchased part" />
    </form>
  );
}

function NewSketch() {
  const wb = useWorkbench();
  const close = useOverlayClose();
  const [plane, setPlane] = useState<Plane>('top');
  const [offset, setOffset] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const outcome = await wb.createSketch(plane, offset);
    if (outcome.ok) close();
    else setErrors(outcome.fields ?? {});
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2 className="panel-title">New sketch</h2>
      <Segmented
        label="Plane"
        name="plane"
        value={plane}
        options={[
          { value: 'top', label: 'Top' },
          { value: 'front', label: 'Front' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={setPlane}
      />
      {errors['plane'] && <p className="field-error">{errors['plane']}</p>}
      <Field label="Offset" numeric autoComplete="off" value={offset} onChange={(e) => setOffset(e.target.value)} error={errors['offset']} />
      <Actions submit="Create sketch" />
    </form>
  );
}

function AddToAssembly() {
  const wb = useWorkbench();
  const close = useOverlayClose();
  const options = [
    { group: 'Parts', items: wb.parts.map((p) => ({ value: `part:${p.id}`, name: p.name })) },
    { group: 'Purchased parts', items: wb.purchased.map((p) => ({ value: `purchased:${p.id}`, name: p.name })) },
    { group: 'Assemblies', items: wb.assemblies.map((a) => ({ value: `assembly:${a.id}`, name: a.name })) },
  ];
  const [component, setComponent] = useState(options.flatMap((o) => o.items)[0]?.value ?? '');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useRef<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const [type = '', id = ''] = component.split(':');
    key.current ??= newKey();
    setBusy(true);
    const outcome = await wb.addInstance({ type, id }, quantity.trim() === '' ? 0 : Number(quantity), key.current);
    setBusy(false);
    if (outcome.ok) {
      close();
      return;
    }
    if (outcome.failure) key.current = null;
    setErrors(outcome.fields ?? {});
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="panel-title">Add to assembly</h2>
      <div className={`field${errors['component'] ? ' invalid' : ''}`}>
        <label htmlFor="component">Component</label>
        <select
          id="component"
          data-autofocus=""
          value={component}
          aria-invalid={errors['component'] ? true : undefined}
          aria-describedby={errors['component'] ? 'component-error' : undefined}
          onChange={(event) => {
            setComponent(event.target.value);
            setErrors({});
          }}
        >
          {options.map((o) => (
            <optgroup key={o.group} label={o.group}>
              {o.items.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {errors['component'] && (
          <p id="component-error" className="field-error">
            {errors['component']}
          </p>
        )}
      </div>
      <Field label="Quantity" type="number" min={1} max={999} numeric value={quantity} onChange={(e) => setQuantity(e.target.value)} error={errors['quantity']} />
      <Actions submit="Add" busy={busy} busyLabel="Adding…" />
    </form>
  );
}

/** The modal dialogs of the feature tree, the part view and the assembly view. */
export function Dialogs() {
  const { dialog, setDialog } = useWorkbench();
  if (!dialog) return null;
  const content = { part: <NewPart />, assembly: <NewAssembly />, purchased: <NewPurchased />, sketch: <NewSketch />, add: <AddToAssembly /> }[dialog];
  const label = { part: 'New part', assembly: 'New assembly', purchased: 'New purchased part', sketch: 'New sketch', add: 'Add to assembly' }[dialog];
  return (
    <Overlay label={label} variant="dialog" onClose={() => setDialog(null)}>
      {content}
    </Overlay>
  );
}
