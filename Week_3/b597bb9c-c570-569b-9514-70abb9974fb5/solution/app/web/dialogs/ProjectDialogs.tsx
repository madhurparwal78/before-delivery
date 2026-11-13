import { useEffect, useState, type ReactNode } from "react";
import { charactersLeft, validCueText } from "../../shared/captions";
import { timecode } from "../../shared/timecode";
import { ASPECT_LABELS, type Caption, type Cut, type Member, type OpResult, type ReviewLink } from "../../shared/types";
import { api, ApiError, newOpId } from "../lib/api";
import { notify, setBanner } from "../lib/notices";
import { useProject } from "../project/context";
import { rateOfState } from "../project/state";
import { Dialog, Field, onSubmit, SelectField, TextField } from "../ui";

interface DialogProps {
  opener: HTMLElement | null;
  onClose: () => void;
}

export function NameCutDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store } = useProject();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const save = async (): Promise<void> => {
    notify("Saving cut…");
    try {
      await api.post(`/api/projects/${store.projectId}/cuts`, { name });
      await store.refreshCuts();
      notify(`${name} saved.`);
      onClose();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields["name"] ?? failure.message);
      notify(failure.message);
    }
  };
  return (
    <Dialog title="Name cut" opener={opener} onClose={onClose}>
      <form onSubmit={onSubmit(() => void save())}>
        <TextField label="Cut name" name="name" value={name} onChange={setName} error={error} />
        <div className="actions">
          <button type="submit">Save cut</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const LASTS = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
];

export function ShareDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store, state } = useProject();
  const [cutId, setCutId] = useState(state.cuts[state.cuts.length - 1]?.id ?? "");
  const [lasts, setLasts] = useState("604800");
  const [link, setLink] = useState<ReviewLink | null>(null);
  const [failure, setFailure] = useState<string | undefined>();
  const [token, setToken] = useState(0);

  useEffect(() => {
    void api.get<{ items: ReviewLink[] }>(`/api/projects/${store.projectId}/review-links`).then(({ items }) => {
      const active = [...items].reverse().find((item) => item.state === "active");
      if (active) {
        setLink(active);
        setCutId(active.cut_id);
      }
    });
  }, [store.projectId]);

  const run = async (pending: string, work: () => Promise<ReviewLink | null>, done: (made: ReviewLink | null) => string): Promise<void> => {
    notify(pending);
    try {
      const made = await work();
      setLink(made);
      setFailure(undefined);
      notify(done(made));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      notify(error.message);
      setFailure(error.message);
      setToken((current) => current + 1);
    }
  };
  const ready = (made: ReviewLink | null): string => `Review link ready. It works until ${made ? new Date(made.expires_at).toLocaleString() : ""}.`;

  return (
    <Dialog title="Share for review" opener={opener} onClose={onClose} summary={{ fields: {}, labels: {}, token, message: failure }}>
      <form onSubmit={onSubmit(() => undefined)}>
        <SelectField label="Cut" name="cut_id" value={cutId} onChange={setCutId} options={state.cuts.map((cut) => ({ value: cut.id, label: cut.name }))} />
        <SelectField label="Link lasts" name="expires_in_seconds" value={lasts} onChange={setLasts} options={LASTS} />
        <TextField label="Review link" name="url" value={link?.url ?? ""} onChange={() => undefined} readOnly />
        <div className="actions">
          <button type="button" onClick={() => void run("Making link…", () => api.post(`/api/projects/${store.projectId}/review-links`, { cut_id: cutId, expires_in_seconds: Number(lasts) }), ready)}>
            Create link
          </button>
          {link ? (
            <>
              <button type="button" onClick={() => void run("Making link…", () => api.put(`/api/review-links/${link.id}`, { cut_id: cutId }), ready)}>
                Share this cut
              </button>
              <button type="button" onClick={() => void run("Making link…", () => api.post(`/api/review-links/${link.id}/regenerate`), ready)}>
                Regenerate link
              </button>
              <button type="button" onClick={() => void run("Turning off link…", async () => (await api.del(`/api/review-links/${link.id}`), null), () => "Review link turned off.")}>
                Revoke link
              </button>
            </>
          ) : null}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const SIZES = [2160, 1080, 720] as const;

export function ExportDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store, state } = useProject();
  const [cutId, setCutId] = useState(state.cuts[state.cuts.length - 1]?.id ?? "");
  const [size, setSize] = useState<number>(1080);
  const [failure, setFailure] = useState<string | undefined>();
  const [token, setToken] = useState(0);
  const start = async (): Promise<void> => {
    notify("Starting export…");
    const cut = state.cuts.find((candidate) => candidate.id === cutId);
    try {
      await api.post(`/api/projects/${store.projectId}/exports`, { cut_id: cutId, size });
      setBanner("queue", null);
      setBanner("storage", null);
      notify(`Export of ${cut?.name ?? ""} at ${size}p queued.`);
      onClose();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      notify(error.message);
      if (error.code === "queue_unavailable") setBanner("queue", error.message);
      if (error.code === "storage_unavailable") setBanner("storage", error.message);
      setFailure(error.message);
      setToken((current) => current + 1);
    }
  };
  return (
    <Dialog title="Export cut" opener={opener} onClose={onClose} summary={{ fields: {}, labels: {}, token, message: failure }}>
      <form onSubmit={onSubmit(() => void start())}>
        <SelectField label="Cut" name="cut_id" value={cutId} onChange={setCutId} options={state.cuts.map((cut) => ({ value: cut.id, label: cut.name }))} />
        <div role="radiogroup" aria-label="Size" className="toggles">
          {SIZES.map((value) => (
            <label key={value} className="toggle">
              <input type="radio" name="size" checked={size === value} onChange={() => setSize(value)} />
              <span>{`${value}p`}</span>
            </label>
          ))}
        </div>
        <div className="actions">
          <button type="submit" disabled={!cutId}>
            Start export
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function FrameSizeDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store, state } = useProject();
  const [aspect, setAspect] = useState<string>(state.project.aspect_ratio);
  const [error, setError] = useState<string | undefined>();
  const change = async (): Promise<void> => {
    notify("Changing frame…");
    try {
      const result = await api.put<OpResult>(`/api/projects/${store.projectId}`, { op_id: newOpId(), base_version: state.version, aspect_ratio: aspect });
      await store.saved(result);
      notify(`The frame is now ${aspect}.`);
      onClose();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields["aspect_ratio"] ?? failure.message);
      notify(failure.message);
    }
  };
  return (
    <Dialog title="Frame size" opener={opener} onClose={onClose}>
      <form onSubmit={onSubmit(() => void change())}>
        <SelectField label="Aspect ratio" name="aspect_ratio" value={aspect} onChange={setAspect} options={ASPECT_LABELS.map((label) => ({ value: label, label }))} error={error} />
        <div className="actions">
          <button type="submit">Change frame</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MembersDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store, state } = useProject();
  const [members, setMembers] = useState<Member[]>(state.members);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [token, setToken] = useState(0);
  const reload = async (): Promise<void> => setMembers((await api.get<{ items: Member[] }>(`/api/projects/${store.projectId}/members`)).items);
  const add = async (): Promise<void> => {
    try {
      const added = await api.post<Member>(`/api/projects/${store.projectId}/members`, { email, role });
      notify(`${added.person.name} added as ${added.role}.`);
      setEmail("");
      setErrors({});
      await reload();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setErrors(failure.fields);
      setToken((current) => current + 1);
      notify(failure.message);
    }
  };
  return (
    <Dialog title="Project members" opener={opener} onClose={onClose} summary={{ fields: errors, labels: { email: "Email", role: "Role" }, token }}>
      <ul className="plain-list">
        {members.map((member) => (
          <li key={member.person.id}>
            <span>{member.person.name}</span> <span className="muted">{member.person.email}</span>{" "}
            {member.role === "owner" ? (
              <span className="muted">owner</span>
            ) : (
              <>
                <select
                  aria-label={`Role for ${member.person.name}`}
                  value={member.role}
                  onChange={(event) => void api.put(`/api/projects/${store.projectId}/members/${member.person.id}`, { role: event.target.value }).then(reload)}
                >
                  <option value="editor">editor</option>
                  <option value="commenter">commenter</option>
                </select>
                <button type="button" aria-label={`Remove ${member.person.name}`} onClick={() => void api.del(`/api/projects/${store.projectId}/members/${member.person.id}`).then(reload)}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit(() => void add())}>
        <TextField label="Email" name="email" value={email} onChange={setEmail} error={errors["email"]} />
        <SelectField
          label="Role"
          name="role"
          value={role}
          onChange={setRole}
          options={[
            { value: "editor", label: "editor" },
            { value: "commenter", label: "commenter" },
          ]}
          error={errors["role"]}
        />
        <div className="actions">
          <button type="submit">Add member</button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface Difference {
  added: string[];
  removed: string[];
  changed: { clip_id: string; from: { row_id: string; start_frame: number; end_frame: number }; to: { row_id: string; start_frame: number; end_frame: number } }[];
  frame_delta: number;
}

export function CompareDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store, state } = useProject();
  const cuts = state.cuts;
  const [from, setFrom] = useState(cuts[0]?.id ?? "");
  const [to, setTo] = useState(cuts[cuts.length - 1]?.id ?? "");
  const [diff, setDiff] = useState<Difference | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const rate = rateOfState(state);
  const target = cuts.find((cut) => cut.id === to);

  useEffect(() => {
    if (!from || !to) return;
    let alive = true;
    void (async () => {
      const [difference, a, b] = await Promise.all([
        api.get<Difference>(`/api/projects/${store.projectId}/cuts/${from}/compare/${to}`),
        api.get<{ clips: { id: string; name: string }[] }>(`/api/projects/${store.projectId}/cuts/${from}`),
        api.get<{ clips: { id: string; name: string }[] }>(`/api/projects/${store.projectId}/cuts/${to}`),
      ]);
      if (!alive) return;
      setDiff(difference);
      setNames(Object.fromEntries([...a.clips, ...b.clips].map((clip) => [clip.id, clip.name])));
    })();
    return () => {
      alive = false;
    };
  }, [from, to, store.projectId]);

  const restore = async (cut: Cut): Promise<void> => {
    notify("Restoring…");
    try {
      const result = await api.post<OpResult>(`/api/projects/${store.projectId}/cuts/${cut.id}/restore`, { op_id: newOpId(), base_version: store.s.version });
      await store.saved(result);
      notify(`${cut.name} restored.`);
      onClose();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      notify(failure.message);
    }
  };

  const span = (place: { start_frame: number; end_frame: number }): string => `${timecode(rate, place.start_frame)} to ${timecode(rate, place.end_frame)}`;
  const options = cuts.map((cut) => ({ value: cut.id, label: cut.name }));
  return (
    <Dialog title="Compare cuts" opener={opener} onClose={onClose}>
      <SelectField label="From cut" name="from" value={from} onChange={setFrom} options={options} />
      <SelectField label="To cut" name="to" value={to} onChange={setTo} options={options} />
      <table aria-label="Cut differences" className="diff">
        <tbody>
          {diff?.added.map((id) => (
            <tr key={`a-${id}`}>
              <td>{names[id] ?? id}</td>
              <td className="muted">added</td>
            </tr>
          ))}
          {diff?.removed.map((id) => (
            <tr key={`r-${id}`}>
              <td>{names[id] ?? id}</td>
              <td className="muted">removed</td>
            </tr>
          ))}
          {diff?.changed.map((change) => (
            <tr key={`c-${change.clip_id}`}>
              <td>{names[change.clip_id] ?? change.clip_id}</td>
              <td className="muted tnum">
                {span(change.from)} → {span(change.to)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="actions">
        {state.role === "owner" && target ? (
          <button type="button" aria-label={`Restore cut ${target.name}`} onClick={() => void restore(target)}>
            Restore
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function CaptionsDialog({ opener, onClose }: DialogProps): ReactNode {
  const { store, state } = useProject();
  const captionRows = state.rows.filter((row) => row.kind === "caption");
  const [rowId, setRowId] = useState(captionRows[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<{ caption: Caption; number: number } | null>(null);
  const [text, setText] = useState("");
  const cues = state.captions.filter((caption) => caption.row_id === rowId).sort((a, b) => a.start_frame - b.start_frame);
  const rate = rateOfState(state);
  const row = captionRows.find((candidate) => candidate.id === rowId);

  const importFile = async (): Promise<void> => {
    if (!file || !row) return;
    notify(`Reading ${file.name}…`);
    try {
      const result = await api.postRaw<{ cues: number; version: number }>(`/api/projects/${store.projectId}/rows/${rowId}/captions/import`, file, "application/x-subrip");
      await store.catchUp();
      setError(undefined);
      notify(`${result.cues} captions imported into ${row.name}.`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.fields["srt"] ?? failure.message);
      notify(failure.message);
    }
  };

  const [focusAfter, setFocusAfter] = useState<"editor" | number | null>(null);
  useEffect(() => {
    if (focusAfter === null) return;
    const selector = focusAfter === "editor" ? "[data-cue-text]" : `[data-edit-cue="${focusAfter}"]`;
    document.querySelector<HTMLElement>(selector)?.focus();
    setFocusAfter(null);
  }, [focusAfter, editing]);

  const saveCue = async (): Promise<void> => {
    if (!editing) return;
    const { caption, number } = editing;
    await store.submit(() => ({ type: "caption_edit", caption_id: caption.id, start_frame: caption.start_frame, end_frame: caption.end_frame, text }));
    setEditing(null);
    setFocusAfter(number);
  };

  return (
    <Dialog title="Captions" opener={opener} onClose={onClose}>
      <SelectField label="Caption row" name="row" value={rowId} onChange={setRowId} options={captionRows.map((candidate) => ({ value: candidate.id, label: candidate.name }))} />
      <Field label="SRT file" name="srt" error={error}>
        {(a11y) => <input {...a11y} type="file" accept=".srt,application/x-subrip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
      </Field>
      <div className="actions">
        <button type="button" disabled={!file} onClick={() => void importFile()}>
          Import captions
        </button>
        <a href={`/api/projects/${store.projectId}/rows/${rowId}/captions/export`} download>
          Download SRT
        </a>
      </div>
      <ul aria-label="Cues" className="cues">
        {cues.map((caption, index) => (
          <li key={caption.id}>
            <span className="muted tnum">
              {timecode(rate, caption.start_frame)} {timecode(rate, caption.end_frame)}
            </span>{" "}
            <span>{caption.text.replace(/\n/g, " / ")}</span>{" "}
            <button
              type="button"
              data-edit-cue={index + 1}
              aria-label={`Edit cue ${index + 1}`}
              onClick={() => {
                setEditing({ caption, number: index + 1 });
                setText(caption.text);
                setFocusAfter("editor");
              }}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="cue-editor">
          <label htmlFor="cue-text">Cue text</label>
          <textarea
            id="cue-text"
            data-cue-text=""
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && validCueText(text)) {
                event.preventDefault();
                void saveCue();
              }
            }}
          />
          <p className="muted tnum" data-count={charactersLeft(text)}>
            {charactersLeft(text)} characters left
          </p>
          <div className="actions">
            <button type="button" disabled={!validCueText(text)} onClick={() => void saveCue()}>
              Save cue
            </button>
            <button
              type="button"
              onClick={() => {
                const number = editing.number;
                setEditing(null);
                setFocusAfter(number);
              }}
            >
              Cancel cue
            </button>
          </div>
        </div>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
