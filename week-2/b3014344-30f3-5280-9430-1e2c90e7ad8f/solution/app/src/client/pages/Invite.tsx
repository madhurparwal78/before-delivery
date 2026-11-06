import { useEffect, useState, type FormEvent } from "react";
import { api, RequestError } from "../lib/api";
import { navigate } from "../lib/router";
import { useSession } from "../session";
import type { User } from "../../shared/domain";

interface InviteInfo {
  businessName: string;
  projectName: string;
  email: string;
}

export function Invite({ token }: { token: string }) {
  const { setUser } = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [refusal, setRefusal] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((error) => setRefusal(error instanceof RequestError ? error.body.message : "We couldn't open this invite."));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFields({});
    try {
      const result = await api<{ user: User; projectId: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, { body: { name, password } });
      setUser(result.user);
      navigate(`/portal/projects/${result.projectId}`);
    } catch (error) {
      if (error instanceof RequestError && error.status === 422) setFields(error.body.fields ?? {});
      else setRefusal(error instanceof RequestError ? error.body.message : "We couldn't accept this invite.");
      setPending(false);
    }
  };

  return (
    <section className="page page--narrow">
      <p className="eyebrow">Teammate invite</p>
      {info ? (
        <>
          <h1>Join {info.businessName}</h1>
          <p className="lede">
            You've been invited to the project <strong>{info.projectName}</strong>. Set your name and a password to sign in as{" "}
            <span className="mono">{info.email}</span>.
          </p>
          <form className="sheet-form" onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="invite-name">Your name</label>
              <input id="invite-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={fields.name ? "invite-name-error" : undefined} />
              {fields.name ? <p id="invite-name-error" className="field-error">{fields.name}</p> : null}
            </div>
            <div className="field">
              <label htmlFor="invite-password">Password</label>
              <input id="invite-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="invite-password-hint" />
              <p id="invite-password-hint" className="field-hint">At least 10 characters.</p>
              {fields.password ? <p className="field-error">{fields.password}</p> : null}
            </div>
            {refusal ? <p role="alert" className="form-alert">{refusal}</p> : null}
            <button type="submit" className="button button--primary" disabled={pending}>
              Join the project
            </button>
          </form>
        </>
      ) : refusal ? (
        <>
          <h1>This invite can't be used</h1>
          <p role="alert" className="form-alert">{refusal}</p>
        </>
      ) : (
        <h1>Opening your invite…</h1>
      )}
    </section>
  );
}
