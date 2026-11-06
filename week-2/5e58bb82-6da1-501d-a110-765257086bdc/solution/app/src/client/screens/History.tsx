// Mission history: every event newest first, filtered by kind from the address, paged back in fifties.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, quietly, type Mission } from "../api";
import { navigate, useLocation } from "../router";
import { NotFound } from "./NotFound";

const KINDS = ["created", "assignments", "status", "line", "file", "alert", "infill", "owner", "hold", "geofence", "rerun"];
const LABEL = (k: string) => k[0].toUpperCase() + k.slice(1);

interface Event {
  seq: number;
  at: string;
  kind: string;
  actor: string;
  summary: string;
}

export function History({ missionId }: { missionId: string }) {
  const { search } = useLocation();
  const kindsParam = new URLSearchParams(search).get("kinds");
  const kinds = kindsParam === null ? KINDS : kindsParam.split(",").filter((k) => KINDS.includes(k));
  const [mission, setMission] = useState<Mission | null | undefined>(undefined);
  const [events, setEvents] = useState<Event[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const focusIndex = useRef<number | null>(null);

  useEffect(() => {
    quietly(api<Mission>(`/api/missions/${missionId}`).then((r) => setMission(r.ok ? r.data : null)));
  }, [missionId]);

  const query = (before: string | null) => {
    const p = new URLSearchParams();
    if (kindsParam !== null) p.set("kinds", kinds.join(","));
    if (before) p.set("before", before);
    const q = p.toString();
    return `/api/missions/${missionId}/history${q ? `?${q}` : ""}`;
  };

  useEffect(() => {
    quietly(api<{ events: Event[]; next: string | null }>(query(null)).then((r) => {
      if (!r.ok) return;
      setEvents(r.data.events);
      setNext(r.data.next);
    }));
  }, [missionId, kindsParam]);

  useLayoutEffect(() => {
    if (focusIndex.current === null) return;
    list.current?.querySelectorAll<HTMLElement>("li")[focusIndex.current]?.focus();
    focusIndex.current = null;
  }, [events]);

  const older = () => quietly(api<{ events: Event[]; next: string | null }>(query(next)).then((r) => {
    if (!r.ok) return;
    focusIndex.current = events.length;
    setEvents([...events, ...r.data.events]);
    setNext(r.data.next);
  }));

  const toggle = (kind: string) => {
    const set = new Set(kinds);
    if (set.has(kind)) set.delete(kind);
    else set.add(kind);
    const chosen = KINDS.filter((k) => set.has(k));
    navigate(`/missions/${missionId}/history${chosen.length === KINDS.length ? "" : `?kinds=${chosen.join(",")}`}`, { replace: true });
  };

  if (mission === null) return <NotFound />;
  // The page waits for the mission: a long name wraps the heading and would push the filters down.
  if (mission === undefined) return <main className="page" />;
  return (
    <main className="page">
      <h1>History of {mission.name}</h1>
      <fieldset role="group" aria-label="Event kinds" className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        {KINDS.map((k) => (
          <label key={k} className="row" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} />
            {LABEL(k)}
          </label>
        ))}
      </fieldset>
      <p role="status" aria-live="polite" aria-label="History status">Showing {events.length} events</p>
      <ol ref={list} aria-label="Mission events" className="slip-rows">
        {events.map((e) => (
          <li key={e.seq} tabIndex={-1}>
            <span><span className="num">{e.at.slice(0, 10)} {e.at.slice(11, 19)}</span> UTC · {e.actor} · {e.summary}</span>
          </li>
        ))}
      </ol>
      {next && <button type="button" onClick={older}>Load older events</button>}
    </main>
  );
}
