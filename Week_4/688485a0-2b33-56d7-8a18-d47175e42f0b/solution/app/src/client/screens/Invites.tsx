import { type ReactNode, useEffect, useState } from "react";
import { asFailure, get, post } from "../api.js";
import { Jar } from "../components/Jar.js";
import { navigate } from "../router.js";

interface Invitation {
  id: string;
  project: { id: string; name: string };
  role: string;
  inviter: { name: string };
}

export function Invites(): ReactNode {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    get<{ invitations: Invitation[] }>("/api/invitations").then((answer) => setInvitations(answer.invitations), () => setInvitations([]));
  }, []);
  const accept = async (invitation: Invitation): Promise<void> => {
    try {
      const answer = await post<{ project_id: string }>(`/api/invitations/${invitation.id}/accept`);
      navigate(`/p/${answer.project_id}`);
    } catch (error) {
      setMessage(asFailure(error).body.error === "invitation_closed" ? "This invitation is no longer open" : "Could not accept the invitation");
    }
  };
  return (
    <>
      <h1>Invitations</h1>
      <ul className="rows" role="list" aria-label="Invitations" aria-busy={invitations === null || undefined}>
        {invitations === null ? (
          <li className="skeleton-row" />
        ) : (
          invitations.map((invitation) => (
            <li key={invitation.id} className="row">
              <span>
                {invitation.project.name} as {invitation.role} from {invitation.inviter.name}
              </span>
              <button type="button" className="btn btn-lime" onClick={() => void accept(invitation)}>
                Accept
              </button>
            </li>
          ))
        )}
      </ul>
      {invitations?.length === 0 ? (
        <div className="empty-inline">
          <Jar size={96} tipped />
          <p className="status-line" role="status">
            No invitations
          </p>
        </div>
      ) : null}
      {message ? (
        <p className="status-line" role="status" aria-label="Invitation status">
          {message}
        </p>
      ) : null}
    </>
  );
}
