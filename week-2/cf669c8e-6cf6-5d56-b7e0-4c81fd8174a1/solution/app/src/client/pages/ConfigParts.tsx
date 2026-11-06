import { useState, type FormEvent, type ReactNode } from 'react';
import { oneOf } from '../../shared/choice.js';
import {
  DELIVERY_COUNTRIES, REG_COUNTRIES, PLATE_COLOURS, ROAD_CLASSES,
  type Catalogue, type Country, type Fulfilment, type ManualFrame, type PlateColour, type RegCountry, type RoadClass, type Units,
} from '../../shared/types.js';
import { ClassMark } from '../components/ClassMark.js';
import { Field } from '../components/Form.js';

interface PlateEntryProps {
  plateText: string;
  onPlateText: (text: string) => void;
  regCountry: RegCountry;
  onRegCountry: (country: RegCountry) => void;
  onLookup: () => void;
  lookupStatus: string;
  lookupInvalid: boolean;
  catalogue: Catalogue | null;
  manual: ManualFrame | null;
  frameErrors: Record<string, string>;
  onTryFrame: (frame: ManualFrame) => void;
}

export function PlateEntry(props: PlateEntryProps): ReactNode {
  const [handOpen, setHandOpen] = useState(Boolean(props.manual));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    props.onLookup();
  };
  return (
    <div className="plate-entry">
      <h2>Donor</h2>
      <form className="plate-form" onSubmit={submit} aria-label="Plate lookup form">
        <div className="field plate-field">
          <label htmlFor="plate">Plate</label>
          <input id="plate" type="text" role="textbox" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={props.plateText}
            aria-invalid={props.lookupInvalid} aria-describedby="plate-status" onChange={(e) => props.onPlateText(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reg-country">Registration country</label>
          <select id="reg-country" value={props.regCountry} onChange={(e) => props.onRegCountry(oneOf(e.target.value, REG_COUNTRIES) ?? props.regCountry)}>
            {REG_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button type="submit" className="btn primary">Look up plate</button>
        <button type="button" className="btn" aria-expanded={handOpen} onClick={() => setHandOpen((v) => !v)}>Enter frame details by hand</button>
      </form>
      <div role="status" aria-label="Plate lookup" id="plate-status" className="lookup-status" data-invalid={props.lookupInvalid}>{props.lookupStatus}</div>
      {handOpen ? <FrameForm {...props} /> : null}
    </div>
  );
}

function FrameForm({ catalogue, manual, regCountry, frameErrors, onTryFrame }: PlateEntryProps): ReactNode {
  const [model, setModel] = useState(manual?.model ?? 'K50');
  const [year, setYear] = useState(manual ? String(manual.firstAdmissionYear) : '');
  const [roadClass, setRoadClass] = useState<RoadClass>(manual?.roadClass ?? 25);
  const [colour, setColour] = useState<PlateColour>(manual?.plateColour ?? 'blue');
  const [mass, setMass] = useState(manual ? manual.registeredMassKg.toFixed(1) : '');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onTryFrame({ model, country: regCountry, firstAdmissionYear: Number(year), roadClass, plateColour: colour, registeredMassKg: Number(mass) });
  };
  return (
    <form className="frame-form ruled" aria-label="Frame details" onSubmit={submit} noValidate>
      <p className="h6">Frame details <span className="unconfirmed">unconfirmed until a plate is read</span></p>
      <Field name="model" label="Model" error={frameErrors['model']}>
        {(p) => (
          <select {...p} value={model} onChange={(e) => setModel(e.target.value)}>
            {(catalogue?.donors ?? [{ model, name: model }]).map((d) => <option key={d.model} value={d.model}>{d.name}</option>)}
          </select>
        )}
      </Field>
      <Field name="year" label="First-admission year" error={frameErrors['firstAdmissionYear']}>
        {(p) => <input {...p} type="number" inputMode="numeric" min={1950} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />}
      </Field>
      <Field name="reg-class" label="Registered road class" error={frameErrors['roadClass']}>
        {(p) => (
          <select {...p} value={roadClass} onChange={(e) => setRoadClass(oneOf(Number(e.target.value), ROAD_CLASSES) ?? roadClass)}>
            <option value={25}>25 km/h</option>
            <option value={45}>45 km/h</option>
          </select>
        )}
      </Field>
      <Field name="colour" label="Plate colour" error={frameErrors['plateColour']}>
        {(p) => (
          <select {...p} value={colour} onChange={(e) => setColour(oneOf(e.target.value, PLATE_COLOURS) ?? colour)}>
            {PLATE_COLOURS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </Field>
      <Field name="mass" label="Registered mass in kg" error={frameErrors['registeredMassKg']} hint="Like 86.0">
        {(p) => <input {...p} type="text" role="textbox" inputMode="decimal" value={mass} onChange={(e) => setMass(e.target.value)} />}
      </Field>
      <button type="submit" className="btn primary">Try this frame</button>
    </form>
  );
}

interface KitOptionsProps {
  catalogue: Catalogue | null;
  pack: string;
  hub: string;
  roadClass: RoadClass;
  units: Units;
  fulfilment: Fulfilment;
  country: Country;
  roadClassError?: string;
  onChange: (patch: { pack?: string; hub?: string; roadClass?: RoadClass; units?: Units; fulfilment?: Fulfilment; country?: Country }) => void;
}

function Segmented<T extends string | number>({ name, label, value, options, onChange }: {
  name: string; label: string; value: T; options: { value: T; text: string; mark?: RoadClass }[]; onChange: (value: T) => void;
}): ReactNode {
  return (
    <div className="field">
      <span className="control-label" id={`${name}-label`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <label key={String(o.value)} className="seg" data-checked={o.value === value}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} aria-label={o.text} />
            {o.mark ? <ClassMark roadClass={o.mark} label={o.text} /> : <span>{o.text}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}

export function KitOptions({ catalogue, pack, hub, roadClass, units, fulfilment, country, roadClassError, onChange }: KitOptionsProps): ReactNode {
  return (
    <div className="kit-options">
      <div className="field">
        <label htmlFor="pack">Pack</label>
        <select id="pack" value={pack} onChange={(e) => onChange({ pack: e.target.value })}>
          {(catalogue?.packs ?? [{ id: pack, wh: 0 }]).map((p) => <option key={p.id} value={p.id}>{p.id} {p.wh} Wh</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="hub">Hub</label>
        <select id="hub" value={hub} onChange={(e) => onChange({ hub: e.target.value })}>
          {(catalogue?.hubs ?? [{ id: hub, kw: '0.0' }]).map((h) => <option key={h.id} value={h.id}>{h.id} {h.kw} kW</option>)}
        </select>
      </div>
      <Segmented name="road-class" label="Road class" value={roadClass} onChange={(v) => onChange({ roadClass: v })}
        options={[{ value: 25, text: '25 km/h', mark: 25 }, { value: 45, text: '45 km/h', mark: 45 }]} />
      {roadClassError ? <p className="field-error">{roadClassError}</p> : null}
      <Segmented name="units" label="Units" value={units} onChange={(v) => onChange({ units: v })}
        options={[{ value: 'metric', text: 'Metric' }, { value: 'imperial', text: 'Imperial' }]} />
      <Segmented name="fulfilment" label="Fulfilment" value={fulfilment} onChange={(v) => onChange({ fulfilment: v })}
        options={[{ value: 'posted', text: 'Posted' }, { value: 'workshop', text: 'Fitted at workshop' }]} />
      <div className="field">
        <label htmlFor="delivery-country">Delivery country</label>
        <select id="delivery-country" value={country} onChange={(e) => onChange({ country: oneOf(e.target.value, DELIVERY_COUNTRIES) ?? country })}>
          {DELIVERY_COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </div>
  );
}
