import { ReactNode, useEffect, useState } from "react";
import { api, CollectionSummary, Member, Invitation, IndexInfo, SavedQuery, SchemaField, User } from "../lib/api";
import { copy, apiErrorMessage } from "../lib/copy";
import { ApiError } from "../lib/api";
import { Dialog } from "../components/Dialog";
import { JsonEditor } from "../components/JsonEditor";
import { useNavigate } from "../lib/router";
import { displayNumber } from "shared/values";

/**
 * The project, members, indexes, schema, rules and saved-query screens.
 */

export function ProjectHome(props: { pid: string; role: string; projectName: string; collections: CollectionSummary[]; onRefresh: () => void }): ReactNode {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState("");
  const isOwner = props.role === "owner";
  return (
    <div className="content-narrow">
      <h1 className="h1">{props.projectName}</h1>
      <h2 className="h2">Collections</h2>
      {props.collections.length === 0 ? (
        <p className="muted">No collections yet</p>
      ) : (
        <ul aria-label="Collections" className="collection-list">
          {props.collections.map(c => (
            <li key={c.id}>
              <button className="collection-row" onClick={() => navigate(`/p/${props.pid}/c/${c.id}`)}>
                <span>{c.name}</span>
                <span className="count-pill">{displayNumber(c.count)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <>
          <form
            className="inline-form"
            onSubmit={e => {
              e.preventDefault();
              void api.post(`/api/projects/${props.pid}/collections`, { name })
                .then(() => { setName(""); props.onRefresh(); })
                .catch(err => setError(apiErrorMessage(err as ApiError)));
            }}
          >
            <label className="field">
              <span className="field-label">Collection name</span>
              <input aria-label="Collection name" className="text-input" value={name} onChange={e => setName(e.target.value)} />
            </label>
            <button className="btn primary" type="submit">Create collection</button>
          </form>
          <button className="btn danger" onClick={() => setDeleteOpen(true)}>Delete project</button>
        </>
      )}
      {error !== "" && <div role="alert" className="form-error">{error}</div>}
      <Dialog label={`Delete project ${props.projectName}?`} open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <h2 className="dialog-title">Delete project {props.projectName}?</h2>
        <div className="dialog-actions">
          <button
            className="btn danger"
            onClick={() => {
              void api.del(`/api/projects/${props.pid}`).then(() => navigate("/projects"));
            }}
          >
            Delete
          </button>
          <button className="btn" onClick={() => setDeleteOpen(false)}>Cancel</button>
        </div>
      </Dialog>
    </div>
  );
}

export function MembersScreen(props: { pid: string; role: string; onRefresh: () => void }): ReactNode {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("reader");
  const [status, setStatus] = useState("");
  const isOwner = props.role === "owner";
  useEffect(() => {
    void api.get<{ members: Member[]; invitations: Invitation[] }>(`/api/projects/${props.pid}/members`)
      .then(r => {
        setMembers(r.members);
        setInvitations(r.invitations);
      });
  }, [props.pid]);
  return (
    <div className="content-narrow">
      <h1 className="h1">Members</h1>
      <ul aria-label="Members" className="member-list">
        {members.map(m => (
          <li key={m.user_id} className="member-row">
            <span className="member-name">{m.name}</span>
            <span className="member-email">{m.email}</span>
            <span className="member-role">{m.role}</span>
            {isOwner && m.role !== "owner" && (
              <>
                <select
                  aria-label={`Role for ${m.email}`}
                  className="text-input"
                  value={m.role}
                  onChange={e => {
                    void api.patch(`/api/projects/${props.pid}/members/${m.user_id}`, { role: e.target.value })
                      .then(() => props.onRefresh());
                  }}
                >
                  <option value="editor">editor</option>
                  <option value="reader">reader</option>
                </select>
                <button
                  className="btn danger small"
                  aria-label={`Remove ${m.email}`}
                  onClick={() => {
                    void api.del(`/api/projects/${props.pid}/members/${m.user_id}`).then(() => props.onRefresh());
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <>
          <h2 className="h2">Invite</h2>
          <form
            className="inline-form"
            onSubmit={e => {
              e.preventDefault();
              void api.post(`/api/projects/${props.pid}/invitations`, { email: inviteEmail, role: inviteRole })
                .then(() => {
                  setStatus(copy.invitationCreated(inviteEmail));
                  setInviteEmail("");
                  props.onRefresh();
                })
                .catch(err => {
                  const c = (err as ApiError).code;
                  setStatus(c === "already_member" ? copy.alreadyMember : c === "already_invited" ? copy.alreadyInvited : apiErrorMessage(err as ApiError));
                });
            }}
          >
            <label className="field">
              <span className="field-label">Invite email</span>
              <input aria-label="Invite email" className="text-input" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Role</span>
              <select aria-label="Invite role" className="text-input" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="editor">editor</option>
                <option value="reader">reader</option>
              </select>
            </label>
            <button className="btn primary" type="submit">Send invitation</button>
          </form>
          <h2 className="h2">Pending invitations</h2>
          {invitations.length === 0 ? (
            <p className="muted">No pending invitations</p>
          ) : (
            <ul aria-label="Pending invitations" className="member-list">
              {invitations.map(inv => (
                <li key={inv.id} className="member-row">
                  <span className="member-email">{inv.email}</span>
                  <span className="member-role">{inv.role}</span>
                  <button
                    className="btn danger small"
                    aria-label={`Revoke ${inv.email}`}
                    onClick={() => {
                      void api.del(`/api/projects/${props.pid}/invitations/${inv.id}`).then(() => props.onRefresh());
                    }}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div role="status" className="form-status">{status}</div>
    </div>
  );
}

export function IndexesScreen(props: { pid: string; cid: string; role: string; onRefresh: () => void }): ReactNode {
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [keys, setKeys] = useState("{\n  \"sku\": 1\n}");
  const [unique, setUnique] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const isOwner = props.role === "owner";
  const load = (): void => {
    void api.get<{ indexes: IndexInfo[] }>(`/api/projects/${props.pid}/collections/${props.cid}/indexes`)
      .then(r => setIndexes(r.indexes));
  };
  useEffect(load, [props.pid, props.cid]);
  return (
    <div className="content-narrow">
      <h1 className="h1">Indexes</h1>
      <ul aria-label="Indexes" className="index-list">
        {indexes.map(idx => (
          <li key={idx.name} className="index-row">
            <span className="index-name">{idx.name}</span>
            <span className="index-keys">{JSON.stringify(idx.keys)}</span>
            {idx.unique && <span className="count-pill">unique</span>}
            {idx.name !== "_id_" && isOwner && (
              <button
                className="btn danger small"
                aria-label={`Drop ${idx.name}`}
                onClick={() => {
                  void api.del(`/api/projects/${props.pid}/collections/${props.cid}/indexes/${idx.name}`).then(load);
                }}
              >
                Drop
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form
          className="stack-form"
          onSubmit={e => {
            e.preventDefault();
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(keys) as Record<string, unknown>;
            } catch {
              setError(copy.invalidIndex);
              return;
            }
            setError("");
            setStatus(copy.indexPending);
            const body: Record<string, unknown> = { keys: parsed, unique };
            if (name.trim() !== "") body.name = name.trim();
            void api.post(`/api/projects/${props.pid}/collections/${props.cid}/indexes`, body)
              .then(res => {
                const created = res as { index: IndexInfo };
                setStatus(copy.indexDone(created.index.name));
                load();
                props.onRefresh();
              })
              .catch(err => {
                const e2 = err as ApiError;
                setStatus(e2.code === "invalid_index" ? copy.invalidIndex : apiErrorMessage(e2));
              });
          }}
        >
          <h2 className="h2">Create index</h2>
          <label className="field">
            <span className="field-label">Index keys</span>
            <textarea aria-label="Index keys" className="text-input mono" rows={3} value={keys} onChange={e => setKeys(e.target.value)} />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={unique} onChange={e => setUnique(e.target.checked)} />
            <span>Unique</span>
          </label>
          <label className="field">
            <span className="field-label">Index name</span>
            <input aria-label="Index name" className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="optional" />
          </label>
          <button className="btn primary" type="submit">Create index</button>
        </form>
      )}
      {error !== "" && <div role="alert" className="form-error">{error}</div>}
      <div role="status" aria-label="Index status" className="form-status">{status}</div>
    </div>
  );
}

export function SchemaScreen(props: { pid: string; cid: string }): ReactNode {
  const [sampled, setSampled] = useState(0);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    setBusy(true);
    void api.get<{ sampled: number; fields: SchemaField[] }>(`/api/projects/${props.pid}/collections/${props.cid}/schema`)
      .then(r => {
        setSampled(r.sampled);
        setFields(r.fields);
        setBusy(false);
      });
  }, [props.pid, props.cid]);
  return (
    <div className="content-narrow">
      <h1 className="h1">Schema</h1>
      <p className="muted">Sampled {displayNumber(sampled)} documents</p>
      <ul aria-label="Schema fields" className="schema-list">
        {fields.map(f => (
          <li key={f.path} data-field-path={f.path} data-present={f.present} className="schema-row">
            <span className="schema-path">{f.path}</span>
            <span className="schema-presence">{copy.schemaPresence(f.present)}</span>
            <span className="schema-types">
              {f.types.map(t => (
                <span key={t.type} data-type={t.type} data-share={t.share} className="schema-type-chip">
                  {copy.schemaShare(t.type, t.share)}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {busy && <div className="pane-loading" aria-busy="true" />}
    </div>
  );
}

export function RulesScreen(props: { pid: string; cid: string; role: string; onRefresh: () => void }): ReactNode {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const isOwner = props.role === "owner";
  useEffect(() => {
    void api.get<{ validator: unknown }>(`/api/projects/${props.pid}/collections/${props.cid}/validator`)
      .then(r => setText(r.validator === null ? "" : JSON.stringify(r.validator, null, 2)));
  }, [props.pid, props.cid]);
  return (
    <div className="content-narrow">
      <h1 className="h1">Rules</h1>
      <div className="editor-mirror">
        <JsonEditor value={text} onChange={isOwner ? v => setText(v) : undefined} readOnly={!isOwner} ariaLabel="Validator JSON" />
      </div>
      {isOwner && (
        <button
          className="btn primary"
          onClick={() => {
            let parsed: unknown;
            try {
              parsed = text.trim() === "" ? null : JSON.parse(text);
            } catch {
              setStatus(copy.invalidValidator);
              return;
            }
            void api.put(`/api/projects/${props.pid}/collections/${props.cid}/validator`, { validator: parsed })
              .then(() => {
                setStatus(copy.rulesSaved);
                props.onRefresh();
              })
              .catch(err => {
                setError(apiErrorMessage(err as ApiError));
                setStatus(copy.invalidValidator);
              });
          }}
        >
          Save rules
        </button>
      )}
      {error !== "" && <div role="alert" className="form-error">{error}</div>}
      <div role="status" aria-label="Rules status" className="form-status">{status}</div>
    </div>
  );
}

export function SavedQueriesScreen(props: {
  pid: string; cid: string; role: string;
  onRunSaved: (q: SavedQuery) => void;
}): ReactNode {
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const canWrite = props.role === "owner" || props.role === "editor";
  const load = (): void => {
    void api.get<{ saved_queries: SavedQuery[] }>(`/api/projects/${props.pid}/collections/${props.cid}/saved-queries`)
      .then(r => setQueries(r.saved_queries));
  };
  useEffect(load, [props.pid, props.cid]);
  return (
    <div className="content-narrow">
      <h1 className="h1">Saved queries</h1>
      <ul aria-label="Saved queries" className="saved-query-list">
        {queries.map(q => (
          <li key={q.id} className="saved-query-row">
            <div className="sq-name">{q.name}</div>
            <div className="sq-filter mono">{JSON.stringify(q.filter)}</div>
            <div className="sq-last">{copy.lastRun(q.last_run_at, q.last_count)}</div>
            <div className="sq-actions">
              <button
                className="btn primary"
                aria-label={`Run ${q.name}`}
                onClick={() => props.onRunSaved(q)}
              >
                Run
              </button>
              {canWrite && (
                <button
                  className="btn danger small"
                  aria-label={`Delete ${q.name}`}
                  onClick={() => {
                    void api.del(`/api/projects/${props.pid}/collections/${props.cid}/saved-queries/${q.id}`).then(load);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InvitesScreen(props: { user: User | null }): ReactNode {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<{ id: string; project: { id: string; name: string }; role: string; inviter: { name: string } }[]>([]);
  useEffect(() => {
    if (props.user === null) return;
    void api.get<{ invitations: typeof invitations }>("/api/invitations")
      .then(r => setInvitations(r.invitations));
  }, [props.user]);
  return (
    <div className="content-narrow">
      <h1 className="h1">Invitations</h1>
      {invitations.length === 0 ? (
        <p>{copy.noInvitations}</p>
      ) : (
        <ul aria-label="Invitations" className="member-list">
          {invitations.map(inv => (
            <li key={inv.id} className="member-row">
              <span>{inv.project.name} as {inv.role} from {inv.inviter.name}</span>
              <button
                className="btn primary"
                onClick={() => {
                  void api.post<{ project_id: string }>(`/api/invitations/${inv.id}/accept`)
                    .then(res => navigate(`/p/${res.project_id}`));
                }}
              >
                Accept
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
