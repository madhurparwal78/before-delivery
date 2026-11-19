// The Drive's dialogs (brief: Public screens and controls; Interactions, Move to and Share dialog).
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../widgets/Dialog";
import { PeoplePicker } from "../widgets/PeoplePicker";
import { Tree, visibleNodes } from "./Tree";
import { api, call, ApiError, query } from "../api";
import { announce } from "../announce";
import { changes, coalesce, folders as folderStore, pushNotice } from "../data";
import { useStore } from "../store";
import { grantDaysLeft } from "../format";
import { noLongerAvailable, noLongerEditable, PICKER_OUTAGE, SOMETHING_WRONG } from "../copy";
import type { Folder, Grant, Handover, ItemType, Person, Role } from "../../shared/api";

function ancestors(all: Folder[], id: string | null): string[] {
  const byId = new Map(all.map((f) => [f.id, f]));
  const out: string[] = [];
  for (let f = id ? byId.get(id) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) out.push(f.id);
  return out;
}

export function MoveDialog({ from, onMove, onClose }: { from: string | null; onMove: (to: string) => void; onClose: () => void }) {
  const all = useStore(folderStore);
  const [expanded, setExpanded] = useState(() => new Set(ancestors(all, from).slice(1)));
  // Start on the first folder the files are not already in: moving into their own folder does nothing.
  const [choice, setChoice] = useState<string | null>(() => visibleNodes(all, expanded).find((n) => n.folder.id !== from)?.folder.id ?? null);
  const moveHere = (id: string | null) => {
    if (!id || id === from) return;
    onClose();
    onMove(id);
  };
  return (
    <Dialog title="Move to" className="dialog-move" onClose={onClose}
      initialFocus={() => document.querySelector<HTMLElement>("[data-tree='Destination folders'] [role=treeitem][tabindex='0']")}>
      <div className="dialog-tree">
        <Tree label="Destination folders" folders={all} expanded={expanded} current={choice} onFocusNode={setChoice} sourceId={from}
          onToggle={(id, open) => setExpanded((s) => {
            const next = new Set(s);
            if (open) next.add(id);
            else next.delete(id);
            return next;
          })}
          onOpen={(id) => moveHere(id)} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="button primary" disabled={!choice || choice === from} onClick={() => moveHere(choice)}>Move here</button>
        <button type="button" className="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

function Field({ label, error, children, id }: { label: string; error?: string | undefined; children: React.ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  );
}

export function RenameDialog({ fileId, name, currentName, onClose, onDone }: {
  fileId: string; name: string; currentName: () => string; onClose: () => void; onDone: () => void;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const body = await api<{ file: { name: string } }>("PATCH", `/api/files/${fileId}`, { name: value });
      announce(`Renamed to ${body.file.name}`);
      onClose();
      onDone();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.status === 422) setError(failure.body.fields?.name ?? SOMETHING_WRONG);
      else {
        if (failure.code === "locked") announce(`${currentName()} is locked and was not renamed.`);
        else if (failure.code === "forbidden") pushNotice(noLongerEditable(currentName()));
        else if (failure.code === "not_found") pushNotice(noLongerAvailable(currentName()));
        else announce(SOMETHING_WRONG);
        onClose();
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Rename" onClose={onClose}>
      <form onSubmit={save} noValidate>
        <Field label="Name" id="rename-name" error={error}>
          <input id="rename-name" className="field-input" value={value} aria-invalid={error ? true : undefined}
            aria-describedby={error ? "rename-name-error" : undefined} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="button primary" aria-busy={busy || undefined}>Save</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

export function NewFolderDialog({ parentId, onClose, onDone }: { parentId: string | null; onClose: () => void; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const body = await api<{ folder: Folder }>("POST", "/api/folders", { parentId, name: value });
      announce(`Created ${body.folder.name}`);
      onClose();
      onDone();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.status === 422) setError(failure.body.fields?.name ?? SOMETHING_WRONG);
      else {
        announce(SOMETHING_WRONG);
        onClose();
      }
    }
  };
  return (
    <Dialog title="New folder" onClose={onClose}>
      <form onSubmit={create} noValidate>
        <Field label="Folder name" id="new-folder-name" error={error}>
          <input id="new-folder-name" className="field-input" value={value} aria-invalid={error ? true : undefined}
            aria-describedby={error ? "new-folder-name-error" : undefined} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="button primary">Create</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

interface Defaults {
  today: string;
  defaultEndDate: string;
  maxEndDate: string;
}

export function ShareDialog({ item, onClose }: { item: { type: ItemType; id: string; name: string }; onClose: () => void }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outage, setOutage] = useState(false);

  const load = useRef(coalesce(() => {
    void api<{ grants: Grant[] }>("GET", `/api/grants${query({ itemType: item.type, itemId: item.id })}`)
      .then((body) => setGrants(body.grants), () => undefined);
  }));

  useEffect(() => {
    load.current();
    void api<Defaults>("GET", "/api/grants/defaults").then((d) => {
      setDefaults(d);
      setEndDate(d.defaultEndDate);
    }, () => undefined);
    return changes.on("change", (kind) => {
      if (kind === "grants" || kind === "all" || kind === "day") load.current();
    });
  }, []);

  const reset = () => {
    setPerson(null);
    setRole("viewer");
    setEndDate(defaults?.defaultEndDate ?? "");
    setErrors({});
  };

  const share = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!person) {
      setErrors({ personId: "Choose a partner." });
      return;
    }
    try {
      const body = await api<{ grant: Grant }>("POST", "/api/grants", {
        itemType: item.type, itemId: item.id, personId: person.id, role, ...(endDate ? { endDate } : {}),
      });
      announce(`Shared ${item.name} with ${body.grant.person.name} until ${body.grant.endDate}`);
      reset();
      setOutage(false);
      load.current();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.code === "grant_exists") {
        announce(`${person.name} already has access to ${item.name}. Change it in the list below.`);
        load.current();
      } else if (failure.code === "directory_unavailable") {
        setOutage(true);
        announce(PICKER_OUTAGE);
      } else if (failure.status === 422) {
        setErrors(failure.body.fields ?? {});
        announce(Object.values(failure.body.fields ?? {})[0] ?? SOMETHING_WRONG);
      } else announce(SOMETHING_WRONG);
    }
  };

  const change = async (grant: Grant, next: Role) => {
    try {
      const body = await api<{ grant: Grant }>("PATCH", `/api/grants/${grant.id}`, { role: next });
      announce(`${body.grant.person.name} is now ${body.grant.role} on ${item.name}`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      announce(SOMETHING_WRONG);
    }
    load.current();
  };

  const remove = async (grant: Grant) => {
    try {
      await call("DELETE", `/api/grants/${grant.id}`);
      announce(`Removed ${grant.person.name} from ${item.name}`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      announce(SOMETHING_WRONG);
    }
    load.current();
  };

  return (
    <Dialog title={`Share ${item.name}`} className="dialog-share" onClose={onClose}
      initialFocus={() => document.querySelector<HTMLElement>(".dialog-share [role=combobox]")}>
      <form onSubmit={share} noValidate className="share-form">
        <div className="field">
          <span className="field-label" id="share-person">Person</span>
          <PeoplePicker label="Person" kind="partner" picked={person} onPick={setPerson} error={errors.personId} />
        </div>
        <div className="field">
          <span className="field-label" id="share-access">Access</span>
          <div role="radiogroup" aria-labelledby="share-access" className="segmented">
            {(["viewer", "editor"] as const).map((value) => (
              <label key={value} className="segment">
                <input type="radio" name="share-role" value={value} checked={role === value} onChange={() => setRole(value)} />
                {value === "viewer" ? "Viewer" : "Editor"}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="share-ends">Access ends</label>
          <input id="share-ends" type="date" className="field-input num" value={endDate} min={defaults?.today} max={defaults?.maxEndDate}
            aria-invalid={errors.endDate ? true : undefined} aria-describedby={errors.endDate ? "share-ends-error" : "share-ends-note"}
            onChange={(e) => setEndDate(e.target.value)} />
          {endDate && !errors.endDate && <p id="share-ends-note" className="field-note">Ends <span className="num">{endDate}</span> (Phoenix)</p>}
          {errors.endDate && <p id="share-ends-error" className="field-error">{errors.endDate}</p>}
        </div>
        {outage && <p className="field-note warn">{PICKER_OUTAGE}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button primary">Share</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
      <h3 className="pane-title" id="share-people">People with access</h3>
      <ul aria-labelledby="share-people" className="access-list">
        {grants.map((grant) => (
          <li key={grant.id} className="access-row">
            <span className="avatar" aria-hidden="true">{grant.person.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2)}</span>
            <span className="access-who">
              <span className="access-name">{grant.person.name}</span>
              <span className="access-firm">{grant.person.firm}</span>
              <span className={grant.daysLeft === 0 ? "access-ends warn" : "access-ends"}>Ends <span className="num">{grant.endDate}</span> · <span className="num">{grantDaysLeft(grant.daysLeft)}</span></span>
            </span>
            <select aria-label={`Access for ${grant.person.name}`} className="field-input compact" value={grant.role}
              onChange={(e) => void change(grant, e.target.value === "editor" ? "editor" : "viewer")}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button type="button" className="button ghost" aria-label={`Remove ${grant.person.name}`} onClick={() => void remove(grant)}>Remove</button>
          </li>
        ))}
        {!grants.length && <li className="access-none">Only Lintelworks staff can see this right now.</li>}
      </ul>
    </Dialog>
  );
}

export function HandOverDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [days, setDays] = useState("7");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outage, setOutage] = useState(false);
  const offer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!person) {
      setErrors({ toPersonId: "Choose a staff member other than the current owner." });
      return;
    }
    try {
      const body = await api<{ handover: Handover }>("POST", "/api/handovers", { folderId: folder.id, toPersonId: person.id, days: Number(days) });
      announce(`Offered ${folder.name} to ${body.handover.to.name} until ${body.handover.lapseDate}`);
      onClose();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.code === "handover_open") announce(`${folder.name} already has an open handover.`);
      else if (failure.code === "directory_unavailable") {
        setOutage(true);
        announce(PICKER_OUTAGE);
      } else if (failure.status === 422) setErrors(failure.body.fields ?? {});
      else announce(SOMETHING_WRONG);
    }
  };
  return (
    <Dialog title={`Hand over ${folder.name}`} onClose={onClose}
      initialFocus={() => document.querySelector<HTMLElement>(".dialog-handover [role=combobox]")} className="dialog-handover">
      <form onSubmit={offer} noValidate>
        <div className="field">
          <span className="field-label">New owner</span>
          <PeoplePicker label="New owner" kind="staff" exclude={[folder.owner.id]} picked={person} onPick={setPerson} error={errors.toPersonId} />
        </div>
        <div className="field">
          <label htmlFor="handover-days">Days to accept</label>
          <input id="handover-days" type="number" min={1} max={14} step={1} className="field-input num narrow" value={days}
            aria-invalid={errors.days ? true : undefined} aria-describedby={errors.days ? "handover-days-error" : undefined}
            onChange={(e) => setDays(e.target.value)} />
          {errors.days && <p id="handover-days-error" className="field-error">{errors.days}</p>}
        </div>
        {outage && <p className="field-note warn">{PICKER_OUTAGE}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button primary">Offer</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
