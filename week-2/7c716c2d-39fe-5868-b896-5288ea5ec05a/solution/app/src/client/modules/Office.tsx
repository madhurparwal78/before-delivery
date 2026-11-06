// The office floor: a drawn plan of ruled rooms on one grid, presence marks, joining and knocking.
import { useEffect, useState } from "react";
import { api, ApiFailure, get, type Floor, type Knock, type KnockState, type Room } from "../api";
import { Panes } from "../components/Panes";
import { NotFound, SheetHeader, TitleBlock } from "../components/Sheet";
import { navigate } from "../router";
import { useApp } from "../store";

const KNOCK_TEXT: Record<KnockState, string> = { waiting: "Waiting", let_in: "Let in", not_now: "Not now", expired: "Knock expired" };

function planSize(rooms: Room[]): { cols: number; rows: number } {
  return {
    cols: Math.max(1, ...rooms.map((r) => r.x + r.w)),
    rows: Math.max(1, ...rooms.map((r) => r.y + r.h)),
  };
}

export function OfficeModule(props: { rest: string[] }): JSX.Element {
  const app = useApp();
  const floor = app.floor;
  const [selected, setSelected] = useState<string | null>(null);
  const [knock, setKnock] = useState<Knock | null>(null);

  const privateIds = (floor?.rooms ?? []).filter((r) => r.kind === "private").map((r) => r.id).join(",");
  const [resets, setResets] = useState(0);
  useEffect(() => {
    if (!privateIds) return;
    let cancelled = false;
    const privateRooms = privateIds.split(",").map((id) => ({ id }));
    void Promise.all(privateRooms.map((r) => get<Knock>(`/api/rooms/${r.id}/knocks/mine`).catch(() => null))).then((found) => {
      if (cancelled) return;
      const latest = found.filter((k): k is Knock => k !== null).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (latest) {
        setKnock(latest);
        if (latest.status === "waiting") setSelected(latest.room_id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [privateIds, resets]);

  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "knock" && event.data.person_id === app.person.id) setKnock(event.data);
        if (event.name === "reset") setResets((n) => n + 1);
      }),
    [app],
  );

  if (props.rest.length > 0) return <Panes list={null} detail={<NotFound back="/office" />} detailFirst detailKey="office-missing" />;

  const rooms = floor?.rooms ?? [];
  const myRoom = floor?.me.room_id ?? null;
  const room = rooms.find((r) => r.id === selected) ?? null;

  const activate = async (target: Room): Promise<void> => {
    setSelected(target.id);
    const inside = target.occupants.some((o) => o.person_id === app.person.id);
    if (inside) return;
    if (target.kind === "private" && target.occupants.length > 0) {
      document.querySelector<HTMLElement>(`[data-knock="${CSS.escape(target.id)}"]`)?.focus();
      return;
    }
    {
      try {
        await api<Floor>("POST", `/api/rooms/${target.id}/join`, {});
        app.reloadFloor();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "knock_required") app.reloadFloor();
      }
    }
  };

  const knockOn = async (target: Room): Promise<void> => {
    try {
      setKnock(await api<Knock>("POST", `/api/rooms/${target.id}/knocks`, {}));
    } catch {
      app.reloadFloor();
    }
  };

  const leave = async (): Promise<void> => {
    await api("POST", "/api/rooms/leave", {}).catch(() => undefined);
    app.reloadFloor();
  };

  const list = (
    <div className="room-list">
      <h2 className="list-heading">Rooms</h2>
      <ul>
        {rooms.map((r) => (
          <li key={r.id} className="room-row">
            <button
              type="button"
              className="room-row-button"
              onClick={() => {
                setSelected(r.id);
                navigate("/office", { state: { pane: "detail" } });
              }}
            >
              <span className="room-row-name">{r.name}</span>
              <span className="mono">{`${r.occupants.length} inside`}</span>
              <span className="muted">{r.kind === "open" ? "Door open" : "Private"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const { cols, rows } = planSize(rooms);
  const knockRoom = knock ? rooms.find((r) => r.id === knock.room_id) : undefined;
  const knockable = rooms.filter((r) => r.kind === "private" && r.occupants.length > 0 && !r.occupants.some((o) => o.person_id === app.person.id));

  const detail = (
    <div className="sheet office-sheet">
      <SheetHeader back="/office" />
      <TitleBlock name="Office floor" state={myRoom ? `In ${rooms.find((r) => r.id === myRoom)?.name ?? "a room"}` : "Not in a room"} changed={app.workspace.today} />
      <h1>Office</h1>
      <section role="region" aria-label="Office floor" className="floor" style={{ aspectRatio: `${cols} / ${rows}` }}>
        {rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`room room-${r.kind}${r.id === selected ? " is-selected" : ""}`}
            style={{ left: `${(r.x / cols) * 100}%`, top: `${(r.y / rows) * 100}%`, width: `${(r.w / cols) * 100}%`, height: `${(r.h / rows) * 100}%` }}
            aria-label={`${r.name}, ${r.occupants.length} inside`}
            onClick={() => void activate(r)}
          >
            <span className="door" aria-hidden="true" />
            <span className="room-name">{r.name}</span>
            <span className="room-kind" />
            <span className="marks" aria-hidden="true">
              {r.occupants.map((o) => (
                <span key={o.person_id} className={`mark ${o.status}${o.person_id === app.person.id ? " me" : ""}`} title={o.name} />
              ))}
            </span>
          </button>
        ))}
      </section>
      <div className="door-panel">
        {room && (
          <>
            <h2>{room.name}</h2>
            <p className="muted">{room.occupants.length === 0 ? "Nobody inside." : room.occupants.map((o) => `${o.name} (${o.status})`).join(", ")}</p>
          </>
        )}
        {knockable.map((r) => (
          <button key={r.id} type="button" className="button primary" data-knock={r.id} onClick={() => void knockOn(r)}>
            {`Knock on ${r.name}`}
          </button>
        ))}
        {myRoom && (
          <button type="button" className="button" onClick={() => void leave()}>
            Leave room
          </button>
        )}
        <p className="knock-line">
          {knockRoom && <span className="muted">{`Your knock on ${knockRoom.name}: `}</span>}
          <span role="status" aria-label="Knock status" aria-live="polite" className={`knock-status knock-${knock?.status ?? "none"}`}>
            {knock ? KNOCK_TEXT[knock.status] : ""}
          </span>
        </p>
      </div>
    </div>
  );

  return <Panes list={list} detail={detail} detailFirst detailKey="office" />;
}
