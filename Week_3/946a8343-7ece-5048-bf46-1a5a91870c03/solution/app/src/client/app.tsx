// Root component: matches the location to the route table, provides the route to every hook (useRoute, useQuery) and renders
// the shell around the page. The page is keyed by path so a new address mounts a fresh page; query changes keep it mounted.
import { useMemo } from "preact/hooks";
import { matchRoute } from "./routes.ts";
import { locationStore, RouteContext, type RouteState } from "./router.ts";
import { Shell } from "./shell/shell.tsx";
import { useStore } from "./store.ts";

export function App() {
  const where = useStore(locationStore);
  const matched = useMemo(() => matchRoute(where.path), [where.path]);
  const state = useMemo<RouteState>(
    () => ({ pattern: matched.pattern, path: where.path, search: where.search, params: matched.params, query: new URLSearchParams(where.search) }),
    [matched, where.path, where.search],
  );
  const Page = matched.page;
  return (
    <RouteContext.Provider value={state}>
      <Shell>
        <Page key={where.path} />
      </Shell>
    </RouteContext.Provider>
  );
}
