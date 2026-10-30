import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoadmapResponse } from '../../shared/types';
import { ApiError, request } from '../api';
import { useApp } from '../app-state';
import { Dialog } from '../components/Dialog';
import { FEATURE_STATUS_LABELS, RELEASE_STATUS_LABELS } from '../labels';
import { formatCalendarDate } from '../../shared/format';

interface Lane {
  releaseId: string | null;
  name: string;
  featureIds: string[];
  orderVersion: number | null;
}

interface MoveState {
  featureId: string;
  featureName: string;
  fromLane: string | null;
  lanes: Lane[];
}

/** Board order of the lanes: Unscheduled first, then releases in board order. */
function buildLanes(roadmap: RoadmapResponse, includeShipped = false): Lane[] {
  const lanes: Lane[] = [
    {
      releaseId: null,
      name: 'Unscheduled',
      featureIds: roadmap.unscheduled.map((feature) => feature.id),
      orderVersion: null,
    },
  ];
  for (const column of roadmap.columns) {
    for (const release of column.releases) {
      if (release.status === 'shipped' && !includeShipped) continue;
      lanes.push({
        releaseId: release.id,
        name: release.name,
        featureIds: release.featureIds,
        orderVersion: release.orderVersion,
      });
    }
  }
  return lanes;
}

function locate(lanes: Lane[], featureId: string): { lane: number; index: number } {
  for (let lane = 0; lane < lanes.length; lane += 1) {
    const index = lanes[lane].featureIds.indexOf(featureId);
    if (index !== -1) return { lane, index };
  }
  return { lane: 0, index: 0 };
}

export function Roadmap(): JSX.Element {
  const app = useApp();
  const [roadmap, setRoadmap] = useState<RoadmapResponse | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [shipFor, setShipFor] = useState<{ id: string; name: string } | null>(null);
  const [dropHint, setDropHint] = useState<{ releaseId: string | null; index: number } | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragged = useRef<string | null>(null);

  const load = useCallback(async () => {
    setRoadmap(await request<RoadmapResponse>('/api/roadmap'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A picked card remounts when it changes lane, so focus follows it after the render.
  useEffect(() => {
    if (move === null) return;
    cardRefs.current.get(move.featureId)?.focus();
  }, [move]);

  const featureNames = new Map<string, string>();
  if (roadmap) {
    for (const feature of roadmap.unscheduled) featureNames.set(feature.id, feature.name);
    for (const column of roadmap.columns) {
      for (const release of column.releases) {
        for (const feature of release.features) featureNames.set(feature.id, feature.name);
      }
    }
  }

  const announce = (lanes: Lane[], featureId: string, prefix: string): void => {
    const { lane, index } = locate(lanes, featureId);
    const name = featureNames.get(featureId) ?? '';
    const copy =
      prefix === ''
        ? `${name}, position ${index + 1} of ${lanes[lane].featureIds.length} in ${lanes[lane].name}.`
        : `${prefix} ${name}. Position ${index + 1} of ${lanes[lane].featureIds.length} in ${lanes[lane].name}.`;
    app.announceBoard(copy);
  };

  const commit = async (state: MoveState): Promise<void> => {
    const { lane, index } = locate(state.lanes, state.featureId);
    const target = state.lanes[lane];
    const expected: Record<string, number> = {};
    for (const candidate of state.lanes) {
      if (candidate.releaseId === null || candidate.orderVersion === null) continue;
      if (candidate.releaseId === target.releaseId || candidate.releaseId === state.fromLane) {
        expected[candidate.releaseId] = candidate.orderVersion;
      }
    }
    app.setPending('Saving order…');
    try {
      await request('/api/roadmap/moves', {
        method: 'POST',
        body: {
          featureId: state.featureId,
          toReleaseId: target.releaseId,
          toIndex: index,
          expectedOrderVersions: expected,
        },
      });
      app.setSaveStatus('');
      app.announceBoard(
        `Dropped ${state.featureName}. Position ${index + 1} of ${target.featureIds.length} in ${target.name}.`,
      );
      await load();
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) app.setAlert(boardErrorCopy(error, state.featureName, target.name));
      await load();
    }
  };

  const applyKey = (event: React.KeyboardEvent<HTMLButtonElement>, featureId: string): void => {
    if (roadmap === null) return;
    if (move === null) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        const lanes = buildLanes(roadmap);
        const { lane } = locate(lanes, featureId);
        const state: MoveState = {
          featureId,
          featureName: featureNames.get(featureId) ?? '',
          fromLane: lanes[lane].releaseId,
          lanes,
        };
        setMove(state);
        announce(state.lanes, featureId, 'Picked up');
      }
      return;
    }
    if (move.featureId !== featureId) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      const original = buildLanes(roadmap);
      const { lane, index } = locate(original, featureId);
      app.announceBoard(
        `Move cancelled. ${move.featureName} is back at position ${index + 1} of ` +
          `${original[lane].featureIds.length} in ${original[lane].name}.`,
      );
      setMove(null);
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      void commit(move);
      setMove(null);
      return;
    }

    const lanes = move.lanes.map((lane) => ({ ...lane, featureIds: [...lane.featureIds] }));
    const { lane, index } = locate(lanes, featureId);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = event.key === 'ArrowUp' ? index - 1 : index + 1;
      if (next < 0 || next >= lanes[lane].featureIds.length) return;
      lanes[lane].featureIds.splice(index, 1);
      lanes[lane].featureIds.splice(next, 0, featureId);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const nextLane = event.key === 'ArrowLeft' ? lane - 1 : lane + 1;
      if (nextLane < 0 || nextLane >= lanes.length) return;
      lanes[lane].featureIds.splice(index, 1);
      const at = Math.min(index, lanes[nextLane].featureIds.length);
      lanes[nextLane].featureIds.splice(at, 0, featureId);
    } else {
      return;
    }
    setMove({ ...move, lanes });
    announce(lanes, featureId, '');
  };

  const pointerDrop = (releaseId: string | null, index: number): void => {
    const featureId = dragged.current;
    dragged.current = null;
    setDropHint(null);
    if (featureId === null || roadmap === null) return;
    // Shipped releases are included so a drop onto one is answered by the server.
    const lanes = buildLanes(roadmap, true).map((lane) => ({ ...lane, featureIds: [...lane.featureIds] }));
    const found = locate(lanes, featureId);
    const fromLane = lanes[found.lane].releaseId;
    lanes[found.lane].featureIds.splice(found.index, 1);
    const targetLane = lanes.findIndex((lane) => lane.releaseId === releaseId);
    if (targetLane === -1) {
      void load();
      return;
    }
    const at = Math.min(index, lanes[targetLane].featureIds.length);
    lanes[targetLane].featureIds.splice(at, 0, featureId);
    void commit({ featureId, featureName: featureNames.get(featureId) ?? '', fromLane, lanes });
  };

  const freeze = async (releaseId: string, name: string): Promise<void> => {
    app.setPending('Freezing scope…');
    try {
      await request(`/api/releases/${releaseId}/freeze`, { method: 'POST' });
      app.setSaveStatus(`Scope frozen for ${name}.`);
      await load();
    } catch (error) {
      app.setSaveStatus('');
      if (error instanceof ApiError) {
        app.setAlert(
          error.code === 'storage_unavailable'
            ? `Storage is unavailable, so ${name} was not frozen. Try again in a minute.`
            : error.code === 'invalid_transition'
              ? `${name} cannot be frozen now.`
              : error.message,
        );
      }
    }
  };

  const activeLanes = move?.lanes ?? (roadmap ? buildLanes(roadmap) : []);
  const laneOrder = (releaseId: string | null): string[] =>
    activeLanes.find((lane) => lane.releaseId === releaseId)?.featureIds ?? [];

  return (
    <main className="roadmap">
      <h1 className="display">Roadmap</h1>
      <div className="board" role="region" aria-label="Roadmap board">
        <section className="lane">
          <h2 className="display">Unscheduled</h2>
          <ul
            aria-label="Unscheduled"
            className="lane-list"
            onDragOver={(event) => {
              event.preventDefault();
              setDropHint({ releaseId: null, index: laneOrder(null).length });
            }}
            onDrop={(event) => {
              event.preventDefault();
              pointerDrop(null, laneOrder(null).length);
            }}
          >
            {laneOrder(null).map((featureId, index) => (
              <Card
                key={featureId}
                featureId={featureId}
                name={featureNames.get(featureId) ?? ''}
                status={null}
                picked={move?.featureId === featureId}
                position={index}
                refs={cardRefs}
                onKeyDown={applyKey}
                onDragStart={() => (dragged.current = featureId)}
                onDragOverCard={() => setDropHint({ releaseId: null, index })}
                onDropCard={() => pointerDrop(null, index)}
                dropBefore={dropHint?.releaseId === null && dropHint.index === index}
              />
            ))}
          </ul>
        </section>

        {(roadmap?.columns ?? []).map((column) => (
          <section key={column.month} className="month" role="group" aria-label={column.label}>
            <h2 className="display">{column.label}</h2>
            {column.releases.map((release) => (
              <article key={release.id} className="release">
                <h3 className="display">{release.name}</h3>
                <p className="release-meta">
                  {formatCalendarDate(release.targetDate)} · {RELEASE_STATUS_LABELS[release.status]} ·{' '}
                  {release.isPublic ? 'Public' : 'Internal'}
                </p>
                <ul
                  aria-label={release.name}
                  className="lane-list"
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropHint({ releaseId: release.id, index: laneOrder(release.id).length });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    pointerDrop(release.id, laneOrder(release.id).length);
                  }}
                >
                  {(release.status === 'shipped' ? release.featureIds : laneOrder(release.id)).map(
                    (featureId, index) => (
                      <Card
                        key={featureId}
                        featureId={featureId}
                        name={featureNames.get(featureId) ?? ''}
                        status={
                          release.features.find((feature) => feature.id === featureId)?.status ?? null
                        }
                        picked={move?.featureId === featureId}
                        position={index}
                        refs={cardRefs}
                        onKeyDown={applyKey}
                        onDragStart={() => (dragged.current = featureId)}
                        onDragOverCard={() => setDropHint({ releaseId: release.id, index })}
                        onDropCard={() => pointerDrop(release.id, index)}
                        dropBefore={dropHint?.releaseId === release.id && dropHint.index === index}
                      />
                    ),
                  )}
                </ul>
                {app.user?.role === 'head_of_product' ? (
                  <div className="row">
                    {release.status === 'open' ? (
                      <button
                        type="button"
                        className="button"
                        onClick={() => void freeze(release.id, release.name)}
                      >
                        Freeze scope
                      </button>
                    ) : null}
                    {release.status === 'frozen' ? (
                      <button
                        type="button"
                        className="button accent"
                        onClick={() => setShipFor({ id: release.id, name: release.name })}
                      >
                        Ship release
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>

      {shipFor !== null ? (
        <ShipDialog
          release={shipFor}
          onClose={() => setShipFor(null)}
          onShipped={() => {
            setShipFor(null);
            void load();
          }}
        />
      ) : null}
    </main>
  );
}

function boardErrorCopy(error: ApiError, featureName: string, releaseName: string): string {
  switch (error.code) {
    case 'order_conflict':
      return `The board changed while you were moving ${featureName}. It now shows the latest order.`;
    case 'feature_not_planned':
      return `${featureName} must be planned before it joins a release.`;
    case 'forbidden':
      return `${releaseName} is frozen. Ask a head of product to change its scope.`;
    case 'release_shipped':
      return `${releaseName} has shipped and can't change.`;
    case 'storage_unavailable':
      return `Storage is unavailable, so ${releaseName} was not frozen. Try again in a minute.`;
    default:
      return error.message;
  }
}

function Card({
  featureId,
  name,
  status,
  picked,
  position,
  refs,
  onKeyDown,
  onDragStart,
  onDragOverCard,
  onDropCard,
  dropBefore,
}: {
  featureId: string;
  name: string;
  status: string | null;
  picked: boolean;
  position: number;
  refs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, featureId: string) => void;
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragOverCard: () => void;
  onDropCard: () => void;
  dropBefore: boolean;
}): JSX.Element {
  return (
    <li className={dropBefore ? 'card-slot drop' : 'card-slot'} data-position={position}>
      <button
        type="button"
        ref={(element) => {
          if (element === null) refs.current.delete(featureId);
          else refs.current.set(featureId, element);
        }}
        className={picked ? 'card picked' : 'card'}
        aria-pressed={picked}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', featureId);
          onDragStart(event);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDragOverCard();
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDropCard();
        }}
        onKeyDown={(event) => onKeyDown(event, featureId)}
      >
        <span className="card-name">{name}</span>
        {status !== null ? (
          <span className="card-status">
            {FEATURE_STATUS_LABELS[status as keyof typeof FEATURE_STATUS_LABELS]}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function ShipDialog({
  release,
  onClose,
  onShipped,
}: {
  release: { id: string; name: string };
  onClose: () => void;
  onShipped: () => void;
}): JSX.Element {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());

  return (
    <Dialog label={`Ship ${release.name}`} onClose={onClose}>
      <p>Each customer who asked for these features gets one email.</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="button accent"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void request<{ emailsQueued: number }>(`/api/releases/${release.id}/ship`, {
              method: 'POST',
              headers: { 'Idempotency-Key': key.current },
            })
              .then((data) => {
                app.setSaveStatus(
                  `${release.name} shipped. ${data.emailsQueued} customer emails queued for delivery.`,
                );
                onShipped();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  app.setAlert(
                    error.code === 'invalid_transition'
                      ? `Freeze ${release.name} before shipping it.`
                      : error.message,
                  );
                }
                onShipped();
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Shipping…' : 'Ship and notify customers'}
        </button>
      </div>
    </Dialog>
  );
}
