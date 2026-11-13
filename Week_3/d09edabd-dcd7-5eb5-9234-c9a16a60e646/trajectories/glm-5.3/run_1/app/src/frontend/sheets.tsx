import { useEffect, useRef, useState } from 'react';
import type { Debrief, Prop, Session, TriggerNode, Version, Placement } from '../shared/types.js';
import { COPY } from '../shared/copy.js';
import { mmss, mss, cardFigures } from '../shared/index.js';
import { Dialog, Icon } from './ui.jsx';

export interface FieldErrors { [field: string]: string }

/** Trigger graph sheet (DP-23). */
export function TriggerGraphSheet(props: {
  onClose: () => void;
  nodes: TriggerNode[];
  placements: Placement[];
  selectedNodeId: string | null;
  holderName: string | null;
  onSelectNode: (id: string) => void;
  onSave: (id: string, fields: Partial<TriggerNode>) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}): JSX.Element {
  const { nodes, selectedNodeId } = props;
  const selected = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const [title, setTitle] = useState(selected?.title ?? '');
  const [kind, setKind] = useState<TriggerNode['kind']>(selected?.kind ?? 'puzzle');
  const [prereq, setPrereq] = useState<string[]>(selected?.prerequisites ?? []);
  const [placementId, setPlacementId] = useState(selected?.placementId ?? '');
  const [answer, setAnswer] = useState(selected?.answer ?? '');

  useEffect(() => {
    setTitle(selected?.title ?? '');
    setKind(selected?.kind ?? 'puzzle');
    setPrereq(selected?.prerequisites ?? []);
    setPlacementId(selected?.placementId ?? '');
    setAnswer(selected?.answer ?? '');
  }, [selected?.id, selected?.version]);

  const hasExit = nodes.some((n) => n.kind === 'exit');
  const readOnly = !!props.holderName;

  return (
    <Dialog label="Trigger graph" onClose={props.onClose} variant="side">
      <div className="sheet-head">
        <h2>Trigger graph</h2>
        <button className="cluster-btn" aria-label="Close" onClick={props.onClose}><Icon name="x" /></button>
      </div>
      {props.holderName && <p className="muted">{props.holderName} is holding this node.</p>}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <ul role="list" aria-label="Trigger nodes" style={{ listStyle: 'none' }}>
          {nodes.map((n) => (
            <li key={n.id} style={{ marginBottom: 8 }}>
              <button
                role="button"
                aria-pressed={n.id === selectedNodeId}
                className={`node-card${n.id === selectedNodeId ? ' selected' : ''}`}
                onClick={() => props.onSelectNode(n.id)}
              >
                <span className="title">{n.title}</span>
                <span className="kind">{n.kind}</span>
                {n.prerequisites.length > 0 && (
                  <span className="wires">
                    {'-> ' + n.prerequisites.map((p) => nodes.find((x) => x.id === p)?.title ?? p).join(' -> ') + ' -> ' + n.title}
                  </span>
                )}
              </button>
            </li>
          ))}
          {!nodes.length && <li className="muted">No nodes yet.</li>}
        </ul>
      </div>
      <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
        {selected ? (
          <fieldset disabled={readOnly} style={{ border: 'none' }}>
            <div className="field">
              <label htmlFor="node-title">Node title</label>
              <input id="node-title" value={title} onChange={(e) => setTitle(e.target.value)} readOnly={readOnly} />
            </div>
            <div className="field">
              <label htmlFor="node-kind">Node kind</label>
              <select
                id="node-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as TriggerNode['kind'])}
                disabled={readOnly}
              >
                <option value="puzzle">puzzle</option>
                <option value="lock">lock</option>
                <option value="cue">cue</option>
                <option value="exit">exit</option>
              </select>
            </div>
            <fieldset role="group" aria-label="Prerequisites" style={{ border: 'none', marginBottom: 10 }}>
              <legend className="muted" style={{ fontSize: 12 }}>Prerequisites</legend>
              {nodes.filter((n) => n.id !== selected.id).map((n) => (
                <label key={n.id} className="checkbox-line" style={{ minHeight: 30 }}>
                  <input
                    type="checkbox"
                    checked={prereq.includes(n.id)}
                    disabled={readOnly}
                    aria-label={n.title}
                    onChange={(e) => setPrereq((p) => (e.target.checked ? [...p, n.id] : p.filter((x) => x !== n.id)))}
                  />
                  {n.title}
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="node-placement">Linked placement</label>
              <select id="node-placement" value={placementId} onChange={(e) => setPlacementId(e.target.value)} disabled={readOnly}>
                <option value="">(none)</option>
                {props.placements.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            {(kind === 'puzzle' || kind === 'exit') && (
              <div className="field">
                <label htmlFor="node-answer">Answer</label>
                <input id="node-answer" value={answer ?? ''} onChange={(e) => setAnswer(e.target.value)} disabled={readOnly} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="cluster-btn" onClick={() => props.onSave(selected.id, {
                title, kind,
                prerequisites: prereq,
                placementId: placementId || null,
                answer: (kind === 'puzzle' || kind === 'exit') ? answer : null,
              })}>Save node</button>
              <button className="cluster-btn" onClick={() => props.onDelete(selected.id)}>Delete node</button>
            </div>
          </fieldset>
        ) : (
          <button className="cluster-btn" onClick={props.onAdd}>Add node</button>
        )}
        {!selected && <p className="muted" style={{ marginTop: 8 }}>Select a node, or add one.</p>}
        {hasExit && selected?.kind !== 'exit' && <p className="muted" style={{ marginTop: 6 }}>This room already has an exit.</p>}
      </div>
    </Dialog>
  );
}

/** Prop library sheet (DP-26). */
export function PropLibrarySheet(props: {
  onClose: () => void;
  props_: Prop[];
  onUpload: (form: FormData) => Promise<void>;
  onPlace: (prop: Prop) => void;
  onDelete: (prop: Prop) => void;
  pending: Array<{ name: string }>;
  focusFile: boolean;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [depth, setDepth] = useState('');
  const [height, setHeight] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.focusFile) fileRef.current?.focus();
  }, [props.focusFile]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!file || !name || !width || !depth || !height) return;
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    form.append('widthMm', String(Math.round(parseFloat(width) * 1000)));
    form.append('depthMm', String(Math.round(parseFloat(depth) * 1000)));
    form.append('heightMm', String(Math.round(parseFloat(height) * 1000)));
    await props.onUpload(form);
    setFile(null); setName(''); setWidth(''); setDepth(''); setHeight('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Dialog label="Prop library" onClose={props.onClose}>
      <div className="sheet-head">
        <h2>Prop library</h2>
        <button className="cluster-btn" aria-label="Close" onClick={props.onClose}><Icon name="x" /></button>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="prop-file">glTF file</label>
          <input id="prop-file" type="file" accept=".glb,.gltf" ref={fileRef} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="prop-name">Prop name</label>
            <input id="prop-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field"><label htmlFor="prop-w">Width (m)</label>
            <input id="prop-w" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} /></div>
          <div className="field"><label htmlFor="prop-d">Depth (m)</label>
            <input id="prop-d" inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} /></div>
          <div className="field"><label htmlFor="prop-h">Height (m)</label>
            <input id="prop-h" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /></div>
        </div>
        <button className="cluster-btn primary" type="submit" disabled={!file || !name}>Upload</button>
      </form>
      <hr style={{ border: 'none', borderTop: '1px solid var(--hairline)', margin: '14px 0' }} />
      <ul role="list" aria-label="Props" style={{ listStyle: 'none' }}>
        {props.pending.map((p, i) => (
          <li key={`pending-${i}`} className="card" style={{ marginBottom: 8, padding: 10 }}>
            <span className="muted">{COPY.uploadPending(p.name)}</span>
          </li>
        ))}
        {props.props_.map((p) => (
          <li key={p.id} className="card" style={{ marginBottom: 8, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>
              <strong>{p.name}</strong>
              <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                {p.widthMm} × {p.depthMm} × {p.heightMm} mm · {(p.bytes / 1000).toFixed(1)} kB
              </span>
            </span>
            <span style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button className="cluster-btn" aria-label={`Place ${p.name}`} onClick={() => props.onPlace(p)}>Place</button>
              <button className="cluster-btn" aria-label={`Delete ${p.name}`} onClick={() => props.onDelete(p)}>
                <Icon name="trash-2" />
              </button>
            </span>
          </li>
        ))}
        {!props.props_.length && !props.pending.length && (
          <li className="muted" style={{ padding: '16px 0', textAlign: 'center' }}>{COPY.emptyLibrary}</li>
        )}
      </ul>
    </Dialog>
  );
}

/** Versions sheet (DP-46). */
export function VersionsSheet(props: {
  onClose: () => void;
  versions: Version[];
  isOwner: boolean;
  onFreeze: (label: string) => void;
  onCopy: (v: Version) => void;
  onRegenerate: (v: Version) => void;
  onRevoke: (v: Version) => void;
  freezeBusy: boolean;
  focusCopy?: string | null;
  focusLabel?: boolean;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const labelRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (props.focusCopy) copyRef.current?.focus();
    else if (props.focusLabel) labelRef.current?.focus();
  }, [props.focusCopy, props.focusLabel]);
  return (
    <Dialog label="Versions" onClose={props.onClose}>
      <div className="sheet-head">
        <h2>Versions</h2>
        <button className="cluster-btn" aria-label="Close" onClick={props.onClose}><Icon name="x" /></button>
      </div>
      {props.isOwner && (
        <form onSubmit={(e) => { e.preventDefault(); if (label) props.onFreeze(label); }} style={{ marginBottom: 14 }}>
          <div className="row">
            <div className="field">
              <label htmlFor="version-label">Version label</label>
              <input id="version-label" ref={labelRef} value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <button className="cluster-btn primary" type="submit" disabled={!label || props.freezeBusy} style={{ alignSelf: 'flex-end' }}>
              Freeze version
            </button>
          </div>
        </form>
      )}
      <ul role="list" aria-label="Version cards" style={{ listStyle: 'none' }}>
        {props.versions.map((v) => (
          <VersionCard key={v.id} v={v} isOwner={props.isOwner} onCopy={props.onCopy} onRegenerate={props.onRegenerate} onRevoke={props.onRevoke} focusRef={props.focusCopy === v.id ? copyRef : undefined} />
        ))}
      </ul>
    </Dialog>
  );
}

function VersionCard(props: {
  v: Version;
  isOwner: boolean;
  onCopy: (v: Version) => void;
  onRegenerate: (v: Version) => void;
  onRevoke: (v: Version) => void;
  focusRef?: React.RefObject<HTMLButtonElement>;
}): JSX.Element {
  return (
    <li className="version-card">
      <div className="head">
        <span className="num">Version {props.v.number} — {props.v.label}</span>
        <span className="state">{props.v.state === 'frozen' ? 'Frozen' : 'Superseded'}</span>
      </div>
      <div className="figs tnum">
        {new Date(props.v.frozenAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · {cardFigures(props.v.stats)}
      </div>
      <div className="actions">
        <button ref={props.focusRef} disabled={!props.v.packUrl} onClick={() => props.onCopy(props.v)}>Copy build pack link</button>
        {props.isOwner && (
          <>
            <button onClick={() => props.onRegenerate(props.v)}>Regenerate link</button>
            <button disabled={!props.v.packUrl} onClick={() => props.onRevoke(props.v)}>Revoke link</button>
          </>
        )}
      </div>
    </li>
  );
}

/** Playtests sheet (DP-31). */
export function PlaytestsSheet(props: {
  onClose: () => void;
  sessions: Session[];
  isOwner: boolean;
  isHostOf: (s: Session) => boolean;
  onSchedule: (iso: string) => Promise<FieldErrors>;
  onInvite: (sessionId: string, email: string) => Promise<void>;
  onAction: (sessionId: string, action: 'open' | 'start' | 'end' | 'cancel') => void;
  onRevoke: (sessionId: string, inviteId: string, email: string) => void;
  onResend: (sessionId: string, inviteId: string, email: string) => void;
  onHint: (sessionId: string, text: string) => Promise<FieldErrors>;
  canControl: (s: Session) => boolean;
}): JSX.Element {
  const [start, setStart] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [hintText, setHintText] = useState<Record<string, string>>({});
  return (
    <Dialog label="Playtests" onClose={props.onClose}>
      <div className="sheet-head">
        <h2>Playtests</h2>
        <button className="cluster-btn" aria-label="Close" onClick={props.onClose}><Icon name="x" /></button>
      </div>
      {props.isOwner && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!start) return;
            // read in the browser's zone, send as UTC ISO
            const asLocal = new Date(start);
            const errs = await props.onSchedule(asLocal.toISOString());
            setErrors(errs);
          }}
          style={{ marginBottom: 14 }}
        >
          <div className="row">
            <div className="field">
              <label htmlFor="pt-start">Start time</label>
              <input id="pt-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              {errors.startsAt && <span className="error">{errors.startsAt}</span>}
            </div>
            <button className="cluster-btn primary" type="submit" disabled={!start} style={{ alignSelf: 'flex-end' }}>
              Schedule playtest
            </button>
          </div>
        </form>
      )}
      {props.sessions.map((s) => {
        const control = props.canControl(s);
        return (
          <div key={s.id} className="session-card">
            <div className="head">
              <strong>{s.roomName}</strong>
              <span className="muted tnum">{s.state} · {utcLine(s.startsAt)}</span>
            </div>
            {s.state === 'running' && (
              <div className="muted tnum" style={{ marginBottom: 6 }}>remaining {mmss(s.remainingSeconds)} · hints {s.hintsUsed} · cooldown {s.hintCooldownSeconds}s</div>
            )}
            {control && (
              <div className="actions" style={{ marginBottom: 8 }}>
                {s.state === 'scheduled' && <button className="cluster-btn" onClick={() => props.onAction(s.id, 'open')}>Open lobby</button>}
                {s.state === 'lobby' && <button className="cluster-btn" onClick={() => props.onAction(s.id, 'start')}>Start</button>}
                {s.state === 'running' && <button className="cluster-btn" onClick={() => props.onAction(s.id, 'end')}>End</button>}
                {(s.state === 'scheduled' || s.state === 'lobby') && <button className="cluster-btn" onClick={() => props.onAction(s.id, 'cancel')}>Cancel playtest</button>}
              </div>
            )}
            {(s.state === 'scheduled' || s.state === 'lobby' || s.state === 'running') && control && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const email = inviteEmail[s.id] ?? '';
                  if (email) {
                    await props.onInvite(s.id, email);
                    setInviteEmail((m) => ({ ...m, [s.id]: '' }));
                  }
                }}
                style={{ display: 'flex', gap: 8, marginBottom: 10 }}
              >
                <input
                  aria-label="Tester email"
                  placeholder="tester@example.test"
                  value={inviteEmail[s.id] ?? ''}
                  onChange={(e) => setInviteEmail((m) => ({ ...m, [s.id]: e.target.value }))}
                  style={{ flex: 1, background: 'var(--ground)', border: '1px solid var(--hairline)', borderRadius: 8, padding: '0 10px', minHeight: 44 }}
                />
                <button className="cluster-btn" type="submit" disabled={!(inviteEmail[s.id] ?? '')}>Send invite</button>
              </form>
            )}
            {s.testers.length > 0 && (
              <table aria-label="Roster">
                <thead>
                  <tr><th>Email</th><th>Joined</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {s.testers.map((t) => (
                    <tr key={t.inviteId}>
                      <td>{t.email}</td>
                      <td>{t.joined ? '✓' : '—'}</td>
                      <td>{t.emailStatus === 'sent' ? 'Sent' : t.emailStatus === 'queued' ? 'Queued' : 'Failed'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="cluster-btn" style={{ minHeight: 44 }} aria-label={`Resend ${t.email}`} onClick={() => props.onResend(s.id, t.inviteId, t.email)}>Resend</button>
                        <button className="cluster-btn" style={{ minHeight: 44 }} aria-label={`Revoke ${t.email}`} onClick={() => props.onRevoke(s.id, t.inviteId, t.email)}>Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {s.state === 'running' && control && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const text = hintText[s.id] ?? '';
                  if (text) {
                    const errs = await props.onHint(s.id, text);
                    if (errs && Object.keys(errs).length === 0) setHintText((m) => ({ ...m, [s.id]: '' }));
                  }
                }}
                style={{ display: 'flex', gap: 8, marginTop: 10 }}
              >
                <input
                  aria-label="Hint"
                  placeholder="Hint text"
                  value={hintText[s.id] ?? ''}
                  onChange={(e) => setHintText((m) => ({ ...m, [s.id]: e.target.value }))}
                  style={{ flex: 1, background: 'var(--ground)', border: '1px solid var(--hairline)', borderRadius: 8, padding: '0 10px', minHeight: 44 }}
                />
                <button className="cluster-btn" type="submit" disabled={!(hintText[s.id] ?? '')}>Send hint</button>
              </form>
            )}
            {s.state === 'running' && s.hintCooldownSeconds > 0 && (
              <div className="muted tnum" style={{ marginTop: 6 }}>
                {s.hintCooldownSeconds > 0 ? COPY.nextHintIn(mss(s.hintCooldownSeconds)) : COPY.hintReady}
              </div>
            )}
          </div>
        );
      })}
      {!props.sessions.length && <p className="muted">No playtests yet.</p>}
    </Dialog>
  );
}

function utcLine(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** Debrief dialog (DP-36, DP-38). */
export function DebriefDialog(props: {
  onClose: () => void;
  debrief: Debrief | null;
  session: Session | null;
  onClosedFocusPlay: () => void;
}): JSX.Element {
  useEffect(() => {
    // focus moves to the Play button once this dialog closes (handled by parent)
  }, []);
  const d = props.debrief;
  const outcome = d
    ? d.outcome === 'escaped'
      ? COPY.escaped(mmss(d.elapsedSeconds))
      : d.outcome === 'timed_out'
        ? COPY.outOfTime
        : COPY.stoppedAt(mmss(d.elapsedSeconds))
    : '';
  return (
    <Dialog label="Debrief" onClose={() => { props.onClose(); props.onClosedFocusPlay(); }}>
      <div className="sheet-head">
        <h2>{COPY.playtestEnded}</h2>
        <button className="cluster-btn" aria-label="Close" onClick={() => { props.onClose(); props.onClosedFocusPlay(); }}><Icon name="x" /></button>
      </div>
      {d ? (
        <>
          <p style={{ marginBottom: 8 }}>{outcome}</p>
          <p className="muted tnum" style={{ marginBottom: 14 }}>{cardFigures(d.stats)}</p>
          <table aria-label="Puzzle times" style={{ marginBottom: 12 }}>
            <thead><tr><th>Puzzle</th><th>Solved at</th><th>Wait</th></tr></thead>
            <tbody>
              {d.puzzles.map((p) => (
                <tr key={p.title}>
                  <td>{p.title}</td>
                  <td className="tnum">{p.solvedAtSeconds === null ? '—' : mmss(p.solvedAtSeconds)}</td>
                  <td className="tnum">{p.waitSeconds === null ? '—' : mmss(p.waitSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginBottom: 6 }}>Hints used: {d.hintsUsed}</p>
          <p className="muted" style={{ marginBottom: 6 }}>
            Choke point: {d.chokePoint ? `${d.chokePoint.title} (${mss(d.chokePoint.waitSeconds)} waiting)` : 'none'}
          </p>
          <p className="muted">Debrief email: {d.emailStatus === 'sent' ? 'Sent' : d.emailStatus === 'queued' ? 'Queued' : 'Failed'}</p>
        </>
      ) : (
        <p className="muted">Loading debrief...</p>
      )}
    </Dialog>
  );
}

/** Keyboard shortcuts sheet (DP-16). */
export function ShortcutsSheet(props: { onClose: () => void }): JSX.Element {
  const rows: Array<[string, string]> = [
    ['G / R / S', 'Move / Rotate / Scale mode'],
    ['] / [', 'Select next / previous placement'],
    ['Arrow keys', 'Move, rotate, scale or turn the camera'],
    ['Delete', 'Delete the selected placement'],
    ['N / Shift+N', 'Next / previous trigger node'],
    ['P', 'Start or stop a playtest'],
    ['T', 'Open or close the Trigger graph'],
    ['L', 'Open the Prop library'],
    ['D', 'Drop the selected placement to the floor'],
    ['Alt+Arrow Up / Down', 'Move the Scene item up / down'],
    ['Ctrl+Z', 'Undo your own latest change'],
    ['Ctrl+K', 'Open the Command palette'],
    ['?', 'Keyboard shortcuts'],
    ['Escape', 'Close the topmost dialog'],
  ];
  return (
    <Dialog label="Keyboard shortcuts" onClose={props.onClose}>
      <div className="sheet-head">
        <h2>Keyboard shortcuts</h2>
        <button className="cluster-btn" aria-label="Close" onClick={props.onClose}><Icon name="x" /></button>
      </div>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><td className="mono" style={{ whiteSpace: 'nowrap' }}>{k}</td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

/** New room sheet. */
export function NewRoomSheet(props: {
  onClose: () => void;
  onCreate: (name: string, w: number, d: number, h: number) => Promise<FieldErrors>;
}): JSX.Element {
  const [name, setName] = useState('');
  const [w, setW] = useState('');
  const [d, setD] = useState('');
  const [h, setH] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label="New room" onClose={props.onClose} variant="small">
      <div className="sheet-head">
        <h2>New room</h2>
        <button className="cluster-btn" aria-label="Close" onClick={props.onClose}><Icon name="x" /></button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const errs = await props.onCreate(name, Math.round(parseFloat(w) * 1000), Math.round(parseFloat(d) * 1000), Math.round(parseFloat(h) * 1000));
          setBusy(false);
          setErrors(errs);
        }}
      >
        <div className="field"><label htmlFor="nr-name">Room name</label>
          <input id="nr-name" value={name} onChange={(e) => setName(e.target.value)} />{errors.name && <span className="error">{errors.name}</span>}</div>
        <div className="row">
          <div className="field"><label htmlFor="nr-w">Width (m)</label><input id="nr-w" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} />{errors.widthMm && <span className="error">{errors.widthMm}</span>}</div>
          <div className="field"><label htmlFor="nr-d">Depth (m)</label><input id="nr-d" inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} />{errors.depthMm && <span className="error">{errors.depthMm}</span>}</div>
          <div className="field"><label htmlFor="nr-h">Height (m)</label><input id="nr-h" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} />{errors.heightMm && <span className="error">{errors.heightMm}</span>}</div>
        </div>
        <button className="cluster-btn primary" type="submit" disabled={busy || !name}>Create room</button>
      </form>
    </Dialog>
  );
}
