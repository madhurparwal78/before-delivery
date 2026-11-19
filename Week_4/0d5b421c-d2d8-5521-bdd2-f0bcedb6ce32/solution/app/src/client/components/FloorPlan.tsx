// The drawn floor plan: six outlined rooms of slate tables. One listbox, one option per table.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { geometryFor } from "./geometry.js";
import { PatternDefs, TableGlyph, type Look } from "./TableGlyph.js";
import { PlaceSettings } from "./HeldMarks.js";

export interface PlanItem {
  id: string;
  name: string;
  idLabel: string;
  statusWord: string;
  look: Look;
  maxSeats: number;
  /** Party size of the hold lying on this table, if any. */
  holdParty: number | null;
  /** On a joined pair: the settings laid on its other table, and the id they are named by. */
  firstSetting?: number;
  settingsId?: string;
  ring?: ReactNode;
  note?: string;
}

export interface PlanRoom {
  roomId: string;
  name: string;
  items: PlanItem[];
}

export function FloorPlan({
  label,
  rooms,
  firstStop,
  onChoose,
  focusRequest,
}: {
  label: string;
  rooms: PlanRoom[];
  firstStop: string | null;
  onChoose: (item: PlanItem) => void;
  focusRequest: { id: string; nonce: number } | null;
}) {
  const items = rooms.flatMap((room) => room.items);
  const [stop, setStop] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const tabbable = stop !== null && items.some((item) => item.id === stop) ? stop : (firstStop ?? items[0]?.id ?? null);

  useEffect(() => {
    if (focusRequest !== null) nodes.current.get(focusRequest.id)?.focus();
  }, [focusRequest]);

  const move = (from: string, step: number | "first" | "last"): void => {
    const index = items.findIndex((item) => item.id === from);
    const target =
      step === "first" ? 0 : step === "last" ? items.length - 1 : (index + step + items.length) % items.length;
    const next = items[target];
    if (next !== undefined) {
      setStop(next.id);
      nodes.current.get(next.id)?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, item: PlanItem): void => {
    const keys: Record<string, number | "first" | "last"> = {
      ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last",
    };
    const step = keys[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(item.id, step);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onChoose(item);
    }
  };

  return (
    <div className="plan" role="listbox" aria-label={label}>
      <PatternDefs />
      {rooms.map((room) => (
        <div className="room" role="group" aria-label={room.name} key={room.roomId}>
          <div className="room-name" aria-hidden="true">
            {room.name}
          </div>
          <div className="room-tables">
            {room.items.map((item) => {
              const geometry = geometryFor(item.maxSeats);
              const firstSetting = item.firstSetting ?? 0;
              const seatsLaid = item.holdParty === null ? 0 : Math.min(item.maxSeats, Math.max(0, item.holdParty - firstSetting));
              return (
                <div className="slot-cell" key={item.id} style={{ minWidth: Math.max(geometry.box.width, 112) }}>
                  <div
                    role="option"
                    aria-label={item.name}
                    aria-selected={item.look === "solid" && item.holdParty !== null}
                    tabIndex={tabbable === item.id ? 0 : -1}
                    data-look={item.look}
                    className="table-option"
                    ref={(node) => {
                      if (node === null) nodes.current.delete(item.id);
                      else nodes.current.set(item.id, node);
                    }}
                    onFocus={() => setStop(item.id)}
                    onClick={() => onChoose(item)}
                    onKeyDown={(event) => onKeyDown(event, item)}
                  >
                    <TableGlyph geometry={geometry} look={item.look} seatsFaded={item.holdParty === null ? 0 : item.maxSeats - seatsLaid} laying={item.holdParty !== null} />
                    {/* The id is drawn, not written: it already leads the option's name, whose visible copy is the status word. */}
                    <span className="table-id" data-id={item.idLabel} aria-hidden="true" />
                    <span className="table-status">{item.statusWord}</span>
                  </div>
                  <div className="overlay" style={{ width: geometry.box.width, height: geometry.box.height }}>
                    {item.ring}
                    <PlaceSettings tableId={item.settingsId ?? item.id} geometry={geometry} partySize={item.holdParty} firstSetting={firstSetting} />
                  </div>
                  {item.note === undefined ? null : <span className="held-for">{item.note}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
