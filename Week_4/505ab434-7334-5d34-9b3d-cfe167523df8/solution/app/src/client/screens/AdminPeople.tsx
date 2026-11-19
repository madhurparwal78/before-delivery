import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, get } from "../lib/api.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { Alert, Button, Loading, usePageStatus } from "../ui/index.ts";
import { useAction } from "../admin/useAction.ts";
import "../admin/admin.css";

interface Organisation {
  id: string;
  name: string;
  kind: string;
  engagement: { startsOn: string; endsOn: string; territories: string[] } | null;
}

/** `/admin/people` (owner): invitations and agency engagement end dates. */
export function AdminPeople(_props: { params: string[] }): ReactNode {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const say = usePageStatus();
  useTitle("People");
  useHeadingFocus(organisations !== null);

  const load = useCallback(async () => setOrganisations((await get<{ organisations: Organisation[] }>("/api/organisations")).organisations), []);
  useEffect(() => void load(), [load]);

  if (!organisations) return <Loading />;
  const outside = organisations.filter((o) => o.kind !== "brand");
  const agencies = organisations.filter((o) => o.engagement !== null);
  return (
    <div className="people-grid">
      <div className="screen-head" data-frame>
        <h1>People</h1>
        <p className="muted">Invite agency partners and press contacts, and set when each agency's engagement ends.</p>
      </div>
      <InviteForm organisations={outside} onInvited={(email) => say(`Invitation queued for ${email}.`)} />
      <section className="cell" data-frame aria-label="Engagements">
        <h2 className="cell-pad">Engagements</h2>
        {agencies.map((org) => (
          <EngagementRow
            key={org.id}
            organisation={org}
            onSaved={async () => {
              await load();
              say("Engagement end saved.");
            }}
          />
        ))}
      </section>
    </div>
  );
}

function InviteForm({ organisations, onInvited }: { organisations: Organisation[]; onInvited: (email: string) => void }): ReactNode {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("agency");
  const [organisationId, setOrganisationId] = useState(organisations[0]?.id ?? "");
  const action = useAction();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void action
      .run("invite", async () => {
        await api("POST", "/api/invitations", { email, displayName, role, organisationId });
      })
      .then((ok) => {
        if (ok) {
          onInvited(email);
          setEmail("");
          setDisplayName("");
        }
      });
  };

  return (
    <form className="cell cell-pad stack" data-frame noValidate onSubmit={submit} aria-label="Invite">
      <h2>Invite a person</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-name">Display name</label>
          <input id="invite-name" type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="agency">Agency partner</option>
            <option value="press">Press contact</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="invite-org">Organisation</label>
          <select id="invite-org" value={organisationId} onChange={(event) => setOrganisationId(event.target.value)}>
            {organisations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Alert message={action.error?.message} />
      <div>
        <Button primary type="submit" pending={action.busy === "invite" && "save"}>
          Invite person
        </Button>
      </div>
    </form>
  );
}

function EngagementRow({ organisation, onSaved }: { organisation: Organisation; onSaved: () => Promise<void> }): ReactNode {
  const [endsOn, setEndsOn] = useState(organisation.engagement!.endsOn);
  const action = useAction();
  const id = `engagement-${organisation.id}`;
  return (
    <div className="org-row">
      <div>
        <strong>{organisation.name}</strong>
        <div className="muted">Territories: {organisation.engagement!.territories.join(", ")}</div>
      </div>
      <div className="field">
        <label htmlFor={id}>{`Engagement end for ${organisation.name}`}</label>
        <input id={id} type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
      </div>
      <Button
        pending={action.busy === "save" && "save"}
        onClick={() => void action.run("save", async () => {
          await api("PUT", `/api/organisations/${organisation.id}/engagement`, { endsOn });
          await onSaved();
        })}
      >
        {`Save engagement end for ${organisation.name}`}
      </Button>
      <div style={{ gridColumn: "1 / -1" }}>
        <Alert message={action.error?.message} />
      </div>
    </div>
  );
}
