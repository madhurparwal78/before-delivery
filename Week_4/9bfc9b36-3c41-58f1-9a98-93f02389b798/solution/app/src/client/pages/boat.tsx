/** A boat: its rig dimensions with every measurement, tape photographs, Remeasure flags and the foretriangle. */
import { useEffect, useState } from "react";
import { ApiError, getBlob, getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { Chip, DataTable, Dialog, DialogForm, TextArea, TextField, UnitPair, useDialog, useLoad, useSubmitter } from "../ui.js";
import { RecordMeasurementDialog } from "./measure-dialog.js";
import { PageHeading } from "./chrome.js";
import { NotFound } from "./public.js";
import { PENDING, SUCCESS } from "../../shared/copy.js";
import { DIMENSION_KEYS, type Boat, type Dimension, type Measurement } from "../../shared/types.js";
import { areaParts, grouped, lengthText } from "../../shared/units.js";

function PhotoThumb({ measurement, dimension }: { measurement: Measurement; dimension: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    getBlob(`/api/measurements/${measurement.id}/photo`)
      .then((blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof ApiError)) throw failure;
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [measurement.id]);
  return url ? <img src={url} alt={`Tape photo for ${dimension}`} className="tape-photo" width={96} height={96} /> : null;
}

export function dimensionCell(dimension: Dimension) {
  return dimension.value_mm === null ? "Not measured" : lengthText(dimension.value_mm);
}

function EditBoat({ boat, onSaved }: { boat: Boat; onSaved: (boat: Boat) => void }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [name, setName] = useState(boat.name);
  const [className, setClassName] = useState(boat.class_name);
  const [notes, setNotes] = useState(boat.notes ?? "");
  const save = () =>
    form.run(async () => {
      const { data } = await sendJson<Boat>("PATCH", `/api/boats/${boat.code}`, { name, class_name: className, notes }, { "if-match": `"${boat.revision}"` });
      say(SUCCESS.saved);
      onSaved(data);
      close(true);
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Save boat" busy={form.busy}>
      <TextField label="Boat name" value={name} onChange={setName} error={form.errors.name} />
      <TextField label="Class" value={className} onChange={setClassName} error={form.errors.class_name} />
      <TextArea label="Notes" value={notes} onChange={setNotes} error={form.errors.notes} />
    </DialogForm>
  );
}

export function BoatPage({ code }: { code: string }) {
  const boat = useLoad((signal) => getJson<Boat>(`/api/boats/${code}`, signal), [code]);
  const [dialog, setDialog] = useState<"measure" | "edit" | null>(null);
  if (boat.error?.status === 404) return <NotFound />;
  const data = boat.data;
  const measured = data && data.dimensions.some((item) => item.key === "I" && item.value_mm !== null) && data.dimensions.some((item) => item.key === "J" && item.value_mm !== null);
  return (
    <main className="page">
      <PageHeading>{data ? `${data.code} · ${data.name}` : code}</PageHeading>
      {data ? (
        <>
          <section className="field-cobalt poster-section" aria-label="Foretriangle">
            <p className="poster-label">Foretriangle</p>
            <p className="poster">{measured ? <UnitPair parts={areaParts(data.foretriangle.area_mm2)} stacked /> : "Not measured"}</p>
            <p className="poster-basis">{data.foretriangle.basis}</p>
          </section>
          <section className="field-surface">
            <div className="section-head">
              <h2>Rig dimensions</h2>
              <div className="actions">
                <button type="button" className="button" onClick={() => setDialog("measure")}>
                  Record measurement
                </button>
                <button type="button" className="button" onClick={() => setDialog("edit")}>
                  Edit boat
                </button>
              </div>
            </div>
            <p className="muted">
              {data.class_name} · owned by {data.owner.display_name}
              {data.notes ? ` · ${data.notes}` : ""}
            </p>
            <DataTable
              label="Rig dimensions"
              headers={["Dimension", "Value", "Status", "Due"]}
              rows={data.dimensions.map((item) => ({
                key: item.key,
                cells: [
                  item.key,
                  dimensionCell(item),
                  <Chip key="c" tone={item.status === "remeasure" ? "ink" : "plain"}>{item.status === "remeasure" ? "Remeasure" : "Measured"}</Chip>,
                  item.remeasure_due ? `Remeasure by ${item.remeasure_due}` : "",
                ],
              }))}
            />
          </section>
          <section className="field-ground">
            <h2>Measurements</h2>
            <DataTable
              label="Measurements"
              headers={["Dimension", "Measured on", "Length", "Source", "Photo"]}
              rows={data.dimensions.flatMap((item) =>
                item.measurements.map((measurement) => ({
                  key: measurement.id,
                  cells: [
                    item.key,
                    measurement.measured_on,
                    `${grouped(measurement.value_mm)} mm (${grouped(measurement.value_in)} in)`,
                    measurement.source === "submission" ? `Owner submission ${measurement.submission_id}` : "Tape, sailmaker",
                    measurement.photo ? <PhotoThumb key="p" measurement={measurement} dimension={item.key} /> : "",
                  ],
                })),
              )}
            />
          </section>
          {dialog === "measure" ? (
            <RecordMeasurementDialog boatCode={data.code} dimensions={[...DIMENSION_KEYS]} onSaved={(next) => boat.set(next)} onClose={() => setDialog(null)} />
          ) : null}
          {dialog === "edit" ? (
            <Dialog title="Edit boat" onClose={() => setDialog(null)}>
              <EditBoat boat={data} onSaved={(next) => boat.set(next)} />
            </Dialog>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
