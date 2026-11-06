// Casting packages (booker, director): links with state, expiry and the casting director's choices;
// New package, Revoke link and Regenerate link.

import { useMemo, useState, type FormEvent } from "react";
import { api } from "../../../api.js";
import { definePage } from "../../../router.js";
import { Dialog } from "../../../ui/dialog.js";
import { Button } from "../../../ui/button.js";
import { Checkbox, FieldError, TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { useAnnouncer } from "../../../ui/status.js";
import { LOADING, RecordsPage, focusSoon, useOfficeTime } from "./common.js";
import { failureCopy, useResource } from "../../../workspace/data.js";

interface Package {
  id: string;
  title: string;
  recipientName: string;
  recipientEmail: string;
  state: "active" | "revoked";
  url: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  talent: Array<{ talentId: string; displayName: string; decision: "shortlisted" | "passed" | "undecided" }>;
}

interface TalentOption {
  id: string;
  displayName: string;
  office: string;
  board: string;
}

const DECISIONS = { shortlisted: "Shortlisted", passed: "Passed", undecided: "No choice yet" };
const SHOWN_MATCHES = 40;

function NewPackageDialog({ onClose, onCreated, announce }: {
  onClose: () => void;
  onCreated: (created: Package) => void;
  announce: (text: string) => void;
}) {
  const { data } = useResource<{ talent: TalentOption[] }>("/api/talent?state=active");
  const [title, setTitle] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const form = useFormErrors({ title: "package-title", recipientName: "package-recipient", recipientEmail: "package-email",
    talentIds: "package-search" });

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = data?.talent ?? [];
    return all.filter((t) => chosen.includes(t.id) || !needle || t.displayName.toLowerCase().includes(needle))
      .slice(0, SHOWN_MATCHES + chosen.length);
  }, [data, search, chosen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api<{ package: Package }>("POST", "/api/packages",
      { title, recipientName, recipientEmail, talentIds: chosen });
    setPending(false);
    if (result.ok) {
      onCreated(result.data.package);
      return;
    }
    if (!form.take(result.error, announce)) announce(failureCopy(result.error));
  };

  return (
    <Dialog title="New package" wide sheet onClose={onClose}
      actions={<Button type="submit" form="package-form" pending={pending} pendingLabel="Creating package…">Send package</Button>}>
      <Problems items={form.problems} />
      <form id="package-form" noValidate className="stack" onSubmit={(event) => void submit(event)}>
        <TextField id="package-title" label="Title" value={title} onChange={setTitle} error={form.error("title")} />
        <TextField id="package-recipient" label="Recipient name" value={recipientName} onChange={setRecipientName}
          error={form.error("recipientName")} />
        <TextField id="package-email" label="Recipient email" type="email" value={recipientEmail} onChange={setRecipientEmail}
          error={form.error("recipientEmail")} />
        <fieldset className="talent-picker" aria-describedby={form.error("talentIds") ? "package-search-error" : undefined}>
          <legend className="group-label">Talent ({chosen.length} chosen)</legend>
          <div className="field">
            <label htmlFor="package-search">Find talent</label>
            <input id="package-search" className="input" type="search" value={search} autoComplete="off"
              onChange={(event) => setSearch(event.target.value)} />
          </div>
          <FieldError id="package-search" error={form.error("talentIds")} />
          {data ? (
            <div className="checkbox-list">
              {matches.map((t) => (
                <Checkbox key={t.id} id={`package-talent-${t.id}`} label={t.displayName} checked={chosen.includes(t.id)}
                  onChange={(on) => setChosen((current) => (on ? [...current, t.id] : current.filter((id) => id !== t.id)))} />
              ))}
            </div>
          ) : LOADING}
        </fieldset>
      </form>
    </Dialog>
  );
}

function PackageEntry({ item, onChanged, announce }: {
  item: Package;
  onChanged: (next: Package, copy: string) => void;
  announce: (text: string) => void;
}) {
  const officeTime = useOfficeTime();
  const [pending, setPending] = useState<"revoke" | "regenerate" | null>(null);
  const shortlisted = item.talent.filter((t) => t.decision === "shortlisted").length;

  const act = async (action: "revoke" | "regenerate") => {
    setPending(action);
    const result = await api<{ package: Package }>("POST", `/api/packages/${item.id}/${action}`, {});
    setPending(null);
    if (result.ok) {
      onChanged(result.data.package, action === "revoke" ? "Package link revoked. It no longer opens."
        : `New link sent to ${result.data.package.recipientName}. The old link no longer opens.`);
    } else announce(failureCopy(result.error));
  };

  return (
    <article className="package-entry" aria-labelledby={`package-${item.id}`}>
      <header className="package-head">
        <h2 id={`package-${item.id}`} tabIndex={-1}>{item.title}</h2>
        <span className="tag quiet">{item.state === "active" ? "Link open" : "Link revoked"}</span>
      </header>
      <p className="muted">
        For {item.recipientName} ({item.recipientEmail}).{" "}
        {item.state === "active" && item.expiresAt ? `The link works until ${officeTime(item.expiresAt)}.` : null}
      </p>
      <p className="num">{shortlisted} shortlisted of {item.talent.length}</p>
      <ul className="choice-list">
        {item.talent.map((t) => (
          <li key={t.talentId}><span>{t.displayName}</span><span className={`choice ${t.decision}`}>{DECISIONS[t.decision]}</span></li>
        ))}
      </ul>
      <div className="btn-row">
        {item.state === "active" ? (
          <Button variant="quiet" pending={pending === "revoke"} pendingLabel="Revoking…"
            onClick={() => void act("revoke")}>Revoke link</Button>
        ) : null}
        <Button variant="quiet" pending={pending === "regenerate"} pendingLabel="Creating new link…"
          onClick={() => void act("regenerate")}>Regenerate link</Button>
      </div>
    </article>
  );
}

function Packages() {
  const officeTime = useOfficeTime();
  const { data, reload } = useResource<{ packages: Package[] }>("/api/packages");
  const { message, announce } = useAnnouncer();
  const [creating, setCreating] = useState(false);

  const changed = async (next: Package, copy: string) => {
    announce(copy);
    await reload();
    focusSoon(`#package-${CSS.escape(next.id)}`);
  };

  return (
    <RecordsPage title="Packages" lede="Private casting links and the choices casting directors make on them."
      statusName="Package" message={message} actions={<Button onClick={() => setCreating(true)}>New package</Button>}>
      {data ? (
        data.packages.length ? (
          <div className="package-list">
            {data.packages.map((item) => (
              <PackageEntry key={item.id} item={item} announce={announce} onChanged={(next, copy) => void changed(next, copy)} />
            ))}
          </div>
        ) : <p className="empty-panel">No packages yet. Send the first one to a casting director with New package.</p>
      ) : LOADING}
      {creating ? (
        <NewPackageDialog announce={announce} onClose={() => setCreating(false)} onCreated={(created) => {
          setCreating(false);
          void changed(created, `Package sent to ${created.recipientName}. The link works until ${
            created.expiresAt ? officeTime(created.expiresAt) : ""}.`);
        }} />
      ) : null}
    </RecordsPage>
  );
}

definePage({ pattern: "/workspace/packages", kind: "workspace", roles: ["agency_director", "booker"],
  render: () => <Packages /> });
