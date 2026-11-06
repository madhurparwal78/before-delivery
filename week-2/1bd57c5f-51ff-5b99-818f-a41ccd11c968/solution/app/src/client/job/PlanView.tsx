import { Check, Maximize } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Item, Job, Room } from "../../shared/domain";
import { roundPin, type Bounds } from "../../shared/geometry";
import { CrosshairGlyph } from "../components/Glyphs";
import { COPY, numberText } from "../copy";
import { EASE, PAN_MS } from "../motion";

// The plan pane: the plan image laid on a sheet over a faint grid, room outlines with their
// counts, a numbered pin per pinned item and, while placing, the crosshair. Framing pans and
// zooms the sheet by animating three registered custom properties that drive its transform.

const PAD = 24;
/** The fitted sheet sits just under the Fit plan control rather than floating mid-pane. */
const TOP = 64;
const FILL = 0.8;
const PLAN_CACHE = "snaglight-plans";

export interface PlanHandle {
  /** Frames a room (or the whole plan for null); resolves when the pan has finished. */
  frame(roomId: string | null, animate: boolean): Promise<void>;
  pinElement(itemId: string): HTMLElement | null;
  pane(): HTMLElement | null;
}

export interface Placement {
  itemId: string;
  number: number;
  x: number;
  y: number;
}

interface PlanViewProps {
  job: Job;
  planKey: number;
  rooms: Room[];
  items: Item[];
  initialRoomId: string | null;
  ringedId: string | null;
  placement: Placement | null;
  onPin: (item: Item) => void;
  onPoint: (x: number, y: number) => void;
  onDropItem: (itemId: string, x: number, y: number) => void;
  placementBar: ReactNode;
}

type LabelSide = "centre" | "below" | "above" | "right" | "left";
const LABEL_SIDES: readonly LabelSide[] = ["centre", "below", "above", "right", "left"];
/** The drawn pin disc's radius plus a breath of space, in px. */
const PIN_CLEARANCE = 19;
const LABEL_GAP = 6;

interface Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

function labelBox(anchor: { x: number; y: number }, size: { w: number; h: number }, side: LabelSide): Box {
  const across = { left: anchor.x - size.w / 2, w: size.w, h: size.h };
  switch (side) {
    case "centre":
      return { ...across, top: anchor.y - size.h / 2 };
    case "below":
      return { ...across, top: anchor.y + LABEL_GAP };
    case "above":
      return { ...across, top: anchor.y - size.h - LABEL_GAP };
    case "right":
      return { left: anchor.x + LABEL_GAP, top: anchor.y - size.h / 2, w: size.w, h: size.h };
    case "left":
      return { left: anchor.x - size.w - LABEL_GAP, top: anchor.y - size.h / 2, w: size.w, h: size.h };
  }
}

/**
 * Which side of its anchor each room label takes, in room order: the one that least overlaps the
 * pins, the labels already placed and the plan's edges, preferring centre, below, above, right,
 * left. Judged at the fitted view; zooming in only spreads pins and anchors apart, while labels
 * and pins keep their size.
 */
function labelSides(
  labels: readonly { id: string; anchor: { x: number; y: number }; size: { w: number; h: number } }[],
  pins: readonly { x: number; y: number }[],
  plan: { width: number; height: number },
): Map<string, LabelSide> {
  const placed: Box[] = [];
  const sides = new Map<string, LabelSide>();
  for (const label of labels) {
    const cost = (side: LabelSide) => {
      const box = labelBox(label.anchor, label.size, side);
      const offPlan =
        Math.max(0, -box.left) + Math.max(0, box.left + box.w - plan.width) + Math.max(0, -box.top) + Math.max(0, box.top + box.h - plan.height);
      const onPins = pins.reduce((sum, pin) => {
        const dx = Math.max(box.left - pin.x, 0, pin.x - (box.left + box.w));
        const dy = Math.max(box.top - pin.y, 0, pin.y - (box.top + box.h));
        return sum + Math.max(0, PIN_CLEARANCE - Math.hypot(dx, dy));
      }, 0);
      const onLabels = placed.reduce((sum, other) => {
        const w = Math.min(box.left + box.w, other.left + other.w) - Math.max(box.left, other.left);
        const h = Math.min(box.top + box.h, other.top + other.h) - Math.max(box.top, other.top);
        return sum + (w > 0 && h > 0 ? Math.min(w, h) : 0);
      }, 0);
      return offPlan + onPins + onLabels;
    };
    const side = LABEL_SIDES.reduce((best, candidate) => (cost(candidate) < cost(best) ? candidate : best));
    sides.set(label.id, side);
    placed.push(labelBox(label.anchor, label.size, side));
  }
  return sides;
}

interface View {
  tx: number;
  ty: number;
  zoom: number;
}

/** Fetches the plan image, keeping a copy so the plan opens again with no signal. */
async function loadPlan(url: string): Promise<Blob | null> {
  const store = "caches" in window ? caches : null;
  try {
    const response = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
    if (!response.ok) return null;
    const copy = response.clone();
    void store?.open(PLAN_CACHE).then((cache) => cache.put(url, copy));
    return await response.blob();
  } catch {
    const hit = await store?.match(url, { cacheName: PLAN_CACHE });
    return hit ? hit.blob() : null;
  }
}

function fraction(event: { clientX: number; clientY: number }, stage: HTMLElement): { x: number; y: number } {
  const box = stage.getBoundingClientRect();
  const clamp = (value: number) => roundPin(Math.min(1, Math.max(0, value)));
  return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) };
}

export const PlanView = forwardRef<PlanHandle, PlanViewProps>(function PlanView(props, ref) {
  const { job, planKey, rooms, items, initialRoomId, ringedId, placement, onPin, onPoint, onDropItem, placementBar } = props;
  const paneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const [aspect, setAspect] = useState(1.5);
  const [image, setImage] = useState<{ state: "loading" | "none" | "unavailable" } | { state: "ready"; src: string }>({ state: "loading" });
  const framed = useRef<string | null>(initialRoomId);
  const view = useRef<View>({ tx: 0, ty: 0, zoom: 1 });
  const running = useRef<Animation | null>(null);
  const labelRefs = useRef(new Map<string, HTMLDivElement>());
  const [labelSizes, setLabelSizes] = useState<ReadonlyMap<string, { w: number; h: number }>>(new Map());

  const sheet = useCallback(() => {
    const width = Math.max(0, Math.min(pane.width - 2 * PAD, (pane.height - TOP - PAD) * aspect));
    return { width, height: width / aspect };
  }, [pane, aspect]);

  const target = useCallback(
    (bounds: Bounds | null): View => {
      const { width, height } = sheet();
      if (!bounds || width === 0) return { tx: (pane.width - width) / 2, ty: Math.max(TOP, (pane.height - height) / 2), zoom: 1 };
      const zoom = Math.min((pane.width * FILL) / (bounds.w * width), (pane.height * FILL) / (bounds.h * height));
      const cx = (bounds.x + bounds.w / 2) * width * zoom;
      const cy = (bounds.y + bounds.h / 2) * height * zoom;
      return { tx: pane.width / 2 - cx, ty: pane.height / 2 - cy, zoom };
    },
    [sheet, pane],
  );

  const apply = (next: View) => {
    view.current = next;
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty("--tx", `${next.tx}px`);
    stage.style.setProperty("--ty", `${next.ty}px`);
    stage.style.setProperty("--zoom", String(next.zoom));
  };

  const boundsOf = useCallback((roomId: string | null) => rooms.find((room) => room.id === roomId)?.bounds ?? null, [rooms]);

  /** Moves the sheet to `next`, over the pan duration when animated; resolves when it arrives. */
  const pan = useCallback(async (next: View, animate: boolean) => {
    const stage = stageRef.current;
    running.current?.cancel();
    const from = view.current;
    apply(next);
    if (!animate || !stage) return;
    const animation = stage.animate(
      [
        { "--tx": `${from.tx}px`, "--ty": `${from.ty}px`, "--zoom": String(from.zoom) },
        { "--tx": `${next.tx}px`, "--ty": `${next.ty}px`, "--zoom": String(next.zoom) },
      ],
      { duration: PAN_MS, easing: EASE },
    );
    running.current = animation;
    try {
      await animation.finished;
    } catch {
      // A newer pan replaced this one.
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      frame(roomId, animate) {
        framed.current = roomId;
        return pan(target(boundsOf(roomId)), animate);
      },
      pinElement: (itemId) => stageRef.current?.querySelector<HTMLElement>(`[data-pin-id="${itemId}"]`) ?? null,
      pane: () => paneRef.current,
    }),
    [pan, target, boundsOf],
  );

  useLayoutEffect(() => {
    const element = paneRef.current;
    if (!element) return;
    // Measured now as well as on every resize, so the sheet is placed before the first paint.
    setPane({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPane({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Label sizes, for placing each label clear of the pins.
  useLayoutEffect(() => {
    const sizes = new Map([...labelRefs.current].map(([id, element]) => [id, { w: element.offsetWidth, h: element.offsetHeight }]));
    setLabelSizes((previous) =>
      [...sizes].every(([id, size]) => previous.get(id)?.w === size.w && previous.get(id)?.h === size.h) && previous.size === sizes.size
        ? previous
        : sizes,
    );
  });

  // Keep the current framing when the pane or the plan's shape changes, without motion.
  useLayoutEffect(() => {
    apply(target(boundsOf(framed.current)));
  }, [target, boundsOf]);

  useEffect(() => {
    if (!job.plan_url) {
      setImage({ state: "none" });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setImage({ state: "loading" });
    void loadPlan(job.plan_url).then((blob) => {
      if (cancelled) return;
      if (!blob) setImage({ state: "unavailable" });
      else {
        objectUrl = URL.createObjectURL(blob);
        setImage({ state: "ready", src: objectUrl });
      }
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [job.plan_url, planKey]);

  const { width, height } = sheet();
  const pinned = items.filter((item) => item.pin && item.id !== placement?.itemId).sort((a, b) => a.number - b.number);
  const sides = labelSides(
    rooms.map((room) => ({
      id: room.id,
      anchor: { x: room.anchor.x * width, y: room.anchor.y * height },
      size: labelSizes.get(room.id) ?? { w: 0, h: 0 },
    })),
    pinned.map((item) => ({ x: item.pin!.x * width, y: item.pin!.y * height })),
    { width, height },
  );

  return (
    <section ref={paneRef} className="plan" aria-label="Plan">
      <div
        ref={stageRef}
        className={placement ? "plan-stage placing" : "plan-stage"}
        style={{ width, height }}
        onClick={(event) => {
          if (placement && stageRef.current) {
            const point = fraction(event, stageRef.current);
            onPoint(point.x, point.y);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-snaglight-item")) event.preventDefault();
        }}
        onDrop={(event) => {
          const itemId = event.dataTransfer.getData("application/x-snaglight-item");
          if (!itemId || !stageRef.current) return;
          event.preventDefault();
          const point = fraction(event, stageRef.current);
          onDropItem(itemId, point.x, point.y);
        }}
      >
        {image.state === "ready" && (
          <img
            className="plan-image"
            src={image.src}
            alt={`Floor plan of ${job.name}`}
            draggable={false}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setAspect(naturalWidth / naturalHeight);
            }}
          />
        )}
        <svg className="plan-outlines" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          {rooms.map((room) => (
            <polygon key={room.id} points={room.outline.map((corner) => `${corner.x * 1000},${corner.y * 1000}`).join(" ")} />
          ))}
        </svg>
        {rooms.map((room) => (
          <div
            key={room.id}
            ref={(element) => {
              if (element) labelRefs.current.set(room.id, element);
              else labelRefs.current.delete(room.id);
            }}
            className={`room-label room-label--${sides.get(room.id)}`}
            style={{ left: `${room.anchor.x * 100}%`, top: `${room.anchor.y * 100}%` }}
          >
            <span className="room-label-name">{room.name}</span>
            <span className="room-label-count">
              {room.counts.verified}/{room.counts.total}
            </span>
          </div>
        ))}
        {pinned.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`pin${item.status === "verified" ? " pin--verified" : ""}${ringedId === item.id ? " ringed" : ""}`}
            style={{ left: `${item.pin!.x * 100}%`, top: `${item.pin!.y * 100}%`, pointerEvents: placement ? "none" : undefined }}
            aria-label={`Pin ${numberText(item.number)}: ${item.title}`}
            data-pin-id={item.id}
            onClick={(event) => {
              event.stopPropagation();
              onPin(item);
            }}
          >
            {item.status === "verified" ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : <span aria-hidden="true">{numberText(item.number)}</span>}
          </button>
        ))}
        {placement && (
          <div className="crosshair" data-crosshair="" aria-hidden="true" style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%` }}>
            <CrosshairGlyph />
          </div>
        )}
      </div>
      {image.state === "unavailable" && <p className="plan-message">{COPY.planUnavailable}</p>}
      {image.state === "none" && <p className="plan-message">No floor plan uploaded yet.</p>}
      <div className="plan-controls">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            framed.current = null;
            void pan(target(null), false);
          }}
        >
          <Maximize size={16} aria-hidden="true" />
          Fit plan
        </button>
      </div>
      {placementBar}
    </section>
  );
});
