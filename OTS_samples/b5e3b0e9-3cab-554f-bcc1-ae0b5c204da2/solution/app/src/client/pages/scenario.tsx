import { useLayoutEffect, useState } from "preact/hooks";
import { api, ApiFailure } from "../api.ts";
import type { Layout } from "../../shared/layout.ts";
import { FormFeedback, TextField, useForm } from "../components/forms.tsx";
import { Loading, NotFound } from "./shared.tsx";

interface TrafficDraft {
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

const blankRow = (): TrafficDraft => ({
  callsign: "",
  type: "",
  wake: "L",
  rules: "VFR",
  kind: "dep",
  stand: "",
  holdingPoint: "",
  runway: "",
  appearAt: "",
  dueSeconds: "",
  slotSeconds: "",
  overrunsHold: false,
});

interface ScenarioBody {
  id: string;
  name: string;
  aerodrome: string;
  runwayInUse: string;
  windDir: number;
  windKt: number;
  startSimTime: string;
  durationSeconds: number;
  seed: number;
  readbackErrorEvery: number | null;
  traffic: {
    callsign: string;
    type: string;
    wake: string;
    rules: string;
    kind: string;
    stand: string | null;
    holdingPoint: string | null;
    runway: string | null;
    appearAt: number;
    dueSeconds: number | null;
    slotSeconds: number | null;
    overrunsHold: boolean;
  }[];
}

const text = (value: number | string | null | undefined): string => (value === null || value === undefined ? "" : String(value));
const whole = (value: string): number | null => (value.trim() === "" ? null : Number(value));

function Select({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ScenarioPage({ id }: { id: string | null }) {
  const form = useForm();
  const [aerodromes, setAerodromes] = useState<{ id: string; name: string }[] | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [missing, setMissing] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(id);
  const [name, setName] = useState("");
  const [aerodrome, setAerodrome] = useState("");
  const [runwayInUse, setRunwayInUse] = useState("");
  const [windDir, setWindDir] = useState("");
  const [windKt, setWindKt] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState("");
  const [seed, setSeed] = useState("");
  const [every, setEvery] = useState("");
  const [rows, setRows] = useState<TrafficDraft[]>([]);
  const [failure, setFailure] = useState("");

  useLayoutEffect(() => {
    void (async () => {
      const list = await api<{ id: string; name: string }[]>("GET", "/api/aerodromes");
      setAerodromes(list);
      if (id === null) {
        setAerodrome(list[0]?.id ?? "");
        return;
      }
      try {
        const body = await api<ScenarioBody>("GET", `/api/scenarios/${id}`);
        setName(body.name);
        setAerodrome(body.aerodrome);
        setRunwayInUse(body.runwayInUse);
        setWindDir(text(body.windDir));
        setWindKt(text(body.windKt));
        setStart(body.startSimTime);
        setDuration(text(body.durationSeconds));
        setSeed(text(body.seed));
        setEvery(text(body.readbackErrorEvery));
        setRows(
          body.traffic.map((t) => ({
            callsign: t.callsign,
            type: t.type,
            wake: t.wake,
            rules: t.rules,
            kind: t.kind,
            stand: text(t.stand),
            holdingPoint: text(t.holdingPoint),
            runway: text(t.runway),
            appearAt: text(t.appearAt),
            dueSeconds: text(t.dueSeconds),
            slotSeconds: text(t.slotSeconds),
            overrunsHold: t.overrunsHold,
          })),
        );
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        setMissing(true);
      }
    })();
  }, [id]);

  useLayoutEffect(() => {
    if (!aerodrome) return;
    void api<{ layout: Layout }>("GET", `/api/aerodromes/${aerodrome}`).then(({ layout: loaded }) => {
      setLayout(loaded);
      const thresholds = loaded.runways.flatMap((r) => r.thresholds.map((t) => t.id));
      setRunwayInUse((current) => (thresholds.includes(current) ? current : (thresholds[0] ?? "")));
    });
  }, [aerodrome]);

  if (missing) return <NotFound />;
  if (!aerodromes) return <Loading />;
  const thresholds = layout ? layout.runways.flatMap((r) => r.thresholds.map((t) => t.id)) : [];
  const change = (index: number, patch: Partial<TrafficDraft>): void => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    form.begin("Saving...");
    setFailure("");
    const body = {
      name,
      aerodrome,
      runwayInUse,
      windDir: Number(windDir),
      windKt: Number(windKt),
      startSimTime: start,
      durationSeconds: Number(duration),
      seed: Number(seed),
      readbackErrorEvery: whole(every),
      traffic: rows.map((row) => ({
        callsign: row.callsign,
        type: row.type,
        wake: row.wake,
        rules: row.rules,
        kind: row.kind,
        stand: row.stand,
        holdingPoint: row.holdingPoint,
        runway: row.runway,
        appearAt: Number(row.appearAt),
        dueSeconds: whole(row.dueSeconds),
        slotSeconds: whole(row.slotSeconds),
        overrunsHold: row.overrunsHold,
      })),
      events: [],
    };
    try {
      if (savedId) await api("PUT", `/api/scenarios/${savedId}`, body);
      else setSavedId((await api<{ id: string }>("POST", "/api/scenarios", body)).id);
      form.succeed("Scenario saved.");
    } catch (error) {
      form.reset();
      setFailure(error instanceof Error ? error.message : "Something went wrong.");
    }
  };

  return (
    <div class="page">
      <h1>{id === null ? "New scenario" : "Scenario"}</h1>
      <form class="cell form" onSubmit={(event) => void save(event)}>
        <TextField name="name" label="Scenario name" value={name} onInput={setName} />
        <Select id="field-aerodrome" label="Aerodrome" value={aerodromes.find((a) => a.id === aerodrome)?.name ?? ""} options={aerodromes.map((a) => a.name)} onChange={(v) => setAerodrome(aerodromes.find((a) => a.name === v)?.id ?? aerodrome)} />
        <Select id="field-runway" label="Runway in use" value={runwayInUse} options={thresholds} onChange={setRunwayInUse} />
        <div class="field-grid">
          <TextField name="windDir" label="Wind direction" value={windDir} onInput={setWindDir} inputMode="numeric" />
          <TextField name="windKt" label="Wind speed" value={windKt} onInput={setWindKt} inputMode="numeric" />
          <TextField name="start" label="Start time" value={start} onInput={setStart} placeholder="HH:MM:SS" />
          <TextField name="duration" label="Duration seconds" value={duration} onInput={setDuration} inputMode="numeric" />
          <TextField name="seed" label="Seed" value={seed} onInput={setSeed} inputMode="numeric" />
          <TextField name="every" label="Readback error interval" value={every} onInput={setEvery} inputMode="numeric" />
        </div>
        <table aria-label="Traffic" role="table" class="table traffic">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">Aircraft</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row, index) => {
              const n = index + 1;
              return (
                <tr role="row" key={index}>
                  <td role="cell" class="traffic-row">
                    <TextField name={`callsign${n}`} label={`Callsign ${n}`} value={row.callsign} onInput={(v) => change(index, { callsign: v })} />
                    <TextField name={`type${n}`} label={`Type ${n}`} value={row.type} onInput={(v) => change(index, { type: v })} />
                    <Select id={`field-wake${n}`} label={`Wake ${n}`} value={row.wake} options={["L", "M", "H", "J"]} onChange={(v) => change(index, { wake: v })} />
                    <Select id={`field-rules${n}`} label={`Rules ${n}`} value={row.rules} options={["VFR", "IFR"]} onChange={(v) => change(index, { rules: v })} />
                    <Select id={`field-kind${n}`} label={`Kind ${n}`} value={row.kind} options={["dep", "arr"]} onChange={(v) => change(index, { kind: v })} />
                    <TextField name={`stand${n}`} label={`Stand ${n}`} value={row.stand} onInput={(v) => change(index, { stand: v })} />
                    <TextField name={`hp${n}`} label={`Holding point ${n}`} value={row.holdingPoint} onInput={(v) => change(index, { holdingPoint: v })} />
                    <TextField name={`runway${n}`} label={`Runway ${n}`} value={row.runway} onInput={(v) => change(index, { runway: v })} />
                    <TextField name={`appear${n}`} label={`Appear at ${n}`} value={row.appearAt} onInput={(v) => change(index, { appearAt: v })} inputMode="numeric" />
                    <TextField name={`due${n}`} label={`Due seconds ${n}`} value={row.dueSeconds} onInput={(v) => change(index, { dueSeconds: v })} inputMode="numeric" />
                    <TextField name={`slot${n}`} label={`Slot seconds ${n}`} value={row.slotSeconds} onInput={(v) => change(index, { slotSeconds: v })} inputMode="numeric" />
                    <label class="check">
                      <input type="checkbox" checked={row.overrunsHold} onChange={(event) => change(index, { overrunsHold: event.currentTarget.checked })} />
                      Overruns hold {n}
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div class="actions">
          <button type="button" onClick={() => setRows((current) => [...current, blankRow()])}>
            Add aircraft
          </button>
          <button type="submit">Save scenario</button>
        </div>
        <FormFeedback form={form} />
        <div role="alert" aria-label="Scenario error" class={failure ? "cell-error" : "cell-quiet"}>
          {failure}
        </div>
      </form>
    </div>
  );
}
