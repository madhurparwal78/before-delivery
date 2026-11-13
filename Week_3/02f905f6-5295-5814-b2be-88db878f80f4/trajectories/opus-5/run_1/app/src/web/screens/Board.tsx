import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Clay,
  Firing,
  Kiln,
  Piece,
  PlacementResult,
  Rotation,
  Shape,
} from '../../shared/types';
import { formatMoney, PLAN_LABELS } from '../../shared/labels';
import {
  footprintOf,
  judgePlacement,
  SHELF_SPAN_HALF_UNITS,
  type Footprint,
} from '../../shared/placement';
import { ApiFailure, api, uploadPhoto } from '../api';
import {
  Dialog,
  LiveRegion,
  StatusLabel,
  quiet,
  useCountTo,
  useReducedMotion,
  type LiveMessage,
} from '../components/bits';
import { Shelf, type LiftedFootprint } from '../components/Shelf';

const REFRESH_MS = 5000;
const SETTLE_MS = 280;

interface Lifted extends LiftedFootprint {
  piece: Piece;
  alreadyPlaced: boolean;
}

interface DamageDraft {
  on: boolean;
  kind: 'glaze_run' | 'crack';
  photoId: string | null;
  note: string;
  photoMessage: string;
}

function halves(inches: string): number {
  return Math.round(Number(inches) * 2);
}

function sidesOf(piece: Piece): { shape: Shape; width: number; depth: number; height: number } {
  const sides = piece.sides_in;
  const width = halves(sides.diameter ?? sides.length ?? '0');
  const depth = halves(sides.diameter ?? sides.width ?? '0');
  return { shape: piece.shape, width, depth, height: halves(sides.height) };
}

export function BoardScreen(): JSX.Element {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [clays, setClays] = useState<Clay[]>([]);
  const [kilnId, setKilnId] = useState<string | null>(null);
  const [firing, setFiring] = useState<Firing | null>(null);
  const [railFirings, setRailFirings] = useState<Record<string, Firing>>({});
  const [queue, setQueue] = useState<Piece[]>([]);
  const [layer, setLayer] = useState(1);
  const [slide, setSlide] = useState<'left' | 'right' | null>(null);
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const [panelNote, setPanelNote] = useState<string | null>(null);
  const [rotationText, setRotationText] = useState('0');
  const [announce, setAnnounce] = useState<LiveMessage>(quiet);
  const [firingResult, setFiringResult] = useState<LiveMessage>(quiet);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [settling, setSettling] = useState<string | null>(null);
  const leavingRef = useRef<string[]>([]);
  const [newFiringOpen, setNewFiringOpen] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [unloadOpen, setUnloadOpen] = useState(false);
  const [pickupShelf, setPickupShelf] = useState('');
  const [damage, setDamage] = useState<Record<string, DamageDraft>>({});
  const panelHeading = useRef<HTMLHeadingElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const newFiringButton = useRef<HTMLButtonElement | null>(null);
  const unloadButton = useRef<HTMLButtonElement | null>(null);
  const reduced = useReducedMotion();

  const kiln = kilns.find((item) => item.id === kilnId) ?? null;
  const fill = useCountTo(firing?.fill_percent ?? 0, reduced);

  /** One quiet refresh: new tickets and firing status, nothing else touched. */
  const refresh = useCallback(
    async (targetKilnId: string | null): Promise<void> => {
      try {
        const [freshKilns, freshQueue] = await Promise.all([
          api.get<Kiln[]>('/api/kilns'),
          api.get<Piece[]>('/api/queue'),
        ]);
        setKilns(freshKilns);
        setQueue((current) => (leavingRef.current.length > 0 ? current : freshQueue));
        const open = await Promise.all(
          freshKilns
            .filter((item) => item.current_firing_id !== null)
            .map(async (item) =>
              [item.id, await api.get<Firing>(`/api/firings/${item.current_firing_id}`)] as const,
            ),
        );
        const byKiln = Object.fromEntries(open);
        setRailFirings(byKiln);
        const chosen = targetKilnId ?? freshKilns[0]?.id ?? null;
        setFiring(chosen ? (byKiln[chosen] ?? null) : null);
        setRefreshFailed(false);
      } catch {
        setRefreshFailed(true);
      }
    },
    [],
  );

  useEffect(() => {
    void api.get<Clay[]>('/api/clays').then(setClays);
    void api.get<Kiln[]>('/api/kilns').then((fresh) => {
      setKilns(fresh);
      setKilnId((current) => current ?? fresh[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!kilnId) return;
    void refresh(kilnId);
    const timer = window.setInterval(() => void refresh(kilnId), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [kilnId, refresh]);

  const layerPlacements = firing?.layers.find((item) => item.layer === layer)?.placements ?? [];

  const occupied = (exceptPiece?: string): { pieceNumber: string; footprint: Footprint }[] =>
    layerPlacements
      .filter((placement) => placement.piece_number !== exceptPiece)
      .map((placement) => ({
        pieceNumber: placement.piece_number,
        footprint: footprintOf(
          {
            shape: placement.shape,
            width: halves(placement.width_in),
            depth: halves(placement.depth_in),
          },
          halves(placement.x),
          halves(placement.y),
          placement.rotation,
        ),
      }));

  /** The same judgement the server makes, for live feedback as it moves. */
  const judge = (spot: {
    piece: Piece;
    xHalf: number;
    yHalf: number;
    rotation: Rotation;
    alreadyPlaced: boolean;
  }): string | null => {
    if (!firing || !kiln) return null;
    const clay = clays.find((item) => item.id === spot.piece.clay_id);
    if (!clay) return null;
    const sides = sidesOf(spot.piece);
    const refusal = judgePlacement(
      {
        sides: { shape: sides.shape, width: sides.width, depth: sides.depth },
        height: sides.height,
        stage: spot.piece.stage,
        clayMaxCone: clay.max_cone,
        glazeCone: spot.piece.cone,
        x: spot.xHalf,
        y: spot.yHalf,
        rotation: spot.rotation,
      },
      {
        firingStage: firing.profile.stage,
        firingCone: firing.profile.cone,
        postHeight: halves(kiln.post_height_in),
        occupied: occupied(spot.alreadyPlaced ? spot.piece.number : undefined),
      },
    );
    return refusal?.message ?? null;
  };

  const firstClearSpot = (piece: Piece, alreadyPlaced: boolean): { x: number; y: number } => {
    for (let y = 0; y <= SHELF_SPAN_HALF_UNITS; y += 1) {
      for (let x = 0; x <= SHELF_SPAN_HALF_UNITS; x += 1) {
        if (judge({ piece, xHalf: x, yHalf: y, rotation: 0, alreadyPlaced }) === null) {
          return { x, y };
        }
      }
    }
    return { x: 0, y: 0 };
  };

  const lift = (piece: Piece, from: HTMLElement | null, alreadyPlaced: boolean): void => {
    openerRef.current = from;
    const placed = layerPlacements.find((item) => item.piece_number === piece.number);
    const sides = sidesOf(piece);
    const spot =
      alreadyPlaced && placed
        ? { x: halves(placed.x), y: halves(placed.y) }
        : firstClearSpot(piece, alreadyPlaced);
    const rotation = alreadyPlaced && placed ? placed.rotation : 0;
    setRotationText(String(rotation));
    setPanelNote(null);
    setLifted({
      piece,
      pieceNumber: piece.number,
      shape: sides.shape,
      width: sides.width,
      depth: sides.depth,
      xHalf: spot.x,
      yHalf: spot.y,
      rotation,
      refused: judge({ piece, xHalf: spot.x, yHalf: spot.y, rotation, alreadyPlaced }) !== null,
      alreadyPlaced,
    });
    window.setTimeout(() => panelHeading.current?.focus(), 0);
  };

  const moveTo = (xHalf: number, yHalf: number, rotation?: Rotation): void => {
    setLifted((current) => {
      if (!current) return current;
      const nextRotation = rotation ?? current.rotation;
      const x = Math.max(0, Math.min(SHELF_SPAN_HALF_UNITS, xHalf));
      const y = Math.max(0, Math.min(SHELF_SPAN_HALF_UNITS, yHalf));
      return {
        ...current,
        xHalf: x,
        yHalf: y,
        rotation: nextRotation,
        refused:
          judge({
            piece: current.piece,
            xHalf: x,
            yHalf: y,
            rotation: nextRotation,
            alreadyPlaced: current.alreadyPlaced,
          }) !== null,
      };
    });
  };

  const collision = lifted
    ? judge({
        piece: lifted.piece,
        xHalf: lifted.xHalf,
        yHalf: lifted.yHalf,
        rotation: lifted.rotation,
        alreadyPlaced: lifted.alreadyPlaced,
      })
    : null;

  const cancel = (): void => {
    setLifted(null);
    setPanelNote(null);
    openerRef.current?.focus();
  };

  const place = async (): Promise<void> => {
    if (!lifted || !firing) return;
    if (collision) {
      setAnnounce({ text: `Not placed: ${collision}.`, tone: 'bad' });
      return;
    }
    const body = {
      piece_number: lifted.piece.number,
      layer,
      x: (lifted.xHalf / 2).toFixed(1),
      y: (lifted.yHalf / 2).toFixed(1),
      rotation: lifted.rotation,
    };
    try {
      const result = lifted.alreadyPlaced
        ? await api.patch<PlacementResult>(
            `/api/firings/${firing.id}/placements/${lifted.piece.number}`,
            body,
          )
        : await api.post<PlacementResult>(`/api/firings/${firing.id}/placements`, body);
      setAnnounce({
        text: `Placed Piece ${lifted.piece.number} on layer ${layer}. Load ${result.fill_percent}% full.`,
        tone: 'good',
      });
      setSettling(lifted.piece.number);
      window.setTimeout(() => setSettling(null), SETTLE_MS);
      if (!lifted.alreadyPlaced) {
        leavingRef.current = [...leavingRef.current, lifted.piece.number];
        setLeaving([...leavingRef.current]);
        window.setTimeout(
          () => {
            setQueue((current) =>
              current.filter((piece) => piece.number !== lifted.piece.number),
            );
            leavingRef.current = leavingRef.current.filter(
              (number) => number !== lifted.piece.number,
            );
            setLeaving([...leavingRef.current]);
          },
          reduced ? 0 : SETTLE_MS,
        );
      }
      setLifted(null);
      openerRef.current?.focus();
      await refresh(kilnId);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) {
        setAnnounce({ text: `Not placed: ${error.body.message}.`, tone: 'bad' });
      } else if (error instanceof ApiFailure && error.status === 422) {
        setAnnounce({
          text: `Not placed: ${Object.values(error.fields)[0] ?? error.body.message}.`,
          tone: 'bad',
        });
      } else {
        setAnnounce({ text: 'Not saved — the studio server is unreachable.', tone: 'bad' });
      }
    }
  };

  const removeFromShelf = async (): Promise<void> => {
    if (!lifted || !firing || !lifted.alreadyPlaced) return;
    try {
      const result = await api.del<{ fill_percent: number }>(
        `/api/firings/${firing.id}/placements/${lifted.piece.number}`,
      );
      setAnnounce({
        text: `Removed Piece ${lifted.piece.number} from layer ${layer}. Load ${result.fill_percent}% full.`,
        tone: 'good',
      });
      setLifted(null);
      await refresh(kilnId);
    } catch {
      setAnnounce({ text: 'Not saved — the studio server is unreachable.', tone: 'bad' });
    }
  };

  const changeLayer = (next: number, direction: 'left' | 'right' | null): void => {
    if (!kiln || next < 1 || next > kiln.layers) return;
    setLayer(next);
    setSlide(direction);
    if (direction) window.setTimeout(() => setSlide(null), SETTLE_MS);
  };

  /** Arrows, R, Enter, Escape and Delete work wherever the board has focus. */
  const onBoardKeyDown = (event: React.KeyboardEvent): void => {
    if (!lifted || newFiringOpen || unloadOpen) return;
    const target = event.target as HTMLElement;
    const inSpotField = target.tagName === 'INPUT' && target.dataset.spot === 'true';
    if (inSpotField && event.key !== 'Escape') return;
    const step = (dx: number, dy: number): void => {
      event.preventDefault();
      moveTo(lifted.xHalf + dx, lifted.yHalf + dy);
    };
    switch (event.key) {
      case 'ArrowLeft':
        step(-1, 0);
        break;
      case 'ArrowRight':
        step(1, 0);
        break;
      case 'ArrowUp':
        step(0, -1);
        break;
      case 'ArrowDown':
        step(0, 1);
        break;
      case 'r':
      case 'R': {
        event.preventDefault();
        const next = ((lifted.rotation + 90) % 360) as Rotation;
        setRotationText(String(next));
        moveTo(lifted.xHalf, lifted.yHalf, next);
        break;
      }
      case 'Enter':
        event.preventDefault();
        void place();
        break;
      case 'Escape':
        event.preventDefault();
        cancel();
        break;
      case 'Delete':
        event.preventDefault();
        void removeFromShelf();
        break;
      default:
        break;
    }
  };

  /** A refresh may take the lifted piece away; the panel says so and stays. */
  useEffect(() => {
    if (!lifted || lifted.alreadyPlaced) return;
    const stillQueued = queue.some((piece) => piece.number === lifted.piece.number);
    const nowPlaced = firing?.layers.some((item) =>
      item.placements.some((placement) => placement.piece_number === lifted.piece.number),
    );
    if (!stillQueued && !nowPlaced) {
      setPanelNote(`Piece ${lifted.piece.number} was placed elsewhere.`);
    }
  }, [queue, firing, lifted]);

  const createFiring = async (): Promise<void> => {
    if (!kiln) return;
    setFiringResult({ text: 'Creating firing…', tone: 'pending' });
    try {
      const created = await api.post<Firing>('/api/firings', {
        kiln_id: kiln.id,
        profile_id: profileId || kiln.profiles[0]?.id,
      });
      setFiringResult({ text: `Firing created with ${created.profile.name}.`, tone: 'good' });
      setNewFiringOpen(false);
      await refresh(kilnId);
    } catch (error) {
      setNewFiringOpen(false);
      setFiringResult({
        text:
          error instanceof ApiFailure && error.body.error === 'kiln_busy'
            ? 'This kiln already has a firing in progress.'
            : 'The studio server is unreachable.',
        tone: 'bad',
      });
    }
  };

  const startFiring = async (): Promise<void> => {
    if (!firing) return;
    setFiringResult({ text: 'Starting firing…', tone: 'pending' });
    try {
      const started = await api.post<Firing>(`/api/firings/${firing.id}/start`);
      setFiringResult({
        text: `Firing started. Unload opens ${started.cool_until_label ?? ''}.`,
        tone: 'good',
      });
      await refresh(kilnId);
    } catch (error) {
      setFiringResult({
        text:
          error instanceof ApiFailure && error.body.error === 'empty_load'
            ? 'Place at least one piece before starting.'
            : error instanceof ApiFailure
              ? error.body.message
              : 'The studio server is unreachable.',
        tone: 'bad',
      });
    }
  };

  const confirmUnload = async (): Promise<void> => {
    if (!firing) return;
    setFiringResult({ text: 'Unloading…', tone: 'pending' });
    const reports = Object.entries(damage)
      .filter(([, draft]) => draft.on && draft.photoId)
      .map(([pieceNumber, draft]) => ({
        piece_number: pieceNumber,
        kind: draft.kind,
        photo_id: draft.photoId,
        note: draft.note,
      }));
    try {
      await api.post(`/api/firings/${firing.id}/unload`, {
        pickup_shelf: pickupShelf,
        damage: reports,
      });
      setFiringResult({
        text: 'Firing unloaded. Pickup notices are on their way.',
        tone: 'good',
      });
      setUnloadOpen(false);
      setDamage({});
      setPickupShelf('');
      await refresh(kilnId);
    } catch (error) {
      const message =
        error instanceof ApiFailure && error.status === 422
          ? (error.fields.pickup_shelf ?? Object.values(error.fields)[0] ?? error.body.message)
          : error instanceof ApiFailure
            ? error.body.message
            : 'The studio server is unreachable.';
      setFiringResult({ text: message, tone: 'bad' });
    }
  };

  const unloadable = firing?.status === 'unloadable';
  const layerHeight = firing?.layers.find((item) => item.layer === layer)?.height_in ?? null;
  const firedPieces = firing?.layers.flatMap((item) => item.placements) ?? [];

  const choosePhoto = async (pieceNumber: string, file: File | undefined): Promise<void> => {
    if (!file) return;
    setDamage((current) => ({
      ...current,
      [pieceNumber]: {
        ...(current[pieceNumber] ?? { on: true, kind: 'glaze_run', note: '', photoId: null }),
        photoMessage: 'Uploading photo…',
      },
    }));
    try {
      const stored = await uploadPhoto(file);
      setDamage((current) => ({
        ...current,
        [pieceNumber]: {
          ...(current[pieceNumber] ?? { on: true, kind: 'glaze_run', note: '' }),
          photoId: stored.photo_id,
          photoMessage: 'Photo attached',
        },
      }));
    } catch (error) {
      const status = error instanceof ApiFailure ? error.status : 0;
      setDamage((current) => ({
        ...current,
        [pieceNumber]: {
          ...(current[pieceNumber] ?? { on: true, kind: 'glaze_run', note: '' }),
          photoId: null,
          photoMessage:
            status === 415
              ? 'Use a JPEG, PNG, WebP or HEIC photo'
              : status === 413
                ? 'Photo is over 8,000,000 bytes'
                : 'Photo not saved — storage is unreachable. Try again in a minute.',
        },
      }));
    }
  };

  return (
    <section className="board" onKeyDown={onBoardKeyDown}>
      <div className="pane kiln-rail">
        <h2>Kilns</h2>
        <nav aria-label="Kilns" className="rail-wide">
          <ul>
            {kilns.map((item) => (
              <li key={item.id}>
                <a
                  href={`/board?kiln=${item.id}`}
                  aria-current={item.id === kilnId ? 'page' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    setKilnId(item.id);
                    setLayer(1);
                    setLifted(null);
                  }}
                >
                  {item.name}
                  <br />
                  {railFirings[item.id] ? (
                    <StatusLabel
                      status={(railFirings[item.id] as Firing).status}
                      label={(railFirings[item.id] as Firing).status_label}
                    />
                  ) : (
                    <span className="mono">No load</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rail-narrow field">
          <label htmlFor="kiln-pick">Kiln</label>
          <select
            id="kiln-pick"
            value={kilnId ?? ''}
            onChange={(event) => {
              setKilnId(event.target.value);
              setLayer(1);
              setLifted(null);
            }}
          >
            {kilns.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="pane board-shelf">
        <div className="shelf-head">
          <div className="layer-tabs rail-wide" role="tablist" aria-label="Layers">
            {Array.from({ length: kiln?.layers ?? 0 }, (unused, index) => index + 1).map((item) => (
              <button
                type="button"
                key={item}
                role="tab"
                aria-selected={item === layer}
                onClick={() => changeLayer(item, null)}
              >
                Layer {item}
              </button>
            ))}
          </div>
          <div className="carousel-controls rail-narrow">
            <button type="button" onClick={() => changeLayer(layer - 1, 'left')}>
              Previous layer
            </button>
            <span className="mono">
              Layer {layer} of {kiln?.layers ?? 1}
            </span>
            <button type="button" onClick={() => changeLayer(layer + 1, 'right')}>
              Next layer
            </button>
          </div>
          <p className="mono">{layerHeight ? `Layer height ${layerHeight} in` : 'Layer empty'}</p>
          <p>
            <meter
              aria-label="Load fill"
              min={0}
              max={100}
              value={Math.min(100, firing?.fill_percent ?? 0)}
            />{' '}
            <span className="mono">Load {fill}% full</span>
          </p>
        </div>

        <Shelf
          layer={layer}
          placements={layerPlacements}
          lifted={lifted}
          slide={slide}
          settling={settling}
          onOpenPlaced={(pieceNumber) => {
            const placed = firedPieces.find((item) => item.piece_number === pieceNumber);
            if (!placed) return;
            void api.get<Piece>(`/api/pieces/${pieceNumber}`).then((piece) => {
              lift(piece, document.activeElement as HTMLElement, true);
            });
          }}
          onDragTo={(x, y) => moveTo(x, y)}
          onSwipe={(direction) =>
            changeLayer(direction === 'next' ? layer + 1 : layer - 1, direction === 'next' ? 'right' : 'left')
          }
        />

        <div className="firing-strip">
          <LiveRegion
            name="Firing status"
            message={{
              text: firing
                ? `${firing.status_label}${
                    firing.started_at
                      ? ` · Firing ends ${firing.firing_ends_at_label} · Unload opens ${firing.cool_until_label}`
                      : ''
                  }`
                : 'No firing on this kiln',
              tone: 'idle',
            }}
          />
          {firing && <StatusLabel status={firing.status} label={firing.status_label} />}
          {refreshFailed && <span className="live bad">Board not refreshed — retrying.</span>}
          <button
            type="button"
            ref={newFiringButton}
            onClick={() => {
              setProfileId(kiln?.profiles[0]?.id ?? '');
              setNewFiringOpen(true);
            }}
          >
            New firing
          </button>
          <button
            type="button"
            className="primary"
            aria-disabled={!firing || firing.status !== 'building'}
            onClick={() => {
              if (firing?.status === 'building') void startFiring();
            }}
          >
            Start firing
          </button>
          <button
            type="button"
            ref={unloadButton}
            aria-disabled={!unloadable}
            onClick={() => {
              if (unloadable) setUnloadOpen(true);
            }}
          >
            Unload
          </button>
          {firing && (firing.status === 'firing' || firing.status === 'cooling') && (
            <span>
              {firing.status === 'firing' ? 'Kiln still firing' : 'Kiln still cooling'}{' '}
              <span className="mono">Unload opens {firing.cool_until_label}</span>
            </span>
          )}
          <LiveRegion name="Firing result" message={firingResult} />
        </div>
      </div>

      <div>
        {lifted && (
          <div className="placement-panel" role="region" aria-label="Placement">
            <h3 tabIndex={-1} ref={panelHeading}>
              Placing Piece {lifted.piece.number}
            </h3>
            <p className={collision ? 'field-error' : ''}>{collision ?? 'Position clear'}</p>
            {panelNote && <p className="field-error">{panelNote}</p>}
            <div className="coord-grid">
              <div className="field">
                <label htmlFor="spot-x">X (in)</label>
                <input
                  id="spot-x"
                  data-spot="true"
                  type="number"
                  step="0.5"
                  min="0"
                  max="23"
                  value={(lifted.xHalf / 2).toFixed(1)}
                  onChange={(event) =>
                    moveTo(Math.round(Number(event.target.value) * 2), lifted.yHalf)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="spot-y">Y (in)</label>
                <input
                  id="spot-y"
                  data-spot="true"
                  type="number"
                  step="0.5"
                  min="0"
                  max="23"
                  value={(lifted.yHalf / 2).toFixed(1)}
                  onChange={(event) =>
                    moveTo(lifted.xHalf, Math.round(Number(event.target.value) * 2))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="spot-rotation">Rotation (degrees)</label>
                <input
                  id="spot-rotation"
                  data-spot="true"
                  type="number"
                  step="90"
                  min="0"
                  max="270"
                  value={rotationText}
                  onChange={(event) => {
                    setRotationText(event.target.value);
                    const value = Number(event.target.value);
                    if (value === 0 || value === 90 || value === 180 || value === 270) {
                      moveTo(lifted.xHalf, lifted.yHalf, value);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void place();
                    }
                  }}
                />
              </div>
            </div>
            <div className="nudge-grid">
              <button type="button" onClick={() => moveTo(lifted.xHalf - 1, lifted.yHalf)}>
                Move left
              </button>
              <button type="button" onClick={() => moveTo(lifted.xHalf + 1, lifted.yHalf)}>
                Move right
              </button>
              <button type="button" onClick={() => moveTo(lifted.xHalf, lifted.yHalf - 1)}>
                Move up
              </button>
              <button type="button" onClick={() => moveTo(lifted.xHalf, lifted.yHalf + 1)}>
                Move down
              </button>
            </div>
            <p>
              <button
                type="button"
                onClick={() => {
                  const next = ((lifted.rotation + 90) % 360) as Rotation;
                  setRotationText(String(next));
                  moveTo(lifted.xHalf, lifted.yHalf, next);
                }}
              >
                Rotate
              </button>{' '}
              <button type="button" className="primary" onClick={() => void place()}>
                Place
              </button>{' '}
              <button type="button" onClick={cancel}>
                Cancel
              </button>{' '}
              {lifted.alreadyPlaced && (
                <button type="button" onClick={() => void removeFromShelf()}>
                  Remove from shelf
                </button>
              )}
            </p>
          </div>
        )}

        <div className="pane">
          <h2>Tickets</h2>
          <LiveRegion name="Shelf announcements" message={announce} />
          <ul className="stub-list" aria-label="Queued pieces">
            {queue.map((piece) => (
              <li key={piece.number} className={leaving.includes(piece.number) ? 'leaving' : ''}>
                <button
                  type="button"
                  className="stub"
                  aria-label={`Pick Piece ${piece.number}`}
                  onClick={(event) => lift(piece, event.currentTarget, false)}
                >
                  <span className="stub-number">Piece {piece.number}</span>
                  <span className="stub-line">
                    {piece.sides_in.diameter
                      ? `${piece.sides_in.diameter} in × ${piece.sides_in.height} in`
                      : `${piece.sides_in.length} in × ${piece.sides_in.width} in × ${piece.sides_in.height} in`}
                  </span>
                  <span className="stub-line">
                    {piece.stage === 'glaze' ? `Glaze cone ${piece.cone ?? ''}` : 'Bisque'} ·{' '}
                    {PLAN_LABELS[piece.plan]}
                  </span>
                  <span className="stub-line">${formatMoney(piece.fee_cents)}</span>
                </button>
              </li>
            ))}
            {queue.length === 0 && <li>No tickets waiting.</li>}
          </ul>
        </div>
      </div>

      {newFiringOpen && (
        <Dialog
          name="New firing"
          onClose={() => {
            setNewFiringOpen(false);
            newFiringButton.current?.focus();
          }}
        >
          <h2>New firing</h2>
          <div className="field">
            <label htmlFor="profile-pick">Profile</label>
            <select
              id="profile-pick"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            >
              {(kiln?.profiles ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="primary" onClick={() => void createFiring()}>
            Create firing
          </button>
        </Dialog>
      )}

      {unloadOpen && firing && (
        <Dialog
          name="Unload firing"
          onClose={() => {
            setUnloadOpen(false);
            unloadButton.current?.focus();
          }}
        >
          <h2>Unload firing</h2>
          <div className="field">
            <label htmlFor="pickup-shelf">Pickup shelf</label>
            <input
              id="pickup-shelf"
              type="text"
              value={pickupShelf}
              onChange={(event) => setPickupShelf(event.target.value.toUpperCase())}
            />
          </div>
          {firedPieces.map((placed) => {
            const draft = damage[placed.piece_number];
            return (
              <div className="card" key={placed.piece_number}>
                <div className="check-row">
                  <input
                    id={`damage-${placed.piece_number}`}
                    type="checkbox"
                    checked={draft?.on ?? false}
                    onChange={(event) =>
                      setDamage((current) => ({
                        ...current,
                        [placed.piece_number]: {
                          on: event.target.checked,
                          kind: draft?.kind ?? 'glaze_run',
                          photoId: draft?.photoId ?? null,
                          note: draft?.note ?? '',
                          photoMessage: draft?.photoMessage ?? '',
                        },
                      }))
                    }
                  />
                  <label htmlFor={`damage-${placed.piece_number}`}>
                    Report damage on Piece {placed.piece_number}
                  </label>
                </div>
                {draft?.on && (
                  <>
                    <div
                      className="radio-row"
                      role="radiogroup"
                      aria-label={`Damage kind for Piece ${placed.piece_number}`}
                    >
                      {(
                        [
                          ['glaze_run', 'Glaze run'],
                          ['crack', 'Crack'],
                        ] as ['glaze_run' | 'crack', string][]
                      ).map(([value, label]) => (
                        <label key={value}>
                          <input
                            type="radio"
                            name={`kind-${placed.piece_number}`}
                            checked={draft.kind === value}
                            onChange={() =>
                              setDamage((current) => ({
                                ...current,
                                [placed.piece_number]: { ...draft, kind: value },
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="field">
                      <label htmlFor={`damage-photo-${placed.piece_number}`}>
                        Damage photo for Piece {placed.piece_number}
                      </label>
                      <input
                        id={`damage-photo-${placed.piece_number}`}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/*"
                        capture="environment"
                        onChange={(event) =>
                          void choosePhoto(placed.piece_number, event.target.files?.[0])
                        }
                      />
                      <span className="live">{draft.photoMessage}</span>
                    </div>
                    <div className="field">
                      <label htmlFor={`damage-note-${placed.piece_number}`}>Damage note</label>
                      <textarea
                        id={`damage-note-${placed.piece_number}`}
                        value={draft.note}
                        onChange={(event) =>
                          setDamage((current) => ({
                            ...current,
                            [placed.piece_number]: { ...draft, note: event.target.value },
                          }))
                        }
                      />
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <button type="button" className="primary" onClick={() => void confirmUnload()}>
            Confirm unload
          </button>
        </Dialog>
      )}
    </section>
  );
}
