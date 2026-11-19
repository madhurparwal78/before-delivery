import { useEffect, useState } from "react";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { announce } from "../lib/feedback";
import { navigate } from "../lib/router";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { Link } from "../ui/Link";
import type { InviteInfo } from "../../shared/types";

const STATUS_COPY: Record<Exclude<InviteInfo["status"], "pending">, string> = {
  accepted: "This invite has already been used.",
  expired: "This invite has expired.",
  revoked: "This invite was withdrawn.",
};

export function InvitePage({ token }: { token: string }) {
  const { me } = useSession();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .get<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((error: unknown) => setFailure(error instanceof ApiFailure && error.status === 404 ? "This invite link isn't valid." : GENERIC_ERROR));
  }, [token]);

  const join = async (): Promise<void> => {
    if (!info) return;
    setBusy(true);
    setFailure(null);
    try {
      const joined = await api.post<{ board_id: number }>(`/api/invites/${encodeURIComponent(token)}/accept`);
      announce(`You joined ${info.board.name}`);
      navigate(`/b/${joined.board_id}`);
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "";
      setFailure(
        code === "forbidden" ? "This invite is for another email address."
        : code === "invite_used" ? STATUS_COPY.accepted
        : code === "invite_expired" ? STATUS_COPY.expired
        : code === "invite_revoked" ? STATUS_COPY.revoked
        : code === "not_found" ? "This invite link isn't valid."
        : GENERIC_ERROR,
      );
      setBusy(false);
    }
  };

  const next = encodeURIComponent(`/invites/${token}`);
  const settled = info && info.status !== "pending" ? STATUS_COPY[info.status] : null;
  return (
    <main className="auth">
      <Link to="/" className="wordmark">MOTHLIGHT</Link>
      <div className="auth-column">
        <h1 className="auth-title">{info ? `Join ${info.board.name}` : "Invite"}</h1>
        {info && info.status === "pending" ? <p>{`${info.inviter.name} invited you to join as ${info.role === "editor" ? "an editor" : "a viewer"}.`}</p> : null}
        {settled ? <p>{settled}</p> : null}
        {failure ? <p role="alert" className="field-error">{failure}</p> : null}
        {info && info.status === "pending" ? (
          me ? (
            <Button variant="primary" busy={busy} busyLabel="Joining" onClick={() => void join()}>Join board</Button>
          ) : (
            <p className="invite-links">
              <Link to={`/signin?next=${next}`}>Sign in</Link> or <Link to={`/signup?next=${next}`}>Sign up</Link> to join.
            </p>
          )
        ) : null}
      </div>
    </main>
  );
}
