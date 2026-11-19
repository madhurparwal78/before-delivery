import { useCallback, useEffect, useState } from "react";
import type { ExportRecord, Project } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { useSession } from "../lib/session";
import { useStatus } from "../lib/status";
import { useStreamEvent, useStreamOpen } from "../lib/stream";

interface Library {
  /** Newest saved first; null until the first answer. */
  projects: Project[] | null;
  exports: ExportRecord[] | null;
}

/** The signed-in person's own projects and exports, kept current by `project-saved` events for their own projects. */
/** A live reload that fails keeps the list on screen; the next stream event or visit loads it again. */
function reportReloadFailure(error: unknown): void {
  console.warn("project list reload failed:", error instanceof Error ? error.message : error);
}

export function useLibrary(): Library {
  const { account } = useSession();
  const { announce } = useStatus();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [exports, setExports] = useState<ExportRecord[] | null>(null);

  const loadProjects = useCallback(async () => {
    const body = await api.get<{ projects: Project[] }>("/api/projects");
    setProjects([...body.projects].sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
  }, []);

  useEffect(() => {
    const report = (error: unknown) => {
      if (error instanceof ApiError) announce(error.message);
    };
    loadProjects().catch((error: unknown) => { report(error); setProjects([]); });
    api.get<{ exports: ExportRecord[] }>("/api/exports").then(
      (body) => setExports([...body.exports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      (error: unknown) => { report(error); setExports([]); },
    );
  }, [loadProjects, announce]);

  useStreamOpen(() => { loadProjects().catch(reportReloadFailure); });
  useStreamEvent("project-saved", (event) => {
    if (event.ownerId === account?.id) loadProjects().catch(reportReloadFailure);
  });

  return { projects, exports };
}
