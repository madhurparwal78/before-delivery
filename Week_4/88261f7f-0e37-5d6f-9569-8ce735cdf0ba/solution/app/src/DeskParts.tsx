import type { Board, CloseResult, ReportFigures, Timeline, TimelineBlock } from "../shared/api";
import type { IsoDate } from "../shared/dates";
import { NO_FIGURE as NO_FIGURE_TEXT, formatMoney } from "../shared/money";
import { statusWords } from "../shared/notices";
import { holdsNights, mayCheckIn, offers } from "../shared/stayStatus";
import { blockEnd, spanOf, stayAt } from "./timelineModel";
import { Chip, EmptySheet } from "./ui";

export interface TallyView {
  date: IsoDate | null;
  roomsSold: number | null;
  roomRevenueCents: number | null;
  figures: ReportFigures | null;
  counting: boolean;
}

export function TallyRail({ tally }: { tally: TallyView }) {
  const { figures } = tally;
  const revenue = tally.roomRevenueCents === null ? NO_FIGURE_TEXT : formatMoney(tally.roomRevenueCents);
  const rows: [string, string][] = [
    ["Tally date", tally.date ? `Last closed night ${tally.date}` : "No night closed yet"],
    ["Tally rooms sold", tally.roomsSold === null ? NO_FIGURE_TEXT : String(tally.roomsSold)],
    ["Tally room revenue", revenue],
    ["Tally occupancy", figures?.occupancy ?? NO_FIGURE_TEXT],
    ["Tally average daily rate", figures?.averageDailyRate ?? NO_FIGURE_TEXT],
    ["Tally revenue per available room", figures?.revenuePerAvailableRoom ?? NO_FIGURE_TEXT],
  ];
  const labels = ["Night", "Rooms sold", "Room revenue", "Occupancy", "Average daily rate", "Revenue per available room"];
  return (
    <section role="region" aria-label="Tally rail" aria-busy={tally.counting} className="tally-rail">
      <h2 className="tally-title">Tally</h2>
      <div className="tally-figures">
        {rows.map(([name, value], index) => (
          <div key={name} className="tally-figure">
            <span className="tally-label">{labels[index]}</span>
            <span role="status" aria-label={name} className="money">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CloseResults({ result }: { result: CloseResult }) {
  return (
    <section className="close-results">
      <table aria-label="Close results" className="ledger">
        <caption>Close results for {result.businessDate}</caption>
        <thead>
          <tr><th scope="col">Room</th><th scope="col" className="money-head">Posted</th></tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.stayId}><td>{row.roomNumber}</td><td className="money">{formatMoney(row.postedCents)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TodayPanel({ data, businessDate, onOpen }: { data: Timeline; businessDate: IsoDate; onOpen: (stayId: string, opener: HTMLElement) => void }) {
  const live = data.blocks.filter((block) => holdsNights(block.status));
  const roomNumber = (block: TimelineBlock): string => data.rooms.find((room) => room.id === block.roomId)?.number ?? "";
  const stays = [...new Set(live.map((block) => block.stayId))].map((stayId) => spanOf(live, stayId));
  const arrivals = stays.filter((stay) => stay.arrival === businessDate);
  const departures = stays.filter((stay) => stay.departure === businessDate);
  const row = (stayId: string) => {
    const block = live.find((candidate) => candidate.stayId === stayId && candidate.firstNight <= businessDate && businessDate <= blockEnd(candidate)) ?? live.find((candidate) => candidate.stayId === stayId);
    return block ? (
      <li key={stayId}>
        <button type="button" className="link-button" onClick={(event) => onOpen(stayId, event.currentTarget)}>
          {roomNumber(block)} · {block.guestName}
        </button>
      </li>
    ) : null;
  };
  return (
    <>
      <h2>Today</h2>
      <h3>Arrivals</h3>
      {arrivals.length > 0 ? <ul className="plain-list">{arrivals.map((stay) => row(stay.stayId))}</ul> : <EmptySheet>No arrivals.</EmptySheet>}
      <h3>Departures</h3>
      {departures.length > 0 ? <ul className="plain-list">{departures.map((stay) => row(stay.stayId))}</ul> : <EmptySheet>No departures.</EmptySheet>}
    </>
  );
}

interface PhoneActions {
  open: (stayId: string, opener: HTMLElement) => void;
  openRoom: (roomId: string) => void;
  checkIn: (stayId: string) => void;
  checkOut: (stayId: string) => void;
}

export function PhoneRooms({ data, board, businessDate, blocked, actions }: { data: Timeline; board: Board | null; businessDate: IsoDate; blocked: string[]; actions: PhoneActions }) {
  return (
    <ul aria-label="Today's rooms" className="phone-rooms">
      {data.rooms.map((room) => {
        const held = stayAt(data.blocks, { roomId: room.id, date: businessDate });
        const dates = board?.rooms.find((candidate) => candidate.roomId === room.id);
        const arrival = dates?.arrival ?? null;
        return (
          <li key={room.id} data-blocked={blocked.includes(room.id) ? "true" : undefined}>
            <span className="room-number">{room.number}</span>
            <button type="button" className="chip-button" aria-label={`Room ${room.number} status: ${statusWords(room.status)}`} onClick={() => actions.openRoom(room.id)}>
              <Chip status={room.status} />
            </button>
            <span className="guest-line">{held ? `${held.guestName} · ${dates?.arrival ?? ""} to ${dates?.departure ?? ""}` : "Vacant"}</span>
            {held ? (
              <span className="row-actions">
                <button type="button" aria-label={`Open stay ${held.guestName}`} onClick={(event) => actions.open(held.stayId, event.currentTarget)}>Open</button>
                {mayCheckIn({ status: held.status, arrival: arrival ?? "" }, businessDate) ? (
                  <button type="button" aria-label={`Check in ${held.guestName}`} onClick={() => actions.checkIn(held.stayId)}>Check in</button>
                ) : null}
                {offers("check_out", held.status) ? (
                  <button type="button" aria-label={`Check out ${held.guestName}`} onClick={() => actions.checkOut(held.stayId)}>Check out</button>
                ) : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
