// The signed-in page's shared state: the workspace record (refreshed every 10 s), people,
// projects, channels with unread counts, the floor, announcements and the live event stream.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { get, type Channel, type Cycle, type Floor, type Person, type Project, type Room, type UnreadBody, type Workspace } from "./api";
import { takeWorkspaceBoot } from "./boot";
import { openStream, type StreamEvent } from "./stream";

type Listener = (event: StreamEvent) => void;

interface App {
  person: Person;
  workspace: Workspace;
  isOwner: boolean;
  members: Person[];
  projects: Project[];
  channels: Channel[];
  unread: UnreadBody;
  floor: Floor | null;
  currentCycle: number;
  calendarVersion: number;
  announcement: string;
  announce: (text: string) => void;
  on: (listener: Listener) => () => void;
  reloadChannels: () => void;
  reloadWorkspace: () => void;
  reloadFloor: () => void;
  nameOf: (personId: string | null) => string;
}

const Context = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(Context);
  if (!app) throw new Error("useApp outside the workspace");
  return app;
}

function calendarKey(w: Workspace): string {
  return JSON.stringify([w.time_zone, w.working_weekdays, w.holidays, w.cycle_anchor]);
}

export function AppProvider(props: {
  person: Person;
  workspace: Workspace;
  onSignedOut: () => void;
  onNotice: () => void;
  onTrouble: () => void;
  children: ReactNode;
}): JSX.Element {
  const { onSignedOut, onNotice, onTrouble } = props;
  const [workspace, setWorkspace] = useState(props.workspace);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [first] = useState(() => takeWorkspaceBoot(props.person.id));
  const [members, setMembers] = useState<Person[]>(first?.members ?? []);
  const [projects, setProjects] = useState<Project[]>(first?.projects ?? []);
  const [channels, setChannels] = useState<Channel[]>(first?.channels ?? []);
  const [unread, setUnread] = useState<UnreadBody>(first?.unread ?? { channels: {}, inbox: 0 });
  const [floor, setFloor] = useState<Floor | null>(null);
  const [currentCycle, setCurrentCycle] = useState<number | null>(first?.current_cycle ?? null);
  const [announcement, setAnnouncement] = useState("");
  const [loaded, setLoaded] = useState({ people: Boolean(first?.members), projects: Boolean(first?.projects), channels: Boolean(first?.channels) });
  const listeners = useRef(new Set<Listener>());
  const calendar = useRef(calendarKey(props.workspace));
  const today = useRef(props.workspace.today);
  const booted = useRef(first !== null && first.current_cycle !== undefined);

  const announce = useCallback((text: string) => {
    flushSync(() => setAnnouncement(""));
    setAnnouncement(text);
  }, []);

  const reloadWorkspace = useCallback(() => {
    get<Workspace>("/api/workspace")
      .then((next) => {
        setWorkspace(next);
        const key = calendarKey(next);
        const calendarChanged = key !== calendar.current;
        if (calendarChanged) {
          calendar.current = key;
          setCalendarVersion((v) => v + 1);
        }
        if (calendarChanged || next.today !== today.current) {
          today.current = next.today;
          void get<Cycle>("/api/cycles/current")
            .then((c) => setCurrentCycle(c.number))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, []);

  const reloadChannels = useCallback(() => {
    get<{ channels: Channel[] }>("/api/channels")
      .then((r) => {
        setChannels(r.channels);
        setLoaded((l) => ({ ...l, channels: true }));
      })
      .catch(() => undefined);
    get<UnreadBody>("/api/unread")
      .then(setUnread)
      .catch(() => undefined);
  }, []);

  const reloadFloor = useCallback(() => {
    get<Floor>("/api/floor")
      .then(setFloor)
      .catch(() => undefined);
  }, []);

  const reloadPeople = useCallback(() => {
    get<{ members: Person[] }>("/api/members")
      .then((r) => {
        setMembers(r.members);
        setLoaded((l) => ({ ...l, people: true }));
      })
      .catch(() => undefined);
    get<{ projects: Project[] }>("/api/projects")
      .then((r) => {
        setProjects(r.projects);
        setLoaded((l) => ({ ...l, projects: true }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!booted.current) {
      reloadPeople();
      reloadChannels();
      get<Cycle>("/api/cycles/current")
        .then((c) => setCurrentCycle(c.number))
        .catch(() => setCurrentCycle(1));
    }
    reloadFloor();
    const timer = setInterval(reloadWorkspace, 10_000);
    return () => clearInterval(timer);
  }, [reloadPeople, reloadChannels, reloadFloor, reloadWorkspace]);

  useEffect(() => {
    if (Object.keys(unread.channels).some((id) => !channels.some((c) => c.id === id))) reloadChannels();
  }, [unread, channels, reloadChannels]);

  useEffect(() => {
    const updateRoom = (room: Room): void =>
      setFloor((f) => {
        if (!f) return f;
        const mine = room.occupants.some((o) => o.person_id === props.person.id);
        const myRoom = mine ? room.id : f.me.room_id === room.id ? null : f.me.room_id;
        return { rooms: f.rooms.map((r) => (r.id === room.id ? room : r)), me: { ...f.me, room_id: myRoom } };
      });
    const handle = (event: StreamEvent): void => {
      switch (event.name) {
        case "unread":
          setUnread(event.data);
          break;
        case "room":
          updateRoom(event.data);
          break;
        case "presence": {
          const { person_id, status } = event.data;
          setFloor((f) => f && { ...f, rooms: f.rooms.map((r) => ({ ...r, occupants: r.occupants.map((o) => (o.person_id === person_id ? { ...o, status } : o)) })) });
          break;
        }
        case "notice":
          onNotice();
          break;
        case "reset":
          reloadChannels();
          reloadFloor();
          reloadPeople();
          break;
        case "revoked": {
          const { scope, id } = event.data;
          if (scope === "workspace") onSignedOut();
          else if (scope === "channel") setChannels((list) => list.filter((c) => c.id !== id));
          else reloadPeople();
          break;
        }
      }
      for (const listener of listeners.current) listener(event);
    };
    return openStream({ event: handle, signedOut: onSignedOut, trouble: onTrouble }, first?.last_event_id ?? null);
  }, [first, props.person.id, onSignedOut, onNotice, onTrouble, reloadChannels, reloadFloor, reloadPeople]);

  const value = useMemo<App>(() => {
    const names = new Map(members.map((m) => [m.id, m.name]));
    return {
      person: props.person,
      workspace,
      isOwner: props.person.role === "owner",
      members,
      projects,
      channels: channels.map((c) => ({ ...c, unread: unread.channels[c.id] ?? 0 })).filter((c) => c.id in unread.channels || Object.keys(unread.channels).length === 0),
      unread,
      floor,
      currentCycle: currentCycle ?? 1,
      calendarVersion,
      announcement,
      announce,
      on: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
      reloadChannels,
      reloadWorkspace,
      reloadFloor,
      nameOf: (id) => (id === null ? "Someone" : (names.get(id) ?? (id === props.person.id ? props.person.name : "Someone"))),
    };
  }, [props.person, workspace, members, projects, channels, unread, floor, currentCycle, calendarVersion, announcement, announce, reloadChannels, reloadWorkspace, reloadFloor]);

  const ready = loaded.people && loaded.projects && loaded.channels && currentCycle !== null;
  return <Context.Provider value={value}>{ready ? props.children : <div className="loading-shell" aria-busy="true" />}</Context.Provider>;
}
