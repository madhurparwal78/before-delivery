import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import type { Knock, Room } from "./types.ts";
import { NotFoundDetail } from "./ui.tsx";

const GRID = 26;

export function OfficeList(props: { currentRoomId: string | null }): React.ReactNode {
  return (
    <div>
      {store.rooms.map((room) => (
        <div key={room.id} className="row">
          <span className="title">{room.name}</span>
          <span className="meta num">{`${room.occupants.length} inside`}</span>
          <span className="meta">{room.kind === "private" ? "private" : "open"}</span>
        </div>
      ))}
      {void props}
    </div>
  );
}

export function OfficeFloor(props: { onNotFound: () => void }): React.ReactNode {
  const [knockStatus, setKnockStatus] = useState<Record<string, Knock["status"]>>({});
  const [dialog, setDialog] = useState<Knock | null>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const rooms = store.rooms;
  const myRoomId = store.myRoomId;

  useEffect(() => {
    const off = store.onStreamEvent((name, data) => {
      if (name === "knock") {
        const k = data as Knock;
        if (k.person_id === store.me?.id) {
          setKnockStatus((map) => ({ ...map, [k.room_id]: k.status }));
          if (k.status !== "waiting") {
            setDialog(null);
            if (k.status === "expired") store.announce("That knock has expired.");
            if (k.status === "not_now") store.announce(`Told ${store.personName(k.person_id)} not now.` || "Not now");
          }
        } else if (k.status === "waiting") {
          const room = store.rooms.find((r) => r.id === k.room_id);
          if (room && room.occupants.some((o) => o.person_id === store.me?.id) && !dialog) {
            setDialog(k);
          }
        }
      }
      if (name === "room") {
        const room = data as Room;
        if (dialog && room.id === dialog.room_id && room.occupants.every((o) => o.person_id !== dialog.person_id) === false) {
          // keep the dialog; it is answered or answered elsewhere by its own event
        }
      }
    });
    return off;
  }, [dialog]);

  const answer = async (knock: Knock, decision: "let_in" | "not_now"): Promise<void> => {
    try {
      const { data } = await api.answerKnock(knock.id, decision);
      if (decision === "let_in") {
        store.announce(`Let ${store.personName(data.person_id)} in.`);
      } else {
        store.announce(`Told ${store.personName(data.person_id)} not now.`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "knock_expired") {
        store.announce("That knock has expired.");
      } else if (e instanceof ApiError && e.code === "knock_answered") {
        store.announce("That knock was already answered.");
      }
    }
    setDialog(null);
  };

  const join = async (room: Room): Promise<void> => {
    try {
      const { data } = await api.joinRoom(room.id);
      store.rooms = data.rooms;
      store.myRoomId = data.me.room_id;
      store.emitChange();
    } catch (e) {
      if (e instanceof ApiError && e.code === "knock_required") {
        // Knocking on an occupied private room creates a waiting knock.
        try {
          const { data } = await api.knock(room.id);
          setKnockStatus((map) => ({ ...map, [room.id]: data.status }));
        } catch {
          // the room state changed; the floor will update
        }
      }
    }
  };

  const knockOn = async (room: Room): Promise<void> => {
    try {
      const { data } = await api.knock(room.id);
      setKnockStatus((map) => ({ ...map, [room.id]: data.status }));
    } catch {
      // already inside, open or empty: the floor shows the truth
    }
  };

  const loadMyKnocks = async (): Promise<void> => {
    for (const room of rooms) {
      if (room.kind === "private") {
        try {
          const { data } = await api.myKnock(room.id);
          setKnockStatus((map) => ({ ...map, [room.id]: data.status }));
        } catch {
          // no knock on this room
        }
      }
    }
  };

  useEffect(() => {
    void loadMyKnocks();
  }, []);

  const maxW = Math.max(...rooms.map((r) => r.x + r.w), 1);
  const maxH = Math.max(...rooms.map((r) => r.y + r.h), 1);

  const privateOccupied = rooms.filter(
    (r) => r.kind === "private" && r.occupants.length > 0 && !r.occupants.some((o) => o.person_id === store.me?.id)
  );

  const statusCopy = (s: Knock["status"] | undefined): string | null => {
    if (!s) return null;
    if (s === "waiting") return "Waiting";
    if (s === "let_in") return "Let in";
    if (s === "not_now") return "Not now";
    return "Knock expired";
  };

  return (
    <div>
      <h1>Office</h1>
      <svg
        className="floor-plan"
        role="region"
        aria-label="Office floor"
        viewBox={`0 0 ${maxW * GRID} ${maxH * GRID}`}
        style={{ maxWidth: `${maxW * GRID}px` }}
      >
        {rooms.map((room) => {
          const x = room.x * GRID;
          const y = room.y * GRID;
          const w = room.w * GRID;
          const h = room.h * GRID;
          return (
            <g key={room.id} className="floor-room">
              <rect x={x} y={y} width={w} height={h} />
              <text x={x + 8} y={y + 18}>
                {room.name}
              </text>
              <rect
                x={x + w - 14}
                y={y + h - 8}
                width={10}
                height={6}
                fill={room.kind === "private" ? "var(--ink)" : "none"}
                stroke="var(--ink)"
              />
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill="transparent"
                stroke="none"
                style={{ cursor: "pointer" }}
                onClick={() => void join(room)}
              />
              {room.occupants.map((occ, i) => (
                <circle
                  key={occ.person_id}
                  className={
                    "presence-dot " +
                    occ.status +
                    (occ.person_id === store.me?.id ? " me" : "")
                  }
                  cx={x + 14 + i * 14}
                  cy={y + 34}
                  r={4}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {rooms.map((room) => (
          <button key={room.id} className="btn" aria-label={`${room.name}, ${room.occupants.length} inside`} onClick={() => void join(room)}>
            {`${room.name}, ${room.occupants.length} inside`}
          </button>
        ))}
      </div>
      {privateOccupied.map((room) => (
        <button
          key={room.id}
          className="btn"
          aria-label={`Knock on ${room.name}`}
          onClick={(e) => {
            dialogOpener.current = e.currentTarget;
            void knockOn(room);
          }}
        >
          {`Knock on ${room.name}`}
        </button>
      ))}
      <div role="status" aria-live="polite" aria-label="Knock status">
        {rooms
          .map((room) => ({ room, status: statusCopy(knockStatus[room.id]) }))
          .filter((entry) => entry.status !== null)
          .map((entry) => (
            <div key={entry.room.id}>{`${entry.room.name}: ${entry.status}`}</div>
          ))}
      </div>
      {myRoomId && (
        <div style={{ marginTop: 8 }}>
          <button
            className="btn"
            aria-label="Leave room"
            onClick={() => {
              void api.leaveRoom().then(() => {
                store.myRoomId = null;
                void store.refreshFloor();
              });
            }}
          >
            Leave room
          </button>
        </div>
      )}
      {dialog && (
        <div className="dialog-backdrop">
          <div className="dialog" role="dialog" aria-label={`Knock at ${store.rooms.find((r) => r.id === dialog.room_id)?.name ?? ""}`}>
            <h2>{`Knock at ${store.rooms.find((r) => r.id === dialog.room_id)?.name ?? ""}`}</h2>
            <p>{`${store.personName(dialog.person_id)} is at the door.`}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" aria-label="Let in" onClick={() => void answer(dialog, "let_in")}>
                Let in
              </button>
              <button className="btn" aria-label="Not now" onClick={() => void answer(dialog, "not_now")}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {void props}
    </div>
  );
}
