import { Clock } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatDate, formatTime } from "../../../../shared/format";
import { call, post } from "../../api";
import { isStudio, useOffice, type Role } from "../context";
import { FILE_LIMIT, tooLarge } from "../copy";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { ErrorSummary, fieldId, TextField, type Errors } from "../fields";
import { ActionButton, domId, focusId, StickyBar, TableRegion } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import "./register.css";

// PL-06 Shop drawings: contractor submissions, the Hong Kong working-day review clock and review codes.

interface ShopDrawing {
  id: string;
  reference: string;
  title: string;
  submission: number;
  status: "received" | "returned";
  receivedAt: string;
  reviewDueOn: string;
  overdue: boolean;
  canReview: boolean;
  canResubmit: boolean;
  review: { code: number; label: string; comments: string; by: string; at: string } | null;
}

const CODES = [
  { code: 1, label: "Code 1 Proceed", shape: "circle" },
  { code: 2, label: "Code 2 Proceed with comments", shape: "ring" },
  { code: 3, label: "Code 3 Revise and resubmit", shape: "triangle" },
  { code: 4, label: "Code 4 Rejected", shape: "cross" },
] as const;
const REVIEWERS: Role[] = ["director", "project_lead", "designer"];
const SUBMIT_FORM = "submit-shop-drawing";
const REFRESH_MS = 60_000;

function CodeShape({ code }: { code: number }) {
  const shape = CODES[code - 1].shape;
  return (
    <svg className={`shape code-${code}`} data-shape={shape} viewBox="0 0 14 14" aria-hidden="true">
      {shape === "circle" && <circle cx="7" cy="7" r="6" />}
      {shape === "ring" && <circle cx="7" cy="7" r="5" />}
      {shape === "triangle" && <path d="M7 1.5 13 12.5H1Z" />}
      {shape === "cross" && <path d="M2 2 12 12M12 2 2 12" />}
    </svg>
  );
}

/** A `datetime-local` value in Hong Kong time as an instant; seconds the browser dropped are put back. */
function hongKongInstant(local: string): string {
  if (!local) return "";
  const withSeconds = /T\d{2}:\d{2}$/.test(local) ? `${local}:00` : local;
  return `${withSeconds}+08:00`;
}

export function ShopDrawingsPanel() {
  const office = useOffice();
  const { project } = useProject();
  const drawings = useResource<{ shopDrawings: ShopDrawing[] }>(`/api/projects/${project.id}/shop-drawings`);
  const [submitting, setSubmitting] = useState<{ resubmit?: ShopDrawing; draft?: Record<string, unknown> } | null>(null);
  const [reviewing, setReviewing] = useState<ShopDrawing | null>(null);
  const member = office.member;
  const canSubmit = !!member && (member.role === "contractor" || REVIEWERS.includes(member.role));
  const { reload } = drawings;

  useEffect(() => {
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const { takeDraft } = office;
  useEffect(() => {
    const draft = takeDraft(SUBMIT_FORM);
    if (draft) setSubmitting({ draft });
  }, [takeDraft]);

  const list = drawings.data?.shopDrawings ?? [];

  const afterReturn = async (id: string): Promise<void> => {
    const fresh = (await reload())?.shopDrawings ?? [];
    flushSync(() => setReviewing(null));
    const index = fresh.findIndex((d) => d.id === id);
    const next = fresh.slice(index + 1).find((d) => d.canReview);
    if (next) focusId(domId("review", next.reference));
    else focusId("shop-drawings-heading");
  };

  const submitButton = canSubmit && (
    <button type="button" className="button button-primary" onClick={() => setSubmitting({})}>Submit shop drawing</button>
  );

  return (
    <div className="has-action-bar">
      <PanelTitle section="shop-drawings" />
      <div className="panel-heading">
        <div>
          <h2 id="shop-drawings-heading" tabIndex={-1}>Shop drawings</h2>
          <p className="panel-lede">Reviews are due five Hong Kong working days after receipt, with a 17:00 HKT cut-off.</p>
        </div>
        {submitButton && <div className="actions">{submitButton}</div>}
      </div>
      <div className="panel-body register-body">
        <TableRegion label="Shop drawings, scrolls sideways">
          <table className="register-table">
            <caption className="visually-hidden">Shop drawings</caption>
            <thead>
              <tr><th scope="col">Reference</th><th scope="col">Title</th><th scope="col">Submission</th><th scope="col">Received</th>
                <th scope="col">Due</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {list.map((drawing) => (
                <tr key={drawing.id}>
                  <td className="sheet-code">{drawing.reference}</td>
                  <td>{drawing.title}</td>
                  <td>{drawing.submission}</td>
                  <td>{formatTime(drawing.receivedAt)}</td>
                  <td>
                    {drawing.overdue ? (
                      <span className="badge badge-overdue"><Clock className="shape" data-shape="clock" aria-hidden="true" />Review overdue</span>
                    ) : <span>Due {formatDate(drawing.reviewDueOn)}</span>}
                  </td>
                  <td>
                    {drawing.review ? (
                      <span className={`badge badge-code code-${drawing.review.code}`}><CodeShape code={drawing.review.code} />{drawing.review.label}</span>
                    ) : <span className="badge"><span className="shape awaiting" aria-hidden="true" />Awaiting review</span>}
                  </td>
                  <td>
                    <div className="row-actions">
                      {drawing.canReview && (
                        <button type="button" id={domId("review", drawing.reference)} className="button" onClick={() => setReviewing(drawing)}>
                          Review {drawing.reference}
                        </button>
                      )}
                      {canSubmit && drawing.canResubmit && (
                        <button type="button" className="button" onClick={() => setSubmitting({ resubmit: drawing })}>Resubmit {drawing.reference}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && drawings.data && (
                <tr><td colSpan={7} className="empty-cell">No shop drawings yet. Contractors submit them here for review.</td></tr>
              )}
            </tbody>
          </table>
        </TableRegion>
      </div>
      {submitButton && <StickyBar>{submitButton}</StickyBar>}
      <SubmitDialog state={submitting} projectId={project.id} studio={isStudio(member)} onCancel={() => setSubmitting(null)}
        onDone={async () => {
          await reload();
          flushSync(() => setSubmitting(null));
          focusId("shop-drawings-heading");
        }} />
      <ReviewDialog drawing={reviewing} onCancel={() => setReviewing(null)} onReturned={afterReturn} onLost={async () => {
        await reload();
        flushSync(() => setReviewing(null));
        focusId("shop-drawings-heading");
      }} />
    </div>
  );
}

function SubmitDialog({ state, projectId, studio, onCancel, onDone }: {
  state: { resubmit?: ShopDrawing; draft?: Record<string, unknown> } | null; projectId: string; studio: boolean;
  onCancel: () => void; onDone: () => Promise<void>;
}) {
  const office = useOffice();
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [received, setReceived] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [wasOpen, setWasOpen] = useState(false);
  const fileInput = useId();
  const open = state !== null;
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReference(String(state?.draft?.reference ?? ""));
      setTitle(String(state?.draft?.title ?? ""));
      setReceived(String(state?.draft?.receivedAt ?? ""));
      setFile(null);
      setErrors({});
    }
  }
  const resubmit = state?.resubmit;
  const form = "shop-drawing";

  const send = async (): Promise<void> => {
    const data = new FormData();
    if (!resubmit) {
      data.append("reference", reference);
      data.append("title", title);
    }
    if (studio && received) data.append("receivedAt", hongKongInstant(received));
    if (file) data.append("file", file, file.name);
    office.announce("Sending…");
    const path = resubmit ? `/api/shop-drawings/${resubmit.id}/resubmissions` : `/api/projects/${projectId}/shop-drawings`;
    const result = await call<{ shopDrawing: ShopDrawing }>("POST", path, undefined, { raw: data });
    if (result.ok) {
      const saved = result.data.shopDrawing;
      office.announce(`${saved.reference} received. Review due ${formatDate(saved.reviewDueOn)}.`);
      await onDone();
      return;
    }
    const body = office.refused(result, { id: SUBMIT_FORM, values: { reference, title, receivedAt: received } });
    if (body?.error === "validation") flushSync(() => setErrors(body.errors ?? {}));
    else if (body?.error === "file_too_large" || body?.error === "body_too_large") {
      flushSync(() => setErrors({ file: tooLarge(file?.name ?? "The file", FILE_LIMIT) }));
    } else if (body?.error === "storage_unavailable") {
      office.alert(`File storage is unreachable, so ${file?.name ?? "the drawing"} wasn't uploaded. Nothing was saved.`);
    } else if (body?.error === "illegal_transition") office.alert(`That can't be done while this is ${body.from}.`);
    focusRefusal(openDialog());
  };

  const fileId = fieldId(form, "file");
  return (
    <Dialog title={resubmit ? `Resubmit ${resubmit.reference}` : "Submit shop drawing"} open={open} onCancel={onCancel}
      actions={<ActionButton primary type="submit" pending="Sending…" onAction={send}>Send for review</ActionButton>}>
      <ErrorSummary errors={errors} form={form} />
      {!resubmit && (
        <>
          <TextField form={form} name="reference" label="Reference" value={reference} onChange={setReference} error={errors.reference} />
          <TextField form={form} name="title" label="Title" value={title} onChange={setTitle} error={errors.title} />
        </>
      )}
      <div className="field">
        <label htmlFor={fileId}>Drawing file</label>
        <span className="hint" id={fileInput}>A PDF, PNG, JPEG or SVG up to 10,000,000 bytes.</span>
        <input id={fileId} type="file" className="input file-input" accept=".pdf,.png,.jpg,.jpeg,.svg"
          aria-describedby={errors.file ? `${fileInput} ${fileId}-error` : fileInput} aria-invalid={errors.file ? true : undefined}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        {errors.file && <span className="field-error" id={`${fileId}-error`} tabIndex={-1}>{errors.file}</span>}
      </div>
      {studio && (
        <TextField form={form} name="receivedAt" label="Received at" type="datetime-local" step="1" value={received} onChange={setReceived}
          error={errors.receivedAt} hint="Hong Kong time, for a transmittal received earlier." />
      )}
    </Dialog>
  );
}

function ReviewDialog({ drawing, onCancel, onReturned, onLost }: {
  drawing: ShopDrawing | null; onCancel: () => void; onReturned: (id: string) => Promise<void>; onLost: () => Promise<void>;
}) {
  const office = useOffice();
  const [code, setCode] = useState(0);
  const [comments, setComments] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [wasFor, setWasFor] = useState<string | null>(null);
  const labelId = useId();
  const current = useRef(drawing);
  if (drawing) current.current = drawing;
  if ((drawing?.id ?? null) !== wasFor) {
    setWasFor(drawing?.id ?? null);
    setCode(0);
    setComments("");
    setErrors({});
  }
  const shown = current.current;
  const form = "review";

  const send = async (): Promise<void> => {
    if (!shown) return;
    office.announce("Returning drawing…");
    const result = await post<{ shopDrawing: ShopDrawing }>(`/api/shop-drawings/${shown.id}/review`,
      { code: code || undefined, comments });
    if (result.ok) {
      const label = result.data.shopDrawing.review?.label ?? "";
      office.announce(`${shown.reference} returned with ${label}.`);
      await onReturned(shown.id);
      return;
    }
    const body = office.refused(result, { id: `review-${shown.id}`, values: { code, comments } });
    if (body?.error === "already_reviewed") {
      office.alert(`${String(body.by)} already returned ${shown.reference} on ${formatTime(String(body.at))}.`);
      await onLost();
      return;
    }
    if (body?.error === "validation") flushSync(() => setErrors(body.errors ?? {}));
    focusRefusal(openDialog());
  };

  const codeId = fieldId(form, "code");
  return (
    <Dialog title={shown ? `Review ${shown.reference}` : "Review"} open={drawing !== null} onCancel={onCancel}
      actions={<ActionButton primary type="submit" pending="Returning drawing…" onAction={send}>Return drawing</ActionButton>}>
      <ErrorSummary errors={errors} form={form} />
      {shown && <p className="review-meta">{shown.title} · submission {shown.submission} · due {formatDate(shown.reviewDueOn)}</p>}
      <div className="field">
        <span className="label" id={labelId}>Review code</span>
        <div role="radiogroup" aria-labelledby={labelId} className="code-options" id={codeId} tabIndex={-1}
          aria-describedby={errors.code ? `${codeId}-error` : undefined}>
          {CODES.map((option) => (
            <label key={option.code} className="code-option">
              <input type="radio" name="review-code" value={option.code} checked={code === option.code} onChange={() => setCode(option.code)} />
              <CodeShape code={option.code} />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {errors.code && <span className="field-error" id={`${codeId}-error`} tabIndex={-1}>{errors.code}</span>}
      </div>
      <TextField form={form} name="comments" label="Comments" multiline value={comments} onChange={setComments} error={errors.comments} />
    </Dialog>
  );
}
