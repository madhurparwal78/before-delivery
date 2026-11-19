import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, CloseResult, DeskView, Stay, Timeline } from "../shared/api";
import { addDays, daysBetween, type IsoDate } from "../shared/dates";
import { divide } from "../shared/money";
import { notices } from "../shared/notices";
import { offers } from "../shared/stayStatus";
import { get, post, refusalText } from "./api";
import { CloseResults, PhoneRooms, TallyRail, TodayPanel, type TallyView } from "./DeskParts";
import { Layer } from "./dialogs";
import { useLayout, useReducedMotion, useSequence } from "./hooks";
import { useLive } from "./live";
import { NewStay, type NewStayRequest } from "./NewStay";
import { RoomStatusDialog } from "./RoomStatusDialog";
import { useSession } from "./session";
import { LiveLine, TopBar } from "./Shell";
import { StayPanel } from "./StayPanel";
import { TimelineGrid, type PickUp, type TimelineActions } from "./Timeline";
import { WINDOW_NIGHTS, roomIndex, spanOf, stayAt, type Cell } from "./timelineModel";
import { Moon } from "./ui";

const NIGHT_MS = 330;
const SLIDE_MS = 330;
const STAMP_STEP_MS = 100;
const STAMP_MIN_MS = 600;
const COUNT_MS = 500;
const COUNT_STEPS = 10;

type Phase = "idle" | "night" | "stamping" | "slide";

/** The close sweep: what the owner's screen shows while the committed night plays out. */
interface Sweep {
  phase: Phase;
  ground: "day" | "night";
  businessDate: IsoDate;
  start: IsoDate;
  revealed: number;
  progress: number;
  counting: boolean;
  result: CloseResult;
  previous: CloseResult | null;
}

export function Desk() {
  const { user, setNotice, setCloseStatus } = useSession();
  const layout = useLayout();
  const reduced = useReducedMotion();
  const phone = layout === "phone";
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [data, setData] = useState<Timeline | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [start, setStart] = useState<IsoDate | null>(null);
  const [cell, setCell] = useState<Cell | null>(null);
  const [pickup, setPickup] = useState<PickUp | null>(null);
  const [newStay, setNewStay] = useState<NewStayRequest>({});
  const [newStayOpen, setNewStayOpen] = useState(false);
  const [stayId, setStayId] = useState<string | null>(null);
  const [stayOpen, setStayOpen] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [todayOpen, setTodayOpen] = useState(false);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [sweep, setSweep] = useState<Sweep | null>(null);
  const [results, setResults] = useState<CloseResult | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const startRef = useRef<IsoDate | null>(null);
  const knownDate = useRef<IsoDate | null>(null);
  const closing = useRef(false);
  const sweeping = useRef(false);
  const acting = useRef(false);
  const timers = useRef<number[]>([]);
  const sequence = useSequence();

  const refresh = useCallback(async () => {
    const id = sequence.next();
    const deskAnswer = await get<DeskView>("/api/desk");
    if (!deskAnswer.ok || !sequence.isNewest(id)) return;
    const businessDate = deskAnswer.data.hotel.businessDate;
    const previous = knownDate.current;
    let from = phone ? businessDate : (startRef.current ?? addDays(businessDate, -1));
    if (!phone && previous && previous !== businessDate && startRef.current === addDays(previous, -1)) from = addDays(businessDate, -1);
    const to = phone ? businessDate : addDays(from, WINDOW_NIGHTS - 1);
    const [timeline, rooms] = await Promise.all([
      get<Timeline>(`/api/timeline?from=${from}&to=${to}`),
      phone ? get<Board>("/api/housekeeping/board") : Promise.resolve(null),
    ]);
    if (!timeline.ok || !sequence.isNewest(id)) return;
    knownDate.current = businessDate;
    startRef.current = from;
    setDesk(deskAnswer.data);
    setData(timeline.data);
    setStart(from);
    if (rooms?.ok) setBoard(rooms.data);
    setCell((current) => current ?? { roomId: timeline.data.rooms[0]?.id ?? "", date: businessDate });
  }, [phone, sequence]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  useLive((event) => {
    if (event.type === "close" && (closing.current || sweeping.current)) return;
    if (event.type !== "report" && event.type !== "checkin") setBlocked([]);
    void refresh();
  });

  const shiftWindow = useCallback((days: number) => {
    if (!startRef.current) return;
    startRef.current = addDays(startRef.current, days);
    setStart(startRef.current);
    void (async () => {
      const from = startRef.current;
      if (!from) return;
      const answer = await get<Timeline>(`/api/timeline?from=${from}&to=${addDays(from, WINDOW_NIGHTS - 1)}`);
      if (answer.ok && startRef.current === from) setData(answer.data);
    })();
  }, []);

  const businessDate = sweep ? sweep.businessDate : (desk?.hotel.businessDate ?? "");
  const shownStart = sweep ? sweep.start : start;

  const stayAction = (stayIdToChange: string, verb: "check-in" | "check-out"): void => {
    if (acting.current) return;
    acting.current = true;
    void (async () => {
      setNotice(verb === "check-in" ? "Checking in…" : "Checking out…");
      const answer = await post<Stay>(`/api/stays/${stayIdToChange}/${verb}`);
      if (answer.ok) {
        const { segments, guest } = answer.data;
        setNotice(verb === "check-in" ? notices.checkedIn(guest.name, segments[0]?.roomNumber ?? "") : notices.checkedOut(guest.name, segments[segments.length - 1]?.roomNumber ?? ""));
      } else setNotice(refusalText(answer));
      acting.current = false;
      await refresh();
    })();
  };

  const rooms = data?.rooms ?? [];
  const blocks = data?.blocks ?? [];
  const noStay = (): void => setNotice("No stay here.");

  const actions: TimelineActions = {
    shiftWindow,
    openStay: (id) => {
      setStayId(id);
      setStayOpen(true);
    },
    newStay: (target) => {
      setNewStay({ roomId: target.roomId, arrival: target.date });
      setNewStayOpen(true);
    },
    openRoom: (id) => setRoomId(id),
    pickUp: (target) => {
      const held = stayAt(blocks, target);
      if (!held) return noStay();
      setPickup({ stayId: held.stayId, guestName: held.guestName, status: held.status, version: held.version, origin: target, roomId: held.roomId, shift: 0 });
      setNotice(`Picked up ${held.guestName}.`);
    },
    place: (roomOffset, dayOffset) => {
      if (!pickup) return;
      const at = Math.min(rooms.length - 1, Math.max(0, roomIndex(rooms, pickup.roomId) + roomOffset));
      const shift = offers("check_in", pickup.status) ? pickup.shift + dayOffset : pickup.shift;
      const room = rooms[at];
      if (!room) return;
      setPickup({ ...pickup, roomId: room.id, shift });
      setNotice(`Over room ${room.number}, ${addDays(pickup.origin.date, shift)}.`);
    },
    placeAt: (target) => {
      setPickup((current) => {
        if (!current) return current;
        const shift = offers("check_in", current.status) ? daysBetween(current.origin.date, target.date) : 0;
        return { ...current, roomId: target.roomId, shift };
      });
      const room = rooms.find((candidate) => candidate.id === target.roomId);
      if (room) setNotice(`Over room ${room.number}, ${target.date}.`);
    },
    cancelPickUp: () => {
      setPickup(null);
      setNotice("Move cancelled.");
    },
    drop: () => void drop(),
    checkIn: (target) => {
      const held = stayAt(blocks, target);
      if (held) stayAction(held.stayId, "check-in");
      else noStay();
    },
    checkOut: (target) => {
      const held = stayAt(blocks, target);
      if (held) stayAction(held.stayId, "check-out");
      else noStay();
    },
  };

  const drop = async (): Promise<void> => {
    if (!pickup || acting.current) return;
    const room = rooms.find((candidate) => candidate.id === pickup.roomId);
    if (!room || (pickup.roomId === pickup.origin.roomId && pickup.shift === 0)) {
      setPickup(null);
      setNotice("Move cancelled.");
      return;
    }
    acting.current = true;
    setNotice("Moving stay…");
    const body = !offers("check_in", pickup.status)
      ? { version: pickup.version, roomId: pickup.roomId, fromNight: businessDate }
      : { version: pickup.version, roomId: pickup.roomId, ...(pickup.shift !== 0 ? { arrival: addDays(spanOf(blocks, pickup.stayId).arrival, pickup.shift) } : {}) };
    const answer = await post<Stay>(`/api/stays/${pickup.stayId}/move`, body);
    setNotice(answer.ok ? notices.moved(pickup.guestName, room.number) : refusalText(answer));
    setPickup(null);
    acting.current = false;
    await refresh();
  };

  const runClose = async (): Promise<void> => {
    if (closing.current || sweeping.current || !desk) return;
    closing.current = true;
    setCloseBusy(true);
    setCloseStatus("Running close…");
    setBlocked([]);
    setResults(null);
    const answer = await post<CloseResult>("/api/close", { businessDate: desk.hotel.businessDate });
    if (!answer.ok) {
      setCloseStatus(refusalText(answer));
      if (answer.blockers.length > 0) {
        setBlocked(answer.blockers.map((blocker) => blocker.roomId));
        const first = answer.blockers[0];
        if (first) document.querySelector<HTMLElement>(`[role="row"][data-room-id="${first.roomId}"] [role="rowheader"]`)?.focus();
      }
    } else {
      const result = answer.data;
      setCloseStatus(notices.closed(result.businessDate, result.roomsCharged, result.noShows));
      const frozen: Sweep = {
        phase: "idle", ground: "day", businessDate: result.businessDate, start: startRef.current ?? addDays(result.businessDate, -1),
        revealed: 0, progress: 0, counting: false, result, previous: desk.lastClose,
      };
      if (reduced || phone) {
        await refresh();
        setResults(result);
      } else {
        sweeping.current = true;
        setSweep(frozen);
        await refresh();
        playSweep(frozen);
      }
    }
    closing.current = false;
    setCloseBusy(false);
  };

  const later = (ms: number, work: () => void): void => {
    timers.current.push(window.setTimeout(work, ms));
  };

  const playSweep = (frozen: Sweep): void => {
    const count = Math.max(1, rooms.length);
    const step = Math.min(STAMP_STEP_MS, divide(1500, count).quotient);
    const stampMs = Math.max(count * step, STAMP_MIN_MS);
    const update = (change: Partial<Sweep>): void => setSweep((current) => (current ? { ...current, ...change } : current));
    update({ phase: "night", ground: "night" });
    later(NIGHT_MS, () => update({ phase: "stamping" }));
    for (let index = 0; index < count; index += 1) later(NIGHT_MS + index * step, () => update({ revealed: index + 1 }));
    later(NIGHT_MS + stampMs - COUNT_MS, () => update({ counting: true, progress: 0 }));
    for (let tick = 1; tick <= COUNT_STEPS; tick += 1) later(NIGHT_MS + stampMs - COUNT_MS + divide(COUNT_MS * tick, COUNT_STEPS).quotient, () => update({ progress: tick }));
    later(NIGHT_MS + stampMs, () => update({ phase: "slide", ground: "day", counting: false, businessDate: frozen.result.newBusinessDate }));
    later(NIGHT_MS + stampMs + SLIDE_MS, () => {
      sweeping.current = false;
      setSweep(null);
    });
  };

  const tally: TallyView = tallyOf(desk?.lastClose ?? null, sweep);
  const withheld = sweep ? { date: sweep.result.businessDate, roomIds: new Set(rooms.slice(sweep.revealed).map((room) => room.id)) } : null;
  const sliding = sweep?.phase === "slide";
  const todayDock = layout === "desktop";

  const openStay = (id: string): void => {
    setStayId(id);
    setStayOpen(true);
  };
  const openNew = (): void => {
    setNewStay({});
    setNewStayOpen(true);
  };

  return (
    <>
      <TopBar>
        <div className="bd-block">
          <span className="bd-label">Business date</span>
          <span role="status" aria-label="Business date" className="business-date">{businessDate}</span>
        </div>
        <span role="status" aria-label="Free rooms" className="free-rooms">{desk?.freeRoomsText ?? ""}</span>
        <button type="button" className="primary" onClick={openNew}>New stay</button>
        {user.role === "owner" ? (
          <button type="button" className="primary" aria-busy={closeBusy} onClick={() => void runClose()}>
            <Moon /> Run close
          </button>
        ) : null}
        {layout === "tablet" ? <button type="button" onClick={() => setTodayOpen((open) => !open)}>Today</button> : null}
      </TopBar>
      <main className="desk" data-ground={sweep?.ground ?? "day"} data-close-phase={sweep?.phase ?? "idle"}>
        <LiveLine withClose />
        {results ? <CloseResults result={results} /> : null}
        <div className="desk-body">
          {data && cell && shownStart ? (
            phone ? (
              <PhoneRooms
                data={data}
                board={board}
                businessDate={businessDate}
                blocked={blocked}
                actions={{ open: (id) => openStay(id), openRoom: (id) => setRoomId(id), checkIn: (id) => stayAction(id, "check-in"), checkOut: (id) => stayAction(id, "check-out") }}
              />
            ) : (
              <TimelineGrid
                data={data}
                start={shownStart}
                businessDate={businessDate}
                cell={cell}
                setCell={setCell}
                pickup={pickup}
                blocked={blocked}
                withheld={withheld}
                sliding={sliding}
                actions={actions}
              />
            )
          ) : (
            <div className="timeline-frame placeholder" aria-hidden="true" />
          )}
          {todayDock && data ? (
            <aside aria-label="Today" className="today">
              <TodayPanel data={data} businessDate={businessDate} onOpen={openStay} />
            </aside>
          ) : null}
        </div>
        {phone && !desk ? null : <TallyRail tally={tally} />}
      </main>
      {layout === "tablet" && data ? (
        <Layer name="Today" role="complementary" open={todayOpen} onClose={() => setTodayOpen(false)} className="today overlay">
          <TodayPanel data={data} businessDate={businessDate} onOpen={(id) => { setTodayOpen(false); openStay(id); }} />
          <button type="button" className="quiet" onClick={() => setTodayOpen(false)}>Close</button>
        </Layer>
      ) : null}
      <NewStay key={`${newStay.roomId}-${newStay.arrival}`} request={newStay} open={newStayOpen} rooms={rooms} onClose={() => setNewStayOpen(false)} setNotice={setNotice}
        onCreated={() => { setNewStayOpen(false); void refresh(); }} />
      <StayPanel stayId={stayId} open={stayOpen} rooms={rooms} onClose={() => setStayOpen(false)} setNotice={setNotice} onChanged={() => void refresh()} />
      <RoomStatusDialog room={rooms.find((room) => room.id === roomId)} open={roomId !== null} onClose={() => setRoomId(null)} setNotice={setNotice} />
    </>
  );
}

/** What the tally rail shows: the last close, or its count-up while the sweep plays. */
function tallyOf(lastClose: CloseResult | null, sweep: Sweep | null): TallyView {
  if (!sweep) {
    return {
      date: lastClose?.businessDate ?? null, roomsSold: lastClose?.figures.roomsSold ?? null, roomRevenueCents: lastClose?.figures.roomRevenueCents ?? null,
      figures: lastClose?.figures ?? null, counting: false,
    };
  }
  const { figures } = sweep.result;
  const started = sweep.counting || sweep.progress > 0;
  if (!started && sweep.phase !== "slide") return tallyOf(sweep.previous, null);
  const done = sweep.phase === "slide" || sweep.progress >= COUNT_STEPS;
  return {
    date: done ? sweep.result.businessDate : null,
    roomsSold: started ? divide(figures.roomsSold * sweep.progress, COUNT_STEPS).quotient : null,
    roomRevenueCents: started ? divide(figures.roomRevenueCents * sweep.progress, COUNT_STEPS).quotient : null,
    figures: done ? figures : null,
    counting: sweep.counting && !done,
  };
}
