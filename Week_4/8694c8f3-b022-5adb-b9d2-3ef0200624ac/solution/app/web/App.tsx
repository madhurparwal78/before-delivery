import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "./api.ts";
import type { Account } from "../shared/types.ts";
import { demoDocument } from "./store/demo.ts";
import { EditorStore } from "./store/editor.ts";
import { Booth, JoinDialog, UsedInvite } from "./ui/Auth.tsx";
import { Shell } from "./ui/Shell.tsx";
import { ShowPage } from "./ui/ShowPage.tsx";
import type { SetListing } from "../shared/types.ts";

type Route = { kind: "show"; token: string } | { kind: "join"; token: string } | { kind: "set"; id: string } | { kind: "home" };

function routeOf(path: string): Route {
  const [, head, tail] = path.split("/");
  if (head === "show" && tail) return { kind: "show", token: tail };
  if (head === "join" && tail) return { kind: "join", token: tail };
  if (head === "sets" && tail) return { kind: "set", id: tail };
  return { kind: "home" };
}

function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(routeOf(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((path: string) => {
    history.pushState(null, "", path);
    setRoute(routeOf(path));
  }, []);
  return [route, go];
}

export function App() {
  const [route, go] = useRoute();
  if (route.kind === "show") return <ShowPage token={route.token} />;
  return <Studio route={route} go={go} />;
}

function Studio({ route, go }: { route: Exclude<Route, { kind: "show" }>; go: (path: string) => void }) {
  const [user, setUser] = useState<Account | null | undefined>(undefined);
  const [sets, setSets] = useState<SetListing[]>([]);
  const [store, setStore] = useState<EditorStore | null>(null);
  const [booth, setBooth] = useState(route.kind === "home" || route.kind === "join");
  const [invite, setInvite] = useState<{ set_name: string; role: string; used: boolean } | null>(null);
  const [joinProblem, setJoinProblem] = useState("");
  const [usedLink, setUsedLink] = useState(false);

  useEffect(() => {
    void api.me().then((found) => setUser(found.user), () => setUser(null));
  }, []);

  const refreshSets = useCallback(async (): Promise<void> => {
    try {
      setSets((await api.sets()).sets);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }, []);

  useEffect(() => {
    if (user) void refreshSets();
  }, [user, refreshSets, route.kind === "home"]);

  const wanted = route.kind === "set" ? route.id : null;
  useEffect(() => {
    if (user === undefined) return;
    let alive = true;
    let current: EditorStore | null = null;
    const person = { user_id: user?.id ?? "demo-visitor", display_name: user?.display_name ?? "Visitor" };
    if (!user) {
      current = EditorStore.demo(demoDocument(), person);
      setStore(current);
    } else if (wanted) {
      void EditorStore.open(wanted, person).then(
        (opened) => {
          if (!alive) {
            opened.dispose();
            return;
          }
          current = opened;
          setStore(opened);
        },
        () => go("/"),
      );
    } else {
      setStore(null);
    }
    return () => {
      alive = false;
      current?.dispose();
    };
  }, [user, wanted]);

  const joinToken = route.kind === "join" ? route.token : null;
  useEffect(() => {
    if (!user || !joinToken) return;
    void api.invitation(joinToken).then(async (found) => {
      if (!found.used) {
        setInvite(found);
        return;
      }
      try {
        const joined = await api.accept(joinToken);
        go(`/sets/${joined.set_id}`);
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "invite_used") setUsedLink(true);
        else throw error;
      }
    }, () => setUsedLink(true));
  }, [user, joinToken]);

  if (user === undefined) return <div className="boot" aria-busy="true" />;

  const signOut = (): void => {
    void api.logout().then(() => {
      setUser(null);
      setSets([]);
      go("/");
      setBooth(true);
    });
  };

  const join = (): void => {
    if (!joinToken) return;
    void api.accept(joinToken).then(
      (joined) => {
        setInvite(null);
        go(`/sets/${joined.set_id}`);
      },
      (error: unknown) => {
        if (error instanceof ApiFailure && error.code === "invite_used") {
          setInvite(null);
          setUsedLink(true);
        } else {
          setJoinProblem(error instanceof ApiFailure ? error.message : "The invite could not be accepted");
        }
      },
    );
  };

  let overlay = null;
  if (!user && booth) {
    overlay = <Booth onClose={() => setBooth(false)} onAuthed={(account) => { setUser(account); setBooth(false); }} />;
  } else if (user && usedLink) {
    overlay = <UsedInvite onClose={() => { setUsedLink(false); go("/"); }} />;
  } else if (user && invite && joinToken) {
    overlay = <JoinDialog name={invite.set_name} role={invite.role} problem={joinProblem} onJoin={join} onClose={() => { setInvite(null); go("/"); }} />;
  }

  return (
    <Shell
      user={user}
      store={store}
      sets={sets}
      onSignOut={signOut}
      onOpenSet={(id) => go(`/sets/${id}`)}
      onWorkspace={() => go("/")}
      onBooth={() => setBooth(true)}
      opening={wanted !== null && (store === null || store.setId !== wanted)}
      onImport={(file) => void api.importSet(file).then((doc) => go(`/sets/${doc.set.id}`), () => undefined)}
      overlay={overlay}
    />
  );
}
