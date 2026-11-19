/** Record measurement: the sailmaker's tape reading, with an optional tape photograph. */
import { useState } from "react";
import { request, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { Dialog, DialogForm, SelectField, TextField, useDialog, useSubmitter, FieldShell } from "../ui.js";
import { todayUtc } from "../format.js";
import { PENDING, SUCCESS } from "../../shared/copy.js";
import type { Boat, DimensionKey } from "../../shared/types.js";

function Body({ boatCode, dimensions, onSaved }: { boatCode: string; dimensions: DimensionKey[]; onSaved: (boat: Boat) => void }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [dimension, setDimension] = useState<string>(dimensions[0] ?? "I");
  const [value, setValue] = useState("");
  const [day, setDay] = useState(todayUtc());
  const [photo, setPhoto] = useState<File | null>(null);
  const { refuse } = useLive();

  const save = async () => {
    const ok = await form.run(async () => {
      const { data } = await sendJson<Boat>("POST", `/api/boats/${boatCode}/measurements`, {
        dimension,
        value_mm: value.trim() === "" ? undefined : Number(value),
        measured_on: day,
      });
      const flagged = data.dimensions.find((item) => item.key === dimension);
      say(flagged?.status === "remeasure" && flagged.remeasure_due ? SUCCESS.measurementFlag(dimension, flagged.remeasure_due) : SUCCESS.measurement);
      if (photo) {
        const latest = flagged?.measurements[flagged.measurements.length - 1];
        if (latest) {
          try {
            await request("PUT", `/api/measurements/${latest.id}/photo`, { raw: photo, headers: { "content-type": photo.type } });
          } catch (failure) {
            const message = failure instanceof Error ? failure.message : "";
            refuse(message);
          }
        }
      }
      onSaved(data);
      close(true);
    }, PENDING.save);
    return ok;
  };

  return (
    <DialogForm onSubmit={() => void save()} submit="Save measurement" busy={form.busy}>
      <SelectField label="Dimension" value={dimension} onChange={setDimension} options={dimensions.map((key) => ({ value: key, label: key }))} error={form.errors.dimension} />
      <TextField label="Measured length (mm)" value={value} onChange={setValue} error={form.errors.value_mm} inputMode="numeric" />
      <TextField label="Measured on" value={day} onChange={setDay} error={form.errors.measured_on} hint="YYYY-MM-DD" />
      <FieldShell label="Tape photo">
        {({ id }) => <input id={id} type="file" accept="image/jpeg,image/png" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />}
      </FieldShell>
    </DialogForm>
  );
}

export function RecordMeasurementDialog(props: { boatCode: string; dimensions: DimensionKey[]; onSaved: (boat: Boat) => void; onClose: () => void }) {
  return (
    <Dialog title="Record measurement" onClose={props.onClose}>
      <Body boatCode={props.boatCode} dimensions={props.dimensions} onSaved={props.onSaved} />
    </Dialog>
  );
}
