import { createContext, useContext, useState } from "react";
import type { EventView, RotaHeat } from "../../shared/api.js";
import { ApiFailure, api } from "../api.js";
import { stationsOpen } from "../format.js";
import { useMediaQuery, useRefresh } from "../hooks.js";
import { Corrections } from "../pages/Corrections.js";
import { Live } from "../pages/Live.js";
import { Overview } from "../pages/Overview.js";
import { Protests } from "../pages/Protests.js";
import { Publish } from "../pages/Publish.js";
import { Rota } from "../pages/Rota.js";
import { Timing } from "../pages/Timing.js";
import { type EventSection, Link } from "../router.js";
import { isStaff, useUser } from "../session.js";
import { AppHeader } from "./AppHeader.js";
import { LoadFailed, Skeleton } from "./ui.js";

interface EventState {
  event: EventView;
  reload: () => void;
  rota: RotaHeat[] | null;
  reloadRota: () => void;
}

const EventContext = createContext<EventState | null>(null);

export function useEvent(): EventState {
  const value = useContext(EventContext);
  if (!value) throw new Error("EventFrame is missing");
  return value;
}

const SECTIONS: { section: EventSection; label: string; path: string }[] = [
  { section: "overview", label: "Overview", path: "" },
  { section: "timing", label: "Timing", path: "/timing" },
  { section: "rota", label: "Rota", path: "/rota" },
  { section: "live", label: "Live results", path: "/live" },
  { section: "protests", label: "Protests", path: "/protests" },
  { section: "corrections", label: "Corrections", path: "/corrections" },
  { section: "publish", label: "Publish", path: "/publish" },
];

export function EventFrame({ id, section }: { id: number; section: EventSection }) {
  const user = useUser();
  const [event, setEvent] = useState<EventView | null>(null);
  const [rota, setRota] = useState<RotaHeat[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const reload = useRefresh(
    async () => {
      try {
        setEvent((await api.get<{ event: EventView }>(`/api/events/${id}`)).event);
        setFailure(null);
      } catch (error) {
        if (error instanceof ApiFailure) setFailure(error);
        throw error;
      }
    },
    10,
    [id],
  );
  const reloadRota = useRefresh(
    async () => setRota((await api.get<{ heats: RotaHeat[] }>(`/api/events/${id}/rota`)).heats),
    1,
    [id],
  );

  if (failure?.status === 404) {
    return (
      <>
        <AppHeader />
        <main className="main">
          <div className="empty">
            <p>You cannot open this screen.</p>
          </div>
        </main>
      </>
    );
  }
  if (!event) {
    return (
      <>
        <AppHeader />
        <main className="main">{failure ? <LoadFailed retry={reload} /> : <Skeleton />}</main>
      </>
    );
  }

  const visible = SECTIONS.filter(
    (s) => (s.section !== "timing" || isStaff(user, "timing")) && (s.section !== "publish" || isStaff(user, "chair")),
  );
  return (
    <EventContext.Provider value={{ event, reload, rota, reloadRota }}>
      {event.status === "running" && event.runningHeat !== null ? (
        <div role="status" aria-label="Live heat" className="strip">
          Heat {event.runningHeat} running
        </div>
      ) : null}
      <AppHeader />
      <nav aria-label="Event sections" className="event-nav">
        {visible.map((s) => (
          <Link key={s.section} href={`/events/${id}${s.path}`} aria-current={s.section === section ? "page" : undefined}>
            {s.label}
          </Link>
        ))}
      </nav>
      <div className="event-layout">
        <Heats section={section} />
        <main className="main event-content" id="main">
          {section === "overview" && <Overview />}
          {section === "timing" && <Timing />}
          {section === "rota" && <Rota />}
          {section === "live" && <Live />}
          {section === "protests" && <Protests />}
          {section === "corrections" && <Corrections />}
          {section === "publish" && <Publish />}
        </main>
      </div>
    </EventContext.Provider>
  );
}

/** Heats and their open-station counters: the fixed left rail from 1024 px, a select below it. */
function Heats({ section }: { section: EventSection }) {
  const { event, rota } = useEvent();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [chosen, setChosen] = useState(1);
  const open = (heat: number): string => {
    const count = rota?.find((h) => h.number === heat)?.unfilled;
    return count === undefined ? "" : stationsOpen(count);
  };
  if (wide) {
    return (
      <nav aria-label="Heats" className="rail">
        <ul>
          {event.heats.map((heat) => (
            <li key={heat.number} className="rail-item">
              <Link href={`/events/${event.id}/rota`}>Heat {heat.number}</Link>
              <span className="rail-classes">{heat.classes.join(", ")}</span>
              <span className="rail-count">{open(heat.number)}</span>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  const selected = event.heats.find((h) => h.number === chosen) ?? event.heats[0];
  return (
    <div className="heat-picker">
      <label htmlFor="heat-select">Heat</label>
      <select
        id="heat-select"
        value={chosen}
        onChange={(e) => {
          const heat = Number(e.target.value);
          setChosen(heat);
          if (section === "rota") document.getElementById(`heat-${heat}`)?.scrollIntoView();
        }}
      >
        {event.heats.map((heat) => (
          <option key={heat.number} value={heat.number}>
            Heat {heat.number}
          </option>
        ))}
      </select>
      {selected ? (
        <>
          <span className="rail-classes">{selected.classes.join(", ")}</span>
          <span className="rail-count">{open(selected.number)}</span>
        </>
      ) : null}
    </div>
  );
}
