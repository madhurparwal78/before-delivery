import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFailure, type FollowData, type NoteData } from '../api';
import { useApp } from '../app';
import { analyse, cellKey, cellMap } from '../chartstate';
import { ChartGrid } from '../components/chartgrid';
import { Dialog } from '../components/dialog';
import { Shell } from '../shell';

const NO_STITCHES = 'This row has no stitches.';

export function FollowScreen({ id }: { id: string }): JSX.Element {
  const { config, subscribe, account, reduceMotion, layout } = useApp();
  const [data, setData] = useState<FollowData | null>(null);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [row, setRow] = useState(1);
  const [latest, setLatest] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [noteStatus, setNoteStatus] = useState('');
  const [versionStatus, setVersionStatus] = useState('');
  const [noteRow, setNoteRow] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteError, setNoteError] = useState('');
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [motion, setMotion] = useState<'row' | null>(null);
  const [noticeMotion, setNoticeMotion] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const motionTimer = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const limits = config?.limits;
  const colourLimits = useMemo(
    () => ({ coloursPerRow: limits?.coloursPerRow ?? 2, maxFloat: limits?.maxFloat ?? 5 }),
    [limits?.coloursPerRow, limits?.maxFloat],
  );
  const cells = useMemo(() => (data ? cellMap(data.cells) : new Map()), [data]);
  const analysis = useMemo(
    () => (data ? analyse({ ...data, cells: data.cells }, colourLimits) : null),
    [data, colourLimits],
  );

  const load = async (): Promise<void> => {
    const follow = await api.get<FollowData>(`/api/patterns/${id}/follow`);
    setData(follow);
    setRow(follow.row);
    setLatest(follow.latestVersion);
    const mine = await api.get<{ notes: NoteData[] }>(`/api/patterns/${id}/notes`);
    setNotes(mine.notes.filter((note) => note.version === follow.version));
  };

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 404) setMissing(true);
        else setFailed(true);
      }
    })();
  }, [id]);

  useEffect(
    () =>
      subscribe((message) => {
        if (message.kind === 'counter' && message.userId === account?.id) {
          setRow(Number(message.row));
        }
        if (message.kind === 'version') {
          setLatest(Number(message.version));
        }
        if (message.kind === 'note' && message.userId === account?.id) {
          setNotes((current) => [
            ...current,
            {
              row: Number(message.row),
              text: String(message.text),
              tester: String(message.tester),
              version: Number(message.version),
            },
          ]);
        }
      }),
    [account?.id, subscribe],
  );

  const lineFor = (which: number): string => {
    const found = data?.rows.find((entry) => entry.row === which);
    return found && found.text !== '' ? found.text : NO_STITCHES;
  };

  useEffect(() => {
    if (!data) return;
    setAnnouncement(lineFor(row));
    if (motionTimer.current) window.clearTimeout(motionTimer.current);
    const area = scroll.current;
    const target = area?.querySelector<HTMLElement>(`[data-row="${row}"]`);
    if (area && target) {
      const areaBox = area.getBoundingClientRect();
      const rowBox = target.getBoundingClientRect();
      area.scrollTop += rowBox.top + rowBox.height / 2 - (areaBox.top + areaBox.height / 2);
    }
    if (!reduceMotion) {
      setMotion('row');
      motionTimer.current = window.setTimeout(() => setMotion(null), limits?.rowMotionMs ?? 200);
    }
  }, [row, data, reduceMotion, limits?.rowMotionMs]);

  useEffect(() => {
    if (!data) return;
    if (latest > data.version) {
      setVersionStatus(`Version ${latest} is out. You are following version ${data.version}.`);
      if (!reduceMotion) {
        setNoticeMotion(true);
        window.setTimeout(() => setNoticeMotion(false), 250);
      }
    } else {
      setVersionStatus(`Version ${data.version}`);
    }
  }, [latest, data?.version, reduceMotion, data]);

  const stepRef = useRef<(direction: 1 | -1) => void>(() => undefined);

  const step = async (direction: 1 | -1): Promise<void> => {
    if (!data) return;
    const from = row;
    const next = from + direction;
    if (next < 1 || next > data.height) return;
    const moved = await api.post<{ row: number }>(`/api/patterns/${id}/counter`, {
      from,
      step: direction,
      stepId: crypto.randomUUID(),
    });
    setRow(moved.row);
  };

  stepRef.current = (direction) => void step(direction);

  useEffect(() => {
    const onKeys = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === 'n') {
        event.preventDefault();
        stepRef.current(1);
        return;
      }
      if (event.key === 'p') {
        event.preventDefault();
        stepRef.current(-1);
        return;
      }
      if (event.key === ' ' && tag !== 'BUTTON') {
        event.preventDefault();
        stepRef.current(1);
      }
    };
    window.addEventListener('keydown', onKeys);
    return () => window.removeEventListener('keydown', onKeys);
  }, []);

  const moveVersion = async (): Promise<void> => {
    setBusy(true);
    try {
      const moved = await api.post<{ version: number; row: number; movedFrom: number | null }>(
        `/api/patterns/${id}/follow`,
        { version: latest },
      );
      await load();
      setVersionStatus(
        moved.movedFrom === null
          ? `Version ${moved.version}`
          : `Version ${moved.version}. Row ${moved.movedFrom} is not in this version.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (): Promise<void> => {
    if (noteRow === null) return;
    setBusy(true);
    try {
      await api.post(`/api/patterns/${id}/notes`, { row: noteRow, text: noteText });
      setNoteStatus(`Note saved on row ${noteRow}.`);
      setNoteError('');
      setNoteRow(null);
      setNoteText('');
    } catch (failure) {
      if (failure instanceof ApiFailure) setNoteError(failure.body.message ?? '');
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <Shell lead="This page is not here.">
        <h1>Not found.</h1>
      </Shell>
    );
  }
  if (failed) return <Shell lead="This page could not be loaded. Reload to try again." />;
  if (!data || !analysis) return <Shell lead="Loading..." />;

  const currentRow = data.rows.find((entry) => entry.row === row);
  const pinnedCells = new Set<string>(
    (analysis.rows.find((entry) => entry.row === row)?.tokens ?? []).flatMap((token) =>
      token.cells.map((cell) => cellKey(cell.row, cell.col)),
    ),
  );
  const gridRows = data.rows.map((entry) => ({
    row: entry.row,
    side: entry.side,
    used: entry.used,
    made: entry.made,
    state: entry.state,
    notes: entry.notes,
    follow: (entry.row === row ? 'current' : entry.row < row ? 'done' : 'todo') as
      | 'current'
      | 'done'
      | 'todo',
  }));

  const dock = (
    <div className="follow-dock">
      <p role="status" aria-label="Row counter" className="counter">
        {`Row ${row} of ${data.height}`}
      </p>
      <section
        className="region current-row"
        aria-label="Current row"
        onPointerDown={(event) => {
          touchStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy)) return;
          void step(dx < 0 ? 1 : -1);
        }}
      >
        {currentRow && currentRow.text !== '' ? currentRow.text : NO_STITCHES}
      </section>
      <div className="row-of-buttons">
        <button type="button" onClick={() => void step(-1)} disabled={row <= 1}>
          Previous row
        </button>
        <button type="button" onClick={() => void step(1)} disabled={row >= data.height}>
          Next row
        </button>
        <button type="button" onClick={() => setNoteRow(row)}>
          Add note
        </button>
        {latest > data.version ? (
          <button
            type="button"
            className="primary"
            onClick={() => void moveVersion()}
            disabled={busy}
            aria-busy={busy}
          >
            {`Move to version ${latest}`}
          </button>
        ) : null}
      </div>
      <p role="status" aria-label="Version" className="status-line" data-motion={noticeMotion ? 'notice' : undefined}>
        {versionStatus}
      </p>
      <p role="status" aria-label="Row announcement" className="status-line">
        {announcement}
      </p>
      <p role="status" aria-label="Note status" className="status-line">
        {noteStatus}
      </p>
      <ul aria-label="Your notes" className="plain-list">
        {notes.map((note, index) => (
          <li key={`${note.row}-${index}`}>{`Row ${note.row}: ${note.text}`}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <Shell wide lead={`Working ${data.name}, version ${data.version}.`}>
      <div className={layout === 'desktop' ? 'follow-desktop' : 'follow-stack'}>
        <h1>{data.name}</h1>
        <ChartGrid
          name="Stitch chart"
          shape={data}
          cells={cells}
          rows={gridRows}
          cursor={{ row, col: 1 }}
          pinned={pinnedCells}
          lifted={pinnedCells}
          motion={motion}
          scrollRef={scroll}
        />
        {dock}
      </div>
      {noteRow !== null ? (
        <Dialog name="Add note" onClose={() => setNoteRow(null)}>
          <div className="form">
            <label className="field">
              <span>{`Note for row ${noteRow}`}</span>
              <textarea
                aria-label={`Note for row ${noteRow}`}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
              />
            </label>
            <p role="alert" aria-label="Note error" className="alert">
              {noteError}
            </p>
            <div className="row-of-buttons">
              <button
                type="button"
                className="primary"
                onClick={() => void saveNote()}
                disabled={busy}
                aria-busy={busy}
              >
                Save note
              </button>
              <button type="button" onClick={() => setNoteRow(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </Shell>
  );
}
