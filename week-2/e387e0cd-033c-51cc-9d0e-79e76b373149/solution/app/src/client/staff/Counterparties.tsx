// Counterparties: the list with the Add counterparty sheet, a counterparty's page with its rename history and the
// cases sent to it, and the spreadsheet import with its preview.
import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { takeDraft, useDraftSource } from "../drafts";
import { useResource } from "../hooks";
import { Heading, Link, navigate } from "../router";
import { say } from "../store";
import type { CaseBody, Counterparty, CounterpartyDetail, RuleBookEntry } from "../types";
import { Dialog } from "../ui/Dialog";
import { ActionNote, Button, ChoiceGroup, Field, Problems, Refusal, SelectField, submit, useForm, type FormState } from "../ui/forms";
import { Icon } from "../ui/Icon";
import { Empty, Fig, Table } from "../ui/Table";
import { formatDate, formatMoney } from "../../shared/format";
import { CASE_STATUS_TEXT, DUE_DILIGENCE_OPTIONS, NETWORK_TEXT, wholeNumber } from "./common-text";
import { useDesk } from "./desk";

type Values = Record<string, string>;

const dueDiligenceText = (value: Counterparty["dueDiligence"]) => DUE_DILIGENCE_OPTIONS.find((o) => o.value === value)?.label ?? value;

function Skeleton() {
  return <div class="skeleton" aria-busy="true"><span /><span /><span /></div>;
}

/** Notes with the live `<n> of 2,000` counter in code points. */
function NotesField({ form }: { form: FormState<Values> }) {
  return (
    <Field form={form} name="notes" label="Notes" multiline rows={3}
      counter={`${wholeNumber([...(form.values.notes ?? "")].length)} of 2,000`} />
  );
}

function useJurisdictions(base: string) {
  const [rules] = useResource<{ jurisdictions: RuleBookEntry[] }>(`/api${base}/rules`);
  return rules.state === "ready" ? rules.data.jurisdictions : [];
}

const ADD = "add-counterparty";
const EMPTY_ADD: Values = {
  legalName: "", lei: "", jurisdictionCode: "", licenceNumber: "", dueDiligence: "pending", contactEmail: "", notes: "", addresses: "",
};

function AddCounterparty({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: Values }) {
  const desk = useDesk();
  const form = useForm<Values>(initial);
  const jurisdictions = useJurisdictions(desk.base);
  useDraftSource(ADD, () => form.values, open);
  const save = (event: Event) => {
    event.preventDefault();
    const v = form.values;
    void submit<{ counterparty: Counterparty }>(form, {
      action: ADD,
      pending: "Saving…",
      call: () => api("POST", `/api${desk.base}/counterparties`, {
        json: {
          legalName: v.legalName, lei: v.lei, jurisdictionCode: v.jurisdictionCode, licenceNumber: v.licenceNumber,
          dueDiligence: v.dueDiligence, contactEmail: v.contactEmail, notes: v.notes,
          addresses: v.addresses.split(/\r?\n/).map((a) => a.trim()).filter(Boolean),
        },
      }),
      done: ({ counterparty }) => {
        say(ADD, "Counterparty added.", "success");
        navigate(`${desk.base}/counterparties/${counterparty.id}`, { keepFeedback: true });
      },
    });
  };
  return (
    <Dialog open={open} label="Add counterparty" kind="side" onClose={onClose}>
      <form class="form" noValidate onSubmit={save}>
        <Problems form={form} order={Object.keys(EMPTY_ADD)} />
        <Refusal form={form} />
        <Field form={form} name="legalName" label="Legal name" />
        <Field form={form} name="lei" label="LEI" mono />
        <SelectField form={form} name="jurisdictionCode" label="Jurisdiction" placeholder="Choose a jurisdiction"
          options={jurisdictions.map((j) => ({ value: j.code, label: j.name }))} />
        <Field form={form} name="licenceNumber" label="Licence number" mono />
        <ChoiceGroup name="dueDiligence" label="Due diligence" value={form.values.dueDiligence} options={DUE_DILIGENCE_OPTIONS}
          onChange={(value) => form.set("dueDiligence", value)} error={form.errors.dueDiligence} idBase={form.fieldId("dueDiligence")} />
        <Field form={form} name="contactEmail" label="Contact email" type="email" />
        <NotesField form={form} />
        <Field form={form} name="addresses" label="Wallet addresses" multiline rows={3} mono hint="One address per line." />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={form.busy}>Save counterparty</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CounterpartiesScreen() {
  const desk = useDesk();
  const [draft] = useState(() => takeDraft(ADD));
  const [adding, setAdding] = useState(draft !== null);
  const [list] = useResource<{ counterparties: Counterparty[] }>(`/api${desk.base}/counterparties`);
  const jurisdictions = useJurisdictions(desk.base);
  const nameOf = (code: string) => jurisdictions.find((j) => j.code === code)?.name ?? code;
  const mayEdit = desk.role === "compliance_officer" || desk.role === "compliance_analyst";
  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Counterparties</Heading>
          {mayEdit && (
            <div class="head-actions">
              <Link href={`${desk.base}/counterparties/import`} class="button button-quiet">
                <Icon name="upload" />
                <span>Import spreadsheet</span>
              </Link>
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Icon name="plus" />
                <span>Add counterparty</span>
              </Button>
            </div>
          )}
          <p class="lede">Due diligence and network reach of every exchange your withdrawals can go to.</p>
        </div>
        <ActionNote action={ADD} />
        {list.state === "loading" ? <Skeleton /> : (
          <Table label="Counterparties" columns={[{ label: "Legal name" }, { label: "LEI" }, { label: "Jurisdiction" },
            { label: "Due diligence" }, { label: "Network" }]}
            rows={(list.state === "ready" ? list.data.counterparties : []).map((c) => ({
              key: c.id,
              cells: [
                <Link href={`${desk.base}/counterparties/${c.id}`}>{c.legalName}</Link>,
                <Fig>{c.lei}</Fig>,
                nameOf(c.jurisdictionCode),
                <span class={`badge dd-${c.dueDiligence}`}>{dueDiligenceText(c.dueDiligence)}</span>,
                NETWORK_TEXT[c.network],
              ],
            }))} />
        )}
      </section>
      {mayEdit && <AddCounterparty open={adding} onClose={() => setAdding(false)} initial={draft ?? EMPTY_ADD} />}
    </div>
  );
}

const EDIT = "edit-counterparty";

function EditCounterparty({ counterparty, open, onClose, onSaved, initial }: {
  counterparty: CounterpartyDetail; open: boolean; onClose: () => void; onSaved: () => void; initial: Values | null;
}) {
  const desk = useDesk();
  const form = useForm<Values>(initial ?? {
    legalName: counterparty.legalName, licenceNumber: counterparty.licenceNumber, dueDiligence: counterparty.dueDiligence,
    contactEmail: counterparty.contactEmail ?? "", notes: counterparty.notes,
  });
  useDraftSource(EDIT, () => form.values, open);
  const save = (event: Event) => {
    event.preventDefault();
    const v = form.values;
    void submit<{ counterparty: Counterparty }>(form, {
      action: EDIT,
      pending: "Saving…",
      call: () => api("PATCH", `/api${desk.base}/counterparties/${counterparty.id}`, {
        json: { legalName: v.legalName, licenceNumber: v.licenceNumber, dueDiligence: v.dueDiligence, contactEmail: v.contactEmail, notes: v.notes },
      }),
      done: () => {
        say(EDIT, "Changes saved.", "success");
        onSaved();
      },
    });
  };
  return (
    <Dialog open={open} label="Edit counterparty" kind="side" onClose={onClose}>
      <form class="form" noValidate onSubmit={save}>
        <Problems form={form} order={["legalName", "licenceNumber", "dueDiligence", "contactEmail", "notes"]} />
        <Refusal form={form} />
        <Field form={form} name="legalName" label="Legal name" />
        <Field form={form} name="licenceNumber" label="Licence number" mono />
        <ChoiceGroup name="dueDiligence" label="Due diligence" value={form.values.dueDiligence} options={DUE_DILIGENCE_OPTIONS}
          onChange={(value) => form.set("dueDiligence", value)} error={form.errors.dueDiligence} idBase={form.fieldId("dueDiligence")} />
        <Field form={form} name="contactEmail" label="Contact email" type="email" />
        <NotesField form={form} />
        <div class="form-actions">
          <Button type="submit" variant="primary" disabled={form.busy}>Save changes</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CounterpartyScreen({ id }: { id: string }) {
  const desk = useDesk();
  const [draft] = useState(() => takeDraft(EDIT));
  const [editing, setEditing] = useState(draft !== null);
  const [loaded, reload] = useResource<{ counterparty: CounterpartyDetail }>(`/api${desk.base}/counterparties/${id}`);
  const [open] = useResource<{ cases: CaseBody[] }>(`/api${desk.base}/cases?show=open`);
  const [closed] = useResource<{ cases: CaseBody[] }>(`/api${desk.base}/cases?show=closed`);
  const jurisdictions = useJurisdictions(desk.base);
  if (loaded.state === "loading") return <Skeleton />;
  if (loaded.state === "failed") {
    return (
      <section class="work">
        <Heading>Counterparty not found</Heading>
        <p class="note note-refusal"><Icon name="alert" size={18} /><span>{loaded.error.message}</span></p>
      </section>
    );
  }
  const c = loaded.data.counterparty;
  const sent = [...(open.state === "ready" ? open.data.cases : []), ...(closed.state === "ready" ? closed.data.cases : [])]
    .filter((k) => k.counterparty?.id === c.id);
  const mayEdit = desk.role === "compliance_officer" || desk.role === "compliance_analyst";
  return (
    <div class="screen screen-split">
      <section class="work">
        <div class="screen-head">
          <Heading>{c.legalName}</Heading>
          {mayEdit && <Button onClick={() => setEditing(true)}>Edit counterparty</Button>}
        </div>
        <ActionNote action={[ADD, EDIT]} />
        <div class="panel">
          <h2>Details</h2>
          <dl class="facts">
            <dt>LEI</dt><dd><Fig>{c.lei}</Fig></dd>
            <dt>Jurisdiction</dt><dd>{jurisdictions.find((j) => j.code === c.jurisdictionCode)?.name ?? c.jurisdictionCode}</dd>
            <dt>Licence number</dt><dd><Fig>{c.licenceNumber}</Fig></dd>
            <dt>Due diligence</dt><dd><span class={`badge dd-${c.dueDiligence}`}>{dueDiligenceText(c.dueDiligence)}</span></dd>
            <dt>Network</dt><dd>{NETWORK_TEXT[c.network]}</dd>
            <dt>Contact email</dt><dd class="wrap-anywhere">{c.contactEmail ?? "None on file"}</dd>
            <dt>Notes</dt><dd class="notes-text">{c.notes || "None"}</dd>
            <dt>Wallet addresses</dt>
            <dd>{c.addresses.length ? (
              <ul class="plain-list">{c.addresses.map((a) => <li key={a}><Fig>{a}</Fig></li>)}</ul>
            ) : "None in the registry"}</dd>
          </dl>
        </div>
      </section>
      <section class="evidence">
        <div class="panel">
          <h2 id="previous-names">Previous names</h2>
          <ul class="plain-list history-list" aria-labelledby="previous-names">
            {c.previousNames.map((p) => (
              <li key={`${p.name}-${p.until}`}>
                <span>{p.name}</span>
                <span class="muted fig">{formatDate(p.from)} – {formatDate(p.until)}</span>
              </li>
            ))}
          </ul>
          {c.previousNames.length === 0 && <Empty text="No previous names." />}
        </div>
        <div class="panel panel-flush">
          <h2>Cases sent</h2>
          <Table label="Cases sent" columns={[{ label: "Reference" }, { label: "Name as sent" }, { label: "Fiat value", figures: true }, { label: "Status" }]}
            rows={sent.map((k) => ({
              key: k.id,
              cells: [
                <Link href={`${desk.base}/cases/${k.id}`}><Fig>{k.reference}</Fig></Link>,
                k.dataSent?.counterpartyNameAsSent ?? k.decidedUnder.counterpartyName ?? "",
                <Fig>{formatMoney(k.currency, k.fiatValueCents)}</Fig>,
                CASE_STATUS_TEXT[k.status],
              ],
            }))} />
        </div>
      </section>
      {mayEdit && (
        <EditCounterparty key={c.updatedAt} counterparty={c} open={editing} initial={draft}
          onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />
      )}
    </div>
  );
}

interface ImportRow {
  row: number;
  legalName: string;
  outcome: "matched" | "new" | "refused";
  matchedBy: "lei" | "legal_name" | null;
  reason: string | null;
}

const OUTCOME_TEXT = (r: ImportRow): string =>
  r.outcome === "refused" ? "Refused" : r.outcome === "new" ? "New" : r.matchedBy === "lei" ? "Matched by LEI" : "Matched by legal name";

export function ImportScreen() {
  const desk = useDesk();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async <T,>(action: string, pending: string, path: string, done: (data: T) => string) => {
    if (!file) {
      say(action, "Choose a spreadsheet file first.", "refusal");
      return;
    }
    say(action, pending, "pending");
    setBusy(true);
    const result = await api<T>("POST", `/api${desk.base}${path}`, { body: await file.arrayBuffer(), contentType: "text/csv" });
    setBusy(false);
    if (result.ok) say(action, done(result.data), "success");
    else say(action, Object.values(result.error.fields)[0] ?? result.error.message, "refusal");
  };

  return (
    <div class="screen">
      <section class="work">
        <div class="screen-head">
          <Heading>Import counterparties</Heading>
          <p class="lede">Bring over the previous tool's spreadsheet. Preview saves nothing; saving applies exactly what the preview shows.</p>
        </div>
        <div class="panel import-picker">
          <input ref={input} type="file" class="sr-only" aria-label="Spreadsheet file" accept=".csv,text/csv"
            onChange={(e) => { setFile(e.currentTarget.files?.[0] ?? null); setRows([]); }} />
          <div class="import-actions">
            <Button onClick={() => input.current?.click()}>
              <Icon name="files" />
              <span>Choose file</span>
            </Button>
            <span class="muted wrap-anywhere">{file ? file.name : "No file chosen"}</span>
          </div>
          <p class="field-hint">UTF-8 CSV with the header row: Legal name, LEI, Jurisdiction, Licence number, Due diligence, Contact email, Notes.</p>
          <div class="import-actions">
            <Button disabled={busy} onClick={() => send<{ rows: ImportRow[] }>("import-preview", "Reading file…", "/counterparties/import/preview", (data) => {
              setRows(data.rows);
              const count = (o: ImportRow["outcome"]) => data.rows.filter((r) => r.outcome === o).length;
              return `${data.rows.length} rows read: ${count("matched")} matched, ${count("new")} new, ${count("refused")} refused.`;
            })}>Preview</Button>
            <Button variant="primary" disabled={busy} onClick={() => send<{ created: number; updated: number; unchanged: number; rows: ImportRow[] }>(
              "import-save", "Saving import…", "/counterparties/import", (data) => {
                setRows(data.rows);
                return `Import saved: ${data.created} created, ${data.updated} updated, ${data.unchanged} unchanged.`;
              })}>Save import</Button>
          </div>
          <ActionNote action={["import-preview", "import-save"]} />
        </div>
        <Table label="Preview rows" columns={[{ label: "Row", figures: true }, { label: "Legal name" }, { label: "Outcome" }, { label: "Reason" }]}
          rows={rows.map((r) => ({
            key: String(r.row),
            class: r.outcome === "refused" ? "row-refused" : undefined,
            cells: [<Fig>{r.row}</Fig>, r.legalName, OUTCOME_TEXT(r), r.reason ?? ""],
          }))} />
      </section>
    </div>
  );
}
