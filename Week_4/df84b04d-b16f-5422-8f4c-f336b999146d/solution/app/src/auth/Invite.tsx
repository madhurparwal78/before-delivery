import { useEffect, useState } from "react";
import { INVITATION_SENTENCES, inviteSignedOut } from "../../shared/copy";
import { ApiFailure, get, post } from "../lib/api";
import { announce } from "../lib/announce";
import { Link, navigate } from "../lib/router";
import { refreshMe, useMe } from "../lib/session";
import { NotFoundPage } from "../outline/NotFound";

interface Invitation {
  email: string;
  bulletText: string;
  inviter: { name: string };
  status: string;
}

export function Invite({ token }: { token: string }) {
  const me = useMe();
  const [invitation, setInvitation] = useState<Invitation | "missing" | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Invitation>(`/api/invitations/${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 404) setInvitation("missing");
        else throw error;
      });
  }, [token]);

  if (invitation === null) return <div className="page-band" aria-busy="true" />;
  if (invitation === "missing") return <NotFoundPage />;

  const accept = async () => {
    setBusy(true);
    try {
      const { bulletId } = await post<{ bulletId: string }>(`/api/invitations/${encodeURIComponent(token)}/accept`);
      announce(`You can now edit ${invitation.bulletText}.`);
      await refreshMe();
      navigate(`/b/${bulletId}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "invitation_lapsed") setLapsed(true);
      else if (error instanceof ApiFailure && error.code === "wrong_account") setWrong(true);
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  const carried = new URLSearchParams({ email: invitation.email, next: `/invite/${token}` }).toString();
  let body;
  if (lapsed || invitation.status === "lapsed") body = <p>{INVITATION_SENTENCES.lapsed}</p>;
  else if (me === null) {
    body = (
      <>
        <p>{inviteSignedOut(invitation.email)}</p>
        <div className="form-actions">
          <Link to={`/signin?${carried}`} className="pill pill-sky">Sign in</Link>
          <Link to={`/signup?${carried}`} className="pill pill-quiet">Create an account</Link>
        </div>
      </>
    );
  } else if (wrong || me.user.email !== invitation.email) body = <p>{INVITATION_SENTENCES.wrongAccount}</p>;
  else {
    body = (
      <>
        <p>{invitation.inviter.name} invited you to edit this branch.</p>
        <button type="button" className="pill pill-sky pill-block" disabled={busy} aria-busy={busy} onClick={() => void accept()}>
          Accept invitation
        </button>
      </>
    );
  }

  return (
    <div className="page-band">
      <section className="card" aria-labelledby="invite-title">
        <h1 id="invite-title">{invitation.bulletText}</h1>
        {body}
      </section>
    </div>
  );
}
