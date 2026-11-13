import { useEffect, useRef, useState } from "preact/hooks";
import { type Asset, type Entry, type Program, type Receipt, del, get, patch, post, upload } from "../api";
import { Dialog, useDialog } from "../dialog";
import { Link, RoleGate, useAction, useBand, useDesk } from "../desk";
import { dollars, zoneLabel } from "../format";
import { type FieldErrors, SelectField, TextField, focusFirstError } from "../form";
import { Icon } from "../icons";
import { TIER_LABEL, entryActionLegal } from "../../shared/transitions";

// Studio entries and the entry page (brief: Screens and layout, Studio entries and Entry).

/** The open program: entries open, soonest deadline, the first created on a tie (the list is newest first). */
function openProgram(programs: Program[]): Program | null {
  const open = programs.filter((p) => p.entriesOpen);
  return open.reduce<Program | null>((best, p) => (!best || Date.parse(p.deadlineAt) <= Date.parse(best.deadlineAt) ? p : best), null);
}

function studioBand(programs: Program[] | null) {
  if (!programs) return null;
  const open = openProgram(programs);
  if (open) return { name: open.name, target: open.deadlineAt };
  return { name: programs[0]?.name ?? "Cutline Jury Desk", target: null };
}

function EntriesList() {
  const desk = useDesk();
  const [data, setData] = useState<{ entries: Entry[]; programs: Program[] } | null>(null);
  useEffect(() => {
    void Promise.all([get<{ entries: Entry[] }>("/api/entries"), get<{ programs: Program[] }>("/api/programs")]).then(([e, p]) => {
      if (e.ok && p.ok) setData({ entries: e.data.entries, programs: p.data.programs });
      else desk.fail(e.ok ? (p.ok ? "" : p.message) : e.message);
    });
  }, []);
  useBand(studioBand(data?.programs ?? null));
  if (!data) return <p class="loading">Loading…</p>;
  const open = openProgram(data.programs);
  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">{desk.user?.studioName}</p>
        <h1 class="page-title">Your entries</h1>
        <div class="page-head__tools">
          {open ? (
            <>
              <button type="button" class="button button--primary" onClick={() => desk.navigate("/studio/entries/new")}>New entry</button>
              <p class="deadline">Entries close {open.deadlineLabel}</p>
            </>
          ) : <p class="deadline">Entries are closed.</p>}
        </div>
      </header>
      <table class="list-table list-table--stack">
        <caption class="sr-only">Your entries</caption>
        <thead>
          <tr>
            <th scope="col" class="num">Entry number</th>
            <th scope="col">Title</th>
            <th scope="col">Category</th>
            <th scope="col">Status</th>
            <th scope="col" class="num">Fee</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((entry) => (
            <tr key={entry.id}>
              <td class="num" data-label="Entry number">{entry.entryNumber}</td>
              <td data-label="Title"><Link href={`/studio/entries/${entry.id}`}>{entry.title}</Link></td>
              <td data-label="Category">{entry.categoryName}</td>
              <td data-label="Status"><StatusText entry={entry} /></td>
              <td class="num" data-label="Fee">{entry.fee ? `$${dollars(entry.fee.amountCents)}` : "—"}</td>
            </tr>
          ))}
          {data.entries.length === 0 ? <tr><td colSpan={5} class="empty">No entries yet. Start one with New entry.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function StatusText({ entry }: { entry: Entry }) {
  return entry.state === "disqualified"
    ? <span class="status-text status-text--out"><Icon name="x" />{entry.statusLabel}</span>
    : <span class="status-text">{entry.statusLabel}</span>;
}

/** One idempotency key per entry page visit, reused on every retry of the pay button. */
function visitKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Upload {
  name: string;
  progress: number;
}

const FIELD_ORDER: [string, string][] = [["categoryId", "entry-category"], ["title", "entry-title"], ["summary", "entry-summary"],
  ["siteUrl", "entry-site"], ["credits", "entry-credits"]];

function EntryPage({ id }: { id: string | null }) {
  const desk = useDesk();
  const run = useAction();
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState({ category: "", title: "", summary: "", siteUrl: "", credits: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const key = useRef(visitKey());
  const files = useRef<HTMLInputElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const [focusReceipt, setFocusReceipt] = useState(false);
  const deleteDialog = useDialog();
  const withdrawDialog = useDialog();

  const program = programs ? (entry ? programs.find((p) => p.id === entry.programId) ?? null : openProgram(programs)) : null;

  const adopt = (next: Entry, list: Program[]) => {
    setEntry(next);
    const own = list.find((p) => p.id === next.programId);
    setForm({ category: own?.categories.find((c) => c.id === next.categoryId)?.name ?? next.categoryName, title: next.title,
      summary: next.summary, siteUrl: next.siteUrl, credits: next.credits });
  };

  const loadReceipt = async (next: Entry) => {
    if (!next.fee) return setReceipt(null);
    const r = await get<{ receipt: Receipt }>(`/api/entries/${next.id}/receipt`);
    if (r.ok) setReceipt(r.data.receipt);
  };

  useEffect(() => {
    void (async () => {
      const list = await get<{ programs: Program[] }>("/api/programs");
      if (!list.ok) return desk.fail(list.message);
      if (id) {
        const found = await get<{ entry: Entry }>(`/api/entries/${id}`);
        if (!found.ok) return setMissing(true);
        adopt(found.data.entry, list.data.programs);
        await loadReceipt(found.data.entry);
      }
      setPrograms(list.data.programs);
    })();
  }, [id]);

  useEffect(() => {
    if (focusReceipt) {
      receiptHeading.current?.focus();
      setFocusReceipt(false);
    }
  }, [focusReceipt]);

  // The fee panel refetches the program when the countdown passes the early-bird end.
  useEffect(() => {
    if (!program || program.currentTier !== "early_bird") return;
    const timer = setInterval(async () => {
      if (Date.now() < Date.parse(program.earlyBirdEndsAt)) return;
      clearInterval(timer);
      const list = await get<{ programs: Program[] }>("/api/programs");
      if (list.ok) setPrograms(list.data.programs);
    }, 1000);
    return () => clearInterval(timer);
  }, [program?.id, program?.currentTier]);

  useBand(missing ? { name: "Cutline Jury Desk", target: null }
    : entry && program ? { name: program.name, target: program.entriesOpen ? program.deadlineAt : null } : studioBand(programs));

  if (missing) return <p class="notice">We couldn't find that.</p>;
  if (!programs) return <p class="loading">Loading…</p>;
  if (!program) return <p class="notice">Entries are closed.</p>;

  const editable = !entry || entryActionLegal(entry.state, "edit");
  const fee = `$${dollars(program.currentFeeCents)}`;
  const title = entry?.title || form.title || "New entry";
  const set = (name: keyof typeof form) => (value: string) => setForm({ ...form, [name]: value });

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy("save");
    const body = {
      categoryId: program.categories.find((c) => c.name === form.category)?.id ?? null,
      title: form.title, summary: form.summary, siteUrl: form.siteUrl, credits: form.credits,
    };
    const result = await run("Saving draft…", () => (entry
      ? patch<{ entry: Entry }>(`/api/entries/${entry.id}`, body)
      : post<{ entry: Entry }>("/api/entries", body)), () => "Draft saved.");
    setBusy("");
    setErrors(result.ok ? {} : result.fields);
    if (!result.ok) return focusFirstError(FIELD_ORDER, result.fields);
    if (entry) adopt(result.data.entry, programs);
    else desk.navigate(`/studio/entries/${result.data.entry.id}`, true);
  };

  const addFiles = async (chosen: File[]) => {
    if (!entry) return;
    let current = entry;
    for (const file of chosen) {
      setUploads((list) => [...list, { name: file.name, progress: 0 }]);
      desk.pending(`Uploading ${file.name}…`);
      const result = await upload(`/api/entries/${current.id}/assets`, file, (progress) =>
        setUploads((list) => list.map((u) => (u.name === file.name ? { ...u, progress } : u))));
      setUploads((list) => list.filter((u) => u.name !== file.name));
      if (result.ok) {
        const asset: Asset = result.data.asset;
        current = { ...current, assets: [...current.assets, asset] };
        setEntry(current);
        setErrors({});
        desk.done(`${file.name} added, ${asset.width} × ${asset.height} pixels.`);
      } else {
        setErrors(result.fields.file ? { file: result.fields.file } : {});
        desk.fail(result.message);
      }
    }
    if (files.current) files.current.value = "";
  };

  const removeImage = async (asset: Asset) => {
    if (!entry) return;
    const result = await run("Removing image…", () => del(`/api/entries/${entry.id}/assets/${asset.id}`), () => "Image removed.");
    if (result.ok) setEntry({ ...entry, assets: entry.assets.filter((a) => a.id !== asset.id) });
  };

  const pay = async () => {
    if (!entry) return;
    setBusy("pay");
    const result = await run("Recording your payment…",
      () => post<{ entry: Entry; receipt: Receipt }>(`/api/entries/${entry.id}/submit`, {}, { "Idempotency-Key": key.current }),
      (data) => `Entry ${data.entry.entryNumber} submitted. Receipt sent to ${desk.user?.email ?? ""}.`);
    setBusy("");
    setErrors(result.ok ? {} : result.fields);
    if (result.ok) {
      adopt(result.data.entry, programs);
      setReceipt(result.data.receipt);
      setFocusReceipt(true);
    }
  };

  const confirmDelete = async () => {
    if (!entry) return;
    setBusy("delete");
    const result = await run("Deleting draft…", () => del(`/api/entries/${entry.id}`));
    setBusy("");
    await deleteDialog.hide();
    if (result.ok) {
      desk.done("Draft deleted.");
      desk.navigate("/studio");
    } else desk.fail(result.message);
  };

  const confirmWithdraw = async () => {
    if (!entry) return;
    setBusy("withdraw");
    const result = await run("Withdrawing…", () => post<{ entry: Entry; refund: { amountCents: number } | null }>(`/api/entries/${entry.id}/withdraw`));
    setBusy("");
    await withdrawDialog.hide();
    if (!result.ok) return desk.fail(result.message);
    adopt(result.data.entry, programs);
    await loadReceipt(result.data.entry);
    desk.done(result.data.refund
      ? `Entry ${result.data.entry.entryNumber} withdrawn. Refund of $${dollars(result.data.refund.amountCents)} recorded.`
      : `Entry ${result.data.entry.entryNumber} withdrawn. No refund after the deadline.`);
  };

  const categoryOptions = [{ value: "", label: "Choose a category" }, ...program.categories.map((c) => ({ value: c.name, label: c.name }))];
  const paidFee = entry?.fee ? `$${dollars(entry.fee.amountCents)}` : fee;

  return (
    <div class="page">
      <header class="page-head">
        <p class="eyebrow">{entry ? `Entry ${entry.entryNumber} · ${program.name}` : program.name}</p>
        <h1 class="page-title">{entry ? entry.title : "New entry"}</h1>
        {entry ? (
          <div class="status-block">
            <p class={`status-line${entry.state === "disqualified" ? " status-line--out" : ""}`}>
              {entry.state === "disqualified" ? <Icon name="x" /> : null}Status: <strong>{entry.statusLabel}</strong>
            </p>
            {entry.disqualifyReason ? <p class="status-reason">Reason: {entry.disqualifyReason}</p> : null}
            {entry.score ? <p class="status-reason">Score <span class="num">{entry.score}</span></p> : null}
          </div>
        ) : null}
      </header>
      <div class="entry-layout">
        <form class="entry-form" onSubmit={save} noValidate>
          <SelectField id="entry-category" label="Category" value={form.category} options={categoryOptions} onValue={set("category")}
            error={errors.categoryId} disabled={!editable} />
          <TextField id="entry-title" label="Title" value={form.title} onValue={set("title")} error={errors.title} readOnly={!editable} />
          <TextField id="entry-summary" label="Case study" value={form.summary} onValue={set("summary")} error={errors.summary} multiline
            readOnly={!editable} />
          <TextField id="entry-site" label="Site address" type="url" value={form.siteUrl} onValue={set("siteUrl")} error={errors.siteUrl}
            readOnly={!editable} hint="An https:// address." />
          <TextField id="entry-credits" label="Credits" value={form.credits} onValue={set("credits")} error={errors.credits} multiline
            readOnly={!editable} />
          {editable ? (
            <div class="actions">
              <button type="submit" class="button button--primary" disabled={busy === "save"} aria-busy={busy === "save" || undefined}>
                {busy === "save" ? "Saving draft…" : "Save draft"}
              </button>
              {entry ? <button type="button" class="button button--danger-quiet" onClick={deleteDialog.show}>Delete draft</button> : null}
            </div>
          ) : null}
        </form>

        <aside class="entry-side">
          {receipt ? (
            <section class="panel panel--receipt" aria-label="Receipt">
              <h2 class="panel__title" tabIndex={-1} ref={receiptHeading}>Receipt</h2>
              <dl class="facts">
                <dt>Amount</dt><dd class="num">${dollars(receipt.amountCents)} {receipt.currency}</dd>
                <dt>Fee tier</dt><dd>{TIER_LABEL[receipt.tier]}</dd>
                <dt>Invoice</dt><dd class="mono-wrap">{receipt.invoiceId}</dd>
                <dt>Paid</dt><dd>{zoneLabel(receipt.paidAt, program.timeZone)}</dd>
                {receipt.refund ? <><dt>Refund</dt><dd>${dollars(receipt.refund.amountCents)} refunded {zoneLabel(receipt.refund.refundedAt, program.timeZone)}</dd></> : null}
              </dl>
            </section>
          ) : (
            <section class="panel" aria-label="Fee">
              <h2 class="panel__title">Fee</h2>
              <p class="fee">Entry fee <span class="num">{fee}</span> ({TIER_LABEL[program.currentTier]})</p>
              <p>{program.currentTier === "early_bird" ? "Early-bird ends" : "Early-bird ended"} {program.earlyBirdLabel}</p>
              <p>Entries close {program.deadlineLabel}</p>
            </section>
          )}
          {receipt ? <p class="deadline">Entries close {entry?.deadlineLabel}</p> : null}

          <section class="images" aria-labelledby="images-title">
            <h2 id="images-title" class="panel__title">Case-study images</h2>
            <ul class="image-list" aria-label="Case-study images">
              {(entry?.assets ?? []).map((asset, i) => (
                <li key={asset.id} class="image-list__item">
                  <img src={asset.url} alt={`${title} — image ${i + 1}`} width={asset.width} height={asset.height} />
                  <span class="image-list__meta"><span class="image-list__name">{asset.name}</span>
                    <span class="num">{asset.width} × {asset.height}</span></span>
                  {editable ? (
                    <button type="button" class="button button--quiet button--icon" aria-label={`Remove image ${i + 1}`}
                      onClick={() => void removeImage(asset)}><Icon name="trash-2" />Remove</button>
                  ) : null}
                </li>
              ))}
            </ul>
            {uploads.map((u) => (
              <p key={u.name} class="upload-line">Uploading {u.name}… <progress max={1} value={u.progress} aria-label={`Upload progress for ${u.name}`} /></p>
            ))}
            {editable ? (
              entry ? (
                <div class="dropzone">
                  <input ref={files} id="entry-files" type="file" class="sr-only" accept="image/png,image/jpeg" multiple
                    aria-describedby={errors.file || errors.assets ? "entry-files-error" : undefined}
                    onChange={(e) => void addFiles([...(e.currentTarget.files ?? [])])} />
                  <label for="entry-files" class="dropzone__label">Add case-study images</label>
                  <div role="button" tabIndex={0} class="dropzone__target"
                    onClick={() => files.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        files.current?.click();
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void addFiles([...(e.dataTransfer?.files ?? [])]);
                    }}>
                    <Icon name="upload" />
                    <span>Drop PNG or JPEG images here</span>
                  </div>
                  <p class="field__hint">PNG or JPEG, 640 to 4,096 pixels a side, up to 6 images.</p>
                  {errors.file || errors.assets ? <p id="entry-files-error" class="field__error">{errors.file ?? errors.assets}</p> : null}
                </div>
              ) : <p class="field__hint">Save the draft first, then add case-study images.</p>
            ) : null}
          </section>

          {entry && entryActionLegal(entry.state, "submit") ? (
            <div class="actions actions--stack">
              <button type="button" class="button button--primary button--wide" disabled={busy === "pay"} aria-busy={busy === "pay" || undefined}
                onClick={() => void pay()}>{busy === "pay" ? "Recording your payment…" : `Pay ${fee} and submit`}</button>
            </div>
          ) : null}
          {entry?.canWithdraw ? (
            <div class="actions actions--stack">
              <button type="button" class="button button--danger" onClick={withdrawDialog.show}>Withdraw entry</button>
            </div>
          ) : null}
        </aside>
      </div>

      <Dialog title="Delete this draft?" {...deleteDialog.props}>
        <p>This removes the entry and its images.</p>
        <div class="actions">
          <button type="button" class="button button--danger" disabled={busy === "delete"} onClick={() => void confirmDelete()}>
            {busy === "delete" ? "Deleting draft…" : "Delete draft"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={deleteDialog.props.onClose}>Keep draft</button>
        </div>
      </Dialog>
      <Dialog title="Withdraw entry?" {...withdrawDialog.props}>
        <p>{entry?.refundOnWithdraw ? `You'll be refunded ${paidFee}.` : "The deadline has passed, so there is no refund."}</p>
        <div class="actions">
          <button type="button" class="button button--danger" disabled={busy === "withdraw"} onClick={() => void confirmWithdraw()}>
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </button>
          <button type="button" class="button button--secondary" data-safe onClick={withdrawDialog.props.onClose}>Keep entry</button>
        </div>
      </Dialog>
    </div>
  );
}

export function StudioEntries() {
  return <RoleGate role="studio"><EntriesList /></RoleGate>;
}

export function StudioEntry({ id }: { id: string | null }) {
  return <RoleGate role="studio"><EntryPage key={id ?? "new"} id={id} /></RoleGate>;
}
