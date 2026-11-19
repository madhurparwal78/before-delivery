import { useEffect, useRef, useState } from "react";
import Field from "../components/Field.jsx";
import { Copy } from "../components/Icons.jsx";
import { api, outageCopy, PERMISSION } from "./api.js";
import { useConsole } from "./context.js";

const ROLES = ["admin", "editor", "viewer"];
const INVITE_REFUSALS = {
  already_member: "This person is already a member.",
  already_invited: "This person already has an open invitation.",
};

export default function Members() {
  const { report } = useConsole();
  const [members, setMembers] = useState(null);
  const [form, setForm] = useState({ email: "", name: "", role: "viewer" });
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState("");
  const [status, setStatus] = useState("");
  const queues = useRef({});

  useEffect(() => {
    api("/api/members").then((result) => {
      if (result.ok) setMembers(result.body.members);
      else report(result);
    });
  }, [report]);

  const invite = async (event) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setLink("");
    setStatus("Creating invite…");
    const result = await api("/api/members", { method: "POST", body: form });
    setPending(false);
    if (result.ok) {
      setLink(`${window.location.origin}/accept-invite?token=${result.body.invite_token}`);
      setStatus("Invite created");
      setForm({ email: "", name: "", role: "viewer" });
    } else if (INVITE_REFUSALS[result.body?.error]) {
      setStatus("");
      setErrors({ email: INVITE_REFUSALS[result.body.error] });
    } else if (result.body?.error === "validation") {
      setStatus("");
      setErrors(result.body.fields);
    } else {
      setStatus(result.outage ? outageCopy(result) : PERMISSION);
      report(result);
    }
  };

  // Role changes are sent in order per member; the select always ends on the role the server holds.
  const changeRole = (member, role) => {
    const held = member.role;
    setMembers((list) => list.map((m) => (m.id === member.id ? { ...m, role } : m)));
    setStatus("Saving…");
    const previous = queues.current[member.id] ?? Promise.resolve(held);
    queues.current[member.id] = previous.then(async (serverRole) => {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      const result = await api(`/api/members/${member.id}`, { method: "PATCH", body: { role } });
      const settled = result.ok ? result.body.member.role : serverRole;
      setMembers((list) => list.map((m) => (m.id === member.id ? { ...m, role: settled } : m)));
      if (result.ok) setStatus("Role updated");
      else if (result.body?.error === "last_admin") setStatus("The workspace needs at least one admin.");
      else {
        setStatus(result.outage ? outageCopy(result) : PERMISSION);
        report(result);
      }
      return settled;
    });
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Members</h1></div>
      <div className="split">
        <section className="panel" aria-labelledby="members-title">
          <h2 id="members-title" className="panel-title">Members</h2>
          <div className="table-frame" role="region" tabIndex={0} aria-label="Members table">
            <table className="data">
              <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th></tr></thead>
              <tbody>
                {members === null && [0, 1, 2].map((row) => (
                  <tr key={row}><td colSpan="3"><span className="skeleton" aria-hidden="true" /></td></tr>
                ))}
                {members?.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}</th>
                    <td>{member.email}</td>
                    <td>
                      <select className="select select-compact" aria-label={`Role for ${member.name}`} value={member.role}
                        onChange={(e) => changeRole(member, e.target.value)}>
                        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <form className="panel form-grid" onSubmit={invite} noValidate aria-labelledby="invite-title">
          <h2 id="invite-title" className="panel-title">Invite member</h2>
          <Field label="Email" error={errors.email}>
            {(control) => <input {...control} className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
          <Field label="Name" error={errors.name}>
            {(control) => <input {...control} className="input" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Field label="Role" error={errors.role}>
            {(control) => (
              <select {...control} className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            )}
          </Field>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating invite…" : "Invite member"}</button>
          {link && (
            <div className="invite-link">
              <span className="field-label">Share this link once; it is not shown again.</span>
              <a href={link} className="code">{link}</a>
              <button type="button" className="btn btn-quiet" onClick={() => navigator.clipboard?.writeText(link)}>
                <Copy width="16" height="16" />Copy link
              </button>
            </div>
          )}
        </form>
      </div>
      <p role="status" aria-label="Members status" className="status-line">{status}</p>
    </div>
  );
}
