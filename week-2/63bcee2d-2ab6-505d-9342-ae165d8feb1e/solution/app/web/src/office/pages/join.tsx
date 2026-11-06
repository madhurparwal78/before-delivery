import { useEffect, useState } from "react";
import { get, post } from "../../api";
import { navigate } from "../../router";
import { useOffice } from "../context";
import { NOT_FOUND } from "../copy";
import { ErrorSummary, TextField, type Errors } from "../fields";
import { ActionButton } from "../layout";
import { OfficeShell } from "../shell";
import "./access.css";

interface Invitation {
  email: string;
  name: string;
  role: string;
  organisation: string;
}

const ROLE_NAMES: Record<string, string> = {
  director: "Studio director", project_lead: "Project lead", designer: "Designer", finance: "Studio finance",
  client_approver: "Client approver", contractor: "Contractor",
};

export function JoinPage({ token }: { token: string }) {
  const office = useOffice();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    void get<{ invitation: Invitation }>(`/api/invitations/${token}`).then((result) => {
      if (result.ok) {
        setInvitation(result.data.invitation);
        setName(result.data.invitation.name);
      } else setMissing(true);
    });
  }, [token]);

  const join = async (): Promise<void> => {
    office.announce("Joining…");
    const result = await post<{ member: { name: string } }>(`/api/invitations/${token}/accept`, { name, password });
    if (!result.ok) {
      office.announce("");
      const body = office.refused(result);
      if (body?.errors) {
        setErrors(body.errors);
        document.querySelector<HTMLElement>(".field-error")?.focus();
      }
      return;
    }
    await office.refreshSession();
    navigate("/office");
    office.announce(`Welcome to Marrow Hall Interiors, ${result.data.member.name}.`);
  };

  return (
    <OfficeShell title="Join" signedIn={false}>
      <div className="access">
        <section className="panel access-card" aria-labelledby="join-title">
          <div className="title-block access-title">
            <span><span className="label">Sheet</span> PL-00</span>
            <span>Invitation</span>
            <span>Marrow Hall Interiors</span>
          </div>
          <form className="panel-body" noValidate onSubmit={(event) => event.preventDefault()}>
            <h1 id="join-title">Join the workspace</h1>
            {missing && <p>{NOT_FOUND}</p>}
            {invitation && (
              <>
                <dl className="access-summary">
                  <dt>Email</dt><dd>{invitation.email}</dd>
                  <dt>Role</dt><dd>{ROLE_NAMES[invitation.role] ?? invitation.role}</dd>
                  <dt>Organisation</dt><dd>{invitation.organisation}</dd>
                </dl>
                <ErrorSummary form="join" errors={errors} />
                <TextField form="join" name="name" label="Your name" autoComplete="name" value={name} onChange={setName} error={errors.name} />
                <TextField form="join" name="password" label="Choose a password" type="password" autoComplete="new-password"
                  hint="12 to 128 characters." value={password} onChange={setPassword} error={errors.password} />
                <ActionButton primary type="submit" pending="Joining…" onAction={join}>Join workspace</ActionButton>
              </>
            )}
          </form>
        </section>
        <aside className="access-aside" aria-label="About Plumbline">
          <p className="access-quote">One place for the studio, the brand and the contractors on every rollout.</p>
        </aside>
      </div>
    </OfficeShell>
  );
}
