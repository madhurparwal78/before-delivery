import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Booking, BookingStatus, HostBookingsResponse, HostFloorResponse, HostLiveEvent, HostTable } from "../../shared/api.js";
import { formatDayLabel } from "../../shared/calendar.js";
import { del, get, onHostSessionEnded, post } from "../api.js";
import { useAnnouncer } from "../announce.js";
import { AlertIcon } from "../components/Icons.js";
import { FloorPlan, type PlanRoom } from "../components/FloorPlan.js";
import { geometryFor } from "../components/geometry.js";
import { CountdownRing } from "../components/HeldMarks.js";
import { ModalDialog } from "../components/ModalDialog.js";
import { ROOM_PORTRAITS } from "../components/Portraits.js";
import type { Look } from "../components/TableGlyph.js";
import { Page } from "../components/Shell.js";
import { depositLine } from "../copy.js";
import { useLiveEvents } from "../liveEvents.js";
import { navigate, queryString } from "../router.js";
import { useDependencyStatus } from "../status.js";
import { useFloor, useRules } from "../reference.js";

const BOOKING_WORDS: Record<BookingStatus, string> = {
  booked: "Booked",
  seated: "Seated",
  completed: "Completed",
  no_show: "No-show",
  cancelled_refunded: "Cancelled, refunded",
  cancelled_retained: "Cancelled, deposit kept",
};

const STALE = "That table has already changed. The plan is up to date.";

function announcement(event: HostLiveEvent): string {
  const tables = event.table_ids.join("+");
  switch (event.type) {
    case "hold.created":
      return `Table ${tables} held for ${event.time}.`;
    case "hold.expired":
      return `Hold on table ${tables} ended.`;
    case "hold.released":
      return `Hold on table ${tables} released.`;
    case "booking.created":
      return `Table ${tables} booked for ${event.time}, party of ${event.party_size}.`;
    case "booking.cancelled":
      return `Booking ${event.reference ?? ""} at table ${tables} cancelled.`;
    case "booking.seated":
      return `Table ${tables} seated.`;
    case "booking.completed":
      return `Table ${tables} cleared.`;
    case "booking.no_show":
      return `Table ${tables} marked no-show.`;
    case "walkin.seated":
      return `Walk-in seated at table ${tables}, party of ${event.party_size}.`;
    case "offer.created":
      return `Table ${tables} offered to the waitlist for ${event.time}.`;
    case "offer.claimed":
      return `Waitlist offer for table ${tables} claimed.`;
    case "offer.lapsed":
      return `Waitlist offer for table ${tables} lapsed.`;
  }
}

function tableWord(table: HostTable): { word: string; look: Look } {
  switch (table.status) {
    case "free":
      return { word: "Free", look: "outline" };
    case "held":
      return { word: "Held", look: "hatched" };
    case "booked":
      return { word: `Booked ${table.booking?.time ?? ""}`, look: "double" };
    case "seated":
      return { word: "Seated", look: "solid" };
    case "offered":
      return { word: "Offered", look: "dotted" };
  }
}

function bookingLine(booking: Booking): string {
  return [
    booking.time,
    booking.reference,
    booking.name,
    `Party of ${booking.party_size}`,
    `Table ${booking.table_id}`,
    BOOKING_WORDS[booking.status],
    depositLine(booking.deposit),
  ].join(" · ");
}

function TableDialog({
  table,
  roomName,
  maxSeats,
  onClose,
  onChanged,
}: {
  table: HostTable;
  roomName: string;
  maxSeats: number;
  onClose: () => void;
  onChanged: (closeAfter: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [walkingIn, setWalkingIn] = useState(false);
  const [party, setParty] = useState(2);
  const partyField = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (walkingIn) partyField.current?.focus();
  }, [walkingIn]);

  const act = async (run: () => ReturnType<typeof post>, closeAfter = false): Promise<void> => {
    if (pending) return;
    setPending(true);
    setProblem(null);
    const outcome = await run();
    setPending(false);
    if (outcome.ok) {
      onChanged(closeAfter);
      return;
    }
    const { code, message } = outcome.failure;
    if (code === "invalid_transition") setProblem(STALE);
    else if (code === "too_early") setProblem(message);
    else if (code === "table_taken") setProblem(`Table ${table.table_id} is no longer free.`);
    else if (code === "table_not_for_party") setProblem(`Table ${table.table_id} doesn't seat a party of ${party}.`);
    if (code === "invalid_transition" || code === "table_taken") onChanged(false);
  };

  const reference = table.booking?.reference ?? "";
  return (
    <ModalDialog labelId="table-title" pending={pending} onClose={onClose}>
      <h2 id="table-title">Table {table.table_id}</h2>
      <div className="stack">
        <p>
          {roomName} · {tableWord(table).word} · up to {maxSeats} seats
        </p>
        {table.booking !== null && <p>{bookingLine(table.booking)}</p>}
        {problem !== null && (
          <p role="alert" className="field-error">
            <AlertIcon />
            <span>{problem}</span>
          </p>
        )}
        {walkingIn && (
          <div className="field">
            <label htmlFor="walk-in-party">Walk-in party size</label>
            <select id="walk-in-party" ref={partyField} className="select" value={party} onChange={(event) => setParty(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="actions">
          {table.status === "booked" && (
            <>
              <button type="button" className="button button-solid" data-initial-focus aria-disabled={pending} onClick={() => void act(() => post(`/api/host/bookings/${reference}/seat`, {}, { host: true }))}>
                Seat
              </button>
              <button type="button" className="button" aria-disabled={pending} onClick={() => void act(() => post(`/api/host/bookings/${reference}/no-show`, {}, { host: true }))}>
                Mark no-show
              </button>
            </>
          )}
          {table.status === "seated" && (
            <button type="button" className="button button-solid" data-initial-focus aria-disabled={pending} onClick={() => void act(() => post(`/api/host/bookings/${reference}/clear`, {}, { host: true }))}>
              Clear table
            </button>
          )}
          {table.status === "free" && !walkingIn && (
            <button type="button" className="button button-solid" data-initial-focus onClick={() => setWalkingIn(true)}>
              Add walk-in
            </button>
          )}
          {walkingIn && table.status === "free" && (
            <button
              type="button"
              className="button button-solid"
              aria-disabled={pending}
              onClick={() => void act(() => post("/api/host/walk-ins", { table_id: table.table_id, party_size: party }, { host: true, keyed: true }), true)}
            >
              Seat walk-in
            </button>
          )}
          <button type="button" className="button" aria-disabled={pending} data-initial-focus={table.status === "held" || table.status === "offered" ? true : undefined} onClick={() => !pending && onClose()}>
            Close
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

export function HostFloorPage({ search }: { search: string }) {
  const params = new URLSearchParams(search);
  const rules = useRules();
  const catalogFloor = useFloor();
  const status = useDependencyStatus();
  const { messages, announce } = useAnnouncer(6);
  const [floor, setFloor] = useState<HostFloorResponse | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [version, setVersion] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const signedIn = useRef(false);
  const leaving = useRef(false);

  const requestedTime = params.get("time");
  const showing = requestedTime !== null && rules?.slot_times.includes(requestedTime) === true ? requestedTime : null;
  const latestFloor = useRef(0);
  const latestBookings = useRef(0);
  const tableParam = params.get("table");

  useEffect(
    () =>
      onHostSessionEnded(() => {
        if (leaving.current) return;
        leaving.current = true;
        const next = `${window.location.pathname}${window.location.search}`;
        navigate(`/host/sign-in${queryString({ next, ended: signedIn.current ? "1" : null })}`);
      }),
    [],
  );

  const refresh = useCallback(() => setVersion((count) => count + 1), []);
  useEffect(() => {
    if (rules === null) return;
    latestFloor.current += 1;
    const floorTicket = latestFloor.current;
    void get<HostFloorResponse>(`/api/host/floor${queryString({ time: showing })}`, { host: true }).then((outcome) => {
      if (!outcome.ok) return;
      signedIn.current = true;
      if (floorTicket !== latestFloor.current) return;
      setFloor(outcome.body);
      if (showing === null) navigate(`/host${queryString({ time: outcome.body.time, table: tableParam })}`, { replace: true });
    });
    latestBookings.current += 1;
    const bookingsTicket = latestBookings.current;
    void get<HostBookingsResponse>("/api/host/bookings", { host: true }).then((outcome) => {
      if (outcome.ok && bookingsTicket === latestBookings.current) setBookings(outcome.body.bookings);
    });
  }, [rules, showing, version]);

  useLiveEvents(
    "/api/host/events",
    (event) => {
      announce(announcement(event));
      refresh();
    },
    refresh,
  );
  // Each status check also rereads the floor: it refreshes the plan while live updates are paused and meets a session that has ended.
  useEffect(refresh, [status.checks, refresh]);

  const rooms: PlanRoom[] = useMemo(() => {
    if (floor === null || catalogFloor === null || rules === null) return [];
    return catalogFloor.rooms.map((room) => ({
      roomId: room.room_id,
      name: room.name,
      items: room.tables.flatMap((entry) => {
        const table = floor.tables.find((candidate) => candidate.table_id === entry.table_id);
        if (table === undefined) return [];
        const { word, look } = tableWord(table);
        const pair = table.joined_with === null ? undefined : catalogFloor.joinable_pairs.find((candidate) => candidate.tables.includes(table.table_id));
        const pairPartner = pair?.tables[0] === table.table_id ? undefined : room.tables.find((other) => other.table_id === pair?.tables[0]);
        const geometry = geometryFor(entry.max_seats);
        return [
          {
            id: table.table_id,
            name: `Table ${table.table_id}, ${room.name}, ${word}`,
            idLabel: table.table_id,
            statusWord: word,
            look,
            maxSeats: entry.max_seats,
            holdParty: table.hold?.party_size ?? null,
            firstSetting: pairPartner?.max_seats ?? 0,
            ...(pair === undefined ? {} : { settingsId: pair.pair_id }),
            ...(table.hold === null ? {} : { ring: <CountdownRing geometry={geometry} expiresAt={table.hold.expires_at} lifetimeSeconds={rules.hold_seconds} /> }),
          },
        ];
      }),
    }));
  }, [floor, catalogFloor, rules]);

  const setTable = (table: string | null): void => {
    navigate(`/host${queryString({ time: showing ?? floor?.time ?? null, table })}`, { replace: true });
  };
  const closeDialog = (): void => {
    const id = tableParam;
    setTable(null);
    if (id !== null) setFocusRequest({ id, nonce: Date.now() });
  };

  const signOut = async (): Promise<void> => {
    await del("/api/host/session", { host: true });
    navigate("/host/sign-in");
  };

  const openTable = tableParam === null ? undefined : floor?.tables.find((table) => table.table_id === tableParam);
  const openRoom = catalogFloor?.rooms.find((room) => room.tables.some((table) => table.table_id === tableParam));
  const todayLabel = floor === null ? "" : formatDayLabel(floor.date);

  return (
    <Page summary={`Tonight · ${todayLabel}`} host live={{ label: "Floor updates", messages }}>
      <div className="host-grid">
        <section className="host-covers" aria-labelledby="covers-title">
          <h2 id="covers-title">Tonight&apos;s covers</h2>
          <div className="field">
            <label htmlFor="showing">Showing</label>
            <select
              id="showing"
              className="select"
              value={showing ?? floor?.time ?? ""}
              onChange={(event) => navigate(`/host${queryString({ time: event.target.value, table: tableParam })}`, { replace: true })}
            >
              {(rules?.slot_times ?? []).map((slot) => (
                <option key={slot}>{slot}</option>
              ))}
            </select>
          </div>
          {floor !== null ? (
            <div className="totals">
              <p className="headline">
                {floor.totals.covers_free} covers free at {floor.time}
              </p>
              {floor.totals.rooms.map((room) => (
                <p key={room.room_id}>
                  {room.name}: {room.covers_free} of {room.seats} seats free
                </p>
              ))}
            </div>
          ) : (
            // Holds the totals' lines while the floor loads, so nothing below them moves when they arrive.
            <div className="totals" aria-hidden="true">
              <p className="headline">&nbsp;</p>
              {ROOM_PORTRAITS.map((room) => (
                <p key={room.roomId}>&nbsp;</p>
              ))}
            </div>
          )}
          <div className="actions">
            <button type="button" className="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </section>

        <section className="host-floor" aria-labelledby="floor-title">
          <h2 id="floor-title">Tonight&apos;s floor</h2>
          <FloorPlan
            label="Tonight's floor"
            rooms={rooms}
            firstStop={null}
            focusRequest={focusRequest}
            onChoose={(item) => setTable(item.id)}
          />
        </section>

        {/* Comes in with the plan above it, so the plan filling in never pushes it down. */}
        {rooms.length > 0 && (
          <section className="host-bookings" aria-labelledby="bookings-title">
            <h2 id="bookings-title">Tonight&apos;s bookings</h2>
            {bookings !== null && bookings.length === 0 ? (
              <p className="note">No bookings yet tonight.</p>
            ) : (
              <ul className="bookings">
                {(bookings ?? []).map((booking) => (
                  <li key={booking.reference}>{bookingLine(booking)}</li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      {openTable !== undefined && openRoom !== undefined && (
        <TableDialog
          key={openTable.table_id}
          table={openTable}
          roomName={openRoom.name}
          maxSeats={openRoom.tables.find((entry) => entry.table_id === openTable.table_id)?.max_seats ?? 0}
          onClose={closeDialog}
          onChanged={(closeAfter) => {
            refresh();
            if (closeAfter) closeDialog();
          }}
        />
      )}
    </Page>
  );
}
