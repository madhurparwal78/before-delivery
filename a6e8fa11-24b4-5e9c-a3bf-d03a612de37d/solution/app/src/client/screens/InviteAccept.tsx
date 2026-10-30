import { type FormEvent, useEffect, useState } from "react";
import { ApiFailure, api } from "../api.js";
import { COPY } from "../copy.js";
import { navigate } from "../router.js";
import { type User } from "../types.js";
import { FieldError, Mark } from "../ui/Icon.js";

export function InviteAccept({ token, onAccepted }: { token: string; onAccepted: (u: User) => void }): JSX.Element {
  const [invite, setInvite] = useState<{ name: string; stationName: string } | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<{ invite: { name: string; stationName: string } }>(`/api/invites/${encodeURIComponent(token)}`)
      .then((r) => setInvite(r.invite))
      .catch(() => setInvite(null));
  }, [token]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (password.length < 10) {
      setError(COPY.shortPassword);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ user: User }>(`/api/invites/${encodeURIComponent(token)}/accept`, { password });
      onAccepted(r.user);
      navigate("/", true);
    } catch (err) {
      setError(err instanceof ApiFailure && err.status === 422 ? COPY.shortPassword : COPY.usedInvite);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page-center graph-ground">
      <form className="card card-narrow" onSubmit={(e) => void submit(e)} noValidate>
        <p className="mark-line">
          <Mark size={30} />
          <span className="mark-word">Furrowbook</span>
        </p>
        {invite === null ? (
          <>
            <h1>Invite not found</h1>
            <FieldError>{COPY.usedInvite}</FieldError>
          </>
        ) : (
          <>
            <h1>{invite ? `Welcome, ${invite.name}` : "Welcome"}</h1>
            <p className="muted">{invite ? `You're joining ${invite.stationName}. Choose a password to finish setting up your account.` : "Loading your invite…"}</p>
            <label className="field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-hint" />
            </label>
            <p className="hint" id="password-hint">
              At least 10 characters.
            </p>
            <button type="submit" className="btn btn-primary btn-wide" disabled={busy}>
              {busy ? "Saving…" : "Accept invite"}
            </button>
            <FieldError>{error}</FieldError>
          </>
        )}
      </form>
    </main>
  );
}
