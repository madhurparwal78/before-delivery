// Members and invitations (agency director): role changes, removal and the Invite member dialog.

import { useRef, useState, type FormEvent } from "react";
import { api } from "../../../api.js";
import { definePage } from "../../../router.js";
import { type Member, type Role } from "../../../session.js";
import { AlertDialog, Dialog } from "../../../ui/dialog.js";
import { Button } from "../../../ui/button.js";
import { RadioGroup, Select, TextField } from "../../../ui/fields.js";
import { Problems, useFormErrors } from "../../../ui/problems.js";
import { useAnnouncer } from "../../../ui/status.js";
import { LOADING, RecordsPage } from "./common.js";
import { failureCopy, useResource, useMember } from "../../../workspace/data.js";

const ROLE_NAMES: Record<Role, string> = {
  agency_director: "Agency director",
  booker: "Booker",
  accounts_lead: "Accounts lead",
  scout: "Scout",
  talent: "Talent",
};
const STAFF_ROLES = (["agency_director", "booker", "accounts_lead", "scout"] as const).map((value) => ({
  value, label: ROLE_NAMES[value] }));
const OFFICES = [{ value: "toronto", label: "Toronto" }, { value: "vancouver", label: "Vancouver" }];

function InviteDialog({ onClose, announce }: { onClose: () => void; announce: (text: string) => void }) {
  const member = useMember();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("booker");
  const [office, setOffice] = useState<string>(member.office);
  const [pending, setPending] = useState(false);
  const form = useFormErrors({ name: "invite-name", email: "invite-email", role: "invite-role", office: "invite-office" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await api<{ message: string }>("POST", "/api/invitations", { name, email, role, office });
    setPending(false);
    if (result.ok) {
      announce(result.data.message);
      onClose();
      return;
    }
    if (!form.take(result.error, announce)) announce(failureCopy(result.error));
  };

  return (
    <Dialog title="Invite member" onClose={onClose} sheet
      actions={<Button type="submit" form="invite-form" pending={pending} pendingLabel="Sending…">Send invitation</Button>}>
      <Problems items={form.problems} />
      <form id="invite-form" noValidate className="stack" onSubmit={(event) => void submit(event)}>
        <TextField id="invite-name" label="Name" value={name} onChange={setName} error={form.error("name")} autoComplete="off" />
        <TextField id="invite-email" label="Email" type="email" value={email} onChange={setEmail} error={form.error("email")}
          autoComplete="off" />
        <Select id="invite-role" label="Role" choices={STAFF_ROLES} value={role} onChange={setRole} error={form.error("role")} />
        <RadioGroup id="invite-office" label="Office" name="invite-office" choices={OFFICES} value={office}
          onChange={setOffice} error={form.error("office")} />
      </form>
    </Dialog>
  );
}

function MemberRow({ row, self, onChanged, announce }: {
  row: Member;
  self: boolean;
  onChanged: () => Promise<unknown>;
  announce: (text: string) => void;
}) {
  const [role, setRole] = useState<Role>(row.role);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);

  const saveRole = async () => {
    setSaving(true);
    const result = await api<Member>("PATCH", `/api/members/${row.id}`, { role });
    setSaving(false);
    if (result.ok) {
      announce(`${row.name} is now ${ROLE_NAMES[result.data.role].toLowerCase()}.`);
      await onChanged();
    } else announce(result.error.errors?.role ?? failureCopy(result.error));
  };

  const remove = async () => {
    setRemoving(true);
    const result = await api("DELETE", `/api/members/${row.id}`);
    setRemoving(false);
    setConfirming(false);
    if (result.ok) {
      announce(`Removed ${row.name}. Their sessions have ended.`);
      await onChanged();
    } else announce(failureCopy(result.error));
  };

  return (
    <tr>
      <th scope="row">{row.name}{self ? <span className="muted"> (you)</span> : null}</th>
      <td className="wrap-anywhere">{row.email}</td>
      <td>
        {self || row.role === "talent" ? ROLE_NAMES[row.role] : (
          <select className="select compact" aria-label={`Role of ${row.name}`} value={role}
            onChange={(event) => {
              const next = STAFF_ROLES.find((choice) => choice.value === event.target.value);
              if (next) setRole(next.value);
            }}>
            {STAFF_ROLES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
        )}
      </td>
      <td>{row.office === "toronto" ? "Toronto" : "Vancouver"}</td>
      <td>
        {self ? null : (
          <div className="btn-row">
            {row.role !== "talent" ? (
              <Button variant="quiet" pending={saving} pendingLabel="Saving…" disabled={role === row.role}
                onClick={() => void saveRole()}>Save role</Button>
            ) : null}
            <Button ref={removeButton} variant="quiet" onClick={() => setConfirming(true)}>Remove</Button>
          </div>
        )}
        {confirming ? (
          <AlertDialog title={`Remove ${row.name}?`} onClose={() => setConfirming(false)}
            returnFocus={() => removeButton.current}
            actions={(
              <>
                <Button pending={removing} pendingLabel="Saving…" onClick={() => void remove()}>Remove</Button>
                <Button variant="quiet" onClick={() => setConfirming(false)}>Keep</Button>
              </>
            )}>
            <p>{row.name} loses access to Rungboard at once, and anything they have open can no longer be saved.</p>
          </AlertDialog>
        ) : null}
      </td>
    </tr>
  );
}

function Members() {
  const member = useMember();
  const { data, reload } = useResource<{ members: Member[] }>("/api/members");
  const { message, announce } = useAnnouncer();
  const [inviting, setInviting] = useState(false);
  return (
    <RecordsPage title="Members" lede="Staff access and invitations. Talent members are invited from their profile through the API."
      statusName="Account" message={message}
      actions={<Button onClick={() => setInviting(true)}>Invite member</Button>}>
      {data ? (
        <div className="table-scroll" role="region" aria-label="Members list" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Office</th>
                <th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {data.members.map((row) => (
                <MemberRow key={row.id} row={row} self={row.id === member.id} onChanged={reload} announce={announce} />
              ))}
            </tbody>
          </table>
        </div>
      ) : LOADING}
      {inviting ? <InviteDialog onClose={() => setInviting(false)} announce={announce} /> : null}
    </RecordsPage>
  );
}

definePage({ pattern: "/workspace/members", kind: "workspace", roles: ["agency_director"], render: () => <Members /> });
