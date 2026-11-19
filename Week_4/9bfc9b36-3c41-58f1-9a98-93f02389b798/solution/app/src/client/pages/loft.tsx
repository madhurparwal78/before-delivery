/** The loft: boats, sail drawings and the dialogs that create them. */
import { useState } from "react";
import { getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { Link, useRouter } from "../router.js";
import { answered, Chip, DataTable, Dialog, DialogForm, SelectField, TextArea, TextField, useCollection, useDialog, useLoad, useSubmitter, type Collection } from "../ui.js";
import { sailLabel, statusLabel } from "../format.js";
import { PENDING, SUCCESS, STATUS_LABELS } from "../../shared/copy.js";
import { areaText } from "../../shared/units.js";
import type { Account, Boat, Cloth, Drawing, DrawingStatus, Page } from "../../shared/types.js";
import { PageHeading } from "./chrome.js";

const statusTone = (status: DrawingStatus): "ink" | "cobalt" | "plain" =>
  status === "remeasure" ? "ink" : status === "issued" || status === "cut" ? "cobalt" : status === "pending_store" ? "ink" : "plain";

export function StatusChip({ status }: { status: DrawingStatus }) {
  return <Chip tone={statusTone(status)}>{statusLabel(status)}</Chip>;
}

function NewBoat({ owners }: { owners: Collection<Account> }) {
  const { close } = useDialog();
  const { navigate } = useRouter();
  const { say } = useLive();
  const form = useSubmitter();
  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const options = owners.items.filter((account) => account.role === "yacht-owner").map((account) => ({ value: account.email, label: account.display_name }));
  const save = () =>
    form.run(async () => {
      const { data } = await sendJson<Boat>("POST", "/api/boats", { name, class_name: className, notes, owner_email: owner || options[0]?.value });
      say(SUCCESS.saved);
      close(false);
      navigate(`/boats/${data.code}`, { state: { focus: true } });
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Create boat" busy={form.busy}>
      <TextField label="Boat name" value={name} onChange={setName} error={form.errors.name} />
      <TextField label="Class" value={className} onChange={setClassName} error={form.errors.class_name} />
      <TextArea label="Notes" value={notes} onChange={setNotes} error={form.errors.notes} />
      <SelectField label="Owner" value={owner || options[0]?.value || ""} onChange={setOwner} options={options} error={form.errors.owner_email} />
    </DialogForm>
  );
}

function NewDrawing({ boats, cloths }: { boats: Collection<Boat>; cloths: Collection<Cloth> }) {
  const { close } = useDialog();
  const { navigate } = useRouter();
  const { say } = useLive();
  const form = useSubmitter();
  const [boat, setBoat] = useState("");
  const [sail, setSail] = useState("mainsail");
  const [cloth, setCloth] = useState("");
  const boatOptions = boats.items.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const clothOptions = cloths.items.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const save = () =>
    form.run(async () => {
      const { data } = await sendJson<Drawing>("POST", "/api/drawings", { boat_code: boat || boatOptions[0]?.value, sail, cloth_code: cloth || clothOptions[0]?.value });
      say(SUCCESS.saved);
      close(false);
      navigate(`/drawings/${data.code}/${data.step ?? "draw"}`, { state: { focus: true } });
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Create drawing" busy={form.busy}>
      <SelectField label="Boat" value={boat || boatOptions[0]?.value || ""} onChange={setBoat} options={boatOptions} error={form.errors.boat_code} />
      <SelectField label="Sail" value={sail} onChange={setSail} options={[{ value: "mainsail", label: "Mainsail" }, { value: "headsail", label: "Headsail" }]} error={form.errors.sail} />
      <SelectField label="Cloth" value={cloth || clothOptions[0]?.value || ""} onChange={setCloth} options={clothOptions} error={form.errors.cloth_code} />
    </DialogForm>
  );
}

const FILTERS: [string, string][] = [["", "All"], ...(Object.entries(STATUS_LABELS) as [string, string][])];

export function LoftPage() {
  const [dialog, setDialog] = useState<"boat" | "drawing" | null>(null);
  const [status, setStatus] = useState("");
  const boats = useCollection<Boat>("/api/boats");
  const owners = useCollection<Account>("/api/accounts");
  const cloths = useCollection<Cloth>("/api/cloths", 1);
  const [visibleBoats, setVisibleBoats] = useState(50);
  const drawings = useLoad((signal) => getJson<Page<Drawing>>(`/api/drawings?limit=50${status ? `&status=${status}` : ""}`, signal), [status]);
  const [moreDrawings, setMoreDrawings] = useState<Drawing[]>([]);
  const [drawingCursor, setDrawingCursor] = useState<string | null | undefined>(undefined);

  const boatList = boats.items.slice(0, visibleBoats);
  const drawingList = [...(drawings.data?.items ?? []), ...moreDrawings];
  const nextDrawing = drawingCursor === undefined ? (drawings.data?.next_cursor ?? null) : drawingCursor;

  const showMoreDrawings = async () => {
    if (!nextDrawing) return;
    const page = await getJson<Page<Drawing>>(`/api/drawings?limit=50${status ? `&status=${status}` : ""}&cursor=${encodeURIComponent(nextDrawing)}`);
    setMoreDrawings((list) => [...list, ...page.items]);
    setDrawingCursor(page.next_cursor);
  };

  return (
    <main className="page">
      <section className="field-ground">
        <div className="section-head">
          <PageHeading>The loft</PageHeading>
          <div className="actions">
            <button type="button" className="button" onClick={() => setDialog("boat")}>
              New boat
            </button>
            <button type="button" className="button" onClick={() => setDialog("drawing")}>
              New drawing
            </button>
          </div>
        </div>
      </section>
      {!answered(boats, drawings) ? null : <>
      <section className="field-surface">
        <h2>Boats</h2>
        <DataTable
          label="Boats"
          headers={["Boat", "Name", "Class", "Owner", "Foretriangle"]}
          rows={boatList.map((boat) => ({
            key: boat.code,
            cells: [<Link key="l" to={`/boats/${boat.code}`}>{boat.code}</Link>, boat.name, boat.class_name, boat.owner.display_name, areaText(boat.foretriangle.area_mm2)],
          }))}
        />
        {boats.items.length > visibleBoats ? (
          <button type="button" className="button" onClick={() => setVisibleBoats((count) => count + 50)}>
            Show more boats
          </button>
        ) : null}
      </section>
      <section className="field-ground">
        <h2>Sail drawings</h2>
        <SelectField
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setMoreDrawings([]);
            setDrawingCursor(undefined);
          }}
          options={FILTERS.map(([value, label]) => ({ value, label }))}
        />
        <DataTable
          label="Sail drawings"
          headers={["Drawing", "Boat", "Sail", "Status", "Loft hand"]}
          rows={drawingList.map((drawing) => ({
            key: drawing.code,
            cells: [
              <Link key="l" to={`/drawings/${drawing.code}`}>{drawing.code}</Link>,
              `${drawing.boat_code} · ${drawing.boat_name}`,
              sailLabel(drawing.sail),
              <StatusChip key="s" status={drawing.status} />,
              drawing.assigned_to?.display_name ?? "",
            ],
          }))}
        />
        {nextDrawing ? (
          <button type="button" className="button" onClick={() => void showMoreDrawings()}>
            Show more drawings
          </button>
        ) : null}
      </section>
      </>}
      {dialog === "boat" && owners.ready ? (
        <Dialog title="New boat" onClose={() => setDialog(null)}>
          <NewBoat owners={owners} />
        </Dialog>
      ) : null}
      {dialog === "drawing" && boats.ready && cloths.ready ? (
        <Dialog title="New drawing" onClose={() => setDialog(null)}>
          <NewDrawing boats={boats} cloths={cloths} />
        </Dialog>
      ) : null}
    </main>
  );
}
