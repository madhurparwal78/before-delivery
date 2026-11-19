import { TriangleAlert } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type CollectionInfo, type CollectionSummary, type ProjectInfo, type Role, ApiFailure, get } from "../api.js";
import { type Route } from "../router.js";
import { useLayout } from "../hooks.js";
import { NotFound } from "../screens/NotFound.js";
import { Dialog, useOverlay } from "../components/Dialog.js";
import { RailContent } from "./Rail.js";
import { SectionNav } from "./SectionNav.js";
import { TopBar } from "./TopBar.js";
import { Lock } from "lucide-react";

/** Everything under /p/<pid>: the project, its collections, the live feed of the open collection and the outage banner. */

type ShellRoute = Extract<Route, { name: "project" | "members" | "collection" }>;

interface Shell {
  project: ProjectInfo;
  role: Role;
  collections: CollectionSummary[];
  collection: CollectionInfo | null;
  reloadCollections: () => Promise<void>;
  reloadCollection: () => Promise<void>;
  /** Called whenever anyone changes a document of the open collection. */
  onChange: (listener: () => void) => () => void;
  recheckStorage: () => Promise<void>;
  /** The route names a document that does not exist: the whole screen becomes Not found. */
  markMissing: () => void;
}

const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell needs a ProjectShell");
  return shell;
}

const FEED_DELAY_MS = 1200;

type Loaded<T> = { status: "loading" } | { status: "missing" } | { status: "ready"; value: T };

export function ProjectShell({ route, children }: { route: ShellRoute; children: (shell: Shell) => ReactNode }): ReactNode {
  const { pid } = route;
  const cid = route.name === "collection" ? route.cid : null;
  const layout = useLayout();
  const [project, setProject] = useState<Loaded<ProjectInfo>>({ status: "loading" });
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [collection, setCollection] = useState<Loaded<CollectionInfo> | null>(cid ? { status: "loading" } : null);
  const [role, setRole] = useState<Role | null>(null);
  const [storageDown, setStorageDown] = useState(false);
  const drawer = useOverlay();
  const [missing, setMissing] = useState(false);
  const markMissing = useCallback(() => setMissing(true), []);
  const listeners = useRef(new Set<() => void>());
  /** The collection's sequence when the screen first loaded it: the feed resumes from here, so nothing is missed while it connects. */
  const firstSequence = useRef<number | null>(null);

  useEffect(() => {
    setProject({ status: "loading" });
    get<ProjectInfo>(`/api/projects/${pid}`).then(
      (info) => {
        setProject({ status: "ready", value: info });
        setRole(info.role);
      },
      () => setProject({ status: "missing" }),
    );
  }, [pid]);

  const reloadCollections = useCallback(async () => {
    const answer = await get<{ collections: CollectionSummary[] }>(`/api/projects/${pid}/collections`).catch(() => null);
    if (answer) setCollections(answer.collections);
  }, [pid]);
  useEffect(() => void reloadCollections(), [reloadCollections]);

  const reloadCollection = useCallback(async () => {
    if (!cid) return;
    try {
      const info = await get<CollectionInfo>(`/api/projects/${pid}/collections/${cid}`);
      firstSequence.current ??= info.sequence;
      setCollection({ status: "ready", value: info });
    } catch (error) {
      if (error instanceof ApiFailure) setCollection({ status: "missing" });
    }
  }, [pid, cid]);
  useEffect(() => {
    firstSequence.current = null;
    setCollection(cid ? { status: "loading" } : null);
    void reloadCollection();
  }, [cid, reloadCollection]);

  const recheckStorage = useCallback(async () => {
    const health = await get<{ status: string }>("/api/health").catch(() => ({ status: "unavailable" }));
    setStorageDown(health.status === "unavailable");
  }, []);
  useEffect(() => {
    if (cid) void recheckStorage();
  }, [cid, recheckStorage]);

  useEffect(() => {
    if (!cid) return;
    let stream: EventSource | null = null;
    // The page's own requests settle first and the stream opens after them; it resumes from the sequence read at load, so no change is lost in between.
    const timer = window.setTimeout(() => {
      const after = firstSequence.current;
      stream = new EventSource(`/api/projects/${pid}/collections/${cid}/events${after === null ? "" : `?after=${after}`}`);
      stream.addEventListener("change", () => {
        void reloadCollection();
        listeners.current.forEach((listener) => listener());
      });
      let roleEvents = 0;
      stream.addEventListener("role", (event) => {
        roleEvents += 1;
        setRole((JSON.parse((event as MessageEvent<string>).data) as { role: Role }).role);
      });
      // A role change made before the stream connected sends no event: re-read the role once the stream is open.
      stream.addEventListener("open", () => {
        const seen = roleEvents;
        get<ProjectInfo>(`/api/projects/${pid}`).then(
          (fresh) => {
            if (roleEvents === seen) setRole(fresh.role);
          },
          () => undefined,
        );
      });
    }, FEED_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      stream?.close();
    };
  }, [pid, cid, reloadCollection]);

  const onChange = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);

  const info = project.status === "ready" ? project.value : null;
  const current = collection?.status === "ready" ? collection.value : null;
  const shell = useMemo<Shell | null>(
    () =>
      info && role && collections
        ? { project: info, role, collections, collection: current, reloadCollections, reloadCollection, onChange, recheckStorage, markMissing }
        : null,
    [info, role, collections, current, reloadCollections, reloadCollection, onChange, recheckStorage, markMissing],
  );

  if (project.status === "missing" || collection?.status === "missing" || missing) return <NotFound />;
  const section = route.name === "collection" ? route.section : route.name === "members" ? "members" : null;
  return (
    <div className="app-shell">
      <TopBar onCollections={layout === "phone" ? () => drawer.open(true) : null} />
      {storageDown && cid ? (
        <div className="banner" role="alert">
          <TriangleAlert size={20} aria-hidden="true" />
          File storage is unavailable. Try again later.
        </div>
      ) : null}
      <div className="project-layout">
        {layout !== "phone" ? <RailContent project={info} collections={collections} cid={cid} section={section} /> : null}
        <main className="content" data-section={section ?? "home"}>
          {role === "reader" && cid ? (
            <p className="read-note">
              <Lock size={16} aria-hidden="true" />
              You have read access
            </p>
          ) : null}
          <SectionNav route={route} />
          {shell ? (
            <ShellContext value={shell}>{children(shell)}</ShellContext>
          ) : (
            <div className="skeleton-block" aria-busy="true" style={{ minHeight: 240 }} />
          )}
        </main>
      </div>
      {drawer.slot && layout === "phone" ? (
        <Dialog key={drawer.slot.id} name="Collections" variant="drawer" onClose={drawer.closeFor(drawer.slot.id)}>
          <RailContent project={info} collections={collections} cid={cid} section={section} inDrawer />
        </Dialog>
      ) : null}
    </div>
  );
}

