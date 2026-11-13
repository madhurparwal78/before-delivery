import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { COPY } from "./deck";
import { Fader, type FaderConfig } from "./fader";
import { KettleOutline } from "./kettle";
import { EASE, SWAP_HALF_MS, SWAP_MS, TILE_SLIDE_PX, prefersReducedMotion } from "./motion";

export interface Subject {
  key: string;
  name: string;
  size: string;
  swatch: string | null;
  photo: string;
  /** Smaller copies of `photo` by width, so the tile loads only the pixels it shows. */
  srcSet?: string;
  /** Set while the whole upright photo is shown, fitted inside the tile. */
  whole?: { aspect: number };
}

export interface Marker {
  x: number;
  y: number;
}

interface Picker {
  marker: Marker | null;
  onPick: ((x: number, y: number) => void) | null;
}

type Slide = 1 | -1 | 0;

interface PhotoItem {
  id: number;
  subject: Subject;
  slide: Slide;
}

interface TileState {
  fill: string | null;
  caption: { name: string; size: string } | null;
  photos: PhotoItem[];
  message: string | null;
  swapId: number;
  swapping: boolean;
}

const EMPTY_TILE: TileState = { fill: null, caption: null, photos: [], message: null, swapId: 0, swapping: false };

interface FieldApi {
  show: (subject: Subject | null, message?: string | null) => void;
  swapTo: (subject: Subject, direction: 1 | -1) => void;
  announce: (text: string) => void;
  setFader: (config: FaderConfig | null) => void;
  setPicker: (picker: Picker | null) => void;
  setNote: (note: string | null) => void;
}

interface FieldView {
  markFailed: (id: number) => void;
  tile: TileState;
  failed: readonly number[];
  announcement: string;
  fader: FaderConfig | null;
  picker: Picker | null;
  note: string | null;
}

const FieldApiContext = createContext<FieldApi | null>(null);
const FieldViewContext = createContext<FieldView | null>(null);

function captionOf(subject: Subject): { name: string; size: string } {
  return { name: subject.name, size: subject.size };
}

export function FieldProvider({ children }: { children: ReactNode }) {
  const [tile, setTile] = useState<TileState>(EMPTY_TILE);
  const [failed, setFailed] = useState<readonly number[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [fader, setFaderState] = useState<FaderConfig | null>(null);
  const [picker, setPickerState] = useState<Picker | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const tileRef = useRef<TileState>(EMPTY_TILE);
  const swapRef = useRef<{ target: PhotoItem; timers: number[] } | null>(null);
  const idRef = useRef(0);

  const commit = useCallback((next: TileState) => {
    tileRef.current = next;
    setTile(next);
  }, []);

  const settle = useCallback(() => {
    const swap = swapRef.current;
    if (!swap) return;
    swapRef.current = null;
    swap.timers.forEach((timer) => window.clearTimeout(timer));
    commit({
      ...tileRef.current,
      fill: swap.target.subject.swatch,
      caption: captionOf(swap.target.subject),
      photos: [{ ...swap.target, slide: 0 }],
      swapping: false,
    });
  }, [commit]);

  const show = useCallback(
    (subject: Subject | null, message: string | null = null) => {
      settle();
      const current = tileRef.current;
      if (!subject) {
        commit({ ...current, fill: null, caption: null, photos: [], message, swapping: false, swapId: current.swapId + 1 });
        return;
      }
      const held = current.photos[0];
      const same = held !== undefined && held.subject.key === subject.key && held.subject.photo === subject.photo;
      const item: PhotoItem = same ? { ...held, subject, slide: 0 } : { id: ++idRef.current, subject, slide: 0 };
      commit({
        fill: subject.swatch,
        caption: captionOf(subject),
        photos: [item],
        message: null,
        swapping: false,
        swapId: current.swapId + (same ? 0 : 1),
      });
    },
    [commit, settle],
  );

  const swapTo = useCallback(
    (subject: Subject, direction: 1 | -1) => {
      if (prefersReducedMotion() || tileRef.current.photos.length === 0) {
        show(subject);
        return;
      }
      settle();
      const base = tileRef.current;
      const held = base.photos[0];
      if (held && held.subject.key === subject.key && held.subject.photo === subject.photo) {
        show(subject);
        return;
      }
      const incoming: PhotoItem = { id: ++idRef.current, subject, slide: direction };
      commit({
        ...base,
        fill: subject.swatch,
        photos: [...base.photos, incoming],
        message: null,
        swapId: base.swapId + 1,
        swapping: true,
      });
      const swap = { target: incoming, timers: [] as number[] };
      swapRef.current = swap;
      swap.timers.push(
        window.setTimeout(() => {
          commit({ ...tileRef.current, caption: captionOf(subject), photos: [incoming] });
        }, SWAP_HALF_MS),
        window.setTimeout(() => {
          swapRef.current = null;
          commit({ ...tileRef.current, photos: [{ ...incoming, slide: 0 }], swapping: false });
        }, SWAP_MS),
      );
    },
    [commit, settle, show],
  );

  const api = useMemo<FieldApi>(
    () => ({
      show,
      swapTo,
      announce: setAnnouncement,
      setFader: setFaderState,
      setPicker: setPickerState,
      setNote,
    }),
    [show, swapTo],
  );

  const markFailed = useCallback((id: number) => setFailed((previous) => [...previous, id]), []);

  const view = useMemo<FieldView>(
    () => ({ tile, failed, announcement, fader, picker, note, markFailed }),
    [tile, failed, announcement, fader, picker, note, markFailed],
  );

  return (
    <FieldApiContext.Provider value={api}>
      <FieldViewContext.Provider value={view}>{children}</FieldViewContext.Provider>
    </FieldApiContext.Provider>
  );
}

export function useField(): FieldApi {
  const value = useContext(FieldApiContext);
  if (!value) throw new Error("FieldProvider is missing");
  return value;
}

function useFieldView(): FieldView {
  const value = useContext(FieldViewContext);
  if (!value) throw new Error("FieldProvider is missing");
  return value;
}

/** The widths the server also serves a display crop at (server/pixels.ts SHRINK_WIDTHS). */
const DISPLAY_WIDTHS = [120, 240, 480, 800] as const;

/** The share of the tile's width the cropped photo takes (styles.css .tile .photo). */
const PHOTO_SHARE = 0.7;

/** A srcset for a display crop: the shrunk copies below its own width, then the crop itself. */
export function displaySrcSet(url: string, photo: { width: number; height: number }): string {
  const side = Math.min(1200, photo.width, photo.height);
  return [
    ...DISPLAY_WIDTHS.filter((width) => width < side).map((width) => `${url}?w=${width} ${width}w`),
    `${url} ${side}w`,
  ].join(", ");
}

/** Where the whole upright photo sits inside the square tile, as fractions of the tile. */
function containRect(aspect: number): { left: number; top: number; width: number; height: number } {
  return aspect >= 1
    ? { left: 0, top: (1 - 1 / aspect) / 2, width: 1, height: 1 / aspect }
    : { left: (1 - aspect) / 2, top: 0, width: aspect, height: 1 };
}

function Tile() {
  const { tile, failed, picker, markFailed } = useFieldView();
  const tileElement = useRef<HTMLDivElement>(null);
  const shutter = useRef<HTMLDivElement>(null);
  const [tileWidth, setTileWidth] = useState(0);

  useLayoutEffect(() => {
    const element = tileElement.current;
    if (!element) return;
    const measure = () => setTileWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = tileElement.current;
    if (!element) return;
    for (const node of element.querySelectorAll(".photo, .shutter")) {
      node.getAnimations().forEach((animation) => animation.cancel());
    }
    if (!tile.swapping) return;
    shutter.current?.animate(
      [
        { transform: "scaleY(0)", easing: EASE },
        { transform: "scaleY(1)", offset: 0.5, easing: EASE },
        { transform: "scaleY(0)" },
      ],
      { duration: SWAP_MS },
    );
    const incoming = element.querySelector<HTMLElement>('.photo[data-slide="1"], .photo[data-slide="-1"]');
    if (incoming) {
      const from = Number(incoming.dataset.slide) * TILE_SLIDE_PX;
      incoming.animate(
        [
          { transform: `translateX(${from}px)`, opacity: 0, easing: EASE },
          { transform: `translateX(${from}px)`, opacity: 0, offset: 0.5, easing: EASE },
          { transform: "translateX(0)", opacity: 1 },
        ],
        { duration: SWAP_MS },
      );
    }
  }, [tile.swapId, tile.swapping]);

  const last = tile.photos[tile.photos.length - 1];
  const whole = last?.subject.whole;
  const photoFailed = tile.photos.some((photo) => failed.includes(photo.id));

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!picker?.onPick || !whole) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const rect = containRect(whole.aspect);
    const x = ((event.clientX - bounds.left) / bounds.width - rect.left) / rect.width;
    const y = ((event.clientY - bounds.top) / bounds.height - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    picker.onPick(x, y);
  };

  const marker = picker?.marker;
  const markerRect = whole ? containRect(whole.aspect) : null;

  return (
    <figure className="figure" aria-label="Current reference">
      <div
        ref={tileElement}
        className={`tile${tile.swapping ? " swapping" : ""}${whole ? " whole" : ""}${picker?.onPick ? " picking" : ""}`}
        style={tile.fill ? { backgroundColor: tile.fill } : undefined}
        onClick={onClick}
      >
        {tile.photos.length === 0 && <KettleOutline />}
        {tile.photos.map((photo) => (
          <img
            key={photo.id}
            className={`photo${photo.subject.whole ? " whole" : ""}`}
            // With a srcset, wait for the tile's measured width (a layout effect, before paint) so the
            // browser fetches only the candidate it keeps instead of starting one and aborting it.
            src={photo.subject.srcSet && tileWidth === 0 ? undefined : photo.subject.photo}
            srcSet={photo.subject.srcSet && tileWidth > 0 ? photo.subject.srcSet : undefined}
            sizes={photo.subject.srcSet && tileWidth > 0 ? `${Math.ceil(tileWidth * PHOTO_SHARE)}px` : undefined}
            alt={photo.subject.name}
            data-slide={photo.slide}
            data-failed={failed.includes(photo.id) || undefined}
            draggable={false}
            onError={() => markFailed(photo.id)}
          />
        ))}
        <div ref={shutter} className="shutter" aria-hidden="true" />
        {marker && markerRect && (
          <div
            className="marker"
            aria-hidden="true"
            style={{
              left: `${(markerRect.left + marker.x * markerRect.width) * 100}%`,
              top: `${(markerRect.top + marker.y * markerRect.height) * 100}%`,
            }}
          />
        )}
      </div>
      <figcaption>
        {tile.message !== null && <p className="tile-message">{tile.message}</p>}
        {tile.message === null && photoFailed && <p className="tile-message">{COPY.photoUnavailable}</p>}
        {tile.message === null && !photoFailed && tile.caption && (
          <>
            <span className="caption-name">{tile.caption.name}</span>
            {tile.caption.size && <span className="caption-size">{tile.caption.size}</span>}
          </>
        )}
      </figcaption>
    </figure>
  );
}

export function Field() {
  const { fader, announcement, note } = useFieldView();
  return (
    <aside className="field" aria-label="Reference field">
      <div className={fader ? "stage has-fader" : "stage"}>
        <Tile />
        <p className="field-note">{note}</p>
        {fader && <Fader config={fader} />}
      </div>
      {fader && (
        <div role="status" aria-label="Reel announcer" className="sr-only">
          {announcement}
        </div>
      )}
    </aside>
  );
}
