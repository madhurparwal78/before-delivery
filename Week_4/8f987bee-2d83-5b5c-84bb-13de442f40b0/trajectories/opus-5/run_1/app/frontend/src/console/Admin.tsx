import { useEffect, useState } from "react";
import { Field, LiveStatus } from "../components/ui";
import { Icon } from "../components/Icon";
import { api, RequestError } from "../lib/api";

import { localTime } from "../lib/format";
import { useSession } from "../lib/session";
import { useConsoleStatus, useRefusalAlert } from "./Shell";

interface Member {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
}

const ROLES: Member["role"][] = ["admin", "editor", "viewer"];

export function Members(): JSX.Element {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const alertFor = useRefusalAlert();

  const load = () => {
    void api<{ members: Member[] }>("GET", "/api/members")
      .then((answer) => setMembers(answer.members))
      .catch(() => undefined);
  };

  useEffect(load, []);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage("Creating invite…");
    setFields({});
    setInviteLink(null);
    try {
      const answer = await api<{ invite_token: string }>("POST", "/api/members", {
        body: { email, name, role },
      });
      setInviteLink(`/accept-invite?token=${answer.invite_token}`);
      setMessage("Invite created");
      setEmail("");
      setName("");
      load();
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "already_member") setFields({ email: "This person is already a member." });
      else if (refusal.code === "already_invited")
        setFields({ email: "This person already has an open invitation." });
      else if (refusal.code === "validation") setFields(refusal.fields);
      else setMessage(alertFor(refusal) ?? "");
      if (refusal.code !== "validation") setMessage((held) => (held === "Creating invite…" ? "" : held));
    } finally {
      setPending(false);
    }
  };

  const changeRole = async (member: Member, next: Member["role"]) => {
    const before = member.role;
    setMembers((held) => held.map((entry) => (entry.id === member.id ? { ...entry, role: next } : entry)));
    setMessage("Saving…");
    try {
      const answer = await api<{ member: Member }>("PATCH", `/api/members/${member.id}`, {
        body: { role: next },
      });
      setMembers((held) =>
        held.map((entry) => (entry.id === member.id ? { ...entry, role: answer.member.role } : entry)),
      );
      setMessage("Role updated");
    } catch (error) {
      const refusal = error as RequestError;
      setMembers((held) => held.map((entry) => (entry.id === member.id ? { ...entry, role: before } : entry)));
      if (refusal.code === "last_admin") setMessage("The workspace needs at least one admin.");
      else setMessage(alertFor(refusal) ?? "");
    }
  };

  return (
    <>
      <h1>Members</h1>
      <form className="panel" onSubmit={invite}>
        <h2>Invite member</h2>
        <Field label="Email" error={fields.email}>
          {(attributes) => (
            <input {...attributes} type="text" value={email} onChange={(event) => setEmail(event.target.value)} />
          )}
        </Field>
        <Field label="Name" error={fields.name}>
          {(attributes) => (
            <input {...attributes} type="text" value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>
        <Field label="Role" error={fields.role}>
          {(attributes) => (
            <select
              {...attributes}
              value={role}
              onChange={(event) => setRole(event.target.value as Member["role"])}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button type="submit" className="button" disabled={pending}>
          Invite member
        </button>
        {inviteLink ? (
          <p className="field-hint">
            <Icon name="copy" />
            <span>{inviteLink}</span>
          </p>
        ) : null}
        <LiveStatus name="Members status" message={message} />
      </form>
      <div className="panel">
        <h2>Workspace members</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <th scope="row">{member.name}</th>
                <td>{member.email}</td>
                <td>
                  <label className="visually-hidden" htmlFor={`role-${member.id}`}>
                    {`Role for ${member.name}`}
                  </label>
                  <select
                    id={`role-${member.id}`}
                    value={member.role}
                    onChange={(event) => void changeRole(member, event.target.value as Member["role"])}
                  >
                    {ROLES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface AuditEvent {
  seq: number;
  action: string;
  target_id: string;
  actor_email: string;
  at: string;
}

export function Audit(): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => {
    void api<{ events: AuditEvent[] }>("GET", "/api/audit")
      .then((answer) => setEvents(answer.events))
      .catch(() => undefined);
  }, []);
  return (
    <>
      <h1>Audit log</h1>
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Seq</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Actor</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.seq}>
                <th scope="row" className="numeric">
                  {event.seq}
                </th>
                <td>{event.action}</td>
                <td className="numeric">{event.target_id}</td>
                <td>{event.actor_email}</td>
                <td>{localTime(event.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const PLANS: { value: string; label: string }[] = [
  { value: "starter", label: "Starter" },
  { value: "team", label: "Team" },
  { value: "scale", label: "Scale" },
  { value: "private", label: "Private Cloud" },
];

export function Settings(): JSX.Element {
  const session = useSession();
  const status = useConsoleStatus();
  const [plan, setPlan] = useState("team");
  const alertFor = useRefusalAlert();
  const isAdmin = session.user?.role === "admin";

  useEffect(() => {
    void api<{ workspace: { plan: string } }>("GET", "/api/workspace")
      .then((answer) => setPlan(answer.workspace.plan))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <h1>Settings</h1>
      <div className="panel">
        <h2>Preferences</h2>
        <p>
          Your sync sounds and theme sit in the top bar and follow you to every session. Each change
          saves at once.
        </p>
        {isAdmin ? (
          <Field label="Plan">
            {(attributes) => (
              <select
                {...attributes}
                value={plan}
                onChange={async (event) => {
                  const next = event.target.value;
                  setPlan(next);
                  status.announceSettings("Saving…");
                  try {
                    await api("PATCH", "/api/workspace", { body: { plan: next } });
                    status.announceSettings("Plan updated");
                  } catch (error) {
                    status.announceSettings(alertFor(error as RequestError) ?? "");
                  }
                }}
              >
                {PLANS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
      </div>
    </>
  );
}
