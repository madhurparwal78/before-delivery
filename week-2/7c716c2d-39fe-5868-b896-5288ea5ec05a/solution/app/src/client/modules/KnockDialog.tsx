// Answering knocks: occupants of a private room see the oldest waiting knock in one dialog; the
// next opens only after it closes, and a knock decided elsewhere or expired closes it.
import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, get, type Knock } from "../api";
import { Dialog } from "../components/Dialog";
import { useApp } from "../store";

export function KnockDialog(): JSX.Element | null {
  const app = useApp();
  const myRoomId = app.floor?.me.room_id ?? null;
  const myRoom = app.floor?.rooms.find((r) => r.id === myRoomId);
  const [queue, setQueue] = useState<Knock[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const answering = useRef<string | null>(null);
  const shown = useRef<string | null>(null);

  const insideRef = useRef<string | null>(null);
  insideRef.current = myRoom?.kind === "private" ? myRoom.id : null;

  /** Knocks at a room this person has left can no longer reach them, so they leave the queue. */
  useEffect(() => setQueue((q) => q.filter((k) => k.room_id === myRoomId)), [myRoomId]);

  /** A page opened inside a private room picks up the knocks already waiting; later knocks arrive on the stream. */
  const floorLoaded = app.floor !== null;
  const loadedInside = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!floorLoaded || loadedInside.current !== undefined) return;
    loadedInside.current = myRoom?.kind === "private" ? myRoom.id : null;
    if (!loadedInside.current) return;
    get<{ knocks: Knock[] }>(`/api/rooms/${loadedInside.current}/knocks`)
      .then((r) => setQueue((q) => [...q.filter((k) => !r.knocks.some((n) => n.id === k.id)), ...r.knocks]))
      .catch(() => undefined);
  }, [floorLoaded, myRoom]);

  useEffect(
    () =>
      app.on((event) => {
        if (event.name === "reset" && insideRef.current) {
          get<{ knocks: Knock[] }>(`/api/rooms/${insideRef.current}/knocks`)
            .then((r) => setQueue(r.knocks))
            .catch(() => undefined);
        }
        if (event.name !== "knock") return;
        const knock = event.data;
        if (knock.person_id === app.person.id) return;
        if (knock.status === "waiting") {
          setQueue((q) => (q.some((k) => k.id === knock.id) ? q : [...q, knock]));
          return;
        }
        setQueue((q) => q.filter((k) => k.id !== knock.id));
        if (shown.current === knock.id && answering.current !== knock.id) {
          app.announce(knock.status === "expired" ? "That knock has expired." : "That knock was already answered.");
        }
      }),
    [app],
  );

  const current = queue
    .filter((k) => k.room_id === myRoomId && !dismissed.has(k.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  shown.current = current?.id ?? null;
  if (!current) return null;

  const name = app.nameOf(current.person_id);
  const room = app.floor?.rooms.find((r) => r.id === current.room_id)?.name ?? "the room";

  const answer = async (verdict: "let_in" | "not_now"): Promise<void> => {
    answering.current = current.id;
    try {
      await api<Knock>("POST", `/api/knocks/${current.id}/answer`, { answer: verdict });
      app.announce(verdict === "let_in" ? `Let ${name} in.` : `Told ${name} not now.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "knock_expired") app.announce("That knock has expired.");
      else if (error instanceof ApiFailure && error.code === "knock_answered") app.announce("That knock was already answered.");
    }
    setQueue((q) => q.filter((k) => k.id !== current.id));
  };

  return (
    <Dialog label={`Knock at ${room}`} contentKey={current.id} onClose={() => setDismissed((d) => new Set(d).add(current.id))}>
      <div className="dialog-body knock-dialog">
        <h2>{`Knock at ${room}`}</h2>
        <p>{`${name} is at the door.`}</p>
        <div className="dialog-actions">
          <button type="button" className="button primary" onClick={() => void answer("let_in")}>
            Let in
          </button>
          <button type="button" className="button" onClick={() => void answer("not_now")}>
            Not now
          </button>
        </div>
      </div>
    </Dialog>
  );
}
