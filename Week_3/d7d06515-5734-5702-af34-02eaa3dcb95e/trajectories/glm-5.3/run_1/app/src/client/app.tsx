import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { Landing } from "./landing.js";
import { AuthPage } from "./auth.js";
import { VerifyPage } from "./auth.js";
import { Dashboard } from "./dashboard.js";
import { EditorPage } from "./editor.js";
import { LinkPage } from "./linkpage.js";
import type { MeResponse } from "./types.js";

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseLocation(): Route {
  const clean = window.location.pathname + window.location.search;
  const [path, query] = clean.split("?");
  return { path, params: new URLSearchParams(query ?? "") };
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(parseLocation);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  useEffect(() => {
    const onPop = (): void => setRoute(parseLocation());
    window.addEventListener("popstate", onPop);
    const original = history.pushState.bind(history);
    history.pushState = ((...args: Parameters<typeof original>) => {
      original(...args);
      setRoute(parseLocation());
    }) as typeof history.pushState;
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadMe = useMemo(
    () => async () => {
      try {
        const result = await api<MeResponse>("/api/me");
        setMe(result);
        setMeLoaded(true);
      } catch {
        setMe(null);
        setMeLoaded(true);
      }
    },
    [],
  );

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const navigate = (path: string): void => {
    history.pushState({}, "", path);
  };
  void navigate;

  const path = route.path;
  let content: JSX.Element;
  if (path === "/" || path === "") {
    content = <Landing signedIn={me !== null} />;
  } else if (path === "/signup") {
    content = <AuthPage mode="signup" />;
  } else if (path === "/check-inbox") {
    content = <AuthPage mode="check-inbox" />;
  } else if (path.startsWith("/verify/")) {
    content = <VerifyPage token={path.slice("/verify/".length)} />;
  } else if (path === "/signin") {
    content = <AuthPage mode="signin" />;
  } else if (path === "/open") {
    content = <AuthPage mode="open" />;
  } else if (path === "/drawings") {
    if (meLoaded && me === null) {
      content = <AuthPage mode="signin" />;
      if (window.location.pathname !== "/signin") {
        window.history.replaceState({}, "", "/signin");
      }
    } else {
      content = <Dashboard me={me} onSignOut={loadMe} view={route.params.get("view")} folder={route.params.get("folder")} />;
    }
  } else if (path.startsWith("/d/")) {
    const drawingId = path.slice("/d/".length);
    if (meLoaded && me === null) {
      content = <AuthPage mode="signin" />;
      if (window.location.pathname !== "/signin") {
        window.history.replaceState({}, "", "/signin");
      }
    } else {
      content = <EditorPage me={me} drawingId={drawingId} linkToken={null} onMe={loadMe} />;
    }
  } else if (path.startsWith("/s/")) {
    content = <LinkPage token={path.slice("/s/".length)} me={me} onMe={loadMe} />;
  } else {
    content = <Landing signedIn={me !== null} />;
  }
  return content;
}
