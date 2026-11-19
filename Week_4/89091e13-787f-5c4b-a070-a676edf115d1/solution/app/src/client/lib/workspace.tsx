import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { LiveEvent, Role, SampleEvent, WorkspaceInfo } from "../../shared/api.ts";
import { producedText, rejectionText } from "../../shared/copy.ts";
import { Boot } from "../components/StrandCanvas.tsx";
import { closeLive, connectLive, listenLive } from "./live.ts";
import { navigate } from "./router.tsx";
import { LiveVersionContext, useJson } from "./resource.ts";
import { useSession } from "./session.tsx";

interface WorkspaceContextValue {
  id: string;
  info: WorkspaceInfo;
  role: Role;
  announcements: string[];
  /** Every sample the live channel has pushed, so a page that mounts after one still announces it. */
  sampled: SampleEvent[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const ANNOUNCEMENTS_KEPT = 6;
const SAMPLES_KEPT = 100;

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace outside a workspace");
  return value;
}

function announcementFor(event: LiveEvent): string | null {
  if (event.type === "block") return producedText(event.height, event.blobs, event.squareWidth);
  if (event.type === "rejected") return rejectionText(event.height, event.rejection);
  return null;
}

interface LiveChannel {
  version: number;
  announcements: string[];
  sampled: SampleEvent[];
}

/** Keeps the live channel open; every push bumps the version so that every resource on screen refetches. */
function useLiveChannel(id: string, enabled: boolean): LiveChannel {
  const [version, setVersion] = useState(0);
  const [announcements, setAnnouncements] = useState<string[]>([]);
  const [sampled, setSampled] = useState<SampleEvent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    connectLive(id);
    const stopListening = listenLive((item) => {
      if (item !== "open") {
        const line = announcementFor(item);
        if (line) setAnnouncements((old) => [...old, line].slice(-ANNOUNCEMENTS_KEPT));
        if (item.type === "sample") setSampled((old) => [...old, item].slice(-SAMPLES_KEPT));
      }
      setVersion((n) => n + 1);
    });
    return () => {
      stopListening();
      closeLive();
    };
  }, [id, enabled]);

  return { version, announcements, sampled };
}

function WorkspaceLoader({ id, channel, notFound, onVisible, children }: { id: string; channel: LiveChannel; notFound: ReactNode; onVisible: (visible: boolean) => void; children: ReactNode }) {
  const info = useJson<WorkspaceInfo>(`/api/w/${id}`, true);
  const visible = info.data !== null && info.error === null;

  useEffect(() => {
    onVisible(visible);
  }, [visible, onVisible]);

  useEffect(() => {
    if (info.error?.status === 401) navigate("/signin", true);
  }, [info.error]);

  if (info.error) return <>{notFound}</>;
  if (!info.data) return <Boot />;
  const value: WorkspaceContextValue = {
    id,
    info: info.data,
    role: info.data.role,
    announcements: channel.announcements,
    sampled: channel.sampled,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/**
 * Loads the workspace and renders `notFound` when it is not visible to the person. A member's live channel opens at once,
 * alongside the workspace fetch, so no event is missed while the page first renders; anyone else never tries the upgrade.
 */
export function WorkspaceProvider({ id, notFound, children }: { id: string; notFound: ReactNode; children: ReactNode }) {
  const { me } = useSession();
  const [visible, setVisible] = useState(false);
  const member = me?.workspaces.some((workspace) => workspace.id === id) ?? false;
  const channel = useLiveChannel(id, member || visible);
  return (
    <LiveVersionContext.Provider value={channel.version}>
      <WorkspaceLoader id={id} channel={channel} notFound={notFound} onVisible={setVisible}>
        {children}
      </WorkspaceLoader>
    </LiveVersionContext.Provider>
  );
}
