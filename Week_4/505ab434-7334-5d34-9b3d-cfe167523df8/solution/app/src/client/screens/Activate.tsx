import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiFailure, get, api, messageOf } from "../lib/api.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { navigate } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";
import { Alert, Button, EmptyState, Loading } from "../ui/index.ts";
import "../admin/admin.css";

interface Invitation {
  email: string;
  displayName: string;
}

/** `/activate/<token>`: sets a password for the invited person and signs them in. */
export function Activate({ params }: { params: string[] }): ReactNode {
  const [token] = params;
  const { refresh } = useSession();
  const [invitation, setInvitation] = useState<Invitation | "invalid" | null>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle("Activate your account");
  useHeadingFocus(invitation !== null && invitation !== "invalid");

  useEffect(() => {
    get<Invitation>(`/api/invitations/${encodeURIComponent(token)}`).then(setInvitation, (failure: unknown) => {
      if (failure instanceof ApiFailure && failure.status === 410) setInvitation("invalid");
      else setError(messageOf(failure));
    });
  }, [token]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api("POST", `/api/invitations/${encodeURIComponent(token)}/activate`, { password });
      await refresh();
      navigate("/library", true);
    } catch (failure) {
      setError(messageOf(failure));
      setPending(false);
    }
  }

  if (invitation === null) return error ? <Alert message={error} /> : <Loading />;
  if (invitation === "invalid") return <EmptyState glyph="lost">This invitation link is no longer valid.</EmptyState>;
  return (
    <form className="cell cell-pad auth-cell stack" data-frame noValidate onSubmit={(event) => void submit(event)}>
      <h1>Activate your account</h1>
      <p className="muted">
        {invitation.displayName}, {invitation.email}
      </p>
      <div className="field">
        <label htmlFor="activate-password">Password</label>
        <input id="activate-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <span className="muted hint">At least 12 characters.</span>
      </div>
      <Alert message={error} />
      <Button primary type="submit" pending={pending && "save"}>
        Activate account
      </Button>
    </form>
  );
}
