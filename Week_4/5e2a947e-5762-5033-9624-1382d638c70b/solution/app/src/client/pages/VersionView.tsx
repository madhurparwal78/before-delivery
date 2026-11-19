import { useLayoutEffect, useState } from 'preact/hooks';
import type { MapPayload, VersionInfo } from '../../shared/model.ts';
import { docOfSnapshot, type Snapshot, type VersionDiff } from '../../shared/snapshot.ts';
import { can } from '../../shared/rules.ts';
import { HttpError, api } from '../api.ts';
import { Canvas, type CanvasActions } from '../editor/Canvas.tsx';
import { Glyph } from '../editor/glyphs.tsx';
import { Announcer, Notices } from '../editor/Overlays.tsx';
import { MapSession, payloadFromDoc } from '../editor/session.ts';
import { location$, navigate } from '../router.ts';
import { useSignal } from '../signal.ts';
import { InboxButton } from '../ui/InboxButton.tsx';
import { Spinner } from '../ui/Spinner.tsx';

type Shown = Snapshot & { version: VersionInfo };

const NO_ACTIONS: CanvasActions = {
  openMenu: () => undefined,
  openFind: () => undefined,
  focusBranch: () => undefined,
  openLink: () => undefined,
  addBoundary: () => undefined,
  openComment: () => undefined,
};

function marksOf(diff: VersionDiff): Map<string, string> {
  const marks = new Map<string, string>();
  for (const id of diff.added) marks.set(id, 'added');
  for (const id of diff.moved) marks.set(id, 'moved');
  for (const id of diff.edited) marks.set(id, marks.get(id) === 'moved' ? 'moved edited' : 'edited');
  return marks;
}

export function VersionView(props: { mapId: string; versionId: string }) {
  const search = useSignal(location$);
  const compare = new URLSearchParams(search.split('?')[1] ?? '').get('compare') ?? '';
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [other, setOther] = useState<Shown | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [session, setSession] = useState<MapSession | null>(null);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    void (async () => {
      try {
        const [list, version, map] = await Promise.all([
          api<{ versions: VersionInfo[] }>('GET', `/api/maps/${props.mapId}/versions`),
          api<Shown>('GET', `/api/maps/${props.mapId}/versions/${props.versionId}`),
          api<MapPayload>('GET', `/api/maps/${props.mapId}`),
        ]);
        setVersions(list.versions);
        setShown(version);
        setOwner(can(map.map.role, 'restore'));
        const doc = docOfSnapshot(version);
        const next = new MapSession(payloadFromDoc(doc, { mapId: props.mapId, title: map.map.title, revision: version.revision, me: map.me, today: map.server_date }));
        setSession(next);
      } catch (error) {
        if (error instanceof HttpError && (error.code === 'unauthenticated' || error.code === 'session_expired')) navigate('/signin', { replace: true });
        else navigate('/maps', { replace: true });
      }
    })();
  }, [props.mapId, props.versionId]);

  useLayoutEffect(() => {
    if (!compare || !shown || !session) {
      setDiff(null);
      setOther(null);
      if (session) {
        session.diffMarks = new Map();
        session.notify();
      }
      return;
    }
    void (async () => {
      const [first, second] = await Promise.all([
        api<Shown>('GET', `/api/maps/${props.mapId}/versions/${compare}`),
        Promise.resolve(shown),
      ]);
      const [from, to] = first.version.number < second.version.number ? [first, second] : [second, first];
      const result = await api<VersionDiff>('GET', `/api/maps/${props.mapId}/versions/diff?from=${from.version.id}&to=${to.version.id}`);
      setOther(first);
      setDiff(result);
      session.diffMarks = marksOf(result);
      session.notify();
    })();
  }, [compare, shown, session]);

  if (!shown || !session) {
    return (
      <main class="loading" aria-busy="true">
        <p role="status">Loading version</p>
      </main>
    );
  }

  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api<{ version: VersionInfo }>('POST', `/api/maps/${props.mapId}/versions/${shown.version.id}/restore`);
      session.notice(`Restored version ${shown.version.number}.`);
      setVersions([...versions, result.version]);
    } catch (error) {
      if (error instanceof HttpError) session.notice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const titleOf = (id: string): string => shown.topics.find((t) => t.id === id)?.title ?? other?.topics.find((t) => t.id === id)?.title ?? id;
  return (
    <div class="editor kind-desk version-view">
      <Announcer session={session} />
      <header class="editor-bar">
        <a class="editor-bar-back" href={`/m/${props.mapId}`} onClick={(event) => { event.preventDefault(); navigate(`/m/${props.mapId}`); }}>
          <Glyph name="chevron" size={16} /> Back to the map
        </a>
        <h1 class="editor-bar-title">{session.header.title}</h1>
        <InboxButton />
      </header>
      <div class="version-bar">
        <p class="notice-band" role="status">
          <Glyph name="eye" size={20} />
          <span>{`This is version ${shown.version.number}. Read only.`}</span>
        </p>
        <label class="field-col">
          <span>Compare with</span>
          <select
            aria-label="Compare with"
            value={compare}
            onChange={(event) => navigate(`/m/${props.mapId}/versions/${props.versionId}${event.currentTarget.value ? `?compare=${event.currentTarget.value}` : ''}`, { replace: true })}
          >
            <option value="">No comparison</option>
            {versions
              .filter((v) => v.id !== props.versionId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {`Version ${v.number}: ${v.name}`}
                </option>
              ))}
          </select>
        </label>
        {owner ? (
          <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void restore()}>
            {busy ? <Spinner /> : null} Restore this version
          </button>
        ) : null}
      </div>
      {diff ? (
        <div role="region" aria-label="Changes" class="changes">
          <p class="figure">{diff.summary}</p>
          <ul aria-label="Removed topics" class="removed-list">
            {diff.removed.map((id) => (
              <li key={id} data-diff="removed">
                {titleOf(id)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div class="workspace">
        <div class="canvas-wrap">
          <div class="overlays">
            <Notices session={session} />
          </div>
          <Canvas session={session} actions={NO_ACTIONS} />
        </div>
      </div>
    </div>
  );
}
