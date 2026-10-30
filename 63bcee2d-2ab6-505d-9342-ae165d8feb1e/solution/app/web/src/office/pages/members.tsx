import { useState } from "react";
import { flushSync } from "react-dom";
import { formatAmount, formatTime, plainAmount } from "../../../../shared/format";
import { del, patch, post, type ErrorBody, type Result } from "../../api";
import { useOffice, type Role } from "../context";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { amountInput, ErrorSummary, SelectField, TextField, type Errors } from "../fields";
import { ActionButton, focusId, TableRegion } from "../layout";
import { useResource } from "../resource";
import { OfficeShell } from "../shell";
import "./members.css";

interface DirectoryMember {
  id: string;
  name: string;
  role: Role;
  organisation: string;
  email?: string;
  phone?: string | null;
  status?: "active" | "removed";
  approvalLimits?: { HKD: number; SGD: number } | null;
  version?: number;
}

const ROLE_NAMES: Record<Role, string> = {
  director: "Studio director", project_lead: "Project lead", designer: "Designer", finance: "Studio finance",
  client_approver: "Client approver", contractor: "Contractor",
};
const ROLE_OPTIONS = (Object.keys(ROLE_NAMES) as Role[]).map((value) => ({ value, label: ROLE_NAMES[value] }));
const INVITE_BUTTON = "invite-member-button";

type Open = "invite" | "edit" | "remove" | null;

const blankInvite = { email: "", name: "", role: "designer", brandId: "", companyName: "", limitHkd: "", limitSgd: "" };

export function MembersPage() {
  const office = useOffice();
  const director = office.member?.role === "director";
  const members = useResource<{ members: DirectoryMember[] }>(office.member ? "/api/members" : null);
  const brands = useResource<{ brands: { id: string; name: string }[] }>(director ? "/api/brands" : null);
  const [open, setOpen] = useState<Open>(null);
  const [target, setTarget] = useState<DirectoryMember | null>(null);
  const [values, setValues] = useState(blankInvite);
  const [errors, setErrors] = useState<Errors>({});
  const [dialogError, setDialogError] = useState("");
  const set = (name: keyof typeof blankInvite) => (value: string) => setValues((current) => ({ ...current, [name]: value }));
  const studio = !!members.data?.members.some((m) => m.email !== undefined);

  const show = (next: Open, member: DirectoryMember | null = null): void => {
    setErrors({});
    setDialogError("");
    setTarget(member);
    if (next === "invite") setValues(blankInvite);
    if (next === "edit" && member) {
      const limits = member.approvalLimits;
      setValues({ ...blankInvite, role: member.role, limitHkd: limits ? plainAmount(limits.HKD) : "", limitSgd: limits ? plainAmount(limits.SGD) : "" });
    }
    setOpen(next);
  };

  const limits = () => ({ HKD: amountInput(values.limitHkd || "0"), SGD: amountInput(values.limitSgd || "0") });

  /** Shared ending of every member dialog: success copy, closed dialog, focus on Invite member. */
  const finish = async (result: Result<unknown>, pending: string, success: string, form: string): Promise<void> => {
    if (result.ok) {
      flushSync(() => setOpen(null));
      await members.reload();
      office.announce(success);
      focusId(INVITE_BUTTON);
      return;
    }
    office.announce("");
    const body: ErrorBody | null = office.refused(result, { id: form, values });
    if (!body) return;
    if (body.errors) flushSync(() => setErrors(body.errors ?? {}));
    else {
      const copy = body.error === "member_exists" ? "That email already belongs to a member." :
        body.error === "stale_version" ? `${String(body.savedBy)} saved a newer version at ${formatTime(String(body.savedAt))}. Your changes weren't saved; they're shown beside the latest version.` :
          body.error === "own_membership" ? "You can't change your own membership." : pending;
      office.alert(copy);
      flushSync(() => setDialogError(copy));
    }
    focusRefusal(openDialog());
  };

  const invite = async (): Promise<void> => {
    office.announce("Sending invitation…");
    const body: Record<string, unknown> = { email: values.email, name: values.name, role: values.role };
    if (values.role === "client_approver") body.brandId = values.brandId;
    if (values.role === "contractor") body.companyName = values.companyName;
    if (values.role === "project_lead") body.approvalLimits = limits();
    await finish(await post("/api/invitations", body), "That invitation wasn't sent.", `Invitation sent to ${values.email}.`, "invite-member");
  };

  const save = async (member: DirectoryMember): Promise<void> => {
    office.announce("Saving…");
    const body: Record<string, unknown> = { version: member.version, role: values.role };
    if (values.role === "project_lead") body.approvalLimits = limits();
    await finish(await patch(`/api/members/${member.id}`, body), "That change wasn't saved.", `${member.name} updated.`, "edit-member");
  };

  const remove = async (member: DirectoryMember): Promise<void> => {
    office.announce("Removing…");
    await finish(await del(`/api/members/${member.id}`), "That member wasn't removed.", `${member.name} no longer has access.`, "remove-member");
  };

  const roleFields = (form: string) => (
    <>
      {values.role === "client_approver" && (
        <SelectField form={form} name="brandId" label="Brand" value={values.brandId} onChange={set("brandId")} error={errors.brandId}
          placeholder="Choose a brand" options={(brands.data?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
      )}
      {values.role === "contractor" && (
        <TextField form={form} name="companyName" label="Company name" value={values.companyName} onChange={set("companyName")} error={errors.companyName} />
      )}
      {values.role === "project_lead" && (
        <>
          <TextField form={form} name="approvalLimits.HKD" label="Approval limit HKD" inputMode="decimal" value={values.limitHkd}
            onChange={set("limitHkd")} error={errors["approvalLimits.HKD"]} />
          <TextField form={form} name="approvalLimits.SGD" label="Approval limit SGD" inputMode="decimal" value={values.limitSgd}
            onChange={set("limitSgd")} error={errors["approvalLimits.SGD"]} />
        </>
      )}
    </>
  );

  const list = members.data?.members ?? [];
  return (
    <OfficeShell title="Members">
      <div className="page-head">
        <div>
          <p className="eyebrow">Marrow Hall Interiors · Workspace</p>
          <h1>Members</h1>
        </div>
        {director && (
          <button id={INVITE_BUTTON} type="button" className="button button-primary" onClick={() => show("invite")}>Invite member</button>
        )}
      </div>
      <TableRegion label="Members, scrolls sideways">
        <table className="members-table">
          <caption>Members</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Organisation</th>
              {studio && (<><th scope="col">Contact</th><th scope="col">Approval limits</th><th scope="col">Status</th></>)}
              {director && <th scope="col"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {list.map((member) => (
              <tr key={member.id} className={member.status === "removed" ? "is-removed" : undefined}>
                <td className="member-name">{member.name}</td>
                <td>{ROLE_NAMES[member.role]}</td>
                <td>{member.organisation}</td>
                {studio && (
                  <>
                    <td className="member-contact"><span>{member.email}</span><span>{member.phone ?? ""}</span></td>
                    <td className="member-limits">
                      {member.approvalLimits && (<><span>{formatAmount("HKD", member.approvalLimits.HKD)}</span><span>{formatAmount("SGD", member.approvalLimits.SGD)}</span></>)}
                    </td>
                    <td>{member.status === "removed" ? "Removed" : "Active"}</td>
                  </>
                )}
                {director && (
                  <td>
                    {member.status === "active" && member.id !== office.member?.id && (
                      <div className="actions">
                        <button type="button" className="button" onClick={() => show("edit", member)}>Edit {member.name}</button>
                        <button type="button" className="button" onClick={() => show("remove", member)}>Remove {member.name}</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>

      <Dialog title="Invite member" open={open === "invite"} onCancel={() => setOpen(null)} error={dialogError}
        actions={<ActionButton primary type="submit" pending="Sending invitation…" onAction={invite}>Send invitation</ActionButton>}>
        <ErrorSummary form="invite-member" errors={errors} />
        <TextField form="invite-member" name="email" label="Email" type="email" value={values.email} onChange={set("email")} error={errors.email} />
        <TextField form="invite-member" name="name" label="Name" value={values.name} onChange={set("name")} error={errors.name} />
        <SelectField form="invite-member" name="role" label="Role" value={values.role} onChange={set("role")} error={errors.role} options={ROLE_OPTIONS} />
        {roleFields("invite-member")}
      </Dialog>

      {target && (
        <Dialog title={`Edit ${target.name}`} open={open === "edit"} onCancel={() => setOpen(null)} error={dialogError}
          actions={<ActionButton primary type="submit" pending="Saving…" onAction={() => save(target)}>Save member</ActionButton>}>
          <ErrorSummary form="edit-member" errors={errors} />
          <SelectField form="edit-member" name="role" label="Role" value={values.role} onChange={set("role")} error={errors.role} options={ROLE_OPTIONS} />
          {values.role === "project_lead" && roleFields("edit-member")}
        </Dialog>
      )}

      {target && (
        <Dialog title={`Remove ${target.name}`} open={open === "remove"} onCancel={() => setOpen(null)} error={dialogError}
          actions={<ActionButton primary type="submit" pending="Removing…" onAction={() => remove(target)}>Remove from workspace</ActionButton>}>
          <p>{target.name} will lose access to every rollout at once. Their past sign-offs, uploads and comments stay on record.</p>
        </Dialog>
      )}
    </OfficeShell>
  );
}
