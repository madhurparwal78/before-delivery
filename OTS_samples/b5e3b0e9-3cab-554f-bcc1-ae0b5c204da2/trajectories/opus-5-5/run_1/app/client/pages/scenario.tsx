import { useLayoutEffect, useState } from 'preact/hooks';
import type { Layout } from '../../shared/types.js';
import { api, ApiFailure, failureText } from '../api.js';
import { ErrorCell, FormStatus } from '../components/forms.js';
import { Loading, NotFound } from '../components/shell.js';

interface Row {
  callsign: string;
  type: string;
  wake: string;
  rules: string;
  kind: string;
  stand: string;
  holdingPoint: string;
  runway: string;
  appearAt: string;
  dueSeconds: string;
  slotSeconds: string;
  overrunsHold: boolean;
}

interface Form {
  name: string;
  aerodrome: string;
  runwayInUse: string;
  windDir: string;
  windKt: string;
  startSimTime: string;
  durationSeconds: string;
  seed: string;
  readbackErrorEvery: string;
  traffic: Row[];
  events: unknown[];
}

const emptyRow = (): Row => ({
  callsign: '',
  type: '',
  wake: 'L',
  rules: 'VFR',
  kind: 'dep',
  stand: '',
  holdingPoint: '',
  runway: '',
  appearAt: '0',
  dueSeconds: '',
  slotSeconds: '',
  overrunsHold: false,
});

const asText = (value: unknown) => (value === null || value === undefined ? '' : String(value));

function numberOrText(value: string): number | string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function TextInput(props: { id: string; label: string; value: string; onInput(value: string): void; inputMode?: 'numeric' }) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <input id={props.id} value={props.value} inputMode={props.inputMode} onInput={(e) => props.onInput(e.currentTarget.value)} />
    </div>
  );
}

function Select(props: { id: string; label: string; value: string; options: { value: string; text: string }[]; onChange(value: string): void }) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </div>
  );
}

const plain = (values: string[]) => values.map((value) => ({ value, text: value }));

export function ScenarioPage({ id }: { id: string | null }) {
  const [aerodromes, setAerodromes] = useState<{ id: string; name: string }[] | null>(null);
  const [layouts, setLayouts] = useState<Record<string, Layout>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [savedId, setSavedId] = useState<string | null>(id);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');

  useLayoutEffect(() => {
    void (async () => {
      try {
        const list = await api<{ id: string; name: string }[]>('GET', '/api/aerodromes');
        setAerodromes(list);
        if (id) {
          const scenario = await api<Record<string, unknown>>('GET', `/api/scenarios/${encodeURIComponent(id)}`);
          setForm({
            name: asText(scenario.name),
            aerodrome: asText(scenario.aerodrome),
            runwayInUse: asText(scenario.runwayInUse),
            windDir: asText(scenario.windDir),
            windKt: asText(scenario.windKt),
            startSimTime: asText(scenario.startSimTime),
            durationSeconds: asText(scenario.durationSeconds),
            seed: asText(scenario.seed),
            readbackErrorEvery: asText(scenario.readbackErrorEvery),
            events: (scenario.events as unknown[]) ?? [],
            traffic: ((scenario.traffic as Record<string, unknown>[]) ?? []).map((item) => ({
              callsign: asText(item.callsign),
              type: asText(item.type),
              wake: asText(item.wake),
              rules: asText(item.rules),
              kind: asText(item.kind),
              stand: asText(item.stand),
              holdingPoint: asText(item.holdingPoint),
              runway: asText(item.runway),
              appearAt: asText(item.appearAt),
              dueSeconds: asText(item.dueSeconds),
              slotSeconds: asText(item.slotSeconds),
              overrunsHold: item.overrunsHold === true,
            })),
          });
        } else {
          setForm({
            name: '',
            aerodrome: list[0]?.id ?? '',
            runwayInUse: '',
            windDir: '270',
            windKt: '8',
            startSimTime: '12:00:00',
            durationSeconds: '1800',
            seed: '1',
            readbackErrorEvery: '',
            traffic: [],
            events: [],
          });
        }
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) setMissing(true);
      }
    })();
  }, [id]);

  const aerodromeId = form?.aerodrome ?? '';
  useLayoutEffect(() => {
    if (!aerodromeId || layouts[aerodromeId]) return;
    void api<{ layout: Layout }>('GET', `/api/aerodromes/${encodeURIComponent(aerodromeId)}`).then((result) =>
      setLayouts((current) => ({ ...current, [aerodromeId]: result.layout })),
    );
  }, [aerodromeId, layouts]);

  const layout = layouts[aerodromeId];
  const thresholds = layout ? layout.runways.flatMap((runway) => runway.thresholds.map((t) => t.id)) : [];
  useLayoutEffect(() => {
    if (form && thresholds.length > 0 && !thresholds.includes(form.runwayInUse)) setForm({ ...form, runwayInUse: thresholds[0]! });
  }, [form, thresholds.join(',')]);

  if (missing) return <NotFound />;
  if (!form || !aerodromes) return <Loading />;

  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const updateRow = (index: number, patch: Partial<Row>) =>
    setForm({ ...form, traffic: form.traffic.map((row, i) => (i === index ? { ...row, ...patch } : row)) });

  return (
    <div class="grid-page">
      <section class="cell span-all">
        <h1>{savedId ? 'Edit scenario' : 'New scenario'}</h1>
        <form
          aria-label="Scenario"
          class="stack"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setStatus('Saving...');
            setFailure('');
            const body = {
              name: form.name,
              aerodrome: form.aerodrome,
              runwayInUse: form.runwayInUse,
              windDir: numberOrText(form.windDir),
              windKt: numberOrText(form.windKt),
              startSimTime: form.startSimTime.trim(),
              durationSeconds: numberOrText(form.durationSeconds),
              seed: numberOrText(form.seed),
              readbackErrorEvery: numberOrText(form.readbackErrorEvery),
              events: form.events,
              traffic: form.traffic.map((row) => ({
                callsign: row.callsign.trim(),
                type: row.type.trim(),
                wake: row.wake,
                rules: row.rules,
                kind: row.kind,
                stand: row.stand.trim() || null,
                holdingPoint: row.holdingPoint.trim() || null,
                runway: row.runway.trim() || null,
                appearAt: numberOrText(row.appearAt) ?? 0,
                dueSeconds: numberOrText(row.dueSeconds),
                slotSeconds: numberOrText(row.slotSeconds),
                overrunsHold: row.overrunsHold,
              })),
            };
            try {
              if (savedId) {
                await api('PUT', `/api/scenarios/${encodeURIComponent(savedId)}`, body);
              } else {
                const created = await api<{ id: string }>('POST', '/api/scenarios', body);
                setSavedId(created.id);
                history.replaceState(null, '', `/scenarios/${created.id}`);
              }
              setStatus('Scenario saved.');
            } catch (error) {
              setStatus('');
              setFailure(failureText(error));
            }
          }}
        >
          <div class="field-grid">
            <TextInput id="scenario-name" label="Scenario name" value={form.name} onInput={(name) => update({ name })} />
            <Select
              id="scenario-aerodrome"
              label="Aerodrome"
              value={form.aerodrome}
              options={aerodromes.map((item) => ({ value: item.id, text: item.name }))}
              onChange={(aerodrome) => update({ aerodrome, runwayInUse: '' })}
            />
            <Select
              id="scenario-runway"
              label="Runway in use"
              value={form.runwayInUse}
              options={plain(thresholds)}
              onChange={(runwayInUse) => update({ runwayInUse })}
            />
            <TextInput id="scenario-wind-dir" label="Wind direction" inputMode="numeric" value={form.windDir} onInput={(windDir) => update({ windDir })} />
            <TextInput id="scenario-wind-kt" label="Wind speed" inputMode="numeric" value={form.windKt} onInput={(windKt) => update({ windKt })} />
            <TextInput id="scenario-start" label="Start time" value={form.startSimTime} onInput={(startSimTime) => update({ startSimTime })} />
            <TextInput
              id="scenario-duration"
              label="Duration seconds"
              inputMode="numeric"
              value={form.durationSeconds}
              onInput={(durationSeconds) => update({ durationSeconds })}
            />
            <TextInput id="scenario-seed" label="Seed" inputMode="numeric" value={form.seed} onInput={(seed) => update({ seed })} />
            <TextInput
              id="scenario-every"
              label="Readback error interval"
              inputMode="numeric"
              value={form.readbackErrorEvery}
              onInput={(readbackErrorEvery) => update({ readbackErrorEvery })}
            />
          </div>
          <h2>Traffic</h2>
          <div class="table-scroll">
            <table aria-label="Traffic" class="data-table traffic-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Aircraft</th>
                </tr>
              </thead>
              <tbody>
                {form.traffic.map((row, index) => {
                  const n = index + 1;
                  return (
                    <tr key={index}>
                      <th scope="row" data-label="Row">
                        {n}
                      </th>
                      <td data-label="Aircraft">
                        <div class="field-grid">
                          <TextInput id={`row-${n}-callsign`} label={`Callsign ${n}`} value={row.callsign} onInput={(callsign) => updateRow(index, { callsign })} />
                          <TextInput id={`row-${n}-type`} label={`Type ${n}`} value={row.type} onInput={(type) => updateRow(index, { type })} />
                          <Select id={`row-${n}-wake`} label={`Wake ${n}`} value={row.wake} options={plain(['L', 'M', 'H', 'J'])} onChange={(wake) => updateRow(index, { wake })} />
                          <Select id={`row-${n}-rules`} label={`Rules ${n}`} value={row.rules} options={plain(['VFR', 'IFR'])} onChange={(rules) => updateRow(index, { rules })} />
                          <Select id={`row-${n}-kind`} label={`Kind ${n}`} value={row.kind} options={plain(['dep', 'arr'])} onChange={(kind) => updateRow(index, { kind })} />
                          <TextInput id={`row-${n}-stand`} label={`Stand ${n}`} value={row.stand} onInput={(stand) => updateRow(index, { stand })} />
                          <TextInput
                            id={`row-${n}-hp`}
                            label={`Holding point ${n}`}
                            value={row.holdingPoint}
                            onInput={(holdingPoint) => updateRow(index, { holdingPoint })}
                          />
                          <TextInput id={`row-${n}-runway`} label={`Runway ${n}`} value={row.runway} onInput={(runway) => updateRow(index, { runway })} />
                          <TextInput
                            id={`row-${n}-appear`}
                            label={`Appear at ${n}`}
                            inputMode="numeric"
                            value={row.appearAt}
                            onInput={(appearAt) => updateRow(index, { appearAt })}
                          />
                          <TextInput
                            id={`row-${n}-due`}
                            label={`Due seconds ${n}`}
                            inputMode="numeric"
                            value={row.dueSeconds}
                            onInput={(dueSeconds) => updateRow(index, { dueSeconds })}
                          />
                          <TextInput
                            id={`row-${n}-slot`}
                            label={`Slot seconds ${n}`}
                            inputMode="numeric"
                            value={row.slotSeconds}
                            onInput={(slotSeconds) => updateRow(index, { slotSeconds })}
                          />
                          <div class="field check">
                            <input
                              id={`row-${n}-overrun`}
                              type="checkbox"
                              checked={row.overrunsHold}
                              onChange={(e) => updateRow(index, { overrunsHold: e.currentTarget.checked })}
                            />
                            <label for={`row-${n}-overrun`}>{`Overruns hold ${n}`}</label>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {form.traffic.length === 0 ? <p class="empty">No aircraft yet.</p> : null}
          <div class="row-buttons">
            <button type="button" onClick={() => update({ traffic: [...form.traffic, emptyRow()] })}>
              Add aircraft
            </button>
            <button type="submit" class="primary">
              Save scenario
            </button>
          </div>
          <FormStatus text={status} />
          <ErrorCell label="Scenario error" text={failure} />
        </form>
      </section>
    </div>
  );
}
