// The current project's identity and the signed-in user's role in it.
//   useRole()     { role, permissions, loaded, denied, atLeast(role), can(permission) }
//                 `role` is my_role from GET /api/projects/<id> ('guest' | 'reporter' | 'developer' | 'maintainer' | 'owner', or a
//                 custom role's name), `permissions` is my_permissions. It follows live `role` messages for the signed-in user.
//                 Render a control only when the role may use it: `const { atLeast, can } = useRole(); atLeast('developer') && ...`.
//                 When a control that holds focus disappears, <main> takes focus (done by shell/main.tsx).
//   useProject()  { id, path, name, defaultBranch, error, loaded } of the project the page's <Main project> loads.
// The state is filled by <Main project={id}> / <LiveMain project={id}>; outside those it is empty.
import { api, ApiError, asApiError } from "./api.ts";
import { createStore, useStore } from "./store.ts";
import { asNumber, asString, asStringList, isRecord } from "./util.ts";

export const ROLE_LEVELS: Readonly<Record<string, number>> = { guest: 10, reporter: 20, developer: 30, maintainer: 40, owner: 50 };

interface ProjectState {
  id: string | null;
  path: string | null;
  name: string | null;
  defaultBranch: string | null;
  role: string | null;
  permissions: string[];
  loaded: boolean;
  denied: boolean;
  error: ApiError | null;
}

const blank = (id: string | null): ProjectState => ({
  id,
  path: null,
  name: null,
  defaultBranch: null,
  role: null,
  permissions: [],
  loaded: false,
  denied: false,
  error: null,
});

export const projectStore = createStore<ProjectState>(blank(null));

export function resetProject(id: string): void {
  if (projectStore.get().id !== id) projectStore.set(blank(id));
}

/** Loads GET /api/projects/<id> into the store and returns the project's current live seq when the server reports it. */
export async function loadProject(id: string): Promise<number | null> {
  try {
    const raw: unknown = await api.get(`/api/projects/${encodeURIComponent(id)}`);
    const body = isRecord(raw) && isRecord(raw.project) ? raw.project : raw;
    if (!isRecord(body)) return null;
    if (projectStore.get().id !== id) return null;
    projectStore.update((state) => ({
      ...state,
      path: asString(body.path) ?? state.path,
      name: asString(body.name) ?? state.name,
      defaultBranch: asString(body.default_branch) ?? state.defaultBranch,
      role: state.denied ? null : (asString(body.my_role) ?? state.role),
      permissions: state.denied ? [] : asStringList(body.my_permissions),
      loaded: true,
      error: null,
    }));
    return asNumber(body.seq) ?? (isRecord(raw) ? asNumber(raw.seq) : null);
  } catch (cause) {
    if (projectStore.get().id === id) projectStore.update((state) => ({ ...state, loaded: true, error: asApiError(cause) }));
    return null;
  }
}

export function applyRole(role: string | null, path: string | null): void {
  projectStore.update((state) =>
    role === null
      ? { ...state, role: null, permissions: [], denied: true, path: path ?? state.path }
      : { ...state, role: role in ROLE_LEVELS ? role : state.role, path: path ?? state.path },
  );
}

interface RoleInfo {
  role: string | null;
  permissions: readonly string[];
  loaded: boolean;
  denied: boolean;
  atLeast(role: string): boolean;
  can(permission: string): boolean;
}

export function useRole(): RoleInfo {
  const state = useStore(projectStore);
  const level = state.role === null ? 0 : (ROLE_LEVELS[state.role] ?? 0);
  return {
    role: state.role,
    permissions: state.permissions,
    loaded: state.loaded,
    denied: state.denied,
    atLeast: (role) => level >= (ROLE_LEVELS[role] ?? Infinity),
    can: (permission) => state.permissions.includes(permission),
  };
}

export function useProject(): Pick<ProjectState, "id" | "path" | "name" | "defaultBranch" | "error" | "loaded"> {
  const { id, path, name, defaultBranch, error, loaded } = useStore(projectStore);
  return { id, path, name, defaultBranch, error, loaded };
}
