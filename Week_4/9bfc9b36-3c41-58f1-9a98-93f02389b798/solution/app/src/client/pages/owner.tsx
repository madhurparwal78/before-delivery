/** The owner's screens: their boats and submissions, the cut sheets shared with them, and the sheet viewer. */
import { useEffect, useRef, useState } from "react";
import { ApiError, getBlob, getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { Link } from "../router.js";
import { answered, Chip, DataTable, Dialog, DialogForm, EmptyState, SelectField, TextField, useDialog, useLoad, usePoll, useSubmitter } from "../ui.js";
import { PageHeading } from "./chrome.js";
import { AccountRegion } from "./drawing.js";
import { todayUtc } from "../format.js";
import { EMPTY, OUTAGES, PENDING, SUCCESS, VIEWER_REFUSAL, supersededCopy } from "../../shared/copy.js";
import { DIMENSION_KEYS, type Boat, type Drawing, type Grant, type Page, type SailAccount, type Submission } from "../../shared/types.js";
import { lengthText } from "../../shared/units.js";

function SubmitDialog({ boat, onSent }: { boat: Boat; onSent: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [dimension, setDimension] = useState("P");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("mm");
  const [day, setDay] = useState(todayUtc());
  const [note, setNote] = useState("");
  const send = () =>
    form.run(async () => {
      const figure = unit === "mm" ? { value_mm: /^\d+$/.test(value.trim()) ? Number(value.trim()) : value } : { value_in: value };
      await sendJson<Submission>("POST", `/api/boats/${boat.code}/submissions`, { dimension, ...figure, measured_on: day, note });
      say(SUCCESS.submission);
      close(true);
      await onSent();
    }, PENDING.submission);
  return (
    <DialogForm onSubmit={() => void send()} submit="Send to the loft" busy={form.busy}>
      <SelectField label="Dimension" value={dimension} onChange={setDimension} options={DIMENSION_KEYS.map((key) => ({ value: key, label: key }))} error={form.errors.dimension} />
      <TextField label="Measured length" value={value} onChange={setValue} error={form.errors.value_mm ?? form.errors.value_in} />
      <SelectField label="Unit" value={unit} onChange={setUnit} options={[{ value: "mm", label: "mm" }, { value: "in", label: "in" }]} />
      <TextField label="Measured on" value={day} onChange={setDay} error={form.errors.measured_on} hint="YYYY-MM-DD" />
      <TextField label="Note" value={note} onChange={setNote} error={form.errors.note} />
    </DialogForm>
  );
}

const STATUS_TEXT: Record<Submission["status"], string> = { pending: "Pending", accepted: "Accepted", rejected: "Rejected", reversed: "Reversed" };

export function OwnerPage() {
  const boats = useLoad((signal) => getJson<Page<Boat>>("/api/boats?limit=50", signal), []);
  const submissions = useLoad((signal) => getJson<Page<Submission>>("/api/submissions?limit=50", signal), []);
  const sheets = useLoad((signal) => getJson<Page<Grant>>("/api/my/cut-sheets?limit=50", signal), []);
  const [open, setOpen] = useState<Boat | null>(null);
  return (
    <main className="page">
      <section className="field-ground">
        <PageHeading>My boats</PageHeading>
      </section>
      {!answered(boats, submissions, sheets) ? null : <>
      {boats.data && boats.data.items.length === 0 ? (
        <EmptyState>{EMPTY.boats}</EmptyState>
      ) : (
        <section className="field-surface">
          <ul className="boat-list">
            {(boats.data?.items ?? []).map((boat) => (
              <li key={boat.code} className="boat-row">
                <div>
                  <h2>{`${boat.code} · ${boat.name}`}</h2>
                  <p className="muted">
                    {boat.class_name} · {boat.dimensions.filter((item) => item.value_mm !== null).map((item) => `${item.key} ${lengthText(item.value_mm!)}${item.status === "remeasure" ? " (Remeasure)" : ""}`).join(" · ")}
                  </p>
                </div>
                <button type="button" className="button" onClick={() => setOpen(boat)}>
                  Submit measurement
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="field-surface">
        <h2>My submissions</h2>
        <DataTable
          label="My submissions"
          headers={["Submission", "Boat", "Dimension", "Figure", "Status", "Measured on", "Reason"]}
          rows={(submissions.data?.items ?? []).map((item) => ({
            key: item.id,
            cells: [item.id, item.boat_code, item.dimension, `${item.as_submitted} · ${lengthText(item.value_mm)}`, <Chip key="s" tone={item.status === "accepted" ? "cobalt" : item.status === "rejected" ? "ink" : "plain"}>{STATUS_TEXT[item.status]}</Chip>, item.measured_on, item.reason ?? ""],
          }))}
        />
      </section>
      <section className="field-ground" id="sheets">
        <h2>Cut sheets</h2>
        {sheets.data && sheets.data.items.length === 0 ? (
          <EmptyState>{EMPTY.sheets}</EmptyState>
        ) : (
          <ul className="sheet-list">
            {(sheets.data?.items ?? []).map((grant) => (
              <li key={grant.id}>
                <Link to={`/sheets/${grant.id}`}>{`Open cut sheet ${grant.drawing_code}`}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      </>}
      {open ? (
        <Dialog title="Submit measurement" onClose={() => setOpen(null)}>
          <SubmitDialog
            boat={open}
            onSent={async () => {
              await Promise.all([submissions.reload(), boats.reload()]);
            }}
          />
        </Dialog>
      ) : null}
    </main>
  );
}

export function SheetViewer({ id }: { id: string }) {
  const { setOutage, refuse } = useLive();
  const [gone, setGone] = useState(false);
  const grant = useLoad((signal) => getJson<Grant>(`/api/grants/${id}`, signal), [id]);
  const drawingCode = grant.data?.drawing_code ?? null;
  const drawing = useLoad((signal) => (drawingCode ? getJson<Drawing>(`/api/drawings/${drawingCode}`, signal) : Promise.resolve(null)), [drawingCode]);
  const account = useLoad((signal) => (drawingCode ? getJson<SailAccount>(`/api/drawings/${drawingCode}/account`, signal) : Promise.resolve(null)), [drawingCode]);
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [imageDone, setImageDone] = useState(false);
  const made = useRef<string | null>(null);

  useEffect(() => {
    if (grant.error?.status === 404) setGone(true);
  }, [grant.error]);
  usePoll(() => void grant.reload(), 5, !gone);

  useEffect(() => {
    if (!drawingCode || gone) return;
    let live = true;
    getBlob(`/api/grants/${id}/cut-sheet`)
      .then((blob) => blob.text())
      .then((text) => {
        if (!live) return;
        // the sheet is drawn 1200 wide; the picture takes its box from the page, with the ratio held before it decodes
        const root = /<svg\b[^>]*>/.exec(text)?.[0] ?? "";
        const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(root);
        const fluid = root ? text.replace(root, root.replace(/\s(width|height)="[^"]*"/g, "")) : text;
        made.current = URL.createObjectURL(new Blob([fluid], { type: "image/svg+xml" }));
        setImage({ url: made.current, width: box ? Number(box[1]) : 1200, height: box ? Number(box[2]) : 900 });
        setImageDone(true);
        setOutage(null);
      })
      .catch((failure: unknown) => {
        if (live) setImageDone(true);
        if (!(failure instanceof ApiError)) throw failure;
        if (failure.status === 404) setGone(true);
        else if (failure.code === "store_unavailable") setOutage(OUTAGES.sheet);
        else refuse(failure.body.message);
      });
    return () => {
      live = false;
    };
  }, [drawingCode, id, gone, setOutage, refuse]);

  useEffect(() => {
    if (!gone) return;
    setImage(null);
    if (made.current) URL.revokeObjectURL(made.current);
  }, [gone]);

  const code = drawingCode ?? "";
  return (
    <main className="page">
      {gone ? (
        <section className="field-black viewer-refusal">
          <PageHeading>Cut sheet</PageHeading>
          <p className="large-copy">{VIEWER_REFUSAL}</p>
        </section>
      ) : (
        <>
          <section className="field-ground">
            <PageHeading>{`Cut sheet ${code}`}</PageHeading>
            {drawing.data?.cut_sheet?.superseded_by ? <p className="banner-black">{supersededCopy(drawing.data.cut_sheet.superseded_by)}</p> : null}
          </section>
          {answered(grant, drawing, account) && imageDone ? (
            <>
              <section className="field-surface sheet-frame">
                {image ? <img src={image.url} width={image.width} height={image.height} style={{ aspectRatio: `${image.width} / ${image.height}` }} alt={`Cut sheet ${code}`} className="sheet-image" /> : null}
              </section>
              {account.data ? <AccountRegion account={account.data} /> : null}
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
