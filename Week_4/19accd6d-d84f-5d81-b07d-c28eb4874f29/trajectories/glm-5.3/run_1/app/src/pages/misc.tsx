import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, HttpError } from '../lib/api.js';
import type { Team } from '../../shared/protocol.js';
import { formatUtcDate } from '../../shared/text.js';
import { Dialog } from '../ui/primitives.js';
import { Icon } from '../ui/icons.js';

function Pane({ title, children, wide }: { title?: string; children: ReactNode; wide?: boolean }): ReactNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16, overflow: 'auto' }}>
      <section className="pane" aria-label={title} style={{ width: '100%', maxWidth: wide ? 720 : 440, height: wide ? '100%' : 'auto', maxHeight: wide ? undefined : 560 }}>
        {title ? (
          <div className="pane-title"><h2>{title}</h2></div>
        ) : null}
        {children}
      </section>
    </div>
  );
}

export function ImportPage({ signal }: { signal: number }): ReactNode {
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('personal');
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [reportLines, setReportLines] = useState<string[]>([]);
  const [reportRecipe, setReportRecipe] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    void api.me().then((r) => setTeams(r.teams.map((t) => ({ id: t.id, name: t.name })))).catch(() => undefined);
  }, []);

  const doImport = useCallback(async (fileText: string) => {
    setBusy(true);
    setReport(null);
    setReportLines([]);
    setReportRecipe(null);
    try {
      const r = await api.importText(fileText, owner === 'personal' ? { type: 'user' } : { type: 'team', id: owner });
      const imp = r.import;
      if (imp.status === 'created') {
        const count = imp.lineCount ?? 0;
        setReport(`Created ${imp.recipe?.name} (version 1) from ${count} ${count === 1 ? 'line' : 'lines'}.`);
        setReportRecipe({ id: imp.recipe!.id, name: imp.recipe!.name });
      } else {
        setReport(imp.message ?? 'Already imported. Nothing was created.');
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 422) {
        setReport(e.message);
        setReportLines((e.details?.lines as string[]) ?? []);
      } else {
        setReport(e instanceof HttpError ? e.message : 'Import failed.');
      }
    } finally {
      setBusy(false);
    }
  }, [owner]);

  return (
    <Pane wide title="Import recipes">
      <div className="pane-body" style={{ display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
        <textarea
          className="editor"
          aria-label="Wring Line text"
          placeholder="wringline 1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minHeight: 180, border: '1px solid var(--divider)', flex: 1 }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.onchange = () => {
              const f = input.files?.[0];
              if (f) void f.text().then((t) => { setText(t); void doImport(t); });
            };
            input.click();
          }}>
            <Icon name="file" /> Choose file
          </button>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <span className="sr-only">Save to</span>
            <select aria-label="Save to" value={owner} onChange={(e) => setOwner(e.target.value)} style={{ padding: 6, border: '1px solid var(--divider)' }}>
              <option value="personal">Personal</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <button className="btn primary" aria-busy={busy} disabled={busy} onClick={() => void doImport(text)}>Import</button>
        </div>
        {report !== null ? (
          <div role="region" aria-label="Import report" style={{ border: '1px solid var(--divider)', padding: 10, background: 'var(--surface)' }}>
            <div style={{ fontSize: 13.5 }}>{report}</div>
            {reportRecipe !== null ? <a href={`/w?recipe=${reportRecipe.id}&version=1`} onClick={() => { /* navigation handled by the shell */ }}>Open in workbench</a> : null}
            {reportLines.length > 0 ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 12.5, color: 'var(--danger)' }}>
                {reportLines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pane-status">{signal >= 0 ? '' : ''}</div>
    </Pane>
  );
}

export function TeamPage(): ReactNode {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');
  const [announce, setAnnounce] = useState('');
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [inviteTeam, setInviteTeam] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [removeMember, setRemoveMember] = useState<{ teamId: string; userId: string; displayName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api.me();
      const loaded: Team[] = [];
      for (const t of me.teams) {
        const r = await api.team(t.id);
        loaded.push({ ...r.team, role: t.role } as Team & { role: string });
      }
      setTeams(loaded);
    } catch { setTeams([]); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const invite = useCallback(async (teamId: string, email: string) => {
    setBusy(true);
    try {
      await api.invite(teamId, email);
      setAnnounce(`Invite sent to ${email}.`);
      setInviteTeam(null);
      setInviteEmail('');
      await load();
    } catch (e) {
      setAnnounce(e instanceof HttpError ? e.message : 'Invite failed.');
    } finally { setBusy(false); }
  }, [load]);

  return (
    <Pane wide title="Team settings">
      <div className="pane-body" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="text" aria-label="Team name" placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, padding: 7, border: '1px solid var(--divider)' }} />
          <button className="btn primary" aria-busy={busy} disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.createTeam(name);
              setName('');
              setAnnounce(`Team ${name} created.`);
              await load();
            } catch (e) { setAnnounce(e instanceof HttpError ? e.message : 'Team creation failed.'); } finally { setBusy(false); }
          }}>Create team</button>
        </div>
        {teams.map((t) => (
          <div key={t.id} style={{ border: '1px solid var(--divider)' }}>
            <button className="family-header" aria-expanded={openTeam === t.id} aria-controls={`team-${t.id}`} onClick={() => setOpenTeam(openTeam === t.id ? null : t.id)}>
              <span>{t.name}</span>
              <Icon name={openTeam === t.id ? 'chevronDown' : 'chevronRight'} />
            </button>
            {openTeam === t.id ? (
              <div id={`team-${t.id}`}>
                <ul role="list" aria-label={`Members of ${t.name}`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {t.members.map((m) => (
                    <li key={m.id} className="list-row" role="listitem" aria-label={m.displayName}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="name">{m.displayName}</div>
                        <div className="meta">{m.email} · {m.role}</div>
                      </div>
                      {t.owner.id !== m.id ? (
                        <button className="btn" aria-label={`Remove ${m.displayName}`} onClick={() => setRemoveMember({ teamId: t.id, userId: m.id, displayName: m.displayName })}>Remove</button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {t.owner.id === (t as Team & { role?: string }).owner.id ? (
                  <div style={{ padding: 10, borderTop: '1px solid var(--divider)' }}>
                    <button className="btn" aria-label="Invite teammate" onClick={() => setInviteTeam(t.id)}>Invite teammate</button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {teams.length === 0 ? <div className="empty-state">No teams yet. Create one above.</div> : null}
      </div>
      <div className="pane-status" role="status" aria-label="Team announcements">{announce}</div>
      {inviteTeam !== null ? (
        <Dialog title="Invite teammate" label="invite" onClose={() => setInviteTeam(null)}>
          <div className="field">
            <label>Email</label>
            <input type="text" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} aria-label="Email" />
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setInviteTeam(null)}>Cancel</button>
            <button className="btn primary" aria-busy={busy} disabled={busy} onClick={() => void invite(inviteTeam, inviteEmail)}>Send invite</button>
          </div>
        </Dialog>
      ) : null}
      {removeMember !== null ? (
        <Dialog title="Remove teammate" label="remove" onClose={() => setRemoveMember(null)}>
          <p style={{ fontSize: 13.5 }}>Remove {removeMember.displayName} from the team?</p>
          <div className="actions">
            <button className="btn" onClick={() => setRemoveMember(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              await api.removeMember(removeMember.teamId, removeMember.userId).catch(() => undefined);
              setAnnounce(`Removed ${removeMember.displayName}.`);
              setRemoveMember(null);
              await load();
            }}>Remove</button>
          </div>
        </Dialog>
      ) : null}
    </Pane>
  );
}

export function SnapshotPage({ token }: { token: string }): ReactNode {
  const [snapshot, setSnapshot] = useState<import('../../shared/protocol.js').Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.snapshot(token);
      setSnapshot(r.snapshot);
      setError(null);
    } catch (e) {
      setError(e instanceof HttpError ? e.message : 'Snapshot unavailable.');
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, [load]);

  const statusLine = snapshot
    ? snapshot.status === 'pending'
      ? 'Pending: storage has not confirmed the input yet.'
      : snapshot.status === 'active'
        ? `Active until ${formatUtcDate(snapshot.expiresAt)}.`
        : snapshot.status === 'expired'
          ? 'This snapshot expired.'
          : 'This snapshot was revoked.'
    : error ?? 'Loading…';

  const badge = snapshot ? snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1) : '…';

  return (
    <Pane wide title="Shared snapshot">
      <div className="pane-body" style={{ display: 'flex', flexDirection: 'column', padding: 12, gap: 10 }}>
        <div role="status" aria-label="Snapshot status" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="span-chip">{badge}</span>
          <span style={{ fontSize: 13 }}>{statusLine}</span>
        </div>
        {snapshot && snapshot.recipe ? (
          <>
            <div>
              <strong>{snapshot.recipe.name}</strong>
            </div>
            <ol role="list" aria-label="Recipe steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {snapshot.recipe.steps.map((s, i) => (
                <li key={i} role="listitem" className="list-row" aria-label={`Step ${i + 1}: ${s.op}`}>
                  <span className="num">{i + 1}</span>
                  <span className="name">{s.op}</span>
                  {s.disabled ? <span className="meta">disabled</span> : null}
                </li>
              ))}
            </ol>
            <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>Input</label>
            <textarea className="editor" aria-label="Input" readOnly style={{ minHeight: 90, border: '1px solid var(--divider)' }} />
            <label style={{ fontSize: 12.5, color: 'var(--muted)' }}>Output</label>
            <textarea className="editor" aria-label="Output" readOnly style={{ minHeight: 90, border: '1px solid var(--divider)' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn" onClick={async () => {
                await load();
                try {
                  const res = await api.snapshotInput(token);
                  if (!res.ok) throw new Error('Download failed');
                  const bytes = new Uint8Array(await res.arrayBuffer());
                  download(bytes, 'input.bin');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Download failed.');
                }
              }}>
                <Icon name="download" /> Download input
              </button>
              <button className="btn" onClick={async () => {
                await load();
                try {
                  const res = await api.snapshotOutput(token);
                  if (!res.ok) throw new Error('Download failed');
                  const bytes = new Uint8Array(await res.arrayBuffer());
                  download(bytes, 'output.bin');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Download failed.');
                }
              }}>
                <Icon name="download" /> Download output
              </button>
            </div>
          </>
        ) : null}
        {error ? <div className="pane-alert" role="alert">{error}</div> : null}
      </div>
      <div className="pane-status">Read-only share</div>
    </Pane>
  );
}

function download(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
