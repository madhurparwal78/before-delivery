import { createContext, useContext } from "react";
import type { Allowance, Person, Project } from "../../shared/types";
import { api } from "./api";
import type { LiveSocket } from "./live";
import { Store } from "./store";

export interface SessionInfo {
  person: Person;
  isOwner: boolean;
}

export const allowanceStore = new Store<Allowance | null>(null);

interface ShellContext {
  session: SessionInfo;
  socket: LiveSocket;
}

export const ShellContext = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("outside the signed-in shell");
  return shell;
}

export const projectsStore = new Store<Project[] | null>(null);

export async function refreshProjects(): Promise<Project[]> {
  const { items } = await api.get<{ items: Project[] }>("/api/projects");
  projectsStore.set(items);
  return items;
}
