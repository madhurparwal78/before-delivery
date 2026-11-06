import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { analyseGraph, computeBoundary, MAX_HOP, type CandidateNote, type GraphLink } from '../shared/boundary';
import { PUBLIC_COPY } from '../shared/copy';
import { renderDossier, renderPageFragment } from '../shared/dossier';
import { DOSSIER_STATE_LABELS } from '../shared/lifecycle';
import { formatDisplayTime } from '../shared/time';
import { ApiError, api } from './api';
import { COPY } from './copy';
import type { StoredNote } from './db';
import { Icon } from './icons';
import { candidateNotes, candidateOf, store } from './state';
import { ConfirmDialog, Dialog, useCairn, useReducedMotion } from './ui';

const CANVAS = 420;
const CENTRE = CANVAS / 2;
const OUTER = CENTRE - 28;

const FILL_MS = 170;
const CUT_MS = 280;
const COUNT_MS = 450;

/** Hop last set for each dossier, kept while the workbench stays open. */
const hopMemory = new Map<string, number>();
let lastDossierId: string | null = null;

interface Counts {
  publicCount: number;
  severed: number;
}

interface NodePlacement {
  noteId: string;
  title: string;
  hop: number;
  x: number;
  y: number;
  isPrivate: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function radiusOf(hop: number): number {
  return (hop / MAX_HOP) * OUTER;
}

function placeNodes(
  notes: readonly CandidateNote[],
  rootNoteId: string,
): { nodes: NodePlacement[]; stubCount: number } {
  const graph = analyseGraph(notes, rootNoteId);
  const byHop = new Map<number, { noteId: string; title: string; isPrivate: boolean }[]>();
  const push = (hop: number, noteId: string, isPrivate: boolean): void => {
    const note = graph.notes.get(noteId);
    const list = byHop.get(hop) ?? [];
    list.push({ noteId, title: note?.title ?? 'Untitled', isPrivate });
    byHop.set(hop, list);
  };
  for (const [noteId, hop] of graph.hops) if (hop <= MAX_HOP) push(hop, noteId, false);
  for (const [noteId, hop] of graph.privateHops) push(hop, noteId, true);

  const nodes: NodePlacement[] = [];
  for (const [hop, entries] of [...byHop.entries()].sort((a, b) => a[0] - b[0])) {
    entries.sort((a, b) => a.title.localeCompare(b.title));
    entries.forEach((entry, index) => {
      // Each ring starts at its own angle so nodes on neighbouring hops do not line up.
      const angle = ((index + hop * 0.35) / Math.max(1, entries.length)) * Math.PI * 2 - Math.PI / 2;
      nodes.push({
        noteId: entry.noteId,
        title: entry.title,
        hop,
        isPrivate: entry.isPrivate,
        x: CENTRE + Math.cos(angle) * radiusOf(hop),
        y: CENTRE + Math.sin(angle) * radiusOf(hop),
      });
    });
  }

  const stubs = graph.links.filter((link) => {
    if (link.toId === null) return true;
    return !graph.hops.has(link.toId) && !graph.privateHops.has(link.toId);
  });
  return { nodes, stubCount: stubs.length };
}

export function PublishWorkbench({ note }: { note: StoredNote }): JSX.Element {
  const state = useCairn();
  const reducedMotion = useReducedMotion();
  const notes = store.notesOf(state.currentNotebookId);

  const dossierForNote = state.dossiers.find((entry) => entry.root_note_id === note.id) ?? null;
  const dossier =
    dossierForNote ?? state.dossiers.find((entry) => entry.id === lastDossierId) ?? null;
  if (dossier) lastDossierId = dossier.id;

  const rootNoteId = dossier?.root_note_id ?? note.id;
  /** Sent to the server: never private, never beyond hop 4. */
  const candidates = useMemo(() => candidateNotes(notes, rootNoteId), [notes, rootNoteId]);
  /** Drawn on the ring: the same graph plus the private pins, which keep a lock mark. */
  const shown = useMemo(() => notes.map(candidateOf), [notes]);
  const placement = useMemo(() => placeNodes(shown, rootNoteId), [shown, rootNoteId]);
  const graph = useMemo(() => analyseGraph(shown, rootNoteId), [shown, rootNoteId]);

  const countsAt = useCallback(
    (hop: number): Counts => {
      const boundary = computeBoundary(shown, rootNoteId, hop, graph);
      return { publicCount: boundary.publicCount, severed: boundary.severedCount };
    },
    [shown, rootNoteId, graph],
  );

  const storedHop = dossier ? (hopMemory.get(dossier.id) ?? dossier.radius ?? 1) : 1;
  const [hop, setHop] = useState(storedHop);
  const [fillHop, setFillHop] = useState(storedHop);
  const [cutHop, setCutHop] = useState(storedHop);
  const [previewHop, setPreviewHop] = useState(storedHop);
  const [counters, setCounters] = useState<Counts>(() => countsAt(storedHop));
  const [dragRadius, setDragRadius] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [checkLine, setCheckLine] = useState<string>('');
  const [matched, setMatched] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [takedownOpen, setTakedownOpen] = useState(false);
  const sequence = useRef(0);
  const checkToken = useRef(0);
  const sliderRef = useRef<HTMLDivElement>(null);

  const dossierId = dossier?.id ?? null;

  useEffect(() => {
    if (!dossierId) return;
    const remembered = hopMemory.get(dossierId) ?? dossier?.radius ?? 1;
    setHop(remembered);
    setFillHop(remembered);
    setCutHop(remembered);
    setPreviewHop(remembered);
    setCounters(countsAt(remembered));
  }, [dossierId]);

  const tweenCounters = useCallback(
    async (from: Counts, to: Counts, run: number): Promise<void> => {
      const started = performance.now();
      return new Promise((resolve) => {
        const frame = (now: number): void => {
          if (sequence.current !== run) {
            resolve();
            return;
          }
          const progress = Math.min(1, (now - started) / COUNT_MS);
          setCounters({
            publicCount: Math.round(from.publicCount + (to.publicCount - from.publicCount) * progress),
            severed: Math.round(from.severed + (to.severed - from.severed) * progress),
          });
          if (progress < 1) window.requestAnimationFrame(frame);
          else resolve();
        };
        window.requestAnimationFrame(frame);
      });
    },
    [],
  );

  /** The crossing sequence: nodes fill, links snap, counters count, preview re-renders. */
  const crossTo = useCallback(
    async (from: number, to: number): Promise<void> => {
      const run = ++sequence.current;
      if (from === to) {
        const counts = countsAt(to);
        setCounters(counts);
        setAnnouncement(COPY.ring.announcement(to, counts.publicCount, counts.severed));
        return;
      }
      const step = to > from ? 1 : -1;
      let current = from;
      let displayed = counters;
      while (current !== to) {
        current += step;
        if (sequence.current !== run) return;
        const counts = countsAt(current);
        setFillHop(current);
        if (reducedMotion) {
          setCutHop(current);
          setCounters(counts);
          setPreviewHop(current);
        } else {
          await sleep(FILL_MS);
          if (sequence.current !== run) return;
          setCutHop(current);
          await sleep(CUT_MS);
          if (sequence.current !== run) return;
          await tweenCounters(displayed, counts, run);
          if (sequence.current !== run) return;
          setPreviewHop(current);
        }
        displayed = counts;
        setAnnouncement(COPY.ring.announcement(current, counts.publicCount, counts.severed));
      }
    },
    [countsAt, counters, reducedMotion, tweenCounters],
  );

  const runCheck = useCallback(
    async (radius: number): Promise<void> => {
      if (!dossierId) return;
      const token = ++checkToken.current;
      setCheckLine(COPY.ring.checking);
      setMatched(false);
      try {
        const answer = await api.manifestPreview(dossierId, { radius, notes: candidates });
        if (checkToken.current !== token) return;
        const local = countsAt(radius);
        if (answer.public_count === local.publicCount && answer.severed_count === local.severed) {
          setCheckLine(COPY.ring.match(answer.public_count, answer.severed_count));
          setMatched(true);
        } else {
          setCheckLine(COPY.ring.mismatch);
          setMatched(false);
        }
      } catch {
        if (checkToken.current !== token) return;
        setCheckLine(COPY.ring.failure);
        setMatched(false);
      }
    },
    [candidates, countsAt, dossierId],
  );

  const settle = useCallback(
    (next: number): void => {
      const target = Math.max(0, Math.min(MAX_HOP, next));
      if (dossierId) hopMemory.set(dossierId, target);
      const from = hop;
      setHop(target);
      setDragRadius(null);
      void crossTo(from, target).then(() => runCheck(target));
    },
    [crossTo, dossierId, hop, runCheck],
  );

  // A private pin, or any edit to the candidate notes, recomputes the boundary at the current hop.
  useEffect(() => {
    if (!dossierId) return;
    setCounters(countsAt(hop));
    setAnnouncement(COPY.ring.announcement(hop, countsAt(hop).publicCount, countsAt(hop).severed));
    void runCheck(hop);
  }, [dossierId, candidates]);


  const onSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, number> = {
      ArrowRight: hop + 1,
      ArrowUp: hop + 1,
      ArrowLeft: hop - 1,
      ArrowDown: hop - 1,
      Home: 0,
      End: MAX_HOP,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    settle(next);
  };

  const pointerHop = (event: PointerEvent | React.PointerEvent): number => {
    const canvas = sliderRef.current?.closest('.ring-canvas');
    if (!(canvas instanceof Element)) return hop;
    const box = canvas.getBoundingClientRect();
    const scale = CANVAS / box.width;
    const x = (event.clientX - box.left) * scale - CENTRE;
    const y = (event.clientY - box.top) * scale - CENTRE;
    const distance = Math.sqrt(x * x + y * y);
    return Math.max(0, Math.min(MAX_HOP, (distance / OUTER) * MAX_HOP));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    sliderRef.current?.focus();
    let latest = pointerHop(event);
    setDragRadius(latest);

    const move = (moveEvent: PointerEvent): void => {
      latest = pointerHop(moveEvent);
      setDragRadius(latest);
      const crossed = Math.round(latest);
      if (crossed !== fillHop) void crossTo(fillHop, crossed);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      settle(Math.round(latest));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const insideIds = useMemo(
    () => computeBoundary(shown, rootNoteId, fillHop, graph).insideIds,
    [shown, rootNoteId, fillHop, graph],
  );
  const cutLinks = useMemo(
    () => computeBoundary(shown, rootNoteId, cutHop, graph).cutLinks,
    [shown, rootNoteId, cutHop, graph],
  );

  const previewHtml = useMemo(() => {
    if (candidates.length === 0) return '';
    const render = renderDossier({
      notes: candidates,
      rootNoteId,
      radius: previewHop,
      siteBaseUrl: window.location.origin,
      basePath: `/d/${dossier?.slug ?? 'draft'}/`,
      footer: PUBLIC_COPY.draftFooter(countsAt(previewHop).publicCount),
      draftPreviewBanner: null,
      assets: null,
      withSearchAndSitemap: false,
    });
    const page = render.pages.find((entry) => entry.noteId === rootNoteId) ?? render.pages[0];
    return page ? renderPageFragment(page.input, { landmarks: false }) : '';
  }, [candidates, rootNoteId, previewHop, dossier?.slug, countsAt]);

  const boundaryRadius = radiusOf(dragRadius ?? fillHop);
  const nodeTitle = (placementNode: NodePlacement): string => {
    const stateWord = placementNode.isPrivate
      ? 'private'
      : insideIds.has(placementNode.noteId)
        ? 'public'
        : 'outside';
    return `${placementNode.title.length > 0 ? placementNode.title : 'Untitled'}, hop ${placementNode.hop}, ${stateWord}`;
  };

  const nodeOf = (noteId: string): NodePlacement | undefined =>
    placement.nodes.find((entry) => entry.noteId === noteId);

  const cutGeometry = (link: GraphLink, index: number): JSX.Element | null => {
    const from = nodeOf(link.fromId);
    if (!from) return null;
    const target = link.toId ? nodeOf(link.toId) : undefined;
    const angle = (index / Math.max(1, cutLinks.length)) * Math.PI * 2;
    const to = target ?? {
      x: CENTRE + Math.cos(angle) * (OUTER + 22),
      y: CENTRE + Math.sin(angle) * (OUTER + 22),
    };
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const pull = 0.18;
    return (
      <g key={`${link.fromId}-${link.target}`} role="img" aria-label={`Cut link ${index + 1}`} className="cut-link">
        <line
          x1={from.x}
          y1={from.y}
          x2={midX - (midX - from.x) * pull}
          y2={midY - (midY - from.y) * pull}
          className="cut-half"
        />
        <line
          x1={to.x}
          y1={to.y}
          x2={midX - (midX - to.x) * pull}
          y2={midY - (midY - to.y) * pull}
          className="cut-half"
        />
        <g transform={`translate(${midX - 6} ${midY - 6}) scale(0.5)`} className="scissor">
          <circle cx="6" cy="6" r="3" />
          <path d="M8.12 8.12 12 12" />
          <path d="M20 4 8.12 15.88" />
          <circle cx="6" cy="18" r="3" />
          <path d="M14.8 14.8 20 20" />
        </g>
      </g>
    );
  };

  const joinedLinks = graph.links.filter(
    (link) => link.toId !== null && insideIds.has(link.fromId) && insideIds.has(link.toId),
  );

  const createDossier = async (): Promise<void> => {
    const created = await store.createDossier(address.trim(), note.id);
    if (created) {
      lastDossierId = created.id;
      hopMemory.set(created.id, 1);
      setAddressOpen(false);
      setAddress('');
      void runCheck(1);
    }
  };

  const publishNow = async (): Promise<void> => {
    if (!dossier) return;
    setPublishOpen(false);
    store.setPublishStatus(COPY.publish.pending);
    try {
      const answer = await api.publish(dossier.id, { radius: hop, notes: candidates });
      store.replaceDossier(answer.dossier);
      store.setPublishStatus(
        COPY.publish.success(answer.dossier.public_count ?? 0, answer.dossier.severed_count ?? 0),
      );
    } catch (error) {
      store.setPublishStatus(publishFailureCopy(error));
    }
  };

  const createPreviewLink = async (): Promise<void> => {
    if (!dossier) return;
    store.setPreview(COPY.preview.pending, null);
    try {
      const answer = await api.createPreviewLink(dossier.id, { radius: hop, notes: candidates });
      const when = formatDisplayTime(
        new Date(answer.preview_link.expires_at),
        state.account?.time_zone ?? 'UTC',
      );
      store.setPreview(COPY.preview.success(when), `${window.location.origin}${answer.url}`);
      await store.refreshDossiers();
    } catch (error) {
      store.setPreview(
        error instanceof ApiError && error.failure.code === 'storage_unavailable'
          ? COPY.preview.storage
          : error instanceof ApiError
            ? error.failure.message
            : COPY.preview.storage,
        null,
      );
    }
  };

  const revokePreviewLink = async (): Promise<void> => {
    if (!dossier?.preview_link) return;
    setRevokeOpen(false);
    try {
      await api.revokePreviewLink(dossier.id, dossier.preview_link.id);
      store.setPreview(COPY.preview.revoked, null);
      await store.refreshDossiers();
    } catch (error) {
      store.setPreview(
        error instanceof ApiError && error.failure.code === 'storage_unavailable'
          ? COPY.preview.storage
          : error instanceof ApiError
            ? error.failure.message
            : COPY.preview.storage,
        null,
      );
    }
  };

  const takeDown = async (): Promise<void> => {
    if (!dossier) return;
    setTakedownOpen(false);
    store.setPublishStatus(COPY.publish.takedownPending);
    try {
      const answer = await api.unpublish(dossier.id);
      store.replaceDossier(answer.dossier);
      store.setPublishStatus(COPY.publish.takedownSuccess);
    } catch (error) {
      store.setPublishStatus(
        error instanceof ApiError && error.failure.code === 'storage_unavailable'
          ? COPY.publish.takedownStorage
          : publishFailureCopy(error),
      );
    }
  };

  const reopen = async (): Promise<void> => {
    if (!dossier) return;
    try {
      const answer = await api.reopen(dossier.id);
      store.replaceDossier(answer.dossier);
      store.setPublishStatus(COPY.publish.reopened);
    } catch (error) {
      store.setPublishStatus(publishFailureCopy(error));
    }
  };

  const openTitle = note.title.length > 0 ? note.title : 'Untitled';
  const previewLink = dossier?.preview_link;

  return (
    <div className="workbench">
      <div className="workbench-head">
        <p className="dossier-address mono">{dossier ? `${window.location.origin}${dossier.url}` : 'No dossier yet'}</p>
        <span
          className={dossier?.state === 'published' ? 'state-chip published' : 'state-chip'}
          role="status"
          aria-label="Dossier state"
        >
          {dossier ? DOSSIER_STATE_LABELS[dossier.state] : 'Draft'}
        </span>
      </div>

      {!dossier || addressOpen ? (
        <div className="address-form">
          <label className="field">
            <span className="field-label">Dossier address</span>
            <input
              aria-label="Dossier address"
              value={address}
              placeholder="port-ellery-fuel"
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <button type="button" className="primary" onClick={() => void createDossier()}>
            Create dossier
          </button>
        </div>
      ) : dossier.root_note_id !== note.id ? (
        <button type="button" onClick={() => setAddressOpen(true)}>
          {`Start a dossier from \u201c${openTitle}\u201d`}
        </button>
      ) : null}

      <div className="workbench-body">
        <div className="ring-column">
          <div className="ring-wrap">
            <svg className="ring-canvas" viewBox={`0 0 ${CANVAS} ${CANVAS}`}>
              {[1, 2, 3, 4].map((ring) => (
                <circle key={ring} cx={CENTRE} cy={CENTRE} r={radiusOf(ring)} className="hop-ring" />
              ))}
              <circle cx={CENTRE} cy={CENTRE} r={OUTER + 22} className="stub-ring" />
              {joinedLinks.map((link) => {
                const from = nodeOf(link.fromId);
                const to = link.toId ? nodeOf(link.toId) : undefined;
                if (!from || !to) return null;
                return (
                  <line
                    key={`${link.fromId}-${link.target}-joined`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className="joined-link"
                  />
                );
              })}
              {cutLinks.map((link, index) => cutGeometry(link, index))}
              <circle
                cx={CENTRE}
                cy={CENTRE}
                r={boundaryRadius}
                className={dragRadius === null ? 'boundary settled' : 'boundary'}
              />
              <g className="exposure-nodes">
                {placement.nodes.map((entry) => {
                  const isPublic = !entry.isPrivate && insideIds.has(entry.noteId);
                  return (
                    <g key={entry.noteId} role="img" aria-label={nodeTitle(entry)} className="ring-node">
                      <circle
                        cx={entry.x}
                        cy={entry.y}
                        r={entry.hop === 0 ? 12 : 10}
                        className={isPublic ? 'node public' : entry.isPrivate ? 'node private' : 'node outside'}
                      />
                      {isPublic ? (
                        <path
                          d={`M ${entry.x - 4} ${entry.y} L ${entry.x - 1} ${entry.y + 3} L ${entry.x + 4} ${entry.y - 3}`}
                          className="node-check"
                        />
                      ) : null}
                      {entry.isPrivate ? (
                        <g transform={`translate(${entry.x - 5} ${entry.y - 5}) scale(0.42)`} className="node-lock">
                          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </g>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>

            <div className="ring-group" role="group" aria-label="Exposure Ring">
              <div
                ref={sliderRef}
                className="ring-handle"
                role="slider"
                tabIndex={0}
                aria-label="Publish boundary"
                aria-valuemin={0}
                aria-valuemax={MAX_HOP}
                aria-valuenow={hop}
                aria-valuetext={`Hop ${hop}`}
                onKeyDown={onSliderKeyDown}
                onPointerDown={onPointerDown}
                style={{ left: `${50 + ((dragRadius ?? hop) / MAX_HOP) * ((OUTER / CANVAS) * 100)}%` }}
              />
            </div>
          </div>

          <div className="hop-stepper" role="radiogroup" aria-label="Hop">
            {[0, 1, 2, 3, 4].map((value) => (
              <label key={value} className={value === hop ? 'hop-radio selected' : 'hop-radio'}>
                <input
                  type="radio"
                  name="hop-stepper"
                  aria-label={`Hop ${value}`}
                  checked={value === hop}
                  onChange={() => settle(value)}
                />
                <span className="mono">{value}</span>
              </label>
            ))}
          </div>

          <p className="counts mono" role="group" aria-label="Exposure counts">
            {COPY.ring.counts(counters.publicCount, counters.severed)}
          </p>
          <p className="announcement" role="status" aria-live="polite" aria-label="Boundary announcement">
            {announcement}
          </p>
          <p className="check-line" role="status" aria-label="Boundary check">
            {checkLine}
          </p>
        </div>

        <div className="preview-column">
          <div className="live-preview" role="region" aria-label="Live preview">
            <div
              className="preview-paper"
              // The fragment comes from the shared allowlisted renderer.
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      </div>

      <div className="workbench-actions">
        <button
          type="button"
          className="publish"
          disabled={!dossier || !matched}
          onClick={() => setPublishOpen(true)}
        >
          Publish dossier
        </button>
        <p className="status-line" role="status" aria-label="Publish status">
          {state.publishStatus ?? ''}
        </p>

        <div className="preview-actions">
          <button type="button" disabled={!dossier} onClick={() => void createPreviewLink()}>
            Create preview link
          </button>
          <input aria-label="Preview link" readOnly value={state.previewUrl ?? ''} className="mono" />
          <button
            type="button"
            disabled={!state.previewUrl}
            onClick={() => void navigator.clipboard?.writeText(state.previewUrl ?? '')}
          >
            Copy link
          </button>
          <button
            type="button"
            disabled={!previewLink || previewLink.state !== 'active'}
            onClick={() => setRevokeOpen(true)}
          >
            Revoke preview link
          </button>
          <p className="status-line" role="status" aria-label="Preview link status">
            {state.previewStatus ?? ''}
          </p>
        </div>

        <div className="takedown-actions">
          <button type="button" disabled={dossier?.state !== 'published'} onClick={() => setTakedownOpen(true)}>
            Take down dossier
          </button>
          <button
            type="button"
            disabled={!dossier || !['unpublished', 'lapsed'].includes(dossier.state)}
            onClick={() => void reopen()}
          >
            Reopen as draft
          </button>
        </div>
      </div>

      {publishOpen ? (
        <Dialog name="Publish dossier" onClose={() => setPublishOpen(false)}>
          <p className="dialog-question">{COPY.publish.confirm(counters.publicCount, counters.severed)}</p>
          <div className="dialog-actions">
            <button type="button" className="publish" onClick={() => void publishNow()}>
              Publish now
            </button>
            <button type="button" onClick={() => setPublishOpen(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}

      {revokeOpen ? (
        <ConfirmDialog
          name="Revoke preview link"
          question="Revoke this preview link now?"
          confirmLabel="Revoke"
          onConfirm={() => void revokePreviewLink()}
          onClose={() => setRevokeOpen(false)}
        />
      ) : null}

      {takedownOpen ? (
        <ConfirmDialog
          name="Take down dossier"
          question="Take the dossier offline and delete every published page?"
          confirmLabel="Take down"
          onConfirm={() => void takeDown()}
          onClose={() => setTakedownOpen(false)}
        />
      ) : null}

      <p className="muted stub-note">
        <Icon name="scissors" className="brick" />
        {placement.stubCount} link targets sit outside the rings.
      </p>
    </div>
  );
}

function publishFailureCopy(error: unknown): string {
  if (!(error instanceof ApiError)) return COPY.publish.storage;
  switch (error.failure.code) {
    case 'storage_unavailable':
      return COPY.publish.storage;
    case 'publish_not_entitled':
      return COPY.publish.notEntitled;
    case 'publish_in_progress':
      return COPY.publish.alreadyRunning;
    case 'billing_unavailable':
      return COPY.plan.billingOutage;
    default:
      return error.failure.message;
  }
}
