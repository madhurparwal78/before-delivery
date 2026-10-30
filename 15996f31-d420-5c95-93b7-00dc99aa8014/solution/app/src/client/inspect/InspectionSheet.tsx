// The inspection sheet at /inspect/<token>: no sign-in, phone first (brief: Screens and layout; Journey 4).

import { Camera, Check, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NOT_INSPECTED, tierLabel, type SampleChange, type Sheet, type SheetBlock, type SignResult } from "../../shared/api.js";
import { countyName, frames, humanDateTime, money } from "../../shared/format.js";
import { averageTenths } from "../../shared/strength.js";
import { del, get, newKey, post, request, type Result } from "../api.js";
import { COPY, genericProblem } from "../copy.js";
import { useFeedback } from "../feedback.js";
import { useInterval } from "../hooks.js";
import { PayableFigure, StrengthLog } from "../desk/Ledger.js";
import { Legend, PlatMap, Swatch } from "../PlatMap.js";
import { toTenths, useStrength, type BlockFigures } from "../strength.js";
import { Dialog } from "../ui/Dialog.js";
import { Button, ErrorSummary, clearEdited, SelectField, TextField, errorFor, fieldErrors, type FieldError } from "../ui/forms.js";

const POLL_MS = 3000;

function figures(sheet: Sheet): BlockFigures[] {
  return sheet.blocks.map((block) => ({ id: block.id, name: block.name, average: toTenths(block.average_frames), tier: block.tier }));
}

function DeadLink({ message }: { message: string }) {
  return (
    <main className="dead-link">
      <p className="wordmark">Swarmline Bloom Desk</p>
      <h1>This inspection link no longer works</h1>
      <p>{message}</p>
    </main>
  );
}

function photoProblem(result: Extract<Result<unknown>, { ok: false }>): string {
  if (result.status === 413) return "Photos must be 8,000,000 bytes or smaller.";
  if (result.status === 415) return "Photos must be JPEG, PNG or WebP images.";
  if (result.status === 503) return "Photo storage is unreachable. The sample is saved without this photo; try again in a minute.";
  return result.error?.fields?.photo ?? genericProblem(result);
}

export function InspectionSheet({ token }: { token: string }) {
  const feedback = useFeedback();
  const strength = useStrength();
  const { load, apply, provisional, rollback } = strength;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [blockId, setBlockId] = useState("");
  const [dropId, setDropId] = useState("");
  const [colony, setColony] = useState("");
  const [framesText, setFramesText] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [signOpen, setSignOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const extraPhoto = useRef<HTMLInputElement>(null);
  const extraFor = useRef<{ id: string; label: string } | null>(null);
  const signOpener = useRef<HTMLButtonElement>(null);
  const base = `/api/inspect/${encodeURIComponent(token)}`;

  const deadFrom = (result: Extract<Result<unknown>, { ok: false }>): boolean => {
    if (result.status !== 410 && result.status !== 404) return false;
    setDead(result.error?.error === "link_signed" ? result.error.message : "Ask the broker for a new link.");
    return true;
  };

  const read = useCallback(
    async (first: boolean) => {
      const result = await get<Sheet>(base);
      if (!result.ok) {
        if (result.status === 410 || result.status === 404) setDead(result.error?.error === "link_signed" ? result.error.message : "Ask the broker for a new link.");
        return;
      }
      setSheet(result.data);
      if (first) load(figures(result.data), result.data.payable_cents);
      else apply(figures(result.data), result.data.payable_cents);
    },
    [base, load, apply],
  );

  useEffect(() => {
    document.title = "Inspection sheet · Swarmline Bloom Desk";
    void read(true);
  }, [read]);

  useInterval(() => void read(false), POLL_MS, sheet !== null && !signed && dead === null && busy === null && !signOpen);

  useEffect(() => {
    if (!sheet || blockId) return;
    const first = sheet.blocks.find((block) => block.yards.length > 0);
    if (first) {
      setBlockId(first.id);
      setDropId(first.yards[0]?.drop_id ?? "");
    }
  }, [sheet, blockId]);

  const block = sheet?.blocks.find((entry) => entry.id === blockId);

  const uploadPhoto = async (sample: { id: string; label: string }, file: File): Promise<void> => {
    feedback.update("Uploading photo…");
    const form = new FormData();
    form.append("photo", file);
    setBusy(`photo-${sample.id}`);
    const result = await request<{ photo: { id: string; url: string } }>("POST", `${base}/samples/${sample.id}/photos`, form);
    setBusy(null);
    if (result.ok) {
      feedback.update(`Photo added to sample ${sample.label}.`);
      void read(false);
      return;
    }
    feedback.update("");
    if (!deadFrom(result)) feedback.problem(photoProblem(result));
  };

  const addSample = async (event: FormEvent) => {
    event.preventDefault();
    if (!sheet || !block) return;
    const label = colony.trim();
    const value = Number(framesText);
    const file = photoInput.current?.files?.[0] ?? null;
    feedback.clearProblem();
    feedback.update(`Saving sample ${label}…`);
    if (Number.isFinite(value) && framesText.trim() !== "" && value >= 0 && value <= 20) {
      provisional(block.id, averageTenths([...block.samples.map((sample) => toTenths(sample.frames) ?? 0), toTenths(value) ?? 0]));
    }
    setBusy("add");
    const result = await post<SampleChange>(`${base}/samples`, {
      block_id: block.id,
      drop_id: dropId,
      colony_label: label,
      frames: framesText.trim() === "" ? null : value,
    });
    setBusy(null);
    if (!result.ok) {
      rollback(block.id);
      feedback.update("");
      if (deadFrom(result)) return;
      if (result.status === 422) {
        setErrors(
          fieldErrors(result.error?.fields, { block_id: "sample-block", drop_id: "sample-yard", colony_label: "sample-colony", frames: "sample-frames" }, "sample-block"),
        );
      } else feedback.problem(genericProblem(result));
      return;
    }
    setErrors([]);
    const change = result.data;
    const next: Sheet = {
      ...sheet,
      payable_cents: change.payable_cents,
      blocks: sheet.blocks.map((entry) =>
        entry.id === change.block.id
          ? { ...entry, ...change.block, samples: change.sample ? [...entry.samples, change.sample] : entry.samples }
          : entry,
      ),
    };
    setSheet(next);
    apply(figures(next), next.payable_cents);
    feedback.update(`Sample ${label} saved.`);
    setColony("");
    setFramesText("");
    if (photoInput.current) photoInput.current.value = "";
    if (file && change.sample) {
      // The upload starts on the next task, so "Sample … saved." is heard before "Uploading photo…" replaces it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await uploadPhoto({ id: change.sample.id, label }, file);
    }
  };

  const removeSample = async (entry: SheetBlock, sample: SheetBlock["samples"][number]) => {
    if (!sheet) return;
    feedback.clearProblem();
    feedback.update(`Removing sample ${sample.colony_label}…`);
    setBusy(`remove-${sample.id}`);
    const result = await del<SampleChange>(`${base}/samples/${sample.id}`);
    setBusy(null);
    if (!result.ok) {
      feedback.update("");
      if (!deadFrom(result)) feedback.problem(genericProblem(result));
      return;
    }
    const next: Sheet = {
      ...sheet,
      payable_cents: result.data.payable_cents,
      blocks: sheet.blocks.map((item) =>
        item.id === entry.id ? { ...item, ...result.data.block, samples: item.samples.filter((other) => other.id !== sample.id) } : item,
      ),
    };
    setSheet(next);
    apply(figures(next), next.payable_cents);
    feedback.update(`Sample ${sample.colony_label} removed.`);
  };

  if (dead !== null) return <DeadLink message={dead} />;
  if (sheet === null) {
    return (
      <main className="sheet">
        <p className="loading-line">Opening the inspection sheet…</p>
      </main>
    );
  }

  const mapBlocks = sheet.blocks.map((entry) => ({ id: entry.id, name: entry.name, acres: Math.max(1, entry.hives_delivered) }));
  const needed = (entry: SheetBlock) => Math.max(0, entry.samples_required - entry.sample_count);

  return (
    <div className={`sheet-page${signed ? " is-signed" : ""}`}>
      <header className="sheet-header">
        <p className="wordmark">Swarmline Bloom Desk</p>
        <h1>{sheet.orchard.name}</h1>
        <p className="sheet-meta">
          {countyName(sheet.orchard.county)} · {sheet.order.ref}
          {signed ? (
            <span className="status-chip status-signed">
              <Check aria-hidden="true" size={16} strokeWidth={2} /> Signed
            </span>
          ) : (
            <span className="expires">Link expires {humanDateTime(new Date(sheet.link.expires_at))}</span>
          )}
        </p>
      </header>
      <main className="sheet">
        <div className="sheet-map">
          <PlatMap
            compact
            orchardName={sheet.orchard.name}
            blocks={mapBlocks}
            shown={strength.shown.blocks}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id);
              const chosen = sheet.blocks.find((entry) => entry.id === id);
              if (chosen && chosen.yards.length > 0 && !signed) {
                setBlockId(id);
                setDropId(chosen.yards[0].drop_id);
              }
            }}
            reduced={strength.reduced}
          />
          <Legend />
        </div>
        <div className="sheet-blocks">
          {sheet.blocks.map((entry) => {
            const shownBlock = strength.shown.blocks[entry.id]?.settled ?? { average: null, tier: null };
            return (
              <section key={entry.id} className="sheet-block" aria-labelledby={`sb-${entry.id}`} id={`section-${entry.id}`} tabIndex={-1}>
                <header>
                  <h2 id={`sb-${entry.id}`}>{entry.name}</h2>
                  <p className="sheet-readout">
                    <Swatch fill={shownBlock.average === null ? "uninspected" : (shownBlock.tier ?? "uninspected")} />
                    <span>{shownBlock.average === null ? `No samples · ${NOT_INSPECTED}` : `${frames(shownBlock.average)} frames · ${tierLabel(shownBlock.tier)}`}</span>
                  </p>
                </header>
                <p className="muted">
                  {entry.hives_delivered} hives delivered · {entry.sample_count} of {entry.samples_required} samples
                  {needed(entry) > 0 ? ` · ${needed(entry)} more needed` : " · complete"}
                </p>
                <h3 className="mini-title">Yards delivered here</h3>
                {entry.yards.length === 0 ? (
                  <p className="muted">No yards delivered to this block.</p>
                ) : (
                  <ul className="yards">
                    {entry.yards.map((yard) => (
                      <li key={yard.drop_id}>
                        {yard.yard_name} <span className="num">· {yard.hives} hives</span>
                      </li>
                    ))}
                  </ul>
                )}
                {entry.samples.length > 0 ? (
                  <ul className="samples" aria-label={`Samples, ${entry.name}`}>
                    {entry.samples.map((sample) => (
                      <li key={sample.id} className="sample">
                        <div className="sample-line">
                          <strong>{sample.colony_label}</strong>
                          <span className="num">{frames(toTenths(sample.frames) ?? 0)} frames</span>
                          <span className="muted sample-yard">{entry.yards.find((yard) => yard.drop_id === sample.drop_id)?.yard_name}</span>
                        </div>
                        {sample.photos.length > 0 ? (
                          <ul className="thumbs" aria-label={`Photos, colony ${sample.colony_label}`}>
                            {sample.photos.map((photo, index) => (
                              <li key={photo.id}>
                                <img src={photo.url} alt={`Frame photo ${index + 1}, colony ${sample.colony_label}`} width={72} height={54} loading="lazy" />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {signed ? null : (
                          <div className="sample-actions">
                            <Button
                              aria-label={`Add photo to ${sample.colony_label}`}
                              busy={busy === `photo-${sample.id}`}
                              disabled={sample.photos.length >= 4}
                              onClick={() => {
                                extraFor.current = { id: sample.id, label: sample.colony_label };
                                extraPhoto.current?.click();
                              }}
                            >
                              <Camera aria-hidden="true" size={18} strokeWidth={1.5} />
                              Photo
                            </Button>
                            <Button aria-label={`Remove sample ${sample.colony_label}`} busy={busy === `remove-${sample.id}`} onClick={() => void removeSample(entry, sample)}>
                              <Trash2 aria-hidden="true" size={18} strokeWidth={1.5} />
                              Remove
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
          <input
            ref={extraPhoto}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              const target = extraFor.current;
              event.target.value = "";
              if (file && target) void uploadPhoto(target, file);
            }}
          />
          {signed ? null : (
            <form onInput={clearEdited(setErrors)} className="add-sample" aria-label="Add sample" onSubmit={addSample} noValidate>
              <h2>Add sample</h2>
              <ErrorSummary errors={errors} />
              <div className="field-pair">
                <SelectField
                  id="sample-block"
                  label="Block"
                  value={blockId}
                  error={errorFor(errors, "sample-block")}
                  onChange={(event) => {
                    setBlockId(event.target.value);
                    setDropId(sheet.blocks.find((entry) => entry.id === event.target.value)?.yards[0]?.drop_id ?? "");
                  }}
                >
                  {sheet.blocks.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField id="sample-yard" label="Yard" value={dropId} error={errorFor(errors, "sample-yard")} onChange={(event) => setDropId(event.target.value)}>
                  {(block?.yards ?? []).map((yard) => (
                    <option key={yard.drop_id} value={yard.drop_id}>
                      {yard.yard_name}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="field-pair">
                <TextField id="sample-colony" label="Colony" value={colony} onChange={(event) => setColony(event.target.value)} error={errorFor(errors, "sample-colony")} />
                <TextField
                  id="sample-frames"
                  label="Frames of bees"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={20}
                  step={0.1}
                  value={framesText}
                  onChange={(event) => setFramesText(event.target.value)}
                  error={errorFor(errors, "sample-frames")}
                />
              </div>
              <div className="field">
                <label htmlFor="sample-photo">Frame photo</label>
                <p className="field-hint" id="sample-photo-hint">
                  Optional. JPEG, PNG or WebP up to 8,000,000 bytes; it uploads right after the sample is saved.
                </p>
                <input id="sample-photo" ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="sample-photo-hint" />
              </div>
              <Button type="submit" variant="primary" busy={busy === "add"}>
                Add sample
              </Button>
            </form>
          )}
          {strength.reduced ? <StrengthLog notes={strength.notes} /> : null}
        </div>
      </main>
      <div className="sheet-dock">
        <table className="ledger-table dock-figure" aria-label="Sheet ledger">
          <tbody>
            <tr>
              <th scope="row">Payable</th>
              <td>
                <PayableFigure shown={strength.shown} reduced={strength.reduced} />
              </td>
            </tr>
          </tbody>
        </table>
        {signed ? (
          <p className="status-chip status-signed">
            <Check aria-hidden="true" size={16} strokeWidth={2} /> Signed
          </p>
        ) : (
          <Button ref={signOpener} variant="primary" onClick={() => setSignOpen(true)}>
            Sign report
          </Button>
        )}
      </div>
      <SignDialog
        open={signOpen}
        opener={signOpener.current}
        base={base}
        sheet={sheet}
        onClose={() => setSignOpen(false)}
        onSigned={() => {
          setSignOpen(false);
          setSigned(true);
        }}
        onDead={(message) => {
          setSignOpen(false);
          setDead(message);
        }}
      />
    </div>
  );
}

interface SignProps {
  open: boolean;
  opener: HTMLElement | null;
  base: string;
  sheet: Sheet;
  onClose: () => void;
  onSigned: () => void;
  onDead: (message: string) => void;
}

function SignDialog({ open, opener, base, sheet, onClose, onSigned, onDead }: SignProps) {
  const feedback = useFeedback();
  const [name, setName] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  // One key per signing attempt; a retry after an outage reuses it.
  const [key] = useState(newKey);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    feedback.clearProblem();
    feedback.update("Signing report…");
    const result = await post<SignResult>(`${base}/sign`, { inspector_name: name, attest }, { "Idempotency-Key": key });
    setBusy(false);
    if (result.ok) {
      setErrors([]);
      feedback.update("Report signed. The grower's notice is on its way.");
      onSigned();
      return;
    }
    feedback.update("");
    if (result.status === 422) {
      const ids: Record<string, string> = { inspector_name: "sign-name", attest: "sign-attest" };
      for (const block of sheet.blocks) ids[block.id] = `section-${block.id}`;
      setErrors(fieldErrors(result.error?.fields, ids, "sign-name"));
    } else if (result.status === 503) {
      feedback.problem(
        result.error?.error === "storage_unavailable"
          ? "Report storage is unreachable, so nothing was signed. Your samples are saved; try again in a minute."
          : "Billing is unreachable, so nothing was signed. Your samples are saved; try again in a minute.",
      );
    } else if (result.status === 410) {
      onDead(result.error?.error === "link_signed" ? result.error.message : "Ask the broker for a new link.");
    } else {
      feedback.problem(result.status === 404 ? COPY.notFound : genericProblem(result));
    }
  };

  return (
    <Dialog title="Sign report" open={open} opener={opener} onClose={onClose}>
      <form onInput={clearEdited(setErrors)} onSubmit={submit} noValidate aria-label="Signature">
        <p className="dialog-lede">
          Signing sends {sheet.orchard.name}'s report to the grower with a payable of {money(sheet.payable_cents)}. The link stops working once it is signed.
        </p>
        <ErrorSummary errors={errors} />
        <TextField id="sign-name" label="Full name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} error={errorFor(errors, "sign-name")} />
        <div className={`field field-check${errorFor(errors, "sign-attest") ? " has-error" : ""}`}>
          {errorFor(errors, "sign-attest") ? (
            <p className="field-error" id="sign-attest-error">
              {errorFor(errors, "sign-attest")}
            </p>
          ) : null}
          <label className="check">
            <input
              id="sign-attest"
              type="checkbox"
              checked={attest}
              onChange={(event) => setAttest(event.target.checked)}
              aria-describedby={errorFor(errors, "sign-attest") ? "sign-attest-error" : undefined}
            />
            <span>I counted these colonies and these figures are true</span>
          </label>
        </div>
        <div className="dialog-actions">
          <Button type="submit" variant="primary" busy={busy}>
            Sign and send
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
