/** Rule sets and accounts. */
import { useEffect, useState } from "react";
import { getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { Chip, DataTable, Dialog, DialogForm, SelectField, TextField, useDialog, useLoad, useSubmitter } from "../ui.js";
import { PageHeading } from "./chrome.js";
import { instantText } from "../format.js";
import { PENDING, SUCCESS } from "../../shared/copy.js";
import type { Account, Page, RuleSet } from "../../shared/types.js";

function RuleSetForm({ existing, onSaved }: { existing: RuleSet | null; onSaved: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [seam, setSeam] = useState(String(existing?.seam_overlap_mm ?? ""));
  const [roach, setRoach] = useState(String(existing?.roach_permille ?? ""));
  const [tolerance, setTolerance] = useState(String(existing?.tolerance_mm ?? ""));
  const [width, setWidth] = useState(String(existing?.min_offcut_width_mm ?? ""));
  const [length, setLength] = useState(String(existing?.min_offcut_length_mm ?? ""));
  const [effective, setEffective] = useState(existing?.effective_at ?? "");
  const number = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text));
  const save = () =>
    form.run(async () => {
      const body = {
        seam_overlap_mm: number(seam),
        roach_permille: number(roach),
        tolerance_mm: number(tolerance),
        min_offcut_width_mm: number(width),
        min_offcut_length_mm: number(length),
        effective_at: effective.trim(),
      };
      const { data } = existing
        ? await sendJson<RuleSet>("PATCH", `/api/rulesets/${existing.version}`, body, { "if-match": `"${existing.revision}"` })
        : await sendJson<RuleSet>("POST", "/api/rulesets", body);
      say(SUCCESS.ruleSet(data.version));
      close(true);
      await onSaved();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Save rule set" busy={form.busy}>
      <TextField label="Seam overlap (mm)" value={seam} onChange={setSeam} error={form.errors.seam_overlap_mm} inputMode="numeric" />
      <TextField label="Roach (permille)" value={roach} onChange={setRoach} error={form.errors.roach_permille} inputMode="numeric" />
      <TextField label="Tolerance (mm)" value={tolerance} onChange={setTolerance} error={form.errors.tolerance_mm} inputMode="numeric" />
      <TextField label="Minimum offcut width (mm)" value={width} onChange={setWidth} error={form.errors.min_offcut_width_mm} inputMode="numeric" />
      <TextField label="Minimum offcut length (mm)" value={length} onChange={setLength} error={form.errors.min_offcut_length_mm} inputMode="numeric" />
      <TextField label="Effective at" value={effective} onChange={setEffective} error={form.errors.effective_at} hint="YYYY-MM-DDTHH:MM:SSZ" />
    </DialogForm>
  );
}

export function RuleSetsPage() {
  const rules = useLoad((signal) => getJson<Page<RuleSet>>("/api/rulesets?limit=50", signal), []);
  const [dialog, setDialog] = useState<{ edit: RuleSet | null } | null>(null);
  return (
    <main className="page">
      <section className="field-ground">
        <div className="section-head">
          <PageHeading>Rule sets</PageHeading>
          <button type="button" className="button" onClick={() => setDialog({ edit: null })}>
            New rule set
          </button>
        </div>
      </section>
      <section className="field-surface">
        <DataTable
          label="Rule sets"
          headers={["Version", "Effective at", "Seam overlap", "Roach", "Tolerance", "Min offcut width", "Min offcut length", "Action"]}
          rows={(rules.data?.items ?? []).map((rule) => ({
            key: String(rule.version),
            cells: [
              <span key="v">{`v${rule.version}`} {rule.current ? <Chip tone="cobalt">Current</Chip> : null}</span>,
              instantText(rule.effective_at),
              `${rule.seam_overlap_mm} mm`,
              `${rule.roach_permille}`,
              `${rule.tolerance_mm} mm`,
              `${rule.min_offcut_width_mm} mm`,
              `${rule.min_offcut_length_mm} mm`,
              !rule.current && Date.parse(rule.effective_at) > Date.now() ? (
                <button key="e" type="button" className="button" onClick={() => setDialog({ edit: rule })}>
                  {`Edit v${rule.version}`}
                </button>
              ) : (
                ""
              ),
            ],
          }))}
        />
      </section>
      {dialog ? (
        <Dialog title={dialog.edit ? "Edit rule set" : "New rule set"} onClose={() => setDialog(null)}>
          <RuleSetForm existing={dialog.edit} onSaved={async () => void (await rules.reload())} />
        </Dialog>
      ) : null}
    </main>
  );
}

function AccountForm({ onCreated }: { onCreated: (email: string) => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("yacht-owner");
  const save = () =>
    form.run(async () => {
      const { data } = await sendJson<Account>("POST", "/api/accounts", { display_name: name, email, password, role });
      say(SUCCESS.account(data.email));
      close(false);
      await onCreated(data.email);
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Create account" busy={form.busy}>
      <TextField label="Display name" value={name} onChange={setName} error={form.errors.display_name} />
      <TextField label="Email" value={email} onChange={setEmail} error={form.errors.email} type="email" autoComplete="off" />
      <TextField label="Password" value={password} onChange={setPassword} error={form.errors.password} type="password" autoComplete="new-password" />
      <SelectField label="Role" value={role} onChange={setRole} options={[{ value: "yacht-owner", label: "Yacht owner" }, { value: "loft-hand", label: "Loft hand" }]} error={form.errors.role} />
    </DialogForm>
  );
}

function EditAccount({ account, onSaved }: { account: Account; onSaved: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [name, setName] = useState(account.display_name);
  const save = () =>
    form.run(async () => {
      await sendJson<Account>("PATCH", `/api/accounts/${account.id}`, { display_name: name });
      say(SUCCESS.saved);
      close(true);
      await onSaved();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Save account" busy={form.busy}>
      <TextField label="Display name" value={name} onChange={setName} error={form.errors.display_name} />
    </DialogForm>
  );
}

function DeleteAccount({ account, onDeleted }: { account: Account; onDeleted: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const remove = () =>
    form.run(async () => {
      await sendJson("DELETE", `/api/accounts/${account.id}`);
      say(SUCCESS.saved);
      close(true);
      await onDeleted();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void remove()} submit="Delete account" busy={form.busy}>
      <p>{`${account.display_name} (${account.email}) will lose access. Their records stay under the name Former account.`}</p>
    </DialogForm>
  );
}

export function AccountsPage() {
  const accounts = useLoad((signal) => getJson<Page<Account>>("/api/accounts?limit=50", signal), []);
  const [more, setMore] = useState<Account[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit" | "delete"; account: Account } | null>(null);
  const [focusEmail, setFocusEmail] = useState<string | null>(null);
  const rows = [...(accounts.data?.items ?? []), ...more];
  const next = cursor === undefined ? (accounts.data?.next_cursor ?? null) : cursor;

  useEffect(() => {
    if (!focusEmail) return;
    const target = document.querySelector<HTMLButtonElement>(`button[data-edit="${CSS.escape(focusEmail)}"]`);
    if (target) {
      target.focus();
      setFocusEmail(null);
    }
  }, [focusEmail, accounts.data]);

  const showMore = async () => {
    if (!next) return;
    const page = await getJson<Page<Account>>(`/api/accounts?limit=50&cursor=${encodeURIComponent(next)}`);
    setMore((list) => [...list, ...page.items]);
    setCursor(page.next_cursor);
  };
  const refresh = async () => {
    setMore([]);
    setCursor(undefined);
    await accounts.reload();
  };

  return (
    <main className="page">
      <section className="field-ground">
        <div className="section-head">
          <PageHeading>Accounts</PageHeading>
          <button type="button" className="button" onClick={() => setDialog({ kind: "new" })}>
            New account
          </button>
        </div>
      </section>
      <section className="field-surface">
        <DataTable
          label="Accounts"
          headers={["Name", "Email", "Role", "Action"]}
          rows={rows.map((account) => ({
            key: account.id,
            cells: [
              account.display_name,
              account.email,
              account.role === "yacht-owner" ? "Yacht owner" : account.role === "loft-hand" ? "Loft hand" : "Sailmaker",
              account.role === "sailmaker" ? (
                ""
              ) : (
                <span key="a" className="row-actions">
                  <button type="button" className="button" data-edit={account.email} onClick={() => setDialog({ kind: "edit", account })}>
                    {`Edit ${account.email}`}
                  </button>
                  <button type="button" className="button" onClick={() => setDialog({ kind: "delete", account })}>
                    {`Delete ${account.email}`}
                  </button>
                </span>
              ),
            ],
          }))}
        />
        {next ? (
          <button type="button" className="button" onClick={() => void showMore()}>
            Show more accounts
          </button>
        ) : null}
      </section>
      {dialog?.kind === "new" ? (
        <Dialog title="New account" onClose={() => setDialog(null)}>
          <AccountForm
            onCreated={async (email) => {
              await refresh();
              setFocusEmail(email);
            }}
          />
        </Dialog>
      ) : null}
      {dialog?.kind === "edit" ? (
        <Dialog title="Edit account" onClose={() => setDialog(null)}>
          <EditAccount account={dialog.account} onSaved={refresh} />
        </Dialog>
      ) : null}
      {dialog?.kind === "delete" ? (
        <Dialog title="Delete account" onClose={() => setDialog(null)}>
          <DeleteAccount account={dialog.account} onDeleted={refresh} />
        </Dialog>
      ) : null}
    </main>
  );
}
