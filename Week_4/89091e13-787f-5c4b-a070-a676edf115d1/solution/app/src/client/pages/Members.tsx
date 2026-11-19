import { useState } from "react";
import type { Member } from "../../shared/api.ts";
import { Page } from "../components/Page.tsx";
import { Field, FormAlert, FormStatus, SubmitButton, useFormModel, useRoleGate } from "../components/forms.tsx";
import { Loading } from "../components/StrandCanvas.tsx";
import { api } from "../lib/api.ts";
import { capitalise } from "../lib/format.ts";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { FormPanel } from "../components/FormPanel.tsx";

export function MembersPage() {
  const { id } = useWorkspace();
  const members = useJson<Member[]>(`/api/w/${id}/members`);
  const model = useFormModel();
  const gate = useRoleGate("members");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"developer" | "viewer">("developer");

  return (
    <Page title="Members">
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Members</h2>
        {members.data ? (
          <table aria-label="Members">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th></tr></thead>
            <tbody>
              {members.data.map((member) => (
                <tr key={member.id}><td>{member.name}</td><td>{member.email}</td><td>{capitalise(member.role)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Loading label="Members loading" />}
      </section>
      <FormPanel title="Invite member">
        <form aria-label="Invite member" noValidate className="stack" onSubmit={(event) => {
          event.preventDefault();
          void model.run(event.currentTarget, async () => {
            await api("POST", `/api/w/${id}/invites`, { email, role });
            setEmail("");
            return `Invite queued for ${email}.`;
          });
        }}>
          {gate.note}
          <Field name="email" label="Email" error={model.errors.email} extraDescription={gate.describedBy}>
            {(props) => <input {...props} type="email" value={email} disabled={gate.disabled} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <div role="radiogroup" aria-label="Role" aria-describedby={gate.describedBy} className="choices">
            {(["developer", "viewer"] as const).map((option) => (
              <label key={option} className="choice">
                <input type="radio" name="role" value={option} checked={role === option} disabled={gate.disabled}
                  aria-describedby={gate.describedBy} onChange={() => setRole(option)} />
                <span className="choice__mark" aria-hidden="true" />
                {capitalise(option)}
              </label>
            ))}
          </div>
          {model.errors.role && <p className="field-error">{model.errors.role}</p>}
          <FormAlert model={model} />
          <SubmitButton model={model} gate={gate}>Send invite</SubmitButton>
          <FormStatus model={model} label="Invite member status" />
        </form>
      </FormPanel>
    </Page>
  );
}
