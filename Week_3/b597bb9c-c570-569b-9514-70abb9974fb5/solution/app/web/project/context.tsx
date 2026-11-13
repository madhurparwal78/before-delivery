import { createContext, useContext } from "react";
import { useStore } from "../lib/store";
import type { ProjectState } from "./state";
import type { ProjectStore } from "./store";

export const ProjectContext = createContext<ProjectStore | null>(null);

function useProjectStore(): ProjectStore {
  const store = useContext(ProjectContext);
  if (!store) throw new Error("outside a project");
  return store;
}

export function useProject(): { store: ProjectStore; state: ProjectState } {
  const store = useProjectStore();
  return { store, state: useStore(store.state) };
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
