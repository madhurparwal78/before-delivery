import { useCallback, useEffect, useState } from "react";
import { ROLES, type Role } from "../../shared/protocol";
import { call } from "../lib/api";
import { Link } from "../lib/router";
import { pushed, useStore } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Chip, Empty, Loading, Status } from "../ui/Bits";
import { useDialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ScheduleDialog } from "../ui/ScheduleDialog";
import { NotFound } from "./NotFound";

interface CommunitySummary {
  id: string;
  name: string;
  timeZone: string;
  role: Role;
}

interface Member {
  personId: string;
  displayName: string;
  role: Role;
  joinedAt?: string;
  email?: string;
}

interface GatheringSummary {
  id: string;
  title: string;
  status: string;
  display: string;
  recurrence: string;
}

export function Communities() {
  const version = useStore(pushed).role;
  const [list, setList] = useState<CommunitySummary[] | null>(null);
  useEffect(() => {
    void call<{ communities: CommunitySummary[] }>("GET", "/api/communities").then((reply) => reply.ok && setList(reply.data.communities));
  }, [version]);
  return (
    <>
      <h1 tabIndex={-1}>Communities</h1>
      <section className="panel">
        {list === null ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty>You are not in a community yet.</Empty>
        ) : (
          <ul className="cards" aria-label="Your communities">
            {list.map((community) => (
              <li key={community.id} className="row-card">
                <div>
                  <strong>{community.name}</strong>
                  <div className="row tight">
                    <Chip>{community.role}</Chip>
                    <span className="muted">{community.timeZone}</span>
                  </div>
                </div>
                <Link to={`/communities/${community.id}`} className="button">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function Community({ id }: { id: string }) {
  const version = useStore(pushed).role;
  const [community, setCommunity] = useState<CommunitySummary | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [gatherings, setGatherings] = useState<GatheringSummary[] | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const roles = useAction("Saving...");
  const scheduling = useAction("Saving...");
  const dialog = useDialog();

  const load = useCallback(async (): Promise<void> => {
    const [all, people, events] = await Promise.all([
      call<{ communities: CommunitySummary[] }>("GET", "/api/communities"),
      call<{ members: Member[] }>("GET", `/api/communities/${id}/members`),
      call<{ gatherings: GatheringSummary[] }>("GET", `/api/communities/${id}/gatherings`),
    ]);
    const found = all.ok ? all.data.communities.find((item) => item.id === id) : undefined;
    if (!found || !people.ok) {
      setCommunity(null);
      return;
    }
    setCommunity(found);
    setMembers(people.data.members);
    if (events.ok) setGatherings(events.data.gatherings);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, version]);

  if (community === undefined) return <Loading />;
  if (community === null) return <NotFound />;
  const owner = community.role === "owner";
  const manager = owner || community.role === "steward";
  const change = async (personId: string, role: string): Promise<void> => {
    setChoices((current) => ({ ...current, [personId]: role }));
    const reply = await roles.run("PUT", `/api/communities/${id}/members/${personId}`, { role }, () => "Role changed.");
    if (reply.ok) await load();
    setChoices(({ [personId]: _settled, ...rest }) => rest);
  };
  const remove = async (personId: string): Promise<void> => {
    const reply = await roles.run("DELETE", `/api/communities/${id}/members/${personId}`, undefined, () => "Member removed.");
    if (reply.ok) await load();
  };
  return (
    <>
      <h1 tabIndex={-1}>{community.name}</h1>
      <p className="muted">
        You are {community.role === "owner" ? "an owner" : community.role === "steward" ? "a steward" : "a member"} here. Times follow {community.timeZone}.
      </p>
      <section className="panel">
        <h2>Members</h2>
        <Status name="Community result" result={roles.result} />
        <table role="table" aria-label="Members" className="members stack-table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Name</th>
              <th role="columnheader" scope="col">Role</th>
              {manager ? <th role="columnheader" scope="col">Joined</th> : null}
              {owner ? <th role="columnheader" scope="col">Email</th> : null}
              {manager ? <th role="columnheader" scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {(members ?? []).map((member) => (
              <tr role="row" key={member.personId}>
                <td role="cell" data-label="Name">{member.displayName}</td>
                <td role="cell" data-label="Role">
                  {owner ? (
                    <select aria-label={`Role for ${member.displayName}`} value={choices[member.personId] ?? member.role} onChange={(event) => void change(member.personId, event.target.value)}>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.role
                  )}
                </td>
                {manager ? <td role="cell" data-label="Joined">{member.joinedAt ? member.joinedAt.slice(0, 10) : ""}</td> : null}
                {owner ? <td role="cell" data-label="Email">{member.email}</td> : null}
                {manager ? (
                  <td role="cell" data-label="Actions">
                    {(owner ? member.role !== "owner" : member.role === "member") ? (
                      <button type="button" className="button" aria-label={`Remove ${member.displayName}`} onClick={() => void remove(member.personId)}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Gatherings</h2>
        {manager ? (
          <div className="row">
            <button type="button" className="button primary" onClick={(event) => dialog.show(event.currentTarget)}>
              <Icon name="communities" size={18} /> Schedule gathering
            </button>
          </div>
        ) : null}
        {!dialog.open ? <Status name="Gathering result" result={scheduling.result} /> : null}
        {gatherings === null ? (
          <Loading />
        ) : gatherings.length === 0 ? (
          <Empty>No gatherings scheduled.</Empty>
        ) : (
          <ul aria-label="Gatherings" className="cards">
            {gatherings.map((gathering) => (
              <li key={gathering.id} data-gathering-id={gathering.id} data-status={gathering.status} className="row-card">
                <div>
                  <strong>
                    <Link to={`/gatherings/${gathering.id}`}>{gathering.title}</Link>
                  </strong>
                  <div className="row tight">
                    <span>{gathering.display}</span>
                    <Chip tone={gathering.status === "open" ? "calm" : "plain"}>{gathering.status}</Chip>
                    {gathering.recurrence === "weekly" ? <Chip>weekly</Chip> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {manager ? <ScheduleDialog communityId={id} handle={dialog} action={scheduling} onScheduled={() => void load()} /> : null}
    </>
  );
}
