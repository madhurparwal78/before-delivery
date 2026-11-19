import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useState } from 'preact/hooks';
import type { ExportInfo, MapDoc, ShareLinkInfo, VersionInfo } from '../../shared/model.ts';
import type { PreviewNode } from '../../shared/outline.ts';
import { COPY, can } from '../../shared/rules.ts';
import { withoutRestricted } from '../../shared/tree.ts';
import { HttpError, api } from '../api.ts';
import { navigate } from '../router.ts';
import { Icon } from '../ui/Icon.tsx';
import { Modal } from '../ui/Modal.tsx';
import { MiniMap } from '../ui/MiniMap.tsx';
import { Spinner } from '../ui/Spinner.tsx';
import { newOpId, type MapSession } from './session.ts';
import { useSession } from './useSession.ts';

/** An error notice: white band, orange marker down the left edge and an icon, so meaning never rests on colour alone. */
function ErrorBand({ children }: { children: ComponentChildren }) {
  return (
    <div class="band band-error" role="alert">
      <Icon name="circle-alert" size={20} />
      <div class="band-body">{children}</div>
    </div>
  );
}

function Shell(props: { label: string; onClose: () => void; children: ComponentChildren; dismissible?: boolean; wide?: boolean }) {
  return (
    <Modal label={props.label} onClose={props.onClose} dismissible={props.dismissible} className={props.wide ? 'wide' : ''}>
      <div class="dialog-body">
        <h2 class="dialog-title">{props.label}</h2>
        {props.children}
        {props.dismissible === false ? null : (
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" onClick={props.onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------- Share

const ROLES = [
  { id: 'owner', name: 'Owner', can: ['Everything an editor can do', 'Share the map and manage roles', 'Restore versions, present and delete the map'] },
  { id: 'editor', name: 'Editor', can: ['Edit topics, links, styles and tasks', 'Import outlines, paste and attach images', 'Save versions and lock branches'] },
  { id: 'commenter', name: 'Commenter', can: ['See the map and its history', 'Comment, reply and vote', 'Export what they can see'] },
  { id: 'viewer', name: 'Viewer', can: ['See the map and its history', 'Follow people and find topics', 'Export what they can see'] },
] as const;

interface Member {
  username: string;
  role: string;
}

function RoleAccordion(props: { doc: MapDoc }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div class="role-accordion">
      {ROLES.map((role) => {
        const expanded = open === role.id;
        const seen = can(role.id, 'see_restricted') ? props.doc : withoutRestricted(props.doc);
        return (
          <div key={role.id} class="accordion-item">
            <h3>
              <button type="button" class="accordion-trigger" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : role.id)}>
                {role.name}
              </button>
            </h3>
            {expanded ? (
              <div class="accordion-panel role-panel">
                <ul class="role-checklist">
                  {role.can.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div class="role-preview" aria-hidden="true">
                  <MiniMap doc={seen} />
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ShareDialog(props: { session: MapSession; onClose: () => void }) {
  const { session } = props;
  useSession(session);
  const [members, setMembers] = useState<Member[]>([]);
  const [links, setLinks] = useState<ShareLinkInfo[]>([]);
  const [invitee, setInvitee] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [linkRole, setLinkRole] = useState('commenter');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    const [m, l] = await Promise.all([
      api<{ members: Member[] }>('GET', `/api/maps/${session.mapId}/members`),
      api<{ links: ShareLinkInfo[] }>('GET', `/api/maps/${session.mapId}/links`),
    ]);
    setMembers(m.members);
    setLinks(l.links);
  };
  useLayoutEffect(() => {
    void load();
  }, []);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
      setError('');
      await load();
    } catch (failure) {
      if (failure instanceof HttpError) setError(failure.message);
    }
  };

  return (
    <Shell label="Share" onClose={props.onClose} wide>
      <RoleAccordion doc={session.display} />
      {error ? <p class="field-error">{error}</p> : null}
      <section class="share-section">
        <h3>Invite someone</h3>
        <div class="form-row">
          <label class="field-col">
            <span>Invite username</span>
            <input type="text" aria-label="Invite username" value={invitee} onInput={(e) => setInvitee(e.currentTarget.value.trim().toLowerCase())} />
          </label>
          <label class="field-col">
            <span>Role</span>
            <select aria-label="Role" value={inviteRole} onChange={(e) => setInviteRole(e.currentTarget.value)}>
              <option value="editor">Editor</option>
              <option value="commenter">Commenter</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button type="button" class="btn btn-primary" onClick={() => void run(async () => { await api('PUT', `/api/maps/${session.mapId}/members/${encodeURIComponent(invitee)}`, { role: inviteRole }); setInvitee(''); })}>
            Invite
          </button>
        </div>
        <ul aria-label="People with access" class="people-list">
          {members.map((member) => (
            <li key={member.username}>
              <span class="person-name">{member.username}</span>
              {member.role === 'owner' ? (
                <span class="muted">Owner</span>
              ) : (
                <>
                  <select aria-label={`Role for ${member.username}`} value={member.role} onChange={(e) => {
                    const role = e.currentTarget.value;
                    setMembers(members.map((m) => (m.username === member.username ? { ...m, role } : m)));
                    void run(() => api('PUT', `/api/maps/${session.mapId}/members/${encodeURIComponent(member.username)}`, { role }));
                  }}>
                    <option value="editor">Editor</option>
                    <option value="commenter">Commenter</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button type="button" class="btn btn-secondary btn-small" aria-label={`Remove ${member.username}`} onClick={() => void run(() => api('DELETE', `/api/maps/${session.mapId}/members/${encodeURIComponent(member.username)}`))}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section class="share-section">
        <h3>Share links</h3>
        <div class="form-row">
          <label class="field-col">
            <span>Link role</span>
            <select aria-label="Link role" value={linkRole} onChange={(e) => setLinkRole(e.currentTarget.value)}>
              <option value="editor">Editor</option>
              <option value="commenter">Commenter</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label class="field-col">
            <span>Expires</span>
            <input type="datetime-local" aria-label="Expires" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />
          </label>
          <button type="button" class="btn btn-primary" onClick={() => void run(async () => { await api('POST', `/api/maps/${session.mapId}/links`, { role: linkRole, expires_at: expires ? new Date(expires).toISOString() : null }); setExpires(''); })}>
            Create link
          </button>
        </div>
        <ul aria-label="Share links" class="link-list">
          {links.map((link) => (
            <li key={link.id}>
              <div>
                <span class="link-url">{`${window.location.origin}${link.url}`}</span>
                <span class="muted">
                  {' '}
                  {link.role}, {link.state === 'active' ? 'active' : link.state === 'expired' ? 'expired' : 'turned off'}
                  {link.expires_at ? `, expires ${new Date(link.expires_at).toLocaleString()}` : ', no expiry'}
                </span>
              </div>
              {link.state === 'active' ? (
                <div class="link-actions">
                  <button type="button" class="btn btn-secondary btn-small" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${link.url}`)}>
                    Copy link
                  </button>
                  <button type="button" class="btn btn-secondary btn-small" onClick={() => void run(() => api('POST', `/api/maps/${session.mapId}/links/${link.id}/regenerate`))}>
                    Regenerate
                  </button>
                  <button type="button" class="btn btn-secondary btn-small" onClick={() => void run(() => api('DELETE', `/api/maps/${session.mapId}/links/${link.id}`))}>
                    Turn off
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

// ------------------------------------------------------------------ History

export function HistoryDialog(props: { session: MapSession; onClose: () => void }) {
  const { session } = props;
  useSession(session);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [at, setAt] = useState(0);
  useLayoutEffect(() => {
    void api<{ versions: VersionInfo[] }>('GET', `/api/maps/${session.mapId}/versions`).then((r) => {
      setVersions(r.versions);
      setAt(r.versions.length);
    });
  }, [session.versionsTick]);
  const chosen = versions[at - 1];
  return (
    <Shell label="History" onClose={props.onClose}>
      {versions.length === 0 ? (
        <p class="muted">No versions yet. Save one from the toolbar.</p>
      ) : (
        <>
          <label class="field-col">
            <span>Version playback</span>
            <input
              type="range"
              aria-label="Version playback"
              min={1}
              max={versions.length}
              step={1}
              value={at}
              aria-valuetext={chosen ? `Version ${chosen.number} of ${versions.length} by ${chosen.by}` : undefined}
              onInput={(event) => setAt(Number(event.currentTarget.value))}
            />
          </label>
          {chosen ? (
            <p class="muted figure">
              {chosen.name} · {chosen.kind} · {new Date(chosen.created_at).toLocaleString()}
            </p>
          ) : null}
          <button type="button" class="btn btn-primary" onClick={() => chosen && navigate(`/m/${session.mapId}/versions/${chosen.id}`)}>
            View version
          </button>
        </>
      )}
    </Shell>
  );
}

// -------------------------------------------------------------- Save version

export function SaveVersionDialog(props: { session: MapSession; onClose: () => void }) {
  const { session } = props;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api<{ version: VersionInfo }>('POST', `/api/maps/${session.mapId}/versions`, { name: name.trim() });
      props.onClose();
      session.notice(`Saved version ${result.version.number}.`);
    } catch (failure) {
      if (failure instanceof HttpError) setError(failure.fields.name ?? failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell label="Save version" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label class="field-col">
          <span>Version name</span>
          <input type="text" aria-label="Version name" maxLength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        {error ? <ErrorBand>{error}</ErrorBand> : null}
        <button type="submit" class="btn btn-primary" disabled={busy}>
          {busy ? <Spinner /> : null} Save
        </button>
      </form>
    </Shell>
  );
}

// ------------------------------------------------------------------- Export

export function ExportDialog(props: { session: MapSession; onClose: () => void }) {
  const { session } = props;
  useSession(session);
  const [format, setFormat] = useState<'sprig' | 'svg'>('sprig');
  const [job, setJob] = useState<ExportInfo | null>(null);
  const [error, setError] = useState('');
  const current = job ? (session.exports.get(job.id) ?? job) : null;

  const begin = async (): Promise<void> => {
    setError('');
    try {
      const result = await api<{ export: ExportInfo }>('POST', `/api/maps/${session.mapId}/exports`, { format, topic_id: null });
      setJob(result.export);
    } catch (failure) {
      if (failure instanceof HttpError) setError(failure.message);
    }
  };
  const retry = async (): Promise<void> => {
    if (!job) return;
    const result = await api<{ export: ExportInfo }>('POST', `/api/exports/${job.id}/retry`);
    session.exports.set(job.id, result.export);
    setJob(result.export);
  };

  return (
    <Shell label="Export" onClose={props.onClose}>
      <fieldset class="radio-set" disabled={current !== null && current.state !== 'ready' && current.state !== 'failed'}>
        <legend>Format</legend>
        <label class="radio">
          <input type="radio" name="export-format" checked={format === 'sprig'} onChange={() => setFormat('sprig')} /> Sprig outline
        </label>
        <label class="radio">
          <input type="radio" name="export-format" checked={format === 'svg'} onChange={() => setFormat('svg')} /> SVG picture
        </label>
      </fieldset>
      {error ? <p class="field-error">{error}</p> : null}
      <button type="button" class="btn btn-primary" onClick={() => void begin()} disabled={current !== null && current.state !== 'ready' && current.state !== 'failed'}>
        Start export
      </button>
      {current && current.state !== 'failed' ? (
        <div class="export-status">
          <progress aria-label="Export" role="progressbar" max={100} value={current.progress} aria-valuenow={current.progress} aria-valuemin={0} aria-valuemax={100} />
          <span class="figure">{current.progress}%</span>
          {current.state === 'ready' ? <p class="success">Export ready.</p> : null}
          {current.state === 'ready' ? (
            <a class="btn btn-primary" href={current.download_url ?? `/api/exports/${current.id}/download`} download>
              Download export
            </a>
          ) : null}
        </div>
      ) : null}
      {current?.state === 'failed' ? (
        <ErrorBand>
          <p>{COPY.storage_export}</p>
          <button type="button" class="btn btn-secondary" onClick={() => void retry()}>
            Retry export
          </button>
        </ErrorBand>
      ) : null}
    </Shell>
  );
}

// ------------------------------------------------------------------- Import

const HELP = [
  { q: 'What is a Sprig outline?', a: 'A plain-text file. The first line is "sprig 1", and every other line is one topic.' },
  { q: 'How do I show that one topic is under another?', a: 'Indent it by two spaces for each level below its parent. Children follow their parent.' },
  { q: 'Can topics carry more than a title?', a: 'Yes. After the title add fields, each written " | key=value": done, weight, state, priority, due, assignee, colour, icon, at and note.' },
  { q: 'What if a title contains a pipe or a backslash?', a: 'Write a backslash before it: \\| for a pipe and \\\\ for a backslash. In notes, \\n is a new line.' },
  { q: 'What happens to lines that are not indented?', a: 'The first one is the top of the branch. More lines with no indent become extra top-level topics, which are added as siblings.' },
  { q: 'Where do the topics go?', a: 'Under the topic that was selected when you pressed Import outline, as its last children. You see a preview first, and one undo takes them all out.' },
];

function HelpAccordion() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div class="help-accordion">
      <h3>Text format help</h3>
      {HELP.map((row, at) => (
        <div key={row.q} class="accordion-item">
          <h4>
            <button type="button" class="accordion-trigger" aria-expanded={open === at} onClick={() => setOpen(open === at ? null : at)}>
              {row.q}
            </button>
          </h4>
          {open === at ? <p class="accordion-panel">{row.a}</p> : null}
        </div>
      ))}
    </div>
  );
}

function PreviewTree(props: { nodes: PreviewNode[] }) {
  return (
    <ul class="preview-tree">
      {props.nodes.map((node, at) => (
        <li key={`${node.title}-${at}`}>
          {node.title}
          {node.children.length > 0 ? <PreviewTree nodes={node.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

interface Imported {
  import: { id: string; sha256: string; bytes: number; topic_count: number };
  preview: PreviewNode[];
}

export function ImportDialog(props: { session: MapSession; target: string; onClose: () => void }) {
  const { session, target } = props;
  const [reading, setReading] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState('');
  const [imported, setImported] = useState<Imported | null>(null);
  const title = session.display.topics[target]?.title ?? '';

  const choose = async (file: File): Promise<void> => {
    setReading(`Reading ${file.name}`);
    setErrors([]);
    setFailure('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setImported(await api<Imported>('POST', `/api/maps/${session.mapId}/imports`, bytes));
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      if (error.code === 'invalid_outline') setErrors(error.lines);
      else setFailure(error.message);
    } finally {
      setReading('');
    }
  };

  const graft = async (): Promise<void> => {
    if (!imported) return;
    try {
      await api('POST', `/api/maps/${session.mapId}/imports/${imported.import.id}/graft`, {
        parent_id: target,
        group_id: `g${newOpId()}`,
        base_revision: session.revision,
      });
      props.onClose();
    } catch (error) {
      if (error instanceof HttpError) setFailure(error.message);
    }
  };

  if (imported) {
    const n = imported.import.topic_count;
    return (
      <Shell label="Import preview" onClose={props.onClose}>
        <p>{`Adds ${n} ${n === 1 ? 'topic' : 'topics'} under ${title}.`}</p>
        <PreviewTree nodes={imported.preview} />
        {failure ? <p class="field-error">{failure}</p> : null}
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" onClick={() => void graft()}>
            Add to map
          </button>
          <button type="button" class="btn btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell label="Import outline" onClose={props.onClose} wide>
      <label class="file-pick field-col">
        <span>Outline file</span>
        <input
          type="file"
          aria-label="Outline file"
          accept=".txt,text/plain"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void choose(file);
          }}
        />
      </label>
      {reading ? (
        <p class="muted" role="status">
          <Spinner /> {reading}
        </p>
      ) : null}
      {failure ? (
        <ErrorBand>{failure}</ErrorBand>
      ) : null}
      {errors.length > 0 ? (
        <ErrorBand>
          <h3>This file can't be imported:</h3>
          <ul>
            {errors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </ErrorBand>
      ) : null}
      <HelpAccordion />
    </Shell>
  );
}

// -------------------------------------------------------------- Cross-link

export function LinkDialog(props: { session: MapSession; from: string; onClose: () => void }) {
  const { session, from } = props;
  const options = session.layout.order.filter((id) => id !== from).map((id) => session.display.topics[id]);
  const [to, setTo] = useState(options[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'related' | 'depends'>('related');
  const add = (): void => {
    if (!to) return;
    session.submit([{ op_id: newOpId(), kind: 'link_add', link_id: `l${newOpId().slice(0, 12)}`, from, to, label, type }]);
    props.onClose();
  };
  return (
    <Shell label="Add cross-link" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <label class="field-col">
          <span>Link to</span>
          <select aria-label="Link to" value={to} onChange={(e) => setTo(e.currentTarget.value)}>
            {options.map((topic) =>
              topic ? (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ) : null,
            )}
          </select>
        </label>
        <label class="field-col">
          <span>Label</span>
          <input type="text" aria-label="Label" maxLength={40} value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
        </label>
        <fieldset class="radio-set" role="radiogroup" aria-label="Type">
          <legend>Type</legend>
          <label class="radio">
            <input type="radio" name="link-type" checked={type === 'related'} onChange={() => setType('related')} /> Related
          </label>
          <label class="radio">
            <input type="radio" name="link-type" checked={type === 'depends'} onChange={() => setType('depends')} /> Depends on
          </label>
        </fieldset>
        <button type="submit" class="btn btn-primary">
          Add link
        </button>
      </form>
    </Shell>
  );
}

// ------------------------------------------------------------ Session expiry

export function SessionDialog(props: { session: MapSession }) {
  const { session } = props;
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('POST', '/api/auth/login', { username: session.me.name, password });
      session.resumeSession();
    } catch (failure) {
      if (failure instanceof HttpError) setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="Sign in again" dismissible={false} onClose={() => undefined}>
      <div class="dialog-body">
        <h2 class="dialog-title">Sign in again</h2>
        <p>Your session ended. Sign in again to keep your changes.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label class="field-col">
            <span>Password</span>
            <input type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
          </label>
          {error ? <p class="field-error">{error}</p> : null}
          <button type="submit" class="btn btn-primary" disabled={busy}>
            {busy ? <Spinner /> : null} Sign in
          </button>
        </form>
      </div>
    </Modal>
  );
}
