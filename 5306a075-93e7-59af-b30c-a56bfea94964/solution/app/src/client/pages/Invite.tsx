import { useCallback, useEffect, useId, useState } from "react";
import type { InvitationInfo, User } from "../../shared/api.js";
import { api, isFailure } from "../api.js";
import { RoadmapOrnament } from "../art.js";
import { MessageSlot, useFeedback } from "../feedback.js";
import { ROLE_LABELS } from "../format.js";
import { navigate } from "../router.js";

const GONE: Record<string, string> = {
  invitation_used: "This invitation has already been used",
  invitation_expired: "This invitation has expired",
  invitation_replaced: "This invitation was replaced by a newer one",
};

export function InvitePage({ token }: { token: string }) {
  const feedback = useFeedback();
  const id = useId();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refuse = useCallback((error: unknown): void => {
    if (isFailure(error, 410)) setGone(GONE[error.code] ?? "This invitation can no longer be used");
    else if (isFailure(error, 404)) setGone("This invitation does not exist");
    else feedback.fail(error);
  }, [feedback]);

  useEffect(() => {
    api.get<InvitationInfo>(`/api/invitations/${encodeURIComponent(token)}`).then(setInfo, refuse);
  }, [token, refuse]);

  const join = async (): Promise<void> => {
    setBusy(true);
    setErrors({});
    feedback.clearAlert();
    try {
      await api.post<{ user: User }>(`/api/invitations/${encodeURIComponent(token)}/accept`, { name, password });
      navigate("/inbox");
    } catch (error) {
      if (isFailure(error, 422)) setErrors(error.fields);
      else refuse(error);
      setBusy(false);
    }
  };

  return (
    <div className="solo">
      <MessageSlot />
      <main className="solo-card">
        <RoadmapOrnament />
        {gone ? <h1>{gone}</h1> : info ? (
          <>
            <h1>Join {info.workspaceName}</h1>
            <p className="lede">You were invited as {ROLE_LABELS[info.role].toLowerCase()} with {info.email}.</p>
            <form onSubmit={(e) => { e.preventDefault(); void join(); }}>
              <div className="field">
                <label htmlFor={`${id}-name`}>Your name</label>
                <input id={`${id}-name`} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={errors.name ? `${id}-name-error` : undefined} />
                {errors.name && <p id={`${id}-name-error`} className="field-error">{errors.name}</p>}
              </div>
              <div className="field">
                <label htmlFor={`${id}-password`}>Password</label>
                <input id={`${id}-password`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={errors.password ? `${id}-password-error` : `${id}-password-hint`} />
                {errors.password ? <p id={`${id}-password-error`} className="field-error">{errors.password}</p> : <p id={`${id}-password-hint`} className="hint">At least 12 characters.</p>}
              </div>
              <button type="submit" className="button button-wide" aria-busy={busy} disabled={busy}>{busy ? "Joining…" : "Join workspace"}</button>
            </form>
          </>
        ) : <p aria-busy="true">Opening your invitation…</p>}
      </main>
    </div>
  );
}
