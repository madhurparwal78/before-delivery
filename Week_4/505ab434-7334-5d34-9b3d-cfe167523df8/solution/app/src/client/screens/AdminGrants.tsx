import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { GrantView } from "../../shared/api.ts";
import { api, get } from "../lib/api.ts";
import { calendarDate } from "../lib/format.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { useLive } from "../lib/live.ts";
import { Link } from "../lib/router.tsx";
import { Alert, Button, Chip, Dialog, EmptyState, Loading, usePageStatus } from "../ui/index.ts";
import { useAction } from "../admin/useAction.ts";
import "../admin/admin.css";

const TONE = { active: "meadow", pending_proof: "saffron", revoked: "ember", expired: "stone", zero_length: "stone" } as const;

/** `/admin/grants` (owner, legal reviewer): every grant, with revocation. */
export function AdminGrants(_props: { params: string[] }): ReactNode {
  const [grants, setGrants] = useState<GrantView[] | null>(null);
  const [revoking, setRevoking] = useState<GrantView | null>(null);
  const say = usePageStatus();
  useTitle("Grants");
  useHeadingFocus(grants !== null);

  const load = useCallback(async () => setGrants((await get<{ grants: GrantView[] }>("/api/grants")).grants), []);
  useEffect(() => void load(), [load]);
  useLive(["grant.updated", "library.updated"], () => void load());

  if (!grants) return <Loading />;
  return (
    <>
      <div className="screen-head" data-frame>
        <h1>Grants</h1>
        <p className="muted">Each grant ends no later than the agency's engagement. Revoking ends access at once.</p>
      </div>
      {grants.length === 0 ? (
        <EmptyState glyph="padlock">There are no grants.</EmptyState>
      ) : (
        <div className="table-cell" data-frame>
          <div className="table-wrap">
            <table className="table table-stack" aria-label="Grants">
              <thead>
                <tr>
                  <th scope="col">Grant</th>
                  <th scope="col">Holder</th>
                  <th scope="col">Card</th>
                  <th scope="col">Status</th>
                  <th scope="col">Window</th>
                  <th scope="col">Request</th>
                  <th scope="col">Conditions</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td data-label="Grant">
                      <strong>{grant.id}</strong>
                    </td>
                    <td data-label="Holder">{grant.holder.displayName}</td>
                    <td data-label="Card">{grant.cardName}</td>
                    <td data-label="Status">
                      <Chip tone={TONE[grant.status]}>{grant.statusLabel}</Chip>
                      {grant.revokedReason ? <div className="muted">{grant.revokedReason}</div> : null}
                    </td>
                    <td data-label="Window">
                      {grant.notBefore ? `${calendarDate(grant.notBefore)} to ` : "Until "}
                      {calendarDate(grant.notAfter)}
                      {grant.cap ? <div className="muted">Cap: {grant.cap}</div> : null}
                    </td>
                    <td data-label="Request">{grant.requestId ? <Link to={`/requests/${grant.requestId}`}>{grant.requestId}</Link> : <span className="muted">None</span>}</td>
                    <td data-label="Conditions">
                      {grant.conditions.length === 0 ? <span className="muted">None</span> : grant.conditions.map((c) => <div key={c.text}>{c.text}</div>)}
                    </td>
                    <td data-label="Actions">
                      <Button disabled={grant.status !== "active" && grant.status !== "pending_proof"} onClick={() => setRevoking(grant)}>
                        {`Revoke ${grant.id}`}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {revoking ? (
        <RevokeDialog
          grant={revoking}
          onClose={() => setRevoking(null)}
          onRevoked={async () => {
            const id = revoking.id;
            setRevoking(null);
            await load();
            say(`${id} revoked.`);
          }}
        />
      ) : null}
    </>
  );
}

function RevokeDialog({ grant, onClose, onRevoked }: { grant: GrantView; onClose: () => void; onRevoked: () => Promise<void> }): ReactNode {
  const [reason, setReason] = useState("");
  const action = useAction();
  return (
    <Dialog name={`Revoke ${grant.id}`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run("revoke", async () => {
            await api("POST", `/api/grants/${grant.id}/revoke`, { reason });
            await onRevoked();
          });
        }}
      >
        <h2>{`Revoke ${grant.id}`}</h2>
        <p className="muted">
          {grant.holder.displayName} loses access to {grant.cardName} at once; links already issued stop working.
        </p>
        <div className="field">
          <label htmlFor="revoke-reason">Reason</label>
          <textarea id="revoke-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <Alert message={action.error?.message} />
        <div className="dialog-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button primary type="submit" pending={action.busy === "revoke" && "save"}>
            Revoke grant
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
