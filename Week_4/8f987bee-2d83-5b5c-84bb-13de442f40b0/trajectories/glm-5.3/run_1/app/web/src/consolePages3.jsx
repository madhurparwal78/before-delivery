import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Field, Status, Tabs } from "./components.jsx";
import { api, ApiError, localTime } from "./api.js";
import { roleAtLeast, useUser } from "./console.jsx";

const DB_OUTAGE = "Wayline can't reach its database right now. It keeps retrying on its own.";
const UNCONFIRMED = "Wayline couldn't confirm this action. Check the list before trying again.";

/* ---------------------------------------------------------------- builder */

const START_MANIFEST = {
  base_url: "/mock-api/v1",
  auth: { type: "api_key", header: "X-Api-Key" },
  streams: [
    { name: "invoices", path: "/invoices", primary_key: ["id"], record_selector: "data",
      paginator: { page_size: 3 } },
  ],
};

function manifestToYaml(manifest) {
  const lines = ["base_url: " + manifest.base_url];
  lines.push("auth:");
  lines.push("  type: " + manifest.auth.type);
  lines.push("  header: " + manifest.auth.header);
  lines.push("streams:");
  manifest.streams.forEach((stream) => {
    lines.push("  - name: " + stream.name);
    lines.push("    path: " + stream.path);
    lines.push("    primary_key: [" + stream.primary_key.join(", ") + "]");
    lines.push("    record_selector: " + stream.record_selector);
    lines.push("    paginator:");
    lines.push("      page_size: " + stream.paginator.page_size);
  });
  return lines.join("\n");
}

function yamlToManifest(text) {
  const result = { base_url: "", auth: { type: "api_key", header: "" }, streams: [] };
  let currentStream = null;
  let currentSection = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const value = line.trim();
    if (indent === 0) {
      if (value.startsWith("base_url:")) {
        result.base_url = value.slice("base_url:".length).trim();
        currentSection = "";
      } else if (value === "auth:") {
        currentSection = "auth";
      } else if (value === "streams:") {
        currentSection = "streams";
      } else {
        return { error: "yaml" };
      }
    } else if (currentSection === "auth") {
      const [key, ...rest] = value.split(":");
      const inner = rest.join(":").trim();
      if (key === "type") result.auth.type = inner;
      if (key === "header") result.auth.header = inner;
    } else if (currentSection === "streams") {
      if (value.startsWith("- name:")) {
        currentStream = { name: value.slice("- name:".length).trim(),
          path: "", primary_key: [], record_selector: "", paginator: { page_size: 3 } };
        result.streams.push(currentStream);
      } else if (currentStream) {
        if (value.startsWith("name:")) currentStream.name = value.slice(5).trim();
        else if (value.startsWith("path:")) currentStream.path = value.slice(5).trim();
        else if (value.startsWith("primary_key:")) {
          const inner = value.slice("primary_key:".length).trim();
          currentStream.primary_key = inner.replace(/[\[\]]/g, "").split(",").map((s) => s.trim())
            .filter(Boolean);
        } else if (value.startsWith("record_selector:")) {
          currentStream.record_selector = value.slice("record_selector:".length).trim();
        } else if (value.startsWith("page_size:")) {
          currentStream.paginator.page_size = Number(value.slice("page_size:".length).trim());
        }
      }
    } else {
      return { error: "yaml" };
    }
  }
  return { manifest: result };
}

export function BuilderPage() {
  const { user } = useUser();
  const isEditor = roleAtLeast(user?.role || "viewer", "editor");
  const [tab, setTab] = useState("ui");
  const [manifest, setManifest] = useState(START_MANIFEST);
  const [yamlText, setYamlText] = useState(manifestToYaml(START_MANIFEST));
  const [yamlError, setYamlError] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState("");
  const [results, setResults] = useState(null);
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState(null);
  const definitionIdRef = useRef(null);

  useEffect(() => {
    api("/api/builder/projects").then(({ data }) => {
      if (data.projects.length) {
        setProjectId(data.projects[0].id);
        setManifest(data.projects[0].manifest);
        setYamlText(manifestToYaml(data.projects[0].manifest));
        definitionIdRef.current = data.projects[0].definition_id;
      }
    }).catch(() => {});
  }, [user?.id]);

  const yamlReadable = (() => {
    const parsed = yamlToManifest(yamlText);
    return !parsed.error && (parsed.manifest?.streams?.length ?? 0) > 0;
  })();

  const switchTab = (next) => {
    if (next === "ui") {
      const parsed = yamlToManifest(yamlText);
      if (parsed.error || (parsed.manifest?.streams?.length ?? 0) === 0) {
        setYamlError("unreadable");
        return;
      }
      setYamlError("");
      setManifest(parsed.manifest);
      setTab("ui");
    } else {
      setYamlText(manifestToYaml(manifest));
      setYamlError("");
      setTab("yaml");
    }
  };

  const currentStream = manifest.streams[0] || { name: "", path: "/", paginator: { page_size: 3 } };

  const ensureProject = useCallback(async () => {
    if (projectId) return projectId;
    const { data } = await api("/api/builder/projects", {
      method: "POST",
      body: { name: "Invoices project", manifest },
    });
    setProjectId(data.project.id);
    return data.project.id;
  }, [projectId, manifest]);

  const test = async () => {
    setPending(true);
    setMessage("Reading pages…");
    setAlert("");
    try {
      const id = await ensureProject();
      await api(`/api/builder/projects/${id}`, {
        method: "PUT",
        body: { name: "Invoices project", manifest },
      }).catch(() => {});
      const { data } = await api(`/api/builder/projects/${id}/test`, {
        method: "POST",
        body: { stream: manifest.streams[0]?.name || "invoices", api_key: apiKey },
      });
      setResults(data);
      setMessage(`Test read finished: ${data.records.length} records`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422
          && error.code === "source_http_error") {
        setMessage(`The sandbox refused the request (HTTP ${error.extra.http_status}).`);
      } else if (error instanceof ApiError && error.status === 400) {
        const fields = error.fields || {};
        setMessage("Reading pages…");
        setAlert(Object.values(fields)[0] || "The manifest has a problem.");
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setMessage("");
      } else {
        setAlert(UNCONFIRMED);
        setMessage("");
      }
    } finally {
      setPending(false);
    }
  };

  const publish = async () => {
    setPending(true);
    setMessage("Publishing…");
    setAlert("");
    try {
      const id = await ensureProject();
      await api(`/api/builder/projects/${id}`, {
        method: "PUT",
        body: { name: "Invoices project", manifest },
      }).catch(() => {});
      const { data } = await api(`/api/builder/projects/${id}/publish`, {
        method: "POST",
        body: {},
      });
      definitionIdRef.current = data.definition.id;
      setMessage(`Published version ${data.definition.version}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setMessage("Test every stream before publishing.");
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setMessage("");
      } else {
        setAlert(UNCONFIRMED);
        setMessage("");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <h1>Builder</h1>
      {alert && <Alert tone="error">{alert}</Alert>}
      <Tabs name="Builder" idBase="builder" active={tab} onChange={switchTab}
        tabs={[
          { id: "ui", label: "UI" },
          { id: "yaml", label: "YAML" },
        ]} />
      {tab === "ui" && (
        <div className="card card-pad">
          <Field label="Base URL" htmlFor="builder-base">
            <input id="builder-base" className="input" value={manifest.base_url}
              onChange={(e) => setManifest({ ...manifest, base_url: e.target.value })} />
          </Field>
          <Field label="Stream name" htmlFor="builder-stream">
            <input id="builder-stream" className="input" value={currentStream.name}
              onChange={(e) => {
                const streams = [...manifest.streams];
                streams[0] = { ...streams[0], name: e.target.value };
                setManifest({ ...manifest, streams });
              }} />
          </Field>
          <Field label="Path" htmlFor="builder-path">
            <input id="builder-path" className="input" value={currentStream.path}
              onChange={(e) => {
                const streams = [...manifest.streams];
                streams[0] = { ...streams[0], path: e.target.value };
                setManifest({ ...manifest, streams });
              }} />
          </Field>
          <Field label="Page size" htmlFor="builder-page-size">
            <input id="builder-page-size" className="input" type="number"
              value={currentStream.paginator.page_size}
              onChange={(e) => {
                const streams = [...manifest.streams];
                streams[0] = { ...streams[0],
                  paginator: { page_size: Number(e.target.value) } };
                setManifest({ ...manifest, streams });
              }} />
          </Field>
        </div>
      )}
      {tab === "yaml" && (
        <div className="card card-pad">
          <Field label="Manifest YAML" htmlFor="builder-yaml"
            error={yamlError ? "This YAML can't be read. Fix it before switching tabs." : ""}>
            <textarea id="builder-yaml" className="textarea" value={yamlText} rows={12}
              aria-describedby={yamlError ? "builder-yaml-error" : undefined}
              aria-invalid={Boolean(yamlError)}
              onChange={(e) => { setYamlText(e.target.value); setYamlError(""); }} />
          </Field>
        </div>
      )}
      {isEditor && (
        <div className="card card-pad" style={{ marginTop: "1rem" }}>
          <Field label="API key" htmlFor="builder-key">
            <input id="builder-key" className="input" type="password" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button type="button" className="btn btn-primary" onClick={test}
              disabled={pending || !yamlReadable}>
              Test
            </button>
            <button type="button" className="btn btn-outline" onClick={publish}
              disabled={pending || !yamlReadable}>
              Publish
            </button>
          </div>
          <Status name="Builder status" message={message} id="builder-status" />
        </div>
      )}
      {results && (
        <div className="card card-pad" style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>{results.records.length} records</h2>
          <ul>
            {results.records.map((record) => (
              <li key={record.id} style={{ fontSize: "0.9rem" }}>
                {record.id}
                <span style={{ color: "var(--muted)" }}>
                  {" "}· {Object.entries(results.detected_schema)
                    .map(([field, type]) => `${field}: ${type}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- members */

export function MembersPage() {
  const { user, guard } = useUser();
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("editor");
  const [inviteLink, setInviteLink] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const { data } = await api("/api/members");
      setMembers(data.members);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        guard("admin");
      }
    }
  }, [guard]);

  useEffect(() => {
    load();
  }, [load, user?.id]);

  const invite = async (e) => {
    e.preventDefault();
    setPending(true);
    setMessage("Creating invite…");
    setErrors({});
    setAlert("");
    setInviteLink("");
    try {
      const { data } = await api("/api/members", {
        method: "POST",
        body: { email, name, role },
      });
      setInviteLink(`/accept-invite?token=${data.invite_token}`);
      setMessage("Invite created");
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const copy = error.code === "already_member" ? "This person is already a member."
          : "This person already has an open invitation.";
        setErrors({ email: copy });
        setMessage("");
      } else if (error instanceof ApiError && error.status === 400) {
        setErrors(error.fields || {});
        setMessage("");
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setMessage("");
      } else {
        setAlert(UNCONFIRMED);
        setMessage("");
      }
    } finally {
      setPending(false);
    }
  };

  const changeRole = async (member, nextRole) => {
    setMessage("Saving…");
    try {
      const { data } = await api(`/api/members/${member.id}`, {
        method: "PATCH",
        body: { role: nextRole },
      });
      setMembers((current) => current.map((entry) =>
        (entry.id === member.id ? data.member : entry)));
      setMessage("Role updated");
    } catch (error) {
      setMembers((current) => current.map((entry) =>
        (entry.id === member.id ? { ...entry, role: member.role } : entry)));
      if (error instanceof ApiError && error.status === 409) {
        setMessage("The workspace needs at least one admin.");
      } else if (error instanceof ApiError && error.status === 403) {
        setMessage("You don't have permission to do that.");
        navigate("/app", { replace: true });
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setMessage("");
      } else {
        setMessage(UNCONFIRMED);
      }
    }
  };

  return (
    <div>
      <h1>Members</h1>
      {alert && <Alert tone="error">{alert}</Alert>}
      <div className="table-scroll">
      <table className="table" style={{ marginBottom: "1.6rem" }}>
        <caption className="visually-hidden">Members</caption>
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th></tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <th scope="row">{member.name}</th>
              <td>{member.email}</td>
              <td>
                <label className="visually-hidden" htmlFor={`role-${member.id}`}>
                  Role for {member.name}
                </label>
                <select id={`role-${member.id}`} className="select" value={member.role}
                  onChange={(e) => changeRole(member, e.target.value)}>
                  <option value="admin">admin</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <form className="card card-pad" onSubmit={invite}>
        <h2 style={{ fontSize: "1.1rem" }}>Invite member</h2>
        <Field label="Email" htmlFor="invite-email" error={errors.email}>
          <input id="invite-email" className="input" type="text" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Name" htmlFor="invite-name" error={errors.name}>
          <input id="invite-name" className="input" type="text" value={name}
            onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <select id="invite-role" className="select" value={role}
            onChange={(e) => setRole(e.target.value)}>
            <option value="admin">admin</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Creating invite…" : "Invite member"}
        </button>
        {inviteLink && (
          <p style={{ marginTop: "1rem", wordBreak: "break-all" }}>
            <Link to={inviteLink}>{inviteLink}</Link>
          </p>
        )}
        <Status name="Members status" message={message} id="members-status" />
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- audit */

export function AuditPage() {
  const { user, guard } = useUser();
  const [events, setEvents] = useState([]);
  const [alert, setAlert] = useState("");

  useEffect(() => {
    api("/api/audit").then(({ data }) => setEvents(data.events)).catch((error) => {
      if (error instanceof ApiError && error.status === 403) guard("admin");
      if (error instanceof ApiError && error.status === 503) setAlert(DB_OUTAGE);
    });
  }, [guard, user?.id]);

  return (
    <div>
      <h1>Audit log</h1>
      {alert && <Alert tone="error">{alert}</Alert>}
      <div className="table-scroll">
      <table className="table">
        <caption className="visually-hidden">Audit log</caption>
        <thead>
          <tr>
            <th scope="col">Seq</th><th scope="col">Action</th><th scope="col">Target</th>
            <th scope="col">Actor</th><th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.seq}>
              <th scope="row" className="num">{event.seq}</th>
              <td>{event.action}</td>
              <td style={{ fontFamily: "var(--code)", fontSize: "0.8rem" }}>{event.target_id}</td>
              <td>{event.actor_email}</td>
              <td>{localTime(event.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

export function SettingsPage() {
  const { user, setUser } = useUser();
  const [plan, setPlan] = useState("");
  const [message, setMessage] = useState("");
  const [alert, setAlert] = useState("");
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api("/api/workspace").then(({ data }) => setPlan(data.workspace.plan)).catch(() => {});
  }, [user?.id]);

  const changePlan = async (nextPlan) => {
    setMessage("Saving…");
    setAlert("");
    try {
      const { data } = await api("/api/workspace", { method: "PATCH", body: { plan: nextPlan } });
      setPlan(data.workspace.plan);
      setMessage("Plan updated");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setMessage("You don't have permission to do that.");
      } else if (error instanceof ApiError && error.status === 503) {
        setAlert(DB_OUTAGE);
        setMessage("");
      } else {
        setAlert(UNCONFIRMED);
        setMessage("");
      }
    }
  };

  return (
    <div>
      <h1>Settings</h1>
      {alert && <Alert tone="error">{alert}</Alert>}
      {isAdmin && (
        <div className="card card-pad" style={{ marginBottom: "1.2rem" }}>
          <Field label="Plan" htmlFor="settings-plan">
            <select id="settings-plan" className="select" value={plan}
              onChange={(e) => changePlan(e.target.value)}>
              <option value="starter">starter</option>
              <option value="team">team</option>
              <option value="scale">scale</option>
              <option value="private">private</option>
            </select>
          </Field>
          <Status name="Settings status" message={message} id="settings-status" />
        </div>
      )}
      <div className="card card-pad">
        <h2 style={{ fontSize: "1.1rem" }}>Preferences</h2>
        <p style={{ marginBottom: 0 }}>
          Sync sounds: {user?.preferences?.sync_sounds ? "on" : "off"} · Theme: {user?.preferences?.theme}
        </p>
      </div>
    </div>
  );
}
