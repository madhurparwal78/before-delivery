/** The plan: the paper sheet with its grid, room outlines, room labels, pins
 *  and the placement crosshair, shown in the pane, the tablet rail or the
 *  phone bottom sheet. */

import { useEffect, useRef, useState } from "react";
import type { Item, JobData } from "../api.js";
import { BottomSheet } from "../components.js";

export type PlanRect = { left: number; top: number; width: number; height: number };
export type PlacementState = { itemId: string; x: number; y: number };

type SheetProps = {
  data: JobData;
  items: Item[];
  overlayItem: (item: Item) => Item;
  selectedId: string | null;
  placement: PlacementState | null;
  reduced: boolean;
  onPlanRect: (rect: PlanRect | null) => void;
  onPlacementMove: (dx: number, dy: number) => void;
  onPlacementSet: (x: number, y: number) => void;
  onPlacementDrop: () => void;
  onPlacementCancel: () => void;
  onPinSelect: (id: string) => void;
};

export function PlanArea(props: SheetProps & {
  railOpen: boolean;
  sheetOpen: boolean;
  onRailOpenChange: (open: boolean) => void;
  onSheetOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { railOpen, sheetOpen, onRailOpenChange, onSheetOpenChange } = props;
  return (
    <>
      <div className="plan-pane"><PlanSheet {...props} /></div>
      <div className="plan-rail" data-open={railOpen} hidden={!railOpen}>
        <PlanSheet {...props} />
      </div>
      <div className="show-plan-button tablet-only">
        <button type="button" className="quiet" aria-expanded={railOpen} onClick={() => onRailOpenChange(!railOpen)}>Show plan</button>
      </div>
      <div className="phone-plan-bar">
        <button type="button" className="quiet" onClick={() => onSheetOpenChange(true)}>Show plan</button>
      </div>
      {sheetOpen && (
        <BottomSheet title="Plan" onClose={() => onSheetOpenChange(false)}>
          <PlanSheet {...props} />
        </BottomSheet>
      )}
    </>
  );
}

export function PlanSheet({ data, items, overlayItem, selectedId, placement, reduced, onPlanRect, onPlacementMove, onPlacementSet, onPlacementDrop, onPlacementCancel, onPinSelect }: SheetProps): JSX.Element {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<PlanRect | null>(null);
  const [failed, setFailed] = useState(false);

  const measure = (): void => {
    const img = imgRef.current;
    const parent = sheetRef.current;
    if (img === null || parent === null || img.naturalWidth === 0) return;
    const scale = Math.min((parent.clientWidth - 20) / img.naturalWidth, (parent.clientHeight - 60) / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    setRect({ left: 10 + (parent.clientWidth - 20 - width) / 2, top: 10 + (parent.clientHeight - 60 - height) / 2, width, height });
  };

  useEffect(() => {
    onPlanRect(rect);
  }, [rect, onPlanRect]);

  useEffect(() => {
    const observer = new ResizeObserver(() => measure());
    if (sheetRef.current !== null) observer.observe(sheetRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (placement === null) return;
    const onKey = (e: KeyboardEvent): void => {
      const step = e.shiftKey ? 0.05 : 0.01;
      if (e.key === "ArrowLeft") { e.preventDefault(); onPlacementMove(-step, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); onPlacementMove(step, 0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); onPlacementMove(0, -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); onPlacementMove(0, step); }
      else if (e.key === "Enter") { e.preventDefault(); onPlacementDrop(); }
      else if (e.key === "Escape") { e.preventDefault(); onPlacementCancel(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [placement, onPlacementMove, onPlacementDrop, onPlacementCancel]);

  const pinned = items.filter((i) => overlayItem(i).pin !== null);
  const placementNumber = placement === null ? "" : (() => {
    const found = items.find((i) => i.id === placement.itemId);
    return found === undefined || found.number === -1 ? "" : found.number;
  })();

  const handleSheetClick = (e: React.MouseEvent): void => {
    if (placement === null || rect === null) return;
    const bounds = sheetRef.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    const x = Math.min(1, Math.max(0, (e.clientX - bounds.left - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - bounds.top - rect.top) / rect.height));
    onPlacementSet(x, y);
  };

  return (
    <div
      className="plan-sheet" ref={sheetRef} role="region" aria-label="Plan"
      onClick={handleSheetClick}
      style={{ cursor: placement === null ? undefined : "crosshair" }}
    >
      <div className="plan-grid" aria-hidden="true" />
      {data.job.plan_url === null || failed ? (
        <p className="plan-unavailable">Plan unavailable right now.</p>
      ) : (
        <>
          <img
            ref={imgRef}
            className="plan-img"
            src={data.job.plan_url}
            alt={`Floor plan of ${data.job.name}`}
            onLoad={measure}
            onError={() => setFailed(true)}
            style={{ left: `${rect?.left ?? 0}px`, top: `${rect?.top ?? 0}px`, width: `${rect?.width ?? 0}px`, height: `${rect?.height ?? 0}px` }}
          />
          {rect !== null && (
            <>
              <svg
                className="room-polygon" aria-hidden="true"
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                viewBox="0 0 1 1" preserveAspectRatio="none"
              >
                {data.rooms.map((room) => (
                  <polygon
                    key={room.id}
                    points={room.outline.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                    fill="none" stroke="var(--blueprint)" strokeWidth="2" vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {data.rooms.map((room) => (
                <span
                  key={room.id} className="room-label" aria-hidden="true"
                  style={{ left: rect.left + room.anchor.x * rect.width, top: rect.top + room.anchor.y * rect.height }}
                >
                  {room.name} <span className="num">{room.counts.verified}/{room.counts.total}</span>
                </span>
              ))}
              {pinned.map((raw) => {
                const item = overlayItem(raw);
                const pin = item.pin!;
                const isSelected = selectedId === item.id;
                const label = `Pin ${item.number === -1 ? "" : item.number}: ${item.title}`;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`pin ${item.status === "verified" ? "verified" : ""} ${isSelected && reduced ? "static-ring" : ""} ${isSelected && !reduced ? "pulse" : ""}`}
                    style={{ left: rect.left + pin.x * rect.width, top: rect.top + pin.y * rect.height }}
                    aria-label={label}
                    onClick={(e) => { e.stopPropagation(); onPinSelect(item.id); }}
                  >
                    {item.status === "verified" ? "✓" : item.number === -1 ? "…" : item.number}
                  </button>
                );
              })}
              {placement !== null && (
                <>
                  <span
                    className="crosshair" data-crosshair="true" aria-hidden="true"
                    style={{ left: rect.left + placement.x * rect.width, top: rect.top + placement.y * rect.height }}
                  />
                  <div className="placement-bar" onClick={(e) => e.stopPropagation()}>
                    <span role="status" aria-live="assertive" aria-label="Pin placement" className="mono">
                      Placing pin for item {placementNumber}: {Math.round(placement.x * 100)}% across, {Math.round(placement.y * 100)}% down.
                    </span>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="primary" onClick={onPlacementDrop}>Drop pin</button>
                    <button type="button" className="quiet" onClick={onPlacementCancel}>Cancel placement</button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      <button type="button" className="quiet fit-plan" onClick={(e) => { e.stopPropagation(); measure(); }}>Fit plan</button>
    </div>
  );
}
