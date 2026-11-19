import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUpload, ApiError, newOperationId, OfflineError, reasonOf } from '../lib/api.js';
import { displayTime, noteCountLabel } from '../lib/format.js';
import { revealWave, sheetIn, snapBack, type RevealCard } from '../lib/motion.js';
import { Icon, LiveRegions, Modal } from '../components/Common.js';
import { BillingBanner, UpgradeDialog } from '../components/Billing.js';
import { Canvas, ZOOM_MAX, ZOOM_MIN, type Viewport } from './Canvas.js';
import { Drawer } from './Drawer.js';
import { framesInRailOrder, useBoardState } from './useBoardState.js';
import {
  STATUS_LABELS,
  VERSION_REASON_LABELS,
  type Billing,
  type BoardNote,
  type BoardVersion,
  type FacilitatorWorkshop,
  type SearchResult,
  type TrashItem,
  type WorkshopStatus,
} from '../../shared/protocol.js';

const PRESENCE_INTERVAL_MS = 1000 / 15;

export function Room({ workshopId }: { workshopId: string }): JSX.Element {
  const state = useBoardState(workshopId);
  const { board, reveal, clearReveal } = state;

  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const [undoFrameId, setUndoFrameId] = useState<string | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [limitError, setLimitError] = useState<ApiError | null>(null);

  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const [revealedNoteIds, setRevealedNoteIds] = useState<ReadonlySet<string>>(new Set());
  const [pickedUpNoteId, setPickedUpNoteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ noteId: string | null; frameId: string } | null>(null);
  const [moveDialogNoteId, setMoveDialogNoteId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [frameMenu, setFrameMenu] = useState<string | null>(null);
  const [dotPending, setDotPending] = useState<string | null>(null);
  const [transitionPending, setTransitionPending] = useState(false);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteText, setInviteText] = useState('');
  const [inviteFieldError, setInviteFieldError] = useState('');
  const [roundMinutes, setRoundMinutes] = useState(5);
  const [voteMinutes, setVoteMinutes] = useState(2);
  const [dotsPerPerson, setDotsPerPerson] = useState(3);

  const [entranceSettled, setEntranceSettled] = useState(false);
  const railElement = useRef<HTMLElement>(null);
  const drawerElement = useRef<HTMLDivElement>(null);
  const noteElements = useRef(new Map<string, HTMLElement>());
  const frameElements = useRef(new Map<string, HTMLElement>());
  const lastPresenceAt = useRef(0);
  const nowTick = useTick(500);

  const isFacilitator = board?.viewer.role === 'facilitator';

  useEffect(() => {
    if (!isFacilitator) return;
    void api<Billing>('GET', '/api/billing')
      .then(setBilling)
      .catch(() => undefined);
  }, [isFacilitator]);

  const registerNoteElement = useCallback((noteId: string, element: HTMLElement | null) => {
    if (element === null) noteElements.current.delete(noteId);
    else noteElements.current.set(noteId, element);
  }, []);

  const registerFrameElement = useCallback((frameId: string, element: HTMLElement | null) => {
    if (element === null) frameElements.current.delete(frameId);
    else frameElements.current.set(frameId, element);
  }, []);

  /** Runs the reveal wave and announces each frame exactly once per reveal. */
  useEffect(() => {
    if (reveal === null || board === null) return;
    const announcements: string[] = [];
    if (reveal.wasOffline) announcements.push('Back online');

    if (reveal.flippedNoteIds.size > 0) {
      const byFrame = new Map<string, RevealCard[]>();
      for (const noteId of reveal.flippedNoteIds) {
        const element = noteElements.current.get(noteId);
        const note = board.notes.find((candidate) => candidate.id === noteId);
        if (!element || !note) continue;
        const frame = board.frames.find((candidate) => candidate.id === note.frameId);
        if (!frame) continue;
        const centreX = frame.x + frame.width / 2;
        const centreY = frame.y + frame.height / 2;
        const list = byFrame.get(frame.id) ?? [];
        list.push({ element, distance: Math.hypot(note.x + 90 - centreX, note.y + 32 - centreY) });
        byFrame.set(frame.id, list);
      }
      // Each frame runs its own wave, and all frames' waves run at the same time.
      for (const cards of byFrame.values()) {
        revealWave(cards, (element) => {
          const id = element.dataset.noteId;
          if (id !== undefined) setRevealedNoteIds((current) => new Set([...current, id]));
        });
      }
    }

    for (const frame of reveal.frames) {
      announcements.push(
        `Round revealed: ${frame.noteCount === 1 ? '1 note' : `${frame.noteCount} notes`} in ${frame.title} frame`,
      );
    }
    if (announcements.length > 0) setStatus(announcements.join(' '));
    // Focus moves to the heading of the first announced frame.
    const first = reveal.frames[0];
    if (first) {
      const element = frameElements.current.get(first.id)?.querySelector('h2');
      if (element instanceof HTMLElement) element.focus();
    }
    clearReveal();
  }, [reveal, board, clearReveal]);

  useEffect(() => {
    if (state.streamDown) setStatus('Reconnecting to the board…');
  }, [state.streamDown]);

  // The board's own entrance plays once; notes arriving later animate individually.
  useEffect(() => {
    if (board === null || entranceSettled) return undefined;
    const timer = window.setTimeout(() => setEntranceSettled(true), 900);
    return () => window.clearTimeout(timer);
  }, [board, entranceSettled]);

  useEffect(() => {
    if (railOpen && railElement.current) sheetIn(railElement.current, 'left');
  }, [railOpen]);

  useEffect(() => {
    if (drawerOpen && drawerElement.current) sheetIn(drawerElement.current, 'right');
  }, [drawerOpen]);

  const call = useCallback(
    async <T,>(
      run: () => Promise<T>,
      onFailure: (reason: string, error: unknown) => void,
    ): Promise<T | null> => {
      try {
        return await run();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'plan_limit') {
          setLimitError(error);
          return null;
        }
        if (error instanceof ApiError && error.code === 'rate_limited') {
          onFailure(`Slow down — too many changes in a row. Try again in ${error.retryAfter ?? 0} seconds.`, error);
          return null;
        }
        onFailure(reasonOf(error), error);
        return null;
      }
    },
    [],
  );

  const onTransition = useCallback(
    async (to: WorkshopStatus) => {
      if (to === 'closed') {
        setCloseOpen(true);
        return;
      }
      setTransitionPending(true);
      const body: Record<string, unknown> = { clientOpId: newOperationId(), to };
      if (to === 'silent_round') body.durationSeconds = roundMinutes * 60;
      if (to === 'voting') {
        body.durationSeconds = voteMinutes * 60;
        body.dotBudget = dotsPerPerson;
      }
      const result = await call(
        () => api<{ workshop: FacilitatorWorkshop }>('POST', `/api/workshops/${workshopId}/transitions`, body),
        (reason, error) => {
          if (error instanceof ApiError && error.code === 'illegal_transition' && board) {
            setProblem(`The session has already moved on — it's now ${STATUS_LABELS[board.workshop.status]}.`);
          } else setProblem(reason);
        },
      );
      setTransitionPending(false);
      if (result === null) return;
      await state.refresh();
      // The reveal announces through the wave rule, never a second time.
      if (to === 'open') setStatus('Room open');
      else if (to === 'silent_round') {
        const endsAt = result.workshop.round?.endsAt;
        setStatus(
          `Silent round started — ends at ${endsAt === undefined ? '' : displayTime(Date.parse(endsAt), result.workshop.timeZone)}`,
        );
      } else if (to === 'voting') setStatus(`Voting started — ${dotsPerPerson} dots each`);
      else if (to === 'archived') setStatus('Workshop archived');
    },
    [call, workshopId, roundMinutes, voteMinutes, dotsPerPerson, state, board],
  );

  const closeWorkshop = useCallback(async () => {
    setCloseOpen(false);
    setTransitionPending(true);
    const result = await call(
      () =>
        api('POST', `/api/workshops/${workshopId}/transitions`, {
          clientOpId: newOperationId(),
          to: 'closed',
        }),
      (reason) => setProblem(reason),
    );
    setTransitionPending(false);
    if (result !== null) {
      setStatus('Workshop closed. Preparing the recap.');
      await state.refresh();
    }
  }, [call, workshopId, state]);

  const addNote = useCallback(
    async (frameId: string, text: string) => {
      const frame = board?.frames.find((candidate) => candidate.id === frameId);
      const opId = newOperationId();
      const body = {
        clientOpId: opId,
        frameId,
        kind: 'text' as const,
        text,
        x: (frame?.x ?? 0) + 40 + Math.random() * 120,
        y: (frame?.y ?? 0) + 90 + Math.random() * 160,
      };
      const result = await call(
        () => api<{ note: BoardNote }>('POST', `/api/workshops/${workshopId}/notes`, body),
        (reason, error) => {
          if (error instanceof OfflineError) setStatus('Couldn&rsquo;t reach the board — retrying your note.');
          else setProblem(`Note not added — ${reason}.`);
        },
      );
      if (result === null) return false;
      setStatus(`Note added to ${frame?.title ?? ''}`);
      await state.refresh();
      return true;
    },
    [board, call, workshopId, state],
  );

  const moveNote = useCallback(
    async (noteId: string, x: number, y: number, element: HTMLElement) => {
      const note = board?.notes.find((candidate) => candidate.id === noteId);
      const result = await call(
        () =>
          api('PATCH', `/api/notes/${noteId}`, {
            clientOpId: newOperationId(),
            position: { x, y },
          }),
        (reason) => {
          // The note glides back to where everyone else sees it.
          snapBack(element, { x: x - (note?.x ?? x), y: y - (note?.y ?? y) });
          setProblem(`Move not saved — ${reason}. The note is back where everyone else sees it.`);
        },
      );
      await state.refresh();
      return result;
    },
    [board, call, workshopId, state],
  );

  const placeNote = useCallback(
    async (noteId: string, frameId: string, clusterId: string | null, index: number | null, element: HTMLElement) => {
      const placement: Record<string, unknown> = { frameId, clusterId };
      if (index !== null) placement.index = index;
      await call(
        () => api('PATCH', `/api/notes/${noteId}`, { clientOpId: newOperationId(), placement }),
        (reason) => {
          snapBack(element, { x: 0, y: 0 });
          setProblem(`Move not saved — ${reason}. The note is back where everyone else sees it.`);
        },
      );
      await state.refresh();
    },
    [call, state],
  );

  const sendPresence = useCallback(
    (x: number, y: number) => {
      const now = Date.now();
      if (now - lastPresenceAt.current < PRESENCE_INTERVAL_MS) return;
      lastPresenceAt.current = now;
      void api('POST', `/api/workshops/${workshopId}/presence`, { x, y }).catch(() => undefined);
    },
    [workshopId],
  );

  const runSearch = useCallback(
    async (text: string) => {
      if (text.trim() === '') {
        setResults(null);
        return;
      }
      setSearching(true);
      const found = await call(
        () =>
          api<{ results: SearchResult[] }>(
            'GET',
            `/api/workshops/${workshopId}/search?q=${encodeURIComponent(text.trim())}`,
          ),
        (reason) => setProblem(reason),
      );
      setSearching(false);
      setResults(found?.results ?? []);
    },
    [call, workshopId],
  );

  // Typing searches about a third of a second after the last keystroke.
  useEffect(() => {
    if (query.trim() === '') {
      setResults(null);
      return undefined;
    }
    const timer = window.setTimeout(() => void runSearch(query), 320);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  const centreOnFrame = useCallback((frameId: string) => {
    const frame = frameElements.current.get(frameId);
    const heading = frame?.querySelector('h2');
    if (heading instanceof HTMLElement) heading.focus();
  }, []);

  const centreOnNote = useCallback((noteId: string) => {
    const element = noteElements.current.get(noteId);
    element?.focus();
    // Pressing a result closes the results list.
    setResults(null);
  }, []);

  const onAddDot = useCallback(
    async (clusterId: string) => {
      setDotPending(clusterId);
      const cluster = board?.clusters.find((candidate) => candidate.id === clusterId);
      const result = await call(
        () =>
          api<{ dotsRemaining: number }>('POST', `/api/clusters/${clusterId}/dots`, {
            clientOpId: newOperationId(),
          }),
        (reason) => setProblem(reason),
      );
      setDotPending(null);
      if (result === null) return;
      setStatus(`Dot placed on ${cluster?.title ?? ''}. ${result.dotsRemaining} left.`);
      await state.refresh();
    },
    [board, call, state],
  );

  const onRemoveDot = useCallback(
    async (clusterId: string) => {
      setDotPending(clusterId);
      const cluster = board?.clusters.find((candidate) => candidate.id === clusterId);
      const result = await call(
        () =>
          api<{ dotsRemaining: number }>('POST', `/api/clusters/${clusterId}/dots/return`, {
            clientOpId: newOperationId(),
          }),
        (reason) => setProblem(reason),
      );
      setDotPending(null);
      if (result === null) return;
      setStatus(`Dot removed from ${cluster?.title ?? ''}. ${result.dotsRemaining} left.`);
      await state.refresh();
    },
    [board, call, state],
  );

  /** Where a note sits for the pick-up announcements: its cluster, or its frame. */
  const placeOf = useCallback(
    (noteId: string): { title: string; index: number; total: number; clusterId: string | null } => {
      const note = board?.notes.find((candidate) => candidate.id === noteId);
      const cluster = board?.clusters.find((candidate) => candidate.noteIds.includes(noteId));
      if (cluster) {
        return {
          title: cluster.title,
          index: cluster.noteIds.indexOf(noteId) + 1,
          total: cluster.noteIds.length,
          clusterId: cluster.id,
        };
      }
      const frame = board?.frames.find((candidate) => candidate.id === note?.frameId);
      const loose = (board?.notes ?? []).filter(
        (candidate) =>
          candidate.frameId === note?.frameId &&
          !(board?.clusters ?? []).some((group) => group.noteIds.includes(candidate.id)),
      );
      return {
        title: frame?.title ?? '',
        index: loose.findIndex((candidate) => candidate.id === noteId) + 1,
        total: loose.length,
        clusterId: null,
      };
    },
    [board],
  );

  /** Moves a picked-up note one row inside its cluster and announces where it landed. */
  const reorderNote = useCallback(
    async (noteId: string, delta: number) => {
      const place = placeOf(noteId);
      if (place.clusterId === null) return;
      const target = Math.min(place.total, Math.max(1, place.index + delta));
      if (target === place.index) return;
      const note = board?.notes.find((candidate) => candidate.id === noteId);
      if (!note) return;
      const element = noteElements.current.get(noteId);
      await call(
        () =>
          api('PATCH', `/api/notes/${noteId}`, {
            clientOpId: newOperationId(),
            placement: { frameId: note.frameId, clusterId: place.clusterId, index: target - 1 },
          }),
        (reason) => {
          if (element) snapBack(element, { x: 0, y: 0 });
          setProblem(`Move not saved — ${reason}. The note is back where everyone else sees it.`);
        },
      );
      setStatus(`Position ${target} of ${place.total} in ${place.title}`);
      await state.refresh();
    },
    [board, call, placeOf, state],
  );

  /** Click or press Enter on a first note, then on a second, to join them. */
  const connectNote = useCallback(
    async (noteId: string) => {
      if (connectFrom === null) {
        setConnectFrom(noteId);
        setStatus('Pick the second note to connect.');
        return;
      }
      if (connectFrom === noteId) return;
      const made = await call(
        () =>
          api('POST', `/api/workshops/${workshopId}/connectors`, {
            clientOpId: newOperationId(),
            fromNoteId: connectFrom,
            toNoteId: noteId,
          }),
        (reason) => setProblem(reason),
      );
      setConnectFrom(null);
      if (made !== null) {
        setStatus('Notes connected');
        await state.refresh();
      }
    },
    [call, connectFrom, state, workshopId],
  );

  const onNoteKeyDown = useCallback(
    (noteId: string, event: React.KeyboardEvent) => {
      const note = board?.notes.find((candidate) => candidate.id === noteId);
      if (!note) return;

      // Connect mode joins the first note pressed to the second.
      if (connectMode) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void connectNote(noteId);
        return;
      }

      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        if (pickedUpNoteId === noteId) {
          const place = placeOf(noteId);
          setPickedUpNoteId(null);
          setStatus(`Dropped. Position ${place.index} of ${place.total} in ${place.title}`);
        } else {
          setPickedUpNoteId(noteId);
          setStatus(
            'Picked up. Up and down arrows reorder, M moves to another cluster or frame, Space drops, Escape cancels.',
          );
        }
        return;
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && pickedUpNoteId === noteId) {
        event.preventDefault();
        void reorderNote(noteId, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === 'Escape' && pickedUpNoteId === noteId) {
        event.preventDefault();
        setPickedUpNoteId(null);
        const frame = board?.frames.find((candidate) => candidate.id === note.frameId);
        setStatus(`Move cancelled. Note returned to ${frame?.title ?? ''}.`);
        return;
      }
      if (event.key.toLowerCase() === 'm' && pickedUpNoteId === noteId) {
        event.preventDefault();
        setMoveDialogNoteId(noteId);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        setEditing({ noteId, frameId: note.frameId });
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void call(
          () => api('DELETE', `/api/notes/${noteId}`),
          (reason) => setProblem(`Note not deleted — ${reason}.`),
        ).then(async () => {
          setStatus('Note deleted');
          await state.refresh();
        });
      }
    },
    [board, pickedUpNoteId, call, state, connectMode, connectNote, placeOf, reorderNote],
  );

  const railFrames = useMemo(() => (board ? framesInRailOrder(board.frames) : []), [board]);

  if (state.ended) {
    return (
      <main className="column session-ended">
        <h1>This join link is no longer active. Ask your facilitator for a new one.</h1>
      </main>
    );
  }

  if (!board) {
    return (
      <main className="column">
        <p>Opening the board…</p>
      </main>
    );
  }

  const workshop = board.workshop;
  const facilitatorWorkshop = isFacilitator ? (workshop as FacilitatorWorkshop) : null;

  return (
    <div className="room">
      {billing && isFacilitator && <BillingBanner billing={billing} onChanged={setBilling} />}

      <header className="top-bar">
        <h1>{workshop.title}</h1>
        <span className="status-label">
          {workshop.status === 'silent_round' || workshop.status === 'voting' ? (
            <span className="live-dot" aria-hidden="true" />
          ) : null}
          {STATUS_LABELS[workshop.status]}
        </span>
        <button type="button" className="only-narrow" onClick={() => setRailOpen(true)}>
          Frames
        </button>
        <button type="button" className="only-narrow" onClick={() => setSearchOpen((open) => !open)}>
          Search
        </button>
        <search className={searchOpen ? 'search open' : 'search'}>
          <label htmlFor="note-search" className="visually-hidden">
            Search notes
          </label>
          <input
            id="note-search"
            type="search"
            value={query}
            placeholder="Search notes"
            aria-label="Search notes"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void runSearch(query);
              }
              if (event.key === 'Escape') {
                setQuery('');
                setResults(null);
              }
            }}
          />
          {results !== null && (
            <ul className="search-results" aria-label="Search results">
              {searching && <li>Searching…</li>}
              {!searching && results.length === 0 && <li>{`No notes match “${query}”.`}</li>}
              {!searching &&
                results.map((result) => (
                  <li key={result.noteId}>
                    <button type="button" onClick={() => centreOnNote(result.noteId)}>
                      {result.text}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </search>
        <button type="button" className="only-narrow" onClick={() => setDrawerOpen(true)}>
          Session
        </button>
      </header>

      <nav className={railOpen ? 'rail open' : 'rail'} aria-label="Frames" ref={railElement}>
        {railFrames.map((frame) => (
          <button key={frame.id} type="button" onClick={() => centreOnFrame(frame.id)}>
            {frame.title}
          </button>
        ))}
        {isFacilitator && (
          <button
            type="button"
            onClick={() =>
              void call(
                () =>
                  api('POST', `/api/workshops/${workshopId}/frames`, {
                    clientOpId: newOperationId(),
                    title: 'New frame',
                    x: railFrames.length * 900,
                    y: 0,
                    width: 800,
                    height: 600,
                  }),
                (reason) => setProblem(reason),
              ).then(() => state.refresh())
            }
          >
            Add frame
          </button>
        )}
      </nav>

      <Canvas
        board={board}
        viewport={viewport}
        setViewport={setViewport}
        cursors={state.cursors}
        showCursorNames={isFacilitator}
        revealedNoteIds={revealedNoteIds}
        pickedUpNoteId={pickedUpNoteId}
        registerNoteElement={registerNoteElement}
        registerFrameElement={registerFrameElement}
        onNoteActivate={(noteId) => {
          if (connectMode) {
            void connectNote(noteId);
            return;
          }
          const note = board.notes.find((candidate) => candidate.id === noteId);
          if (note) setEditing({ noteId, frameId: note.frameId });
        }}
        onNoteKeyDown={onNoteKeyDown}
        onNoteMoved={async (noteId, x, y, element) => {
          await moveNote(noteId, x, y, element);
        }}
        onNoteDroppedOnCluster={placeNote}
        onPointerMoved={sendPresence}
        connectFrom={connectFrom}
        connectMode={connectMode}
        voting={workshop.status === 'voting'}
        onAddDot={(clusterId) => void onAddDot(clusterId)}
        onRemoveDot={(clusterId) => void onRemoveDot(clusterId)}
        dotPending={dotPending}
        isFacilitator={isFacilitator}
        onFrameMenu={(frameId) => setFrameMenu(frameId)}
        entranceSettled={entranceSettled}
      />

      <div className="toolbar" role="toolbar" aria-label="Board tools">
        <button
          type="button"
          title="Add note"
          aria-label="Add note"
          onClick={() => setEditing({ noteId: null, frameId: railFrames[0]?.id ?? '' })}
        >
          <Icon name="stickyNote" />
        </button>
        <button type="button" title="Add image" aria-label="Add image" onClick={pickImage}>
          <Icon name="image" />
        </button>
        <button type="button" title="Add cluster" aria-label="Add cluster" onClick={() => void addCluster()}>
          <Icon name="group" />
        </button>
        <button
          type="button"
          title="Connect notes"
          aria-label="Connect notes"
          aria-pressed={connectMode}
          onClick={() => {
            setConnectMode((on) => !on);
            setConnectFrom(null);
            setStatus(connectMode ? 'Connect mode off' : 'Connect mode on. Pick the first note.');
          }}
        >
          <Icon name="link" />
        </button>
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => setViewport({ ...viewport, zoom: Math.max(ZOOM_MIN, viewport.zoom / 1.25) })}
        >
          <Icon name="zoomOut" />
        </button>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => setViewport({ ...viewport, zoom: Math.min(ZOOM_MAX, viewport.zoom * 1.25) })}
        >
          <Icon name="zoomIn" />
        </button>
        <button type="button" title="Fit board" aria-label="Fit board" onClick={fitBoard}>
          <Icon name="maximize" />
        </button>
      </div>

      <div className={drawerOpen ? 'drawer-host open' : 'drawer-host'} ref={drawerElement}>
        <Drawer
          board={board}
          nowMs={nowTick + state.serverOffsetMs}
          isFacilitator={isFacilitator}
          roundMinutes={roundMinutes}
          setRoundMinutes={setRoundMinutes}
          voteMinutes={voteMinutes}
          setVoteMinutes={setVoteMinutes}
          dotsPerPerson={dotsPerPerson}
          setDotsPerPerson={setDotsPerPerson}
          onTransition={(to) => void onTransition(to)}
          transitionPending={transitionPending}
          onCopyLink={() => {
            const url = facilitatorWorkshop?.joinUrl;
            if (url !== null && url !== undefined) {
              void navigator.clipboard?.writeText(url);
              setStatus('Join link copied');
            }
          }}
          onRotateLink={() => void rotateLink()}
          onTurnOffLink={() => void turnOffLink()}
          inviteText={inviteText}
          setInviteText={setInviteText}
          onSendInvites={() => void sendInvites()}
          invitePending={invitePending}
          inviteFieldError={inviteFieldError}
          onOpenTrash={() => setTrashOpen(true)}
          onOpenVersions={() => setVersionsOpen(true)}
        />
      </div>

      <LiveRegions
        statusLabel="Board activity"
        alertLabel="Board problems"
        status={status}
        problem={problem}
        extra={
          undoFrameId !== null ? (
            <button type="button" onClick={() => void restoreFrame(undoFrameId)}>
              Undo
            </button>
          ) : null
        }
      />

      {editing && (
        <NoteEditor
          board={board}
          editing={editing}
          isFacilitator={isFacilitator}
          onClose={() => setEditing(null)}
          onSave={async (text, frameId, facilitatorOnly) => {
            if (editing.noteId === null) {
              const added = await addNote(frameId, text);
              if (added) setEditing(null);
              return;
            }
            const body: Record<string, unknown> = { clientOpId: newOperationId(), text };
            if (isFacilitator) body.facilitatorOnly = facilitatorOnly;
            const saved = await call(
              () => api('PATCH', `/api/notes/${editing.noteId}`, body),
              (reason) => setProblem(`Edit not saved — ${reason}. The note shows its saved text.`),
            );
            if (saved !== null) {
              setEditing(null);
              await state.refresh();
            }
          }}
        />
      )}

      {moveDialogNoteId !== null && (
        <MoveNoteDialog
          board={board}
          onClose={() => setMoveDialogNoteId(null)}
          onMove={async (frameId, clusterId) => {
            const element = noteElements.current.get(moveDialogNoteId);
            if (element) await placeNote(moveDialogNoteId, frameId, clusterId, null, element);
            const place = placeOf(moveDialogNoteId);
            setStatus(`Moved to ${place.title}, position ${place.index} of ${place.total}`);
            setMoveDialogNoteId(null);
            setPickedUpNoteId(null);
          }}
        />
      )}

      {trashOpen && <TrashDialog workshopId={workshopId} onClose={() => setTrashOpen(false)} onRestore={restoreFrame} />}
      {versionsOpen && (
        <VersionsDialog workshopId={workshopId} onClose={() => setVersionsOpen(false)} onRestored={onVersionRestored} />
      )}
      {closeOpen && (
        <Modal title="Close workshop" onClose={() => setCloseOpen(false)}>
          <p>Closing freezes the board and sends the recap to the sponsor.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => void closeWorkshop()}>
              Close and send recap
            </button>
            <button type="button" onClick={() => setCloseOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {frameMenu !== null && (
        <Modal title="Frame options" onClose={() => setFrameMenu(null)}>
          <ul className="listbox" role="menu">
            <li
              role="menuitem"
              tabIndex={0}
              onClick={() => void renameFrame(frameMenu)}
              onKeyDown={(event) => event.key === 'Enter' && void renameFrame(frameMenu)}
            >
              Rename
            </li>
            <li
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                setFrameMenu(null);
                void trashFrame(frameMenu);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                setFrameMenu(null);
                void trashFrame(frameMenu);
              }}
            >
              Move to trash
            </li>
          </ul>
        </Modal>
      )}
      {limitError && <UpgradeDialog error={limitError} onClose={() => setLimitError(null)} />}
    </div>
  );

  function fitBoard(): void {
    if (board === null || board.frames.length === 0) return;
    const minX = Math.min(...board.frames.map((frame) => frame.x));
    const minY = Math.min(...board.frames.map((frame) => frame.y));
    const maxX = Math.max(...board.frames.map((frame) => frame.x + frame.width));
    const maxY = Math.max(...board.frames.map((frame) => frame.y + frame.height));
    const available = { width: window.innerWidth - 360, height: window.innerHeight - 200 };
    const zoom = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.min(available.width / (maxX - minX), available.height / (maxY - minY))),
    );
    setViewport({ zoom, x: 200 - minX * zoom, y: 110 - minY * zoom });
  }

  function pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void uploadImage(file);
    });
    input.click();
  }

  async function uploadImage(file: File): Promise<void> {
    setStatus('Uploading…');
    try {
      const uploaded = await apiUpload<{ imageId: string }>(
        `/api/workshops/${workshopId}/images`,
        file,
      );
      const frameId = railFrames[0]?.id ?? '';
      const frame = board?.frames.find((candidate) => candidate.id === frameId);
      await api('POST', `/api/workshops/${workshopId}/notes`, {
        clientOpId: newOperationId(),
        frameId,
        kind: 'image',
        imageId: uploaded.imageId,
        x: (frame?.x ?? 0) + 60,
        y: (frame?.y ?? 0) + 120,
      });
      setStatus(`Note added to ${frame?.title ?? ''}`);
      await state.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'storage_unavailable') {
        setProblem('Image storage is unavailable. Your image was not added — try again shortly.');
      } else if (error instanceof ApiError && error.code === 'too_large') {
        setProblem('Images must be 5,000,000 bytes or smaller.');
      } else if (error instanceof ApiError && error.code === 'unsupported_media_type') {
        setProblem('Use a PNG, JPEG or WebP image.');
      } else if (error instanceof ApiError && error.fields?.image !== undefined) {
        setProblem(error.fields.image);
      } else {
        setProblem(reasonOf(error));
      }
    }
  }

  async function addCluster(): Promise<void> {
    const title = window.prompt('Cluster title');
    if (title === null || title.trim() === '') return;
    const frame = railFrames[0];
    if (!frame) return;
    await call(
      () =>
        api('POST', `/api/workshops/${workshopId}/clusters`, {
          clientOpId: newOperationId(),
          frameId: frame.id,
          title: title.trim(),
          x: frame.x + 60,
          y: frame.y + 280,
        }),
      (reason) => setProblem(reason),
    );
    await state.refresh();
  }

  async function renameFrame(frameId: string): Promise<void> {
    const frame = board?.frames.find((candidate) => candidate.id === frameId);
    const title = window.prompt('Frame title', frame?.title ?? '');
    setFrameMenu(null);
    if (title === null || title.trim() === '') return;
    await call(
      () => api('PATCH', `/api/frames/${frameId}`, { clientOpId: newOperationId(), title: title.trim() }),
      (reason) => setProblem(reason),
    );
    await state.refresh();
  }

  async function trashFrame(frameId: string): Promise<void> {
    const frame = board?.frames.find((candidate) => candidate.id === frameId);
    const result = await call(
      () => api('POST', `/api/frames/${frameId}/trash`, { clientOpId: newOperationId() }),
      (reason) => setProblem(reason),
    );
    if (result === null) return;
    setStatus(`Frame ${frame?.title ?? ''} moved to trash`);
    setUndoFrameId(frameId);
    window.setTimeout(() => setUndoFrameId(null), 10_000);
    await state.refresh();
  }

  async function restoreFrame(frameId: string): Promise<void> {
    const result = await call(
      () =>
        api<{ frame: { title: string }; restored: { notes: number } }>(
          'POST',
          `/api/trash/${frameId}/restore`,
          { clientOpId: newOperationId() },
        ),
      (reason) => setProblem(reason),
    );
    setUndoFrameId(null);
    if (result === null) return;
    setStatus(`Frame ${result.frame.title} restored with ${result.restored.notes} notes`);
    await state.refresh();
  }

  async function onVersionRestored(version: number, savedVersion: number): Promise<void> {
    setStatus(`Board restored to version ${version}. The previous board is saved as version ${savedVersion}.`);
    await state.refresh();
  }

  async function rotateLink(): Promise<void> {
    await call(
      () => api('POST', `/api/workshops/${workshopId}/join-link/rotate`),
      (reason) => setProblem(reason),
    );
    setStatus('New join link created. The old link no longer works.');
    await state.refresh();
  }

  async function turnOffLink(): Promise<void> {
    await call(
      () => api('DELETE', `/api/workshops/${workshopId}/join-link`),
      (reason) => setProblem(reason),
    );
    setStatus('Join link turned off. Everyone who joined with it has been disconnected.');
    await state.refresh();
  }

  async function sendInvites(): Promise<void> {
    setInvitePending(true);
    setInviteFieldError('');
    const emails = inviteText
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const result = await call(
      () =>
        api<{ invites: Array<{ email: string; status: string }> }>(
          'POST',
          `/api/workshops/${workshopId}/invites`,
          { emails },
        ),
      (reason, error) => {
        if (error instanceof ApiError && error.code === 'quota_exceeded') {
          const zone = facilitatorWorkshop?.timeZone ?? 'your time zone';
          setInviteFieldError(`Today's invite limit is reached. You can send more after midnight (${zone}).`);
        } else if (error instanceof ApiError && error.fields?.emails !== undefined) {
          setInviteFieldError(error.fields.emails);
        } else setProblem(reason);
      },
    );
    setInvitePending(false);
    if (result === null) return;
    const queued = result.invites.filter((invite) => invite.status === 'queued').length;
    const sent = result.invites.length - queued;
    setStatus(
      queued > 0
        ? `${sent} sent, ${queued} queued — email is unavailable. Queued invites go out automatically.`
        : `Invites sent to ${result.invites.length} people`,
    );
    setInviteText('');
    await state.refresh();
  }
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function NoteEditor({
  board,
  editing,
  isFacilitator,
  onClose,
  onSave,
}: {
  board: { notes: readonly BoardNote[]; frames: readonly { id: string; title: string }[] };
  editing: { noteId: string | null; frameId: string };
  isFacilitator: boolean;
  onClose: () => void;
  onSave: (text: string, frameId: string, facilitatorOnly: boolean) => Promise<void>;
}): JSX.Element {
  const existing = board.notes.find((note) => note.id === editing.noteId);
  const [text, setText] = useState(existing?.text ?? '');
  const [facilitatorOnly, setFacilitatorOnly] = useState(existing?.facilitatorOnly === true);
  const [pending, setPending] = useState(false);

  async function save(): Promise<void> {
    if (pending) return;
    setPending(true);
    await onSave(text, editing.frameId, facilitatorOnly);
    setPending(false);
  }

  return (
    <Modal title="Note" onClose={onClose}>
      <div className="field">
        <label htmlFor="note-text">Note text</label>
        <textarea
          id="note-text"
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
      </div>
      {isFacilitator && (
        <label className="row option-row">
          <input
            type="checkbox"
            checked={facilitatorOnly}
            onChange={(event) => setFacilitatorOnly(event.target.checked)}
          />
          <span>Facilitator only</span>
        </label>
      )}
      <div className="row">
        <button type="button" className="primary" onClick={() => void save()} disabled={pending}>
          Save note
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function MoveNoteDialog({
  board,
  onClose,
  onMove,
}: {
  board: {
    frames: readonly { id: string; title: string }[];
    clusters: readonly { id: string; frameId: string; title: string }[];
  };
  onClose: () => void;
  onMove: (frameId: string, clusterId: string | null) => Promise<void>;
}): JSX.Element {
  const framesById = new Map(board.frames.map((frame) => [frame.id, frame]));
  const options = [
    ...board.clusters.map((cluster) => ({
      key: `cluster:${cluster.id}`,
      label: `Cluster: ${cluster.title} (${framesById.get(cluster.frameId)?.title ?? ''})`,
      frameId: cluster.frameId,
      clusterId: cluster.id as string | null,
    })),
    ...board.frames.map((frame) => ({
      key: `frame:${frame.id}`,
      label: `Frame: ${frame.title}`,
      frameId: frame.id,
      clusterId: null,
    })),
  ];
  const [selected, setSelected] = useState(0);

  return (
    <Modal title="Move note" onClose={onClose}>
      <ul className="listbox" role="listbox" aria-label="Destinations" tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected((index) => Math.min(options.length - 1, index + 1));
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected((index) => Math.max(0, index - 1));
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            const option = options[selected];
            if (option) void onMove(option.frameId, option.clusterId);
          }
        }}
      >
        {options.map((option, index) => (
          <li
            key={option.key}
            role="option"
            aria-selected={index === selected}
            className={index === selected ? 'selected' : ''}
            onClick={() => void onMove(option.frameId, option.clusterId)}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function TrashDialog({
  workshopId,
  onClose,
  onRestore,
}: {
  workshopId: string;
  onClose: () => void;
  onRestore: (frameId: string) => Promise<void>;
}): JSX.Element {
  const [items, setItems] = useState<readonly TrashItem[]>([]);
  useEffect(() => {
    void api<{ items: TrashItem[] }>('GET', `/api/workshops/${workshopId}/trash`)
      .then((result) => setItems(result.items))
      .catch(() => undefined);
  }, [workshopId]);

  return (
    <Modal title="Trash" onClose={onClose}>
      <ul className="rule-list">
        {items.map((item) => (
          <li key={item.id}>
            <p className="mono muted">
              Deleted {new Date(item.deletedAt).toISOString().slice(0, 10)}, purged{' '}
              {new Date(item.purgeAt).toISOString().slice(0, 10)}
            </p>
            <button
              type="button"
              onClick={() => {
                void onRestore(item.id);
                onClose();
              }}
            >
              {`Restore ${item.title}`}
            </button>
          </li>
        ))}
        {items.length === 0 && <li>Nothing in the trash.</li>}
      </ul>
    </Modal>
  );
}

function VersionsDialog({
  workshopId,
  onClose,
  onRestored,
}: {
  workshopId: string;
  onClose: () => void;
  onRestored: (version: number, savedVersion: number) => Promise<void>;
}): JSX.Element {
  const [versions, setVersions] = useState<readonly BoardVersion[]>([]);
  const [confirming, setConfirming] = useState<BoardVersion | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api<{ versions: BoardVersion[] }>('GET', `/api/workshops/${workshopId}/versions`)
      .then((result) => setVersions(result.versions))
      .catch(() => undefined);
  }, [workshopId]);

  if (confirming) {
    return (
      <Modal title="Restore version" onClose={() => setConfirming(null)}>
        <p>{`Restore version ${confirming.version}? The current board is saved as a version first.`}</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                const result = await api<{ restoredFrom: number; saved: { version: number } }>(
                  'POST',
                  `/api/workshops/${workshopId}/versions/${confirming.id}/restore`,
                  { clientOpId: newOperationId() },
                );
                await onRestored(result.restoredFrom, result.saved.version);
                onClose();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? 'Restoring…' : 'Restore'}
          </button>
          <button type="button" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Versions" onClose={onClose}>
      <ul className="rule-list">
        {versions.map((version) => (
          <li key={version.id}>
            <p className="mono muted">
              {`Version ${version.version} — ${VERSION_REASON_LABELS[version.reason]} — ${new Date(version.createdAt).toISOString().slice(0, 10)}, ${new Date(version.createdAt).toISOString().slice(11, 16)}`}
            </p>
            <button type="button" onClick={() => setConfirming(version)}>
              {`Restore version ${version.version}`}
            </button>
          </li>
        ))}
        {versions.length === 0 && <li>No versions yet.</li>}
      </ul>
    </Modal>
  );
}
