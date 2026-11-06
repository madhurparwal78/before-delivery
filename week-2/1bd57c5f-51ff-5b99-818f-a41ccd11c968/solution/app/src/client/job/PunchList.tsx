import { useEffect, useId, useRef, useState } from "react";
import {
  FIELD_LABELS,
  STATUS_LABELS,
  TRADES,
  TRADE_LABELS,
  isCrew,
  isTrade,
  type Conflict,
  type EditableField,
  type FieldValue,
  type Item,
  type ItemStatus,
  type Room,
  type Trade,
} from "../../shared/domain";
import { EmptyGlyph } from "../components/Glyphs";
import { COPY, percent } from "../copy";
import { useJob } from "./context";
import { HouseAccess } from "./HouseAccess";
import { ItemRow } from "./ItemRow";

/** A conflict value as the conflict group prints it. */
function valueText(field: EditableField, value: FieldValue, rooms: Room[]): string {
  if (field === "room_id") return rooms.find((room) => room.id === value)?.name ?? "Unknown room";
  if (field === "trade") return isTrade(value) ? TRADE_LABELS[value] : "No trade";
  if (field === "pin") return value && typeof value === "object" ? `${percent(value.x)}%, ${percent(value.y)}%` : "No pin";
  if (field === "quantity" || field === "unit_cost") return typeof value === "string" ? value : "No value";
  return typeof value === "string" ? value : "";
}

function Conflicts({ items, rooms }: { items: Item[]; rooms: Room[] }) {
  const { session, online } = useJob();
  const headingId = useId();
  const groups = items.flatMap((item) => (item.conflicts ?? []).map((conflict) => ({ item, conflict })));
  if (groups.length === 0) return null;
  const choice = (item: Item, conflict: Conflict, value: FieldValue) => (
    <button type="button" className="btn btn--small" disabled={!online} onClick={() => void session.resolve(item, conflict.field, value)}>
      Keep {valueText(conflict.field, value, rooms)}
    </button>
  );
  return (
    <section className="conflicts" aria-labelledby={headingId}>
      <h2 id={headingId}>{COPY.conflictHeading}</h2>
      {groups.map(({ item, conflict }) => {
        const label = `Item ${item.number}: ${FIELD_LABELS[conflict.field]}`;
        return (
          <div key={`${item.id}-${conflict.field}`} className="conflict" role="group" aria-label={label}>
            <h3>{label}</h3>
            <p>
              {conflict.server_by} set {valueText(conflict.field, conflict.server_value, rooms)}
            </p>
            <p>
              {conflict.phone_by} set {valueText(conflict.field, conflict.phone_value, rooms)}
            </p>
            <div className="conflict-choices">
              {choice(item, conflict, conflict.server_value)}
              {choice(item, conflict, conflict.phone_value)}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function QuickAdd({ rooms }: { rooms: Room[] }) {
  const { session, selectedId } = useJob();
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const fieldId = useId();
  const roomFieldId = useId();
  const selectedRoom = session.view().items.find((item) => item.id === selectedId)?.room_id;

  useEffect(() => {
    if (selectedRoom) setRoomId(selectedRoom);
  }, [selectedRoom]);
  useEffect(() => {
    if (!rooms.some((room) => room.id === roomId) && rooms[0]) setRoomId(rooms[0].id);
  }, [rooms, roomId]);

  if (rooms.length === 0) return <p className="muted">Rooms appear here once the owner draws them on the plan.</p>;
  return (
    <div className="quick-add">
      <div className="field">
        <label htmlFor={fieldId}>Quick add item</label>
        <input
          id={fieldId}
          className="input"
          data-quick-add=""
          value={title}
          placeholder="What needs fixing?"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const text = title.trim();
            if (!text) return;
            setTitle("");
            void session.addItem(text, roomId);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={roomFieldId}>Quick add room</label>
        <select id={roomFieldId} className="input" value={roomId} onChange={(event) => setRoomId(event.target.value)}>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface Filters {
  room: string;
  status: ItemStatus | "";
  trade: Trade | "crew" | "";
}

function matches(item: Item, filters: Filters): boolean {
  return (
    (filters.room === "" || item.room_id === filters.room) &&
    (filters.status === "" || item.status === filters.status) &&
    (filters.trade === "" || (filters.trade === "crew" ? item.trade === null : item.trade === filters.trade))
  );
}

function FilterBar({ rooms, filters, onChange }: { rooms: Room[]; filters: Filters; onChange: (filters: Filters) => void }) {
  const roomId = useId();
  const statusId = useId();
  const tradeId = useId();
  return (
    <div className="filters">
      <div className="field">
        <label htmlFor={roomId}>Show room</label>
        <select id={roomId} className="input" value={filters.room} onChange={(event) => onChange({ ...filters, room: event.target.value })}>
          <option value="">All rooms</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={statusId}>Show status</label>
        <select
          id={statusId}
          className="input"
          value={filters.status}
          onChange={(event) => onChange({ ...filters, status: event.target.value as Filters["status"] })}
        >
          <option value="">All</option>
          {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={tradeId}>Show trade</label>
        <select
          id={tradeId}
          className="input"
          value={filters.trade}
          onChange={(event) => onChange({ ...filters, trade: event.target.value as Filters["trade"] })}
        >
          <option value="">All trades</option>
          <option value="crew">Crew</option>
          {TRADES.map((trade) => (
            <option key={trade} value={trade}>
              {TRADE_LABELS[trade]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function BulkControls({ shown, onFailures }: { shown: Item[]; onFailures: (lines: string[]) => void }) {
  const { session, online } = useJob();
  const [assignTo, setAssignTo] = useState<Trade | "">("");
  const [pending, setPending] = useState(false);
  const assignId = useId();
  const k = shown.length;
  const disabled = k === 0 || !online || pending;
  const run = async (work: () => Promise<string[] | null>) => {
    setPending(true);
    onFailures([]);
    const failures = await work();
    setPending(false);
    if (failures) onFailures(failures);
  };
  return (
    <div className="bulk">
      <button
        type="button"
        className="btn"
        disabled={disabled}
        aria-busy={pending}
        onClick={() => void run(() => session.bulk("verify", shown))}
      >
        Check off {k} shown
      </button>
      <div className="field">
        <label htmlFor={assignId}>Assign shown to</label>
        <select id={assignId} className="input" value={assignTo} onChange={(event) => setAssignTo(event.target.value as Trade | "")}>
          <option value="">No trade</option>
          {TRADES.map((trade) => (
            <option key={trade} value={trade}>
              {TRADE_LABELS[trade]}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        aria-busy={pending}
        onClick={() => void run(() => session.bulk("set_trade", shown, assignTo === "" ? null : assignTo))}
      >
        Assign {k} shown
      </button>
    </div>
  );
}

function NothingChanged({ lines }: { lines: string[] }) {
  const headingId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (lines.length > 0) ref.current?.focus();
  }, [lines]);
  if (lines.length === 0) return null;
  return (
    <div ref={ref} className="error-summary" role="alert" aria-labelledby={headingId} tabIndex={-1}>
      <h2 id={headingId}>{COPY.nothingChanged}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function PunchList() {
  const { session, role, readOnly } = useJob();
  const view = session.view();
  const crew = isCrew(role);
  const [filters, setFilters] = useState<Filters>({ room: "", status: "", trade: "" });
  const [failures, setFailures] = useState<string[]>([]);
  const shown = view.items.filter((item) => matches(item, filters));
  return (
    <section className="list-pane" aria-label="Punch list">
      {role === "trade" && <HouseAccess />}
      <div className="list-tools">
        {role !== "trade" && !readOnly && <QuickAdd rooms={view.rooms} />}
        <FilterBar rooms={view.rooms} filters={filters} onChange={setFilters} />
        {crew && !readOnly && <BulkControls shown={shown} onFailures={setFailures} />}
      </div>
      <NothingChanged lines={failures} />
      {crew && <Conflicts items={view.items} rooms={view.rooms} />}
      {view.rooms.length === 0 && <p className="loading">This job has no rooms yet.</p>}
      {view.rooms.map((room) => {
        const inRoom = view.items.filter((item) => item.room_id === room.id);
        const rows = inRoom.filter((item) => matches(item, filters));
        return (
          <div key={room.id} className="room-group">
            <div className="room-head">
              <h2>{room.name}</h2>
              <span className="room-count mono">
                {room.counts.verified} of {room.counts.total} verified
              </span>
            </div>
            {inRoom.length === 0 ? (
              <p className="empty">
                <EmptyGlyph />
                {COPY.emptyRoom}
              </p>
            ) : (
              <ul className="rows" aria-label={`${room.name} items`}>
                {rows.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    waiting={view.waiting.has(item.id)}
                    note={session.rowNotes.get(item.id)}
                    uploading={session.uploading.has(item.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
